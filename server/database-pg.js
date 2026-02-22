const { Pool } = require('pg');

// Connection - uses DATABASE_URL env variable (Neon/Render)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// ========= SQLite → PostgreSQL Compatibility Wrapper =========
// Auto-converts ? placeholders to $1, $2, $3 etc.
// Provides db.all(), db.run(), db.get(), db.serialize() matching sqlite3 API

function convertPlaceholders(sql) {
    let idx = 0;
    return sql.replace(/\?/g, () => `$${++idx}`);
}

// Convert SQLite-specific syntax to PostgreSQL
function convertSyntax(sql) {
    let pgSql = sql;
    // AUTOINCREMENT → handled by SERIAL in CREATE TABLE
    pgSql = pgSql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
    // INSERT OR IGNORE → ON CONFLICT DO NOTHING
    pgSql = pgSql.replace(/INSERT OR IGNORE/gi, 'INSERT');
    // Boolean-ish style handling
    return pgSql;
}

const db = {
    all(sql, params, callback) {
        // Handle (sql, callback) signature
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        const pgSql = convertPlaceholders(sql);
        pool.query(pgSql, params || [])
            .then(result => callback(null, result.rows))
            .catch(err => callback(err));
    },

    get(sql, params, callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        const pgSql = convertPlaceholders(sql);
        pool.query(pgSql, params || [])
            .then(result => callback(null, result.rows[0] || null))
            .catch(err => callback(err));
    },

    run(sql, params, callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        const pgSql = convertPlaceholders(sql);

        // For INSERT statements, add RETURNING id to get lastID
        let finalSql = pgSql;
        if (/^\s*INSERT/i.test(sql) && !/RETURNING/i.test(sql)) {
            finalSql = pgSql + ' RETURNING id';
        }

        pool.query(finalSql, params || [])
            .then(result => {
                // Simulate sqlite3 `this` context with lastID and changes
                const context = {
                    lastID: result.rows?.[0]?.id || 0,
                    changes: result.rowCount || 0
                };
                if (callback) callback.call(context, null);
            })
            .catch(err => {
                if (callback) callback(err);
            });
    },

    serialize(fn) {
        // PostgreSQL handles serialization automatically
        fn();
    },

    prepare(sql) {
        const pgSql = convertPlaceholders(sql);
        return {
            run(...args) {
                pool.query(pgSql, args).catch(err => console.error('Prepared stmt error:', err.message));
            },
            finalize() { /* no-op for pg */ }
        };
    }
};

// ========= Database Initialization (PostgreSQL syntax) =========
const initDb = async () => {
    const client = await pool.connect();
    try {
        // Sucursales
        await client.query(`CREATE TABLE IF NOT EXISTS branches (
            id SERIAL PRIMARY KEY,
            name TEXT,
            address TEXT,
            latitude REAL,
            longitude REAL,
            radius REAL DEFAULT 100,
            logo TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        // Default branch
        await client.query(`INSERT INTO branches (id, name) VALUES (1, 'Sucursal Central') ON CONFLICT (id) DO NOTHING`);
        await client.query(`SELECT setval('branches_id_seq', (SELECT COALESCE(MAX(id),1) FROM branches))`);

        // Usuarios
        await client.query(`CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE,
            password TEXT,
            role TEXT CHECK(role IN ('super_admin', 'admin', 'waiter', 'chef', 'cashier')),
            branch_id INTEGER DEFAULT 1,
            FOREIGN KEY(branch_id) REFERENCES branches(id)
        )`);

        // Productos
        await client.query(`CREATE TABLE IF NOT EXISTS products (
            id SERIAL PRIMARY KEY,
            name TEXT,
            price REAL,
            category TEXT,
            stock INTEGER DEFAULT 0,
            branch_id INTEGER DEFAULT 1,
            delivery_price REAL DEFAULT 0,
            FOREIGN KEY(branch_id) REFERENCES branches(id)
        )`);

        // Órdenes
        await client.query(`CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY,
            table_number INTEGER,
            waiter_id INTEGER,
            status TEXT CHECK(status IN ('pending', 'preparing', 'ready', 'paid', 'cancelled')),
            total REAL DEFAULT 0,
            payment_method TEXT DEFAULT 'cash',
            tip REAL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            branch_id INTEGER DEFAULT 1,
            order_type TEXT DEFAULT 'dine_in',
            customer_name TEXT DEFAULT '',
            customer_phone TEXT DEFAULT '',
            delivery_address TEXT DEFAULT '',
            delivery_notes TEXT DEFAULT '',
            platform_commission REAL DEFAULT 0,
            FOREIGN KEY(waiter_id) REFERENCES users(id),
            FOREIGN KEY(branch_id) REFERENCES branches(id)
        )`);

        // Detalles de Orden
        await client.query(`CREATE TABLE IF NOT EXISTS order_items (
            id SERIAL PRIMARY KEY,
            order_id INTEGER,
            product_id INTEGER,
            quantity INTEGER,
            notes TEXT,
            FOREIGN KEY(order_id) REFERENCES orders(id),
            FOREIGN KEY(product_id) REFERENCES products(id)
        )`);

        // Inventario
        await client.query(`CREATE TABLE IF NOT EXISTS inventory (
            id SERIAL PRIMARY KEY,
            item_name TEXT,
            quantity REAL,
            unit TEXT,
            branch_id INTEGER DEFAULT 1,
            FOREIGN KEY(branch_id) REFERENCES branches(id)
        )`);

        // Settings
        await client.query(`CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )`);

        // Gastos
        await client.query(`CREATE TABLE IF NOT EXISTS expenses (
            id SERIAL PRIMARY KEY,
            branch_id INTEGER,
            description TEXT,
            amount REAL,
            category TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(branch_id) REFERENCES branches(id)
        )`);

        // Clientes
        await client.query(`CREATE TABLE IF NOT EXISTS customers (
            id SERIAL PRIMARY KEY,
            branch_id INTEGER,
            name TEXT,
            phone TEXT,
            email TEXT,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(branch_id) REFERENCES branches(id)
        )`);

        // Recetas
        await client.query(`CREATE TABLE IF NOT EXISTS recipes (
            id SERIAL PRIMARY KEY,
            product_id INTEGER,
            inventory_id INTEGER,
            quantity_needed REAL,
            FOREIGN KEY(product_id) REFERENCES products(id),
            FOREIGN KEY(inventory_id) REFERENCES inventory(id)
        )`);

        // Config Mesas
        await client.query(`CREATE TABLE IF NOT EXISTS tables_config (
            id SERIAL PRIMARY KEY,
            branch_id INTEGER,
            table_number INTEGER,
            pos_x INTEGER DEFAULT 0,
            pos_y INTEGER DEFAULT 0,
            status TEXT DEFAULT 'available',
            FOREIGN KEY(branch_id) REFERENCES branches(id)
        )`);

        // Dispositivos
        await client.query(`CREATE TABLE IF NOT EXISTS devices (
            id SERIAL PRIMARY KEY,
            device_token TEXT UNIQUE,
            branch_id INTEGER,
            allowed_role TEXT,
            nickname TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(branch_id) REFERENCES branches(id)
        )`);

        // Cortes de Caja
        await client.query(`CREATE TABLE IF NOT EXISTS cash_cuts (
            id SERIAL PRIMARY KEY,
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
            details TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(branch_id) REFERENCES branches(id)
        )`);

        // Ticket settings defaults
        const ticketDefaults = [
            ['ticket_header', 'Taquería El Cerebro'],
            ['ticket_footer', '¡Gracias por su compra! Vuelva pronto 🌮'],
            ['ticket_show_logo', '1'],
            ['ticket_qr_url', ''],
            ['ticket_show_qr', '0'],
        ];
        for (const [key, value] of ticketDefaults) {
            await client.query(`INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`, [key, value]);
        }

        console.log('Database initialized successfully.');
    } finally {
        client.release();
    }
};

module.exports = { db, initDb };
