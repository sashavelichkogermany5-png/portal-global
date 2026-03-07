'use strict';

const fs = require('fs');
const path = require('path');
const { openDb, exec, DB_PATH } = require('../db/sqlite-async');

const sqlPath = path.join(process.cwd(), 'backend', 'db', 'sql', 'email.sql');
if (!fs.existsSync(sqlPath)) {
  throw new Error(`Not found: ${sqlPath}`);
}

const sql = fs.readFileSync(sqlPath, 'utf8');

const run = async () => {
  const db = openDb();
  await exec(db, sql);
  db.close();
  console.log('[apply-email-sql] OK');
  console.log('db=', DB_PATH);
};

run().catch((error) => {
  console.error('[apply-email-sql] Failed', error);
  process.exit(1);
});
