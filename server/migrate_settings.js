const { db, initDb } = require('./database');

const migrateSettings = async () => {
    console.log('Starting Settings migration...');
    await initDb();

    db.serialize(() => {
        // Seed the initial security setting if it doesn't exist
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('security_enabled', '1')`, (err) => {
            if (err) {
                console.error('Error seeding settings:', err.message);
            } else {
                console.log('Global security setting initialized (enabled by default).');
            }
        });
        console.log('Settings migration attempted.');
    });
};

migrateSettings();
