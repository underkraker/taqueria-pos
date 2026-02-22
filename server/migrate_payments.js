const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'taqueria.db');
const db = new sqlite3.Database(dbPath);

console.log('Starting migration for Payments and Cash Drawer...');

db.serialize(() => {
    // 1. Añadir payment_method a orders
    db.run(`ALTER TABLE orders ADD COLUMN payment_method TEXT DEFAULT 'cash'`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
            console.error('Error adding payment_method to orders:', err);
        } else {
            console.log('payment_method column ensures in orders table.');
        }
    });

    // 2. Añadir campos al arqueo en cash_cuts
    const cashCutColumns = [
        'expected_cash REAL DEFAULT 0',
        'declared_cash REAL DEFAULT 0',
        'difference REAL DEFAULT 0',
        'card_totals REAL DEFAULT 0',
        'transfer_totals REAL DEFAULT 0',
        'tips REAL DEFAULT 0'
    ];

    cashCutColumns.forEach(col => {
        db.run(`ALTER TABLE cash_cuts ADD COLUMN ${col}`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error(`Error adding ${col} to cash_cuts:`, err);
            } else {
                console.log(`${col} column ensures in cash_cuts table.`);
            }
        });
    });

    console.log('Migration completed.');
    db.close();
});
