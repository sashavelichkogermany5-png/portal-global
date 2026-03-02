const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const loadEnv = () => {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const [key, ...rest] = trimmed.split('=');
        if (!key) return;
        const value = rest.join('=').trim();
        if (process.env[key] === undefined) {
            process.env[key] = value.replace(/^"|"$/g, '');
        }
    });
};

loadEnv();

const OWNER_EMAIL = String(process.env.OWNER_EMAIL || '').trim();
if (!OWNER_EMAIL) {
    console.error('[daily-report] OWNER_EMAIL is required');
    process.exit(1);
}

const DEFAULT_CURRENCY = String(process.env.DEFAULT_CURRENCY || 'EUR').trim().toUpperCase();
const BERLIN_TZ = 'Europe/Berlin';

const DB_PATH = process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.join(__dirname, '..', 'database', 'portal.db');
if (DB_PATH !== ':memory:') {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const db = new sqlite3.Database(DB_PATH);

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function runCallback(err) {
        if (err) return reject(err);
        return resolve({ id: this.lastID, changes: this.changes });
    });
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        return resolve(rows);
    });
});

const ensureTables = async () => {
    await dbRun('PRAGMA foreign_keys = ON');
    await dbRun(`
        CREATE TABLE IF NOT EXISTS financial_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            amount REAL NOT NULL,
            currency TEXT NOT NULL,
            tags TEXT,
            source TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS email_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            [to] TEXT NOT NULL,
            subject TEXT NOT NULL,
            body TEXT,
            html TEXT,
            text TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            last_attempt_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `);
    await dbRun('CREATE INDEX IF NOT EXISTS idx_financial_events_created ON financial_events(created_at)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox(status, created_at)');
};

const normalizeTags = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) {
        return Array.from(new Set(value.map((item) => String(item).trim()).filter(Boolean)));
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return Array.from(new Set(parsed.map((item) => String(item).trim()).filter(Boolean)));
            }
        } catch (error) {
            return Array.from(new Set(trimmed.split(',').map((item) => item.trim()).filter(Boolean)));
        }
        return Array.from(new Set(trimmed.split(',').map((item) => item.trim()).filter(Boolean)));
    }
    return [];
};

const parseTagsValue = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return normalizeTags(value);
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) return normalizeTags(parsed);
        } catch (error) {
            return normalizeTags(value);
        }
        return normalizeTags(value);
    }
    return [];
};

const formatSqliteDate = (date) => date.toISOString().slice(0, 19).replace('T', ' ');

const getTimeZoneParts = (timeZone, date) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).formatToParts(date);
    return parts.reduce((acc, part) => {
        if (part.type !== 'literal') {
            acc[part.type] = part.value;
        }
        return acc;
    }, {});
};

const getTimeZoneOffsetMinutes = (timeZone, date) => {
    const parts = getTimeZoneParts(timeZone, date);
    const asUtc = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second)
    );
    return (asUtc - date.getTime()) / 60000;
};

const getBerlinMidnightUtc = (year, month, day) => {
    const approxUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    const offsetMinutes = getTimeZoneOffsetMinutes(BERLIN_TZ, approxUtc);
    return new Date(approxUtc.getTime() - offsetMinutes * 60000);
};

const getBerlinDateString = (date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: BERLIN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
}).format(date);

const queueEmail = async ({ to, subject, body }) => {
    const toValue = String(to || '').trim();
    const subjectValue = String(subject || '').trim();
    const bodyValue = body === null || body === undefined ? '' : String(body);
    if (!toValue || !subjectValue || !bodyValue.trim()) {
        throw new Error('Email to, subject, and body are required');
    }
    const result = await dbRun(
        `INSERT INTO email_outbox ([to], subject, body, status, attempts, last_error, created_at)
         VALUES (?, ?, ?, 'pending', 0, NULL, datetime('now'))`,
        [toValue, subjectValue, bodyValue]
    );
    return result.id;
};

const buildWindow = () => {
    const now = new Date();
    const berlinParts = getTimeZoneParts(BERLIN_TZ, now);
    const end = getBerlinMidnightUtc(
        Number(berlinParts.year),
        Number(berlinParts.month),
        Number(berlinParts.day)
    );
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const reportDate = getBerlinDateString(start);
    return { start, end, reportDate };
};

const buildReportBody = ({ start, end, totalsByCurrency, typeCounts, tagCounts, reportDate }) => {
    const dateLabel = `${reportDate} (Europe/Berlin)`;
    const totals = Array.from(totalsByCurrency.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, amount]) => `- ${currency} ${amount.toFixed(2)}`);
    const types = Array.from(typeCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `- ${type}: ${count}`);
    const tags = Array.from(tagCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([tag, count]) => `- ${tag}: ${count}`);

    return [
        'Portal Global Daily Revenue Report',
        `Date: ${dateLabel}`,
        `Window: ${formatSqliteDate(start)} to ${formatSqliteDate(end)} (UTC)`,
        '',
        'Totals by currency:',
        ...(totals.length ? totals : ['- none']),
        '',
        'Top tags:',
        ...(tags.length ? tags : ['- none']),
        '',
        'Top event types:',
        ...(types.length ? types : ['- none'])
    ].join('\n');
};

const runReport = async () => {
    await ensureTables();
    const { start, end, reportDate } = buildWindow();
    const startValue = formatSqliteDate(start);
    const endValue = formatSqliteDate(end);

    const rows = await dbAll(
        `SELECT type, amount, currency, tags
         FROM financial_events
         WHERE created_at >= ? AND created_at < ?`,
        [startValue, endValue]
    );

    const totalsByCurrency = new Map();
    const typeCounts = new Map();
    const tagCounts = new Map();

    rows.forEach((row) => {
        const currency = String(row.currency || DEFAULT_CURRENCY).toUpperCase();
        const amountValue = Number(row.amount);
        const amount = Number.isFinite(amountValue) ? amountValue : 0;
        totalsByCurrency.set(currency, (totalsByCurrency.get(currency) || 0) + amount);
        const typeKey = String(row.type || 'unknown');
        typeCounts.set(typeKey, (typeCounts.get(typeKey) || 0) + 1);
        const tags = parseTagsValue(row.tags);
        tags.forEach((tag) => {
            tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        });
    });

    const subject = `Daily Revenue Report - ${reportDate}`;
    const body = buildReportBody({ start, end, reportDate, totalsByCurrency, typeCounts, tagCounts });
    const emailId = await queueEmail({ to: OWNER_EMAIL, subject, body });

    console.log(`[daily-report] queued email #${emailId} for ${OWNER_EMAIL}`);
    console.log(`[daily-report] events: ${rows.length}`);
};

runReport()
    .then(() => db.close())
    .catch((error) => {
        console.error('[daily-report] failed:', error);
        db.close(() => process.exit(1));
    });
