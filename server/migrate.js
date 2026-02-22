const { db, initDb } = require('./database');

const migrate = async () => {
    console.log('Starting migration...');
    // Ensure branches table exists and has default branch
    await initDb();

    const tablesToUpdate = ['users', 'products', 'orders', 'inventory'];

    db.serialize(() => {
        tablesToUpdate.forEach(table => {
            db.run(`ALTER TABLE ${table} ADD COLUMN branch_id INTEGER DEFAULT 1`, (err) => {
                if (err) {
                    if (err.message.includes('duplicate column name')) {
                        console.log(`Column branch_id already exists in ${table}`);
                    } else {
                        console.error(`Error migrating ${table}:`, err.message);
                    }
                } else {
                    console.log(`Added branch_id to ${table}`);
                }
            });
        });

        // Note: We can't easily change the CHECK constraint on 'users.role' in SQLite 
        // without recreating the table. For now, we'll skip the super_admin check enforcement 
        // at the DB level for existing users, but the app code will handle it.

        console.log('Migration attempted for all tables.');
    });
};

migrate();
