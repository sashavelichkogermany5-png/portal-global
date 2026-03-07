'use strict';

const { openDb, run, all, get, exec, DB_PATH } = require('./sqlite-async');

let _db = null;

function getDb() {
  if (_db) return _db;
  _db = openDb();
  return _db;
}

module.exports = { openDb, run, all, get, exec, getDb, DB_PATH };
