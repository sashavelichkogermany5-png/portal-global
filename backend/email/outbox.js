'use strict';

const crypto = require('crypto');
const { openDb, run } = require('../db/sqlite-async');

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

async function queueEmail({ to, subject, html, text, from, kind }) {
  const db = openDb();
  const id = uuid();
  await run(db, `
    INSERT INTO email_outbox
    (id, to_email, subject, html, text, from_email, kind, status, attempts, last_error, locked_at, created_at, updated_at)
    VALUES
    (?, ?, ?, ?, ?, ?, ?, 'queued', 0, NULL, NULL, datetime('now'), datetime('now'))
  `, [
    id,
    to,
    subject,
    html,
    text || null,
    from || (process.env.EMAIL_FROM || process.env.SENDGRID_FROM || null),
    kind || 'generic'
  ]);
  db.close();
  return { id };
}

module.exports = { queueEmail };
