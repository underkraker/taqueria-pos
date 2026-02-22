const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'taqueria.db');
const db = new sqlite3.Database(dbPath);

console.log('Starting migration for Tips...');

db.serialize(() => {
    db.run(`ALTER TABLE orders ADD COLUMN tip REAL DEFAULT 0`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
            console.error('Error adding tip to orders:', err);
        } else {
            console.log('tip column ensures in orders table.');
        }
    });

    console.log('Migration completed.');
    db.close();
});
