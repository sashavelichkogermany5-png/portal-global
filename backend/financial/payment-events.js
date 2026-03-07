'use strict';

const crypto = require('crypto');
const { openDb, run } = require('../db/sqlite-async');
const { queueEmail } = require('../email/outbox');

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function money(amountCents, currency = 'EUR') {
  return `${(Number(amountCents) / 100).toFixed(2)} ${currency}`;
}

async function onPaymentReceived(payload) {
  const db = openDb();

  const event = {
    id: uuid(),
    type: 'payment_received',
    amount_cents: Number(payload.amount_cents || 0),
    currency: payload.currency || 'EUR',
    tenant_id: payload.tenant_id || null,
    user_id: payload.user_id || null,
    source: payload.source || 'unknown',
    meta_json: JSON.stringify(payload.meta || {})
  };

  await run(db, `
    INSERT INTO financial_events
    (id, type, amount_cents, currency, tenant_id, user_id, source, meta_json, created_at)
    VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `, [
    event.id,
    event.type,
    event.amount_cents,
    event.currency,
    event.tenant_id,
    event.user_id,
    event.source,
    event.meta_json
  ]);
  db.close();

  const owner = process.env.OWNER_EMAIL;
  if (owner) {
    const subject = `Payment received: ${money(event.amount_cents, event.currency)}${event.tenant_id ? ` (${event.tenant_id})` : ''}`;

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.4">
        <h2>Payment received</h2>
        <p><b>Amount:</b> ${money(event.amount_cents, event.currency)}</p>
        <p><b>Tenant:</b> ${escapeHtml(event.tenant_id || 'unknown')}</p>
        <p><b>Source:</b> ${escapeHtml(event.source)}</p>
        <p><b>Event ID:</b> ${escapeHtml(event.id)}</p>
        <hr/>
        <pre style="background:#f6f6f6;padding:12px;border-radius:8px;white-space:pre-wrap">${escapeHtml(event.meta_json)}</pre>
      </div>
    `.trim();

    const text =
`Payment received
Amount: ${money(event.amount_cents, event.currency)}
Tenant: ${event.tenant_id || 'unknown'}
Source: ${event.source}
Event ID: ${event.id}
Meta: ${event.meta_json}`;

    await queueEmail({
      to: owner,
      subject,
      html,
      text,
      kind: 'owner_alert'
    });
  }

  return event;
}

module.exports = { onPaymentReceived };
