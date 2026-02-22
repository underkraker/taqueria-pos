require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    try {
        console.log('Migrating Delivery statuses...');
        const client = await pool.connect();

        // Drop the existing constraint
        await client.query(`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;`);

        // Add the new one with 'dispatched'
        await client.query(`ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK(status IN ('pending', 'preparing', 'ready', 'dispatched', 'paid', 'cancelled'));`);

        console.log('✅ Base de datos actualizada: Estado "dispatched" añadido.');
        client.release();
    } catch (err) {
        console.error('Error durante la migración:', err);
    } finally {
        pool.end();
    }
}

migrate();
