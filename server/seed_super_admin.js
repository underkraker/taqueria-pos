const { db, initDb } = require('./database');

const seedSuperAdmin = async () => {
    await initDb();

    const superAdmin = ['adminuniv', 'super123', 'super_admin', 1]; // id 1 is default branch

    db.serialize(() => {
        const stmt = db.prepare(`INSERT OR IGNORE INTO users (username, password, role, branch_id) VALUES (?, ?, ?, ?)`);
        stmt.run(superAdmin, (err) => {
            if (err) console.error('Error seeding super admin:', err.message);
            else console.log('Super Admin "adminuniv" seeded successfully. Password: super123');
        });
        stmt.finalize();
    });
};

seedSuperAdmin();
