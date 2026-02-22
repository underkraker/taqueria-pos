// Migration: Add delivery_price to products + ticket settings
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.resolve(__dirname, 'taqueria.db'));

const migrations = [
    `ALTER TABLE products ADD COLUMN delivery_price REAL DEFAULT 0`,
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
            // Now seed default ticket settings
            const ticketSettings = [
                ['ticket_header', 'Taquería El Cerebro'],
                ['ticket_footer', '¡Gracias por su compra! Vuelva pronto 🌮'],
                ['ticket_show_logo', '1'],
                ['ticket_qr_url', ''],
                ['ticket_show_qr', '0'],
            ];
            let settingsDone = 0;
            ticketSettings.forEach(([key, value]) => {
                db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, [key, value], (err) => {
                    settingsDone++;
                    if (settingsDone === ticketSettings.length) {
                        console.log('✅ Ticket settings seeded');
                        db.close();
                    }
                });
            });
        }
    });
});
