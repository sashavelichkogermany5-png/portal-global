'use strict';
const { openDb, all } = require('../db/sqlite-async');

const run = async () => {
  const db = openDb();
  const columns = await all(db, 'PRAGMA table_info(email_outbox)');
  const columnNames = new Set((columns || []).map((col) => col.name));
  const wanted = ['id', 'to_email', 'subject', 'status', 'attempts', 'created_at', 'sent_at', 'last_error'];
  const selectColumns = wanted.filter((col) => columnNames.has(col));
  const sql = `
    SELECT ${selectColumns.length ? selectColumns.join(', ') : '*'}
    FROM email_outbox
    ORDER BY created_at DESC
    LIMIT 10
  `;
  const rows = await all(db, sql);
  console.table(rows);
  db.close();
};

run().catch((error) => {
  console.error('[check-outbox] Failed', error);
  process.exit(1);
});
