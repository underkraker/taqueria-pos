const { db, initDb } = require('./database');

const migrateLogo = async () => {
    console.log('Starting Branding (Logo) migration...');
    await initDb();

    db.serialize(() => {
        db.run(`ALTER TABLE branches ADD COLUMN logo TEXT`, (err) => {
            if (err) {
                if (err.message.includes('duplicate column name')) {
                    console.log('Column logo already exists in branches');
                } else {
                    console.error('Error migrating branches (logo):', err.message);
                }
            } else {
                console.log('Added logo column to branches');
            }
        });
        console.log('Branding migration attempted.');
    });
};

migrateLogo();
