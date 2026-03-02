const createDbHelpers = (db) => {
    const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
        db.run(sql, params, function runCallback(err) {
            if (err) {
                err.sql = sql;
                err.params = params;
                return reject(err);
            }
            return resolve({ id: this.lastID, changes: this.changes });
        });
    });

    const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            return resolve(row);
        });
    });

    const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) return reject(err);
            return resolve(rows);
        });
    });

    return { dbRun, dbGet, dbAll };
};

const nowUnix = () => Math.floor(Date.now() / 1000);

module.exports = {
    createDbHelpers,
    nowUnix
};
