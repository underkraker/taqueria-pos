const { db, initDb } = require('./database');

const fixUsersTable = async () => {
    await initDb();

    console.log('Migrating users table to support super_admin role...');

    db.serialize(() => {
        // 1. Create a temporary table with the new schema
        db.run(`CREATE TABLE users_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            role TEXT CHECK(role IN ('super_admin', 'admin', 'waiter', 'chef', 'cashier')),
            branch_id INTEGER DEFAULT 1,
            FOREIGN KEY(branch_id) REFERENCES branches(id)
        )`, (err) => {
            if (err) {
                console.error('Error creating users_new:', err.message);
                return;
            }

            // 2. Copy data from the old table to the new one
            // We need to be careful with column names. The old table has branch_id now thanks to migrate.js
            db.run(`INSERT INTO users_new (id, username, password, role, branch_id)
                    SELECT id, username, password, role, branch_id FROM users`, (err) => {
                if (err) {
                    console.error('Error copying data:', err.message);
                    return;
                }

                // 3. Drop the old table
                db.run(`DROP TABLE users`, (err) => {
                    if (err) {
                        console.error('Error dropping users:', err.message);
                        return;
                    }

                    // 4. Rename the new table to the original name
                    db.run(`ALTER TABLE users_new RENAME TO users`, (err) => {
                        if (err) {
                            console.error('Error renaming users_new:', err.message);
                            return;
                        }
                        console.log('Users table migrated successfully with super_admin support.');

                        // 5. Now try to seed the super admin again
                        const superAdmin = ['adminuniv', 'super123', 'super_admin', 1];
                        const stmt = db.prepare(`INSERT OR IGNORE INTO users (username, password, role, branch_id) VALUES (?, ?, ?, ?)`);
                        stmt.run(superAdmin, (err) => {
                            if (err) console.error('Error seeding super admin:', err.message);
                            else console.log('Super Admin "adminuniv" seeded successfully. Password: super123');
                        });
                        stmt.finalize();
                    });
                });
            });
        });
    });
};

fixUsersTable();
