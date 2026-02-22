// Migration: Add delivery fields to orders table
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.resolve(__dirname, 'taqueria.db'));

const migrations = [
    `ALTER TABLE orders ADD COLUMN order_type TEXT DEFAULT 'dine_in'`,
    `ALTER TABLE orders ADD COLUMN customer_name TEXT DEFAULT ''`,
    `ALTER TABLE orders ADD COLUMN customer_phone TEXT DEFAULT ''`,
    `ALTER TABLE orders ADD COLUMN delivery_address TEXT DEFAULT ''`,
    `ALTER TABLE orders ADD COLUMN delivery_notes TEXT DEFAULT ''`,
    `ALTER TABLE orders ADD COLUMN platform_commission REAL DEFAULT 0`,
];

let completed = 0;
migrations.forEach(sql => {
    db.run(sql, (err) => {
        completed++;
        if (err && !err.message.includes('duplicate column')) {
            console.error('Migration error:', err.message);
        } else {
            console.log(`✅ Migration ${completed}/${migrations.length} applied`);
        }
        if (completed === migrations.length) {
            console.log('All delivery migrations complete!');
            db.close();
        }
    });
});
