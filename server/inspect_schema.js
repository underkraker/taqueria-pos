const { db, initDb } = require('./database');

const inspectSchema = async () => {
    await initDb();
    db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'", (err, row) => {
        if (err) console.error(err);
        else console.log('Schema for users:', row.sql);
    });
};

inspectSchema();
