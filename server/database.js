const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'taqueria.db');
const db = new sqlite3.Database(dbPath);

const initDb = () => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Sucursales
            db.run(`CREATE TABLE IF NOT EXISTS branches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                address TEXT,
                latitude REAL,
                longitude REAL,
                radius REAL DEFAULT 100, -- Radio en metros
                logo TEXT, -- Base64 o URL del logo
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Asegurar que exista al menos una sucursal por defecto
            db.run(`INSERT OR IGNORE INTO branches (id, name) VALUES (1, 'Sucursal Central')`);

            // Usuarios y Roles
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE,
                password TEXT,
                role TEXT CHECK(role IN ('super_admin', 'admin', 'waiter', 'chef', 'cashier')),
                branch_id INTEGER DEFAULT 1,
                FOREIGN KEY(branch_id) REFERENCES branches(id)
            )`);

            // Productos (Menú)
            db.run(`CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                price REAL,
                category TEXT,
                stock INTEGER DEFAULT 0,
                branch_id INTEGER DEFAULT 1,
                FOREIGN KEY(branch_id) REFERENCES branches(id)
            )`);

            // Órdenes
            db.run(`CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                table_number INTEGER,
                waiter_id INTEGER,
                status TEXT CHECK(status IN ('pending', 'preparing', 'ready', 'dispatched', 'paid', 'cancelled')),
                total REAL DEFAULT 0,
                payment_method TEXT DEFAULT 'cash', -- efectivo, tarjeta, transferencia
                tip REAL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                branch_id INTEGER DEFAULT 1,
                FOREIGN KEY(waiter_id) REFERENCES users(id),
                FOREIGN KEY(branch_id) REFERENCES branches(id)
            )`);

            // Detalles de la Orden
            db.run(`CREATE TABLE IF NOT EXISTS order_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER,
                product_id INTEGER,
                quantity INTEGER,
                notes TEXT,
                FOREIGN KEY(order_id) REFERENCES orders(id),
                FOREIGN KEY(product_id) REFERENCES products(id)
            )`);

            // Inventario / Insumos
            db.run(`CREATE TABLE IF NOT EXISTS inventory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_name TEXT,
                quantity REAL,
                unit TEXT,
                branch_id INTEGER DEFAULT 1,
                FOREIGN KEY(branch_id) REFERENCES branches(id)
            )`);

            // Configuraciones Globales
            db.run(`CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )`);

            // Gastos de la Sucursal
            db.run(`CREATE TABLE IF NOT EXISTS expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                branch_id INTEGER,
                description TEXT,
                amount REAL,
                category TEXT, -- 'renta', 'insumos', 'nomina', 'otros'
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(branch_id) REFERENCES branches(id)
            )`);

            // Base de Datos de Clientes
            db.run(`CREATE TABLE IF NOT EXISTS customers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                branch_id INTEGER,
                name TEXT,
                phone TEXT,
                email TEXT,
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(branch_id) REFERENCES branches(id)
            )`);

            // Recetas (Escandallos) - Vincula productos a insumos
            db.run(`CREATE TABLE IF NOT EXISTS recipes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER,
                inventory_id INTEGER,
                quantity_needed REAL, -- Cuánto de este insumo usa 1 unidad del producto
                FOREIGN KEY(product_id) REFERENCES products(id),
                FOREIGN KEY(inventory_id) REFERENCES inventory(id)
            )`);

            // Configuración Visual de Mesas
            db.run(`CREATE TABLE IF NOT EXISTS tables_config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                branch_id INTEGER,
                table_number INTEGER,
                pos_x INTEGER DEFAULT 0,
                pos_y INTEGER DEFAULT 0,
                status TEXT DEFAULT 'available', -- 'available', 'occupied', 'dirty'
                FOREIGN KEY(branch_id) REFERENCES branches(id)
            )`);

            // Dispositivos Autorizados
            db.run(`CREATE TABLE IF NOT EXISTS devices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_token TEXT UNIQUE,
                branch_id INTEGER,
                allowed_role TEXT, -- 'waiter', 'cashier', 'chef', 'any'
                nickname TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(branch_id) REFERENCES branches(id)
            )`);

            // Historial de Cortes de Caja
            db.run(`CREATE TABLE IF NOT EXISTS cash_cuts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                branch_id INTEGER,
                total_sales REAL,
                total_expenses REAL,
                net_profit REAL,
                expected_cash REAL DEFAULT 0,
                declared_cash REAL DEFAULT 0,
                difference REAL DEFAULT 0,
                card_totals REAL DEFAULT 0,
                transfer_totals REAL DEFAULT 0,
                tips REAL DEFAULT 0,
                details TEXT, -- JSON con detalles de las ventas y gastos
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(branch_id) REFERENCES branches(id)
            )`, (err) => {
                if (err) reject(err);
                else {
                    console.log('Database initialized successfully.');
                    resolve();
                }
            });
        });
    });
};

module.exports = { db, initDb };
