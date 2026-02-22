const { db, initDb } = require('./database');

const seedData = async () => {
    await initDb();

    db.serialize(() => {
        // Insert Users
        const users = [
            ['admin', 'admin123', 'admin'],
            ['mesero1', 'mesero123', 'waiter'],
            ['taquero1', 'taquero123', 'chef'],
            ['cajero1', 'cajero123', 'cashier']
        ];

        const userStmt = db.prepare(`INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)`);
        users.forEach(u => userStmt.run(u));
        userStmt.finalize();

        // Insert Products (Menu)
        const products = [
            ['Taco de Pastor', 15.0, 'tacos', 100],
            ['Taco de Bistec', 18.0, 'tacos', 100],
            ['Taco de Cabeza', 15.0, 'tacos', 80],
            ['Gringa de Pastor', 45.0, 'tortas_gringas', 50],
            ['Refresco 600ml', 25.0, 'bebidas', 200],
            ['Agua Natural', 20.0, 'bebidas', 150]
        ];

        const prodStmt = db.prepare(`INSERT OR IGNORE INTO products (name, price, category, stock) VALUES (?, ?, ?, ?)`);
        products.forEach(p => prodStmt.run(p));
        prodStmt.finalize();

        // Insert Inventory items
        const inventoryItems = [
            ['Tortillas', 10.0, 'kg'],
            ['Carne Pastor', 5.0, 'kg'],
            ['Bistec', 5.0, 'kg'],
            ['Cebolla', 2.0, 'kg'],
            ['Cilantro', 1.0, 'kg'],
            ['Salsa Roja', 2.0, 'lt']
        ];

        const invStmt = db.prepare(`INSERT OR IGNORE INTO inventory (item_name, quantity, unit) VALUES (?, ?, ?)`);
        inventoryItems.forEach(i => invStmt.run(i));
        invStmt.finalize();

        console.log('Seed data inserted successfully.');
    });
};

seedData();
