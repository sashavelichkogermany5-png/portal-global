const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const nodemailer = require('nodemailer');

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

const ensureEmailOutbox = async () => {
    await dbRun('PRAGMA foreign_keys = ON');
    await dbRun(`
        CREATE TABLE IF NOT EXISTS email_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER,
            [to] TEXT NOT NULL,
            subject TEXT NOT NULL,
            body TEXT,
            body_html TEXT,
            html TEXT,
            text TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            last_attempt_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            sent_at TEXT
        )
    `);
    await dbRun('CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox(status, created_at)');
};

const toNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const EMAIL_BATCH_SIZE = toNumber(process.env.EMAIL_BATCH_SIZE, 10);
const EMAIL_MAX_ATTEMPTS = toNumber(process.env.EMAIL_MAX_ATTEMPTS, 5);
const EMAIL_POLL_INTERVAL_MS = toNumber(process.env.EMAIL_POLL_INTERVAL_MS, 10000);
const EMAIL_STUCK_MINUTES = toNumber(process.env.EMAIL_STUCK_MINUTES, 15);

const resolveFromAddress = () => {
    const fromEmail = process.env.EMAIL_FROM
        || process.env.SMTP_FROM
        || process.env.SENDGRID_FROM
        || '';
    const fromName = process.env.EMAIL_FROM_NAME
        || process.env.SMTP_FROM_NAME
        || process.env.SENDGRID_FROM_NAME
        || '';
    if (!fromEmail) {
        throw new Error('EMAIL_FROM (or SMTP_FROM / SENDGRID_FROM) is required');
    }
    return fromName ? `${fromName} <${fromEmail}>` : fromEmail;
};

const createEmailSender = () => {
    const provider = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
    const sendgridKey = process.env.SENDGRID_API_KEY;
    const smtpHost = process.env.SMTP_HOST;
    const resolvedProvider = provider || (sendgridKey ? 'sendgrid' : 'smtp');
    const from = resolveFromAddress();

    if (resolvedProvider === 'sendgrid') {
        if (!sendgridKey) {
            throw new Error('SENDGRID_API_KEY is required for SendGrid');
        }
        const fromEmail = (process.env.SENDGRID_FROM || process.env.EMAIL_FROM || '').trim();
        const fromName = (process.env.SENDGRID_FROM_NAME || process.env.EMAIL_FROM_NAME || '').trim();
        return {
            provider: 'sendgrid',
            send: async ({ to, subject, text, html }) => {
                const contentValue = html || text || '';
                const contentType = html ? 'text/html' : 'text/plain';
                const payload = {
                    personalizations: [{ to: [{ email: to }], subject }],
                    from: {
                        email: fromEmail || from,
                        ...(fromName ? { name: fromName } : {})
                    },
                    content: [{ type: contentType, value: contentValue }]
                };
                const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${sendgridKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });
                if (!response.ok) {
                    const responseText = await response.text();
                    throw new Error(`SendGrid error ${response.status}: ${responseText}`);
                }
            }
        };
    }

    if (!smtpHost) {
        throw new Error('SMTP_HOST is required for SMTP');
    }

    const smtpPort = toNumber(process.env.SMTP_PORT, 587);
    const smtpSecure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';
    const smtpUser = process.env.SMTP_USER || '';
    const smtpPass = process.env.SMTP_PASS || '';
    const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: smtpUser ? { user: smtpUser, pass: smtpPass } : undefined
    });

    return {
        provider: 'smtp',
        send: async ({ to, subject, text, html }) => {
            await transporter.sendMail({
                from,
                to,
                subject,
                ...(html ? { html } : {}),
                ...(text ? { text } : {})
            });
        }
    };
};

const resolveContent = (row) => {
    const bodyValue = (row.body || '').trim();
    const textValue = (row.text || '').trim();
    const htmlValue = (row.html || row.body_html || '').trim();
    if (htmlValue) {
        return { text: textValue || bodyValue || null, html: htmlValue };
    }
    if (textValue) {
        return { text: textValue, html: null };
    }
    if (bodyValue) {
        return { text: bodyValue, html: null };
    }
    return { text: '', html: null };
};

const markStuckEmails = async () => {
    const retryWindow = `-${EMAIL_STUCK_MINUTES} minutes`;
    await dbRun(
        `UPDATE email_outbox
         SET status = 'pending'
         WHERE status = 'sending'
           AND (last_attempt_at IS NULL OR last_attempt_at < datetime('now', ?))`,
        [retryWindow]
    );
};

const processOutbox = async (sender) => {
    await ensureEmailOutbox();
    await markStuckEmails();

    const rows = await dbAll(
        `SELECT id, [to] as recipient, subject, body, body_html, text, html, attempts
         FROM email_outbox
         WHERE status = 'pending' AND attempts < ?
         ORDER BY created_at ASC
         LIMIT ?`,
        [EMAIL_MAX_ATTEMPTS, EMAIL_BATCH_SIZE]
    );

    for (const row of rows) {
        const lock = await dbRun(
            `UPDATE email_outbox
             SET status = 'sending', attempts = attempts + 1, last_attempt_at = datetime('now')
             WHERE id = ? AND status = 'pending'`,
            [row.id]
        );
        if (!lock.changes) continue;

        const { text, html } = resolveContent(row);
        if (!text && !html) {
            await dbRun(
                `UPDATE email_outbox
                 SET status = 'failed', last_error = ?
                 WHERE id = ?`,
                ['Email body is empty', row.id]
            );
            console.error(`[worker] email #${row.id} has empty body`);
            continue;
        }

        try {
            await sender.send({ to: row.recipient, subject: row.subject, text, html });
            await dbRun(
                `UPDATE email_outbox
                 SET status = 'sent', last_error = NULL, sent_at = datetime('now')
                 WHERE id = ?`,
                [row.id]
            );
            console.log(`[worker] sent email #${row.id} to ${row.recipient}`);
        } catch (error) {
            const attempts = row.attempts + 1;
            const nextStatus = attempts >= EMAIL_MAX_ATTEMPTS ? 'failed' : 'pending';
            const message = String(error?.message || error).slice(0, 1000);
            await dbRun(
                `UPDATE email_outbox
                 SET status = ?, last_error = ?
                 WHERE id = ?`,
                [nextStatus, message, row.id]
            );
            console.error(`[worker] failed email #${row.id}: ${message}`);
        }
    }
};

const startWorker = async () => {
    const sender = createEmailSender();
    console.log(`[worker] email provider: ${sender.provider}`);

    let isProcessing = false;
    const runLoop = async () => {
        if (isProcessing) return;
        isProcessing = true;
        try {
            await processOutbox(sender);
        } catch (error) {
            console.error('[worker] processing error:', error);
        } finally {
            isProcessing = false;
        }
    };

    await runLoop();
    const interval = Number.isFinite(EMAIL_POLL_INTERVAL_MS) && EMAIL_POLL_INTERVAL_MS > 0
        ? EMAIL_POLL_INTERVAL_MS
        : 10000;
    const timer = setInterval(runLoop, interval);

    const shutdown = () => {
        clearInterval(timer);
        db.close(() => process.exit(0));
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
};

startWorker().catch((error) => {
    console.error('[worker] startup failed:', error);
    process.exit(1);
});
