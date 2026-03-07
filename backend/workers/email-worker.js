'use strict';

const nodemailer = require('nodemailer');
const { openDb, run, all, DB_PATH } = require('../db/sqlite-async');

let sendgrid = null;
try {
  sendgrid = require('@sendgrid/mail');
} catch (error) {
  sendgrid = null;
}

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const EMAIL_BATCH_SIZE = toNumber(process.env.EMAIL_BATCH_SIZE, 10);
const EMAIL_MAX_ATTEMPTS = toNumber(process.env.EMAIL_MAX_ATTEMPTS, 5);
const EMAIL_POLL_INTERVAL_MS = toNumber(process.env.EMAIL_POLL_INTERVAL_MS, 10000);
const EMAIL_STUCK_MINUTES = toNumber(process.env.EMAIL_STUCK_MINUTES, 15);

const resolveFromAddress = (override) => {
  if (override) return override;
  const fromEmail = process.env.EMAIL_FROM
    || process.env.SENDGRID_FROM
    || process.env.SMTP_FROM
    || '';
  const fromName = process.env.EMAIL_FROM_NAME
    || process.env.SENDGRID_FROM_NAME
    || process.env.SMTP_FROM_NAME
    || '';
  if (!fromEmail) return '';
  return fromName ? `${fromName} <${fromEmail}>` : fromEmail;
};

const createEmailSender = () => {
  const provider = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
  const sendgridKey = process.env.SENDGRID_API_KEY;
  const smtpHost = process.env.SMTP_HOST;
  const resolvedProvider = provider || (sendgridKey ? 'sendgrid' : 'smtp');

  if (resolvedProvider === 'sendgrid') {
    if (!sendgridKey) {
      throw new Error('SENDGRID_API_KEY is required for SendGrid');
    }
    if (!sendgrid) {
      throw new Error('@sendgrid/mail is not installed');
    }
    sendgrid.setApiKey(sendgridKey);
    return {
      provider: 'sendgrid',
      send: async ({ to, subject, text, html, from }) => {
        const fromValue = resolveFromAddress(from);
        if (!fromValue) {
          throw new Error('EMAIL_FROM (or SENDGRID_FROM / SMTP_FROM) is required');
        }
        await sendgrid.send({
          to,
          from: fromValue,
          subject,
          text: text || undefined,
          html: html || undefined
        });
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
    send: async ({ to, subject, text, html, from }) => {
      const fromValue = resolveFromAddress(from);
      if (!fromValue) {
        throw new Error('EMAIL_FROM (or SENDGRID_FROM / SMTP_FROM) is required');
      }
      await transporter.sendMail({
        from: fromValue,
        to,
        subject,
        ...(html ? { html } : {}),
        ...(text ? { text } : {})
      });
    }
  };
};

const resolveContent = (row) => {
  const htmlValue = (row.html || '').trim();
  const textValue = (row.text || '').trim();
  if (htmlValue) {
    return { text: textValue || null, html: htmlValue };
  }
  if (textValue) {
    return { text: textValue, html: null };
  }
  return { text: '', html: null };
};

const db = openDb();

const markStuckEmails = async () => {
  const retryWindow = `-${EMAIL_STUCK_MINUTES} minutes`;
  await run(db, `
    UPDATE email_outbox
    SET status = 'queued', locked_at = NULL, updated_at = datetime('now')
    WHERE status = 'sending'
      AND locked_at IS NOT NULL
      AND locked_at < datetime('now', ?)
  `, [retryWindow]);
};

const processOutbox = async (sender) => {
  await markStuckEmails();

  const rows = await all(db, `
    SELECT id, to_email, subject, html, text, from_email, kind, attempts
    FROM email_outbox
    WHERE status = 'queued' AND attempts < ?
    ORDER BY created_at ASC
    LIMIT ?
  `, [EMAIL_MAX_ATTEMPTS, EMAIL_BATCH_SIZE]);

  for (const row of rows) {
    const lock = await run(db, `
      UPDATE email_outbox
      SET status = 'sending', attempts = attempts + 1, locked_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND status = 'queued'
    `, [row.id]);
    if (!lock.changes) continue;

    const { text, html } = resolveContent(row);
    if (!text && !html) {
      await run(db, `
        UPDATE email_outbox
        SET status = ?, last_error = ?, locked_at = NULL, updated_at = datetime('now')
        WHERE id = ?
      `, ['failed', 'Email body is empty', row.id]);
      continue;
    }

    try {
      await sender.send({
        to: row.to_email,
        subject: row.subject,
        text,
        html,
        from: row.from_email || null
      });
      await run(db, `
        UPDATE email_outbox
        SET status = 'sent', last_error = NULL, locked_at = NULL, updated_at = datetime('now')
        WHERE id = ?
      `, [row.id]);
      console.log(`[email-worker] sent ${row.id} -> ${row.to_email}`);
    } catch (error) {
      const attempts = Number(row.attempts || 0) + 1;
      const nextStatus = attempts >= EMAIL_MAX_ATTEMPTS ? 'failed' : 'queued';
      const message = String(error?.message || error).slice(0, 1000);
      await run(db, `
        UPDATE email_outbox
        SET status = ?, last_error = ?, locked_at = NULL, updated_at = datetime('now')
        WHERE id = ?
      `, [nextStatus, message, row.id]);
      console.error(`[email-worker] failed ${row.id}: ${message}`);
    }
  }
};

const startWorker = async () => {
  const sender = createEmailSender();
  console.log(`[email-worker] provider: ${sender.provider}`);
  console.log(`[email-worker] db: ${DB_PATH}`);

  let isProcessing = false;
  const runLoop = async () => {
    if (isProcessing) return;
    isProcessing = true;
    try {
      await processOutbox(sender);
    } catch (error) {
      console.error('[email-worker] processing error:', error);
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
  console.error('[email-worker] startup failed:', error);
  process.exit(1);
});
