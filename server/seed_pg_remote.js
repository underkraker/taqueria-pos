const { db, initDb } = require('./database-pg');

const seedRemote = async () => {
    try {
        await initDb();
        console.log('DB Initialized');

        // Insert Super Admin
        const superAdmin = ['adminuniv', 'super123', 'super_admin', 1];
        db.run(`INSERT INTO users (username, password, role, branch_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, superAdmin);

        // Insert regular users
        const users = [
            ['admin', 'admin123', 'admin'],
            ['mesero1', 'mesero123', 'waiter'],
            ['taquero1', 'taquero123', 'chef'],
            ['cajero1', 'cajero123', 'cashier']
        ];

        for (const u of users) {
            db.run(`INSERT INTO users (username, password, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, u);
        }

        setTimeout(() => {
            db.all(`SELECT id, username, password, role FROM users`, (err, rows) => {
                if (err) console.error(err);
                console.log('--- USERS IN REMOTE DB ---');
                console.table(rows);
                process.exit(0);
            });
        }, 2000); // Give time for async queries to finish

    } catch (err) {
        console.error(err);
    }
}

seedRemote();
