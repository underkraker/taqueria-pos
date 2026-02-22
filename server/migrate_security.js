const { db, initDb } = require('./database');

const migrateSecurity = async () => {
    console.log('Starting Security migration...');
    await initDb();

    db.serialize(() => {
        // Add columns to branches
        const columns = ['latitude', 'longitude', 'radius'];
        columns.forEach(col => {
            const type = col === 'radius' ? 'REAL DEFAULT 100' : 'REAL';
            db.run(`ALTER TABLE branches ADD COLUMN ${col} ${type}`, (err) => {
                if (err) {
                    if (err.message.includes('duplicate column name')) {
                        console.log(`Column ${col} already exists in branches`);
                    } else {
                        console.error(`Error migrating branches (${col}):`, err.message);
                    }
                } else {
                    console.log(`Added ${col} to branches`);
                }
            });
        });

        console.log('Security migration attempted.');
    });
};

migrateSecurity();
