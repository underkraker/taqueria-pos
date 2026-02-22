const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const path = require('path');

// Use PostgreSQL in production (Neon/Render), SQLite locally
const { initDb, db } = process.env.DATABASE_URL
    ? require('./database-pg')
    : require('./database');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

// Socket.io Logic
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Unirse a una "sala" específica de la sucursal
    socket.on('join_branch', (branchId) => {
        const roomName = `branch_${branchId}`;
        socket.join(roomName);
        console.log(`User ${socket.id} joined ${roomName}`);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

// Basic Routes
app.get('/api/status', (req, res) => {
    res.json({ status: 'Cerebro is running' });
});

// Get products by branch
app.get('/api/products', (req, res) => {
    const branchId = req.query.branchId || 1; // Default a 1 si no se envía
    db.all(`SELECT * FROM products WHERE branch_id = ?`, [branchId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Función Haversine para calcular distancia entre coordenadas (en metros)
function getDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return Infinity;
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Simple Login con Geofencing y Bloqueo de Dispositivo
app.post('/api/login', (req, res) => {
    const { username, password, coords, deviceToken } = req.body;

    db.get(`SELECT * FROM users WHERE username = ?`,
        [username], async (err, user) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!user) return res.json({ success: false, message: 'Credenciales inválidas' });

            // Check password: try bcrypt first, then plain text fallback for legacy
            let passwordValid = false;
            try {
                if (user.password.startsWith('$2a$') || user.password.startsWith('$2b$')) {
                    passwordValid = await bcrypt.compare(password, user.password);
                } else {
                    passwordValid = (user.password === password);
                }
            } catch (e) {
                passwordValid = (user.password === password);
            }

            if (!passwordValid) return res.json({ success: false, message: 'Credenciales inválidas' });

            // Return user without password
            const safeUser = { id: user.id, username: user.username, role: user.role, branch_id: user.branch_id };

            // 1. Bypass para Super Admin
            if (safeUser.role === 'super_admin') {
                return res.json({ success: true, user: safeUser });
            }

            // 2. Verificar si la seguridad global está habilitada
            db.get(`SELECT value FROM settings WHERE key = 'security_enabled'`, (err, setting) => {
                const securityEnabled = setting ? setting.value === '1' : true;

                if (!securityEnabled) {
                    console.log('Seguridad Global DESACTIVADA. Saltando validaciones para', username);
                    return res.json({ success: true, user: safeUser });
                }

                // 3. Obtener datos de la sucursal (coordenadas)
                db.get(`SELECT * FROM branches WHERE id = ?`, [safeUser.branch_id], (err, branch) => {
                    if (err) return res.status(500).json({ error: err.message });

                    // 3. Validar Geolocalización (Solo si la sucursal tiene coordenadas configuradas)
                    if (branch && branch.latitude && branch.longitude) {
                        if (!coords || !coords.latitude || !coords.longitude) {
                            return res.json({ success: false, message: 'Se requiere ubicación GPS para entrar.' });
                        }
                        const distance = getDistance(coords.latitude, coords.longitude, branch.latitude, branch.longitude);
                        if (distance > branch.radius) {
                            return res.json({ success: false, message: 'Estás fuera del rango permitido de la sucursal.' });
                        }
                    }

                    // 4. Validar Dispositivo Autorizado
                    db.get(`SELECT * FROM devices WHERE device_token = ? AND branch_id = ?`, [deviceToken, safeUser.branch_id], (err, device) => {
                        if (err) return res.status(500).json({ error: err.message });

                        if (!device) {
                            return res.json({ success: false, message: 'Dispositivo no registrado para esta sucursal.' });
                        }

                        // 5. Validar Rol en el dispositivo
                        if (device.allowed_role !== 'any' && device.allowed_role !== safeUser.role) {
                            return res.json({ success: false, message: `Este dispositivo solo permite el rol: ${device.allowed_role}` });
                        }

                        // Passed all checks!
                        res.json({ success: true, user: safeUser });
                    });
                });
            });
        });
});

// Create Order (supports delivery)
app.post('/api/orders', (req, res) => {
    const { table_number, waiter_id, items, order_type, customer_name, customer_phone, delivery_address, delivery_notes, platform_commission } = req.body;

    // First, get the real prices from the database
    const productIds = items.map(i => i.product_id);
    const placeholders = productIds.map(() => '?').join(',');

    db.all(`SELECT id, price, delivery_price FROM products WHERE id IN (${placeholders})`, productIds, (err, products) => {
        if (err) return res.status(500).json({ error: err.message });

        // Calculate total from DB prices
        const priceMap = {};
        const deliveryPriceMap = {};
        products.forEach(p => { priceMap[p.id] = p.price; deliveryPriceMap[p.id] = p.delivery_price || p.price; });

        const isDelivery = (order_type || 'dine_in').startsWith('delivery_') || order_type === 'takeout';
        let total = 0;
        items.forEach(item => {
            const unitPrice = isDelivery ? (deliveryPriceMap[item.product_id] || priceMap[item.product_id] || 0) : (priceMap[item.product_id] || 0);
            total += unitPrice * item.quantity;
        });

        db.serialize(() => {
            const branchId = req.body.branch_id || 1;
            const ot = order_type || 'dine_in';
            db.run(`INSERT INTO orders (table_number, waiter_id, status, total, branch_id, order_type, customer_name, customer_phone, delivery_address, delivery_notes, platform_commission) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
                [table_number, waiter_id, total, branchId, ot, customer_name || '', customer_phone || '', delivery_address || '', delivery_notes || '', platform_commission || 0], function (err) {
                    if (err) return res.status(500).json({ error: err.message });

                    const orderId = this.lastID;
                    const stmt = db.prepare(`INSERT INTO order_items (order_id, product_id, quantity, notes) VALUES (?, ?, ?, ?)`);

                    items.forEach(item => {
                        stmt.run(orderId, item.product_id, item.quantity, item.notes || '');
                    });

                    stmt.finalize();

                    // Notify via Socket (only to the branch room)
                    io.to(`branch_${branchId}`).emit('order_update', { id: orderId, table_number, status: 'pending', total, order_type: ot });

                    res.json({ success: true, orderId, total });
                });
        });
    });
});

// Get pending orders with items by branch
app.get('/api/orders/pending', (req, res) => {
    const branchId = req.query.branchId || 1;
    const query = `
        SELECT o.*, 
               u.username as waiter_name,
               json_group_array(
                   json_object(
                       'product_name', p.name,
                       'quantity', oi.quantity,
                       'price', p.price,
                       'notes', oi.notes
                   )
               ) as items
        FROM orders o
        JOIN users u ON o.waiter_id = u.id
        LEFT JOIN order_items oi ON o.id = oi.order_id
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE o.status IN ('pending', 'preparing', 'ready') AND o.branch_id = ?
        GROUP BY o.id
        ORDER BY 
            CASE WHEN o.order_type LIKE 'delivery_%' THEN 0 ELSE 1 END,
            o.created_at DESC
    `;

    db.all(query, [branchId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const parsedRows = rows.map(row => ({
            ...row,
            items: JSON.parse(row.items)
        }));
        res.json(parsedRows);
    });
});

// Update order status or content (Also saves payment_method and tip on paid)
app.put('/api/orders/:id/status', (req, res) => {
    const { status, payment_method, tip, branch_id } = req.body;
    const { id } = req.params;

    const pm = payment_method || 'cash';
    const finalTip = tip || 0;

    db.run(`UPDATE orders SET status = ?, payment_method = ?, tip = ? WHERE id = ?`, [status, pm, finalTip, id], function (err) {
        if (err) return res.status(500).json({ error: err.message });

        // Automated Inventory Deduction on 'ready' or 'paid'
        if (status === 'ready' || status === 'paid') {
            db.all(`SELECT oi.product_id, oi.quantity, r.inventory_id, r.quantity_needed 
                    FROM order_items oi 
                    JOIN recipes r ON oi.product_id = r.product_id 
                    WHERE oi.order_id = ?`, [id], (err, items) => {
                if (!err && items) {
                    items.forEach(item => {
                        const totalToDeduct = item.quantity * item.quantity_needed;
                        db.run(`UPDATE inventory SET quantity = quantity - ? WHERE id = ?`, [totalToDeduct, item.inventory_id]);
                    });
                }
            });
        }

        // Notify only the branch room
        if (branch_id) {
            io.to(`branch_${branch_id}`).emit('order_update', { id, status, payment_method: pm });
        } else {
            io.emit('order_update', { id, status, payment_method: pm });
        }
        res.json({ success: true });
    });
});

// Append to existing order
app.post('/api/orders/:id/append', (req, res) => {
    const { id } = req.params;
    const { items, branch_id } = req.body; // items = [{product_id, quantity, notes}]

    const productIds = items.map(i => i.product_id);
    const placeholders = productIds.map(() => '?').join(',');

    db.all(`SELECT id, price FROM products WHERE id IN (${placeholders})`, productIds, (err, products) => {
        if (err) return res.status(500).json({ error: err.message });

        const priceMap = {};
        products.forEach(p => { priceMap[p.id] = p.price; });

        let additionalTotal = 0;

        db.serialize(() => {
            const stmt = db.prepare(`INSERT INTO order_items (order_id, product_id, quantity, notes) VALUES (?, ?, ?, ?)`);

            items.forEach(item => {
                const priceMatch = priceMap[item.product_id] || 0;
                additionalTotal += (priceMatch * item.quantity);
                stmt.run(id, item.product_id, item.quantity, item.notes || '');
            });
            stmt.finalize();

            // Update order total and reset status to pending (or keep preparing if that's standard)
            // Let's reset to 'pending' so kitchen sees new items
            db.run(`UPDATE orders SET total = total + ?, status = 'pending' WHERE id = ?`, [additionalTotal, id], function (err) {
                if (err) return res.status(500).json({ error: err.message });
                io.to(`branch_${branch_id}`).emit('order_update', { id, status: 'pending', totalAdded: additionalTotal });
                res.json({ success: true, added_total: additionalTotal });
            });
        });
    });
});

// Cancel an order (restore inventory if it was ready/paid)
app.put('/api/orders/:id/cancel', (req, res) => {
    const { id } = req.params;
    const { branch_id } = req.body;

    // Check current status first to know if we need to refund inventory
    db.get('SELECT status FROM orders WHERE id = ?', [id], (err, order) => {
        if (err || !order) return res.status(500).json({ error: err ? err.message : 'Order not found' });

        db.run('UPDATE orders SET status = "cancelled" WHERE id = ?', [id], function (err) {
            if (err) return res.status(500).json({ error: err.message });

            // Restore inventory if it had been deducted
            if (order.status === 'ready' || order.status === 'paid') {
                db.all(`SELECT oi.product_id, oi.quantity, r.inventory_id, r.quantity_needed 
                        FROM order_items oi 
                        JOIN recipes r ON oi.product_id = r.product_id 
                        WHERE oi.order_id = ?`, [id], (err, items) => {
                    if (!err && items) {
                        items.forEach(item => {
                            const totalToRestore = item.quantity * item.quantity_needed;
                            db.run(`UPDATE inventory SET quantity = quantity + ? WHERE id = ?`, [totalToRestore, item.inventory_id]);
                        });
                    }
                });
            }

            io.to(`branch_${branch_id}`).emit('order_update', { id, status: 'cancelled' });
            res.json({ success: true, message: 'Orden cancelada y regresada al inventario' });
        });
    });
});

// Update order entirely (for editing)
app.put('/api/orders/:id', (req, res) => {
    const { id } = req.params;
    const { items, table_number } = req.body;

    const productIds = items.map(i => i.product_id);
    const placeholders = productIds.map(() => '?').join(',');

    db.all(`SELECT id, price FROM products WHERE id IN (${placeholders})`, productIds, (err, products) => {
        if (err) return res.status(500).json({ error: err.message });

        const priceMap = {};
        products.forEach(p => { priceMap[p.id] = p.price; });

        let total = 0;
        items.forEach(item => {
            total += (priceMap[item.product_id] || 0) * item.quantity;
        });

        db.serialize(() => {
            // Update total and table
            db.run(`UPDATE orders SET total = ?, table_number = ? WHERE id = ?`, [total, table_number, id], function (err) {
                if (err) return res.status(500).json({ error: err.message });

                // Delete old items and insert new ones
                db.run(`DELETE FROM order_items WHERE order_id = ?`, [id], (err) => {
                    if (err) return res.status(500).json({ error: err.message });

                    const stmt = db.prepare(`INSERT INTO order_items (order_id, product_id, quantity, notes) VALUES (?, ?, ?, ?)`);
                    items.forEach(item => {
                        stmt.run(id, item.product_id, item.quantity, item.notes || '');
                    });
                    stmt.finalize();

                    // Notify only the branch room
                    const branchId = req.body.branch_id || 1;
                    io.to(`branch_${branchId}`).emit('order_update', { id, total, status: 'updated' });
                    res.json({ success: true, total });
                });
            });
        });
    });
});

// Admin: Corte de Caja (Sales summary) by branch
app.get('/api/admin/report', (req, res) => {
    const branchId = req.query.branchId || 1;
    const query = `
        SELECT o.status, 
               o.payment_method,
               SUM(oi.quantity * p.price) as total_products, 
               SUM(o.tip) as total_tips,
               COUNT(DISTINCT o.id) as count 
        FROM orders o
        LEFT JOIN order_items oi ON o.id = oi.order_id
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE o.branch_id = ?
        GROUP BY o.status, o.payment_method
    `;
    db.all(query, [branchId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Inventory: Get all items by branch
app.get('/api/inventory', (req, res) => {
    const branchId = req.query.branchId || 1;
    db.all(`SELECT * FROM inventory WHERE branch_id = ?`, [branchId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Inventory: Update item quantity
app.put('/api/inventory/:id', (req, res) => {
    const { quantity } = req.body;
    const { id } = req.params;

    db.run(`UPDATE inventory SET quantity = ? WHERE id = ?`, [quantity, id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Inventory: Add new item
app.post('/api/inventory', (req, res) => {
    const { item_name, quantity, unit, branch_id } = req.body;
    db.run(`INSERT INTO inventory (item_name, quantity, unit, branch_id) VALUES (?, ?, ?, ?)`,
        [item_name, quantity, unit, branch_id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, inventoryId: this.lastID });
        });
});

// Inventory: Delete item
app.delete('/api/inventory/:id', (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM inventory WHERE id = ?`, [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// --- Branding & Branch Info ---

// Get single branch info (For branding/localization)
app.get('/api/branches/:id', (req, res) => {
    const { id } = req.params;
    db.get(`SELECT id, name, logo, latitude, longitude, radius FROM branches WHERE id = ?`, [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row);
    });
});

// Admin: Update branch name and logo
app.put('/api/admin/branch/:id', (req, res) => {
    const { name, logo } = req.body;
    const { id } = req.params;

    db.run(`UPDATE branches SET name = ?, logo = ? WHERE id = ?`, [name, logo, id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Admin: Cierre de Caja (Finalizar el día y cerrar sesiones, y guardar historial de corte)
app.post('/api/admin/cierre-caja', (req, res) => {
    const { branch_id, total_sales, total_expenses, net_profit, details,
        expected_cash, declared_cash, difference, card_totals, transfer_totals, tips } = req.body;

    if (!branch_id) return res.status(400).json({ error: 'branch_id es requerido' });

    console.log(`Cierre de caja en sucursal ${branch_id}. Guardando corte y cerrando sesiones...`);

    // Guardar el corte en la base de datos
    db.run(`INSERT INTO cash_cuts (branch_id, total_sales, total_expenses, net_profit, 
            expected_cash, declared_cash, difference, card_totals, transfer_totals, tips, details) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            branch_id,
            total_sales || 0,
            total_expenses || 0,
            net_profit || 0,
            expected_cash || 0,
            declared_cash || 0,
            difference || 0,
            card_totals || 0,
            transfer_totals || 0,
            tips || 0,
            JSON.stringify(details || {})
        ], function (err) {
            if (err) console.error('Error guardando corte de caja:', err);

            // Emitir evento de cierre de sesión forzado a la sala de la sucursal
            io.to(`branch_${branch_id}`).emit('force_logout');

            res.json({ success: true, message: 'Sesiones cerradas y corte guardado correctamente' });
        });
});

// Admin: Obtener historial de cortes de caja
app.get('/api/admin/cash-cuts', (req, res) => {
    const branchId = req.query.branchId;
    if (!branchId) return res.status(400).json({ error: 'branchId is required' });

    db.all(`SELECT * FROM cash_cuts WHERE branch_id = ? ORDER BY created_at DESC`, [branchId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        // Parse details back to objects
        const parsedRows = rows.map(r => ({ ...r, details: JSON.parse(r.details || '{}') }));
        res.json(parsedRows);
    });
});

// --- Admin Management (Users & Products) ---

// Get users by branch
app.get('/api/admin/users', (req, res) => {
    const branchId = req.query.branchId;
    if (!branchId) return res.status(400).json({ error: 'branchId is required' });
    db.all(`SELECT id, username, role, branch_id FROM users WHERE branch_id = ? AND role != 'super_admin'`, [branchId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Create user for branch
app.post('/api/admin/users', async (req, res) => {
    const { username, password, role, branch_id } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO users (username, password, role, branch_id) VALUES (?, ?, ?, ?)`,
        [username, hashedPassword, role, branch_id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, userId: this.lastID });
        });
});

// Update user
app.put('/api/admin/users/:id', async (req, res) => {
    const { username, password, role } = req.body;
    const { id } = req.params;
    let query = `UPDATE users SET username = ?, role = ?`;
    let params = [username, role];

    if (password) {
        const hashedPassword = await bcrypt.hash(password, 10);
        query += `, password = ?`;
        params.push(hashedPassword);
    }

    query += ` WHERE id = ? AND role != 'super_admin'`;
    params.push(id);

    db.run(query, params, function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Delete user (Safety: Admin cannot delete themselves or super_admin easily here)
app.delete('/api/admin/users/:id', (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM users WHERE id = ? AND role != 'super_admin'`, [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Create product for branch
app.post('/api/admin/products', (req, res) => {
    const { name, price, category, branch_id, delivery_price } = req.body;
    db.run(`INSERT INTO products (name, price, category, branch_id, delivery_price) VALUES (?, ?, ?, ?, ?)`,
        [name, price, category, branch_id, delivery_price || 0], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, productId: this.lastID });
        });
});

// Update product
app.put('/api/admin/products/:id', (req, res) => {
    const { name, price, category, delivery_price } = req.body;
    const { id } = req.params;
    db.run(`UPDATE products SET name = ?, price = ?, category = ?, delivery_price = ? WHERE id = ?`,
        [name, price, category, delivery_price || 0, id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
});

// Delete product
app.delete('/api/admin/products/:id', (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM products WHERE id = ?`, [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// --- Operational Intelligence (Expenses & Recipes) ---

// Get expenses by branch
app.get('/api/admin/expenses', (req, res) => {
    const branchId = req.query.branchId;
    db.all(`SELECT * FROM expenses WHERE branch_id = ? ORDER BY created_at DESC`, [branchId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Create expense
app.post('/api/admin/expenses', (req, res) => {
    const { branch_id, description, amount, category } = req.body;
    db.run(`INSERT INTO expenses (branch_id, description, amount, category) VALUES (?, ?, ?, ?)`,
        [branch_id, description, amount, category], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, expenseId: this.lastID });
        });
});

// Delete expense
app.delete('/api/admin/expenses/:id', (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM expenses WHERE id = ?`, [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Get recipe for a product
app.get('/api/admin/recipes/:productId', (req, res) => {
    const { productId } = req.params;
    db.all(`SELECT r.*, i.item_name, i.unit FROM recipes r JOIN inventory i ON r.inventory_id = i.id WHERE r.product_id = ?`, [productId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Create or update recipe item
app.post('/api/admin/recipes', (req, res) => {
    const { product_id, inventory_id, quantity_needed } = req.body;
    db.run(`INSERT INTO recipes (product_id, inventory_id, quantity_needed) VALUES (?, ?, ?)`,
        [product_id, inventory_id, quantity_needed], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, recipeId: this.lastID });
        });
});

// Delete recipe item
app.delete('/api/admin/recipes/:id', (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM recipes WHERE id = ?`, [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});
// --- Delivery Report ---
app.get('/api/admin/delivery-report', (req, res) => {
    const branchId = req.query.branchId || 1;
    const query = `
        SELECT 
            order_type,
            COUNT(*) as total_orders,
            SUM(total) as total_sales,
            SUM(platform_commission) as total_commissions,
            SUM(total - platform_commission) as net_income
        FROM orders
        WHERE branch_id = ? AND status = 'paid' AND order_type != 'dine_in'
        GROUP BY order_type
        ORDER BY total_sales DESC
    `;
    db.all(query, [branchId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// --- Analytics ---
app.get('/api/admin/analytics', (req, res) => {
    const branchId = req.query.branchId || 1;
    const queries = {
        daily: `SELECT DATE(created_at) as day, SUM(total) as sales, COUNT(*) as orders 
                FROM orders WHERE branch_id = ? AND status = 'paid' AND created_at >= date('now', '-7 days') 
                GROUP BY DATE(created_at) ORDER BY day`,
        topProducts: `SELECT p.name, SUM(oi.quantity) as sold, SUM(oi.quantity * p.price) as revenue
                      FROM order_items oi JOIN products p ON oi.product_id = p.id 
                      JOIN orders o ON oi.order_id = o.id
                      WHERE o.branch_id = ? AND o.status = 'paid'
                      GROUP BY p.id ORDER BY sold DESC LIMIT 5`,
        byType: `SELECT order_type, COUNT(*) as orders, SUM(total) as sales
                 FROM orders WHERE branch_id = ? AND status = 'paid'
                 GROUP BY order_type`
    };

    const results = {};
    let done = 0;
    const total = Object.keys(queries).length;

    Object.entries(queries).forEach(([key, sql]) => {
        db.all(sql, [branchId], (err, rows) => {
            results[key] = err ? [] : rows;
            done++;
            if (done === total) res.json(results);
        });
    });
});

// --- Customer Management ---

// Get customers by branch
app.get('/api/admin/customers', (req, res) => {
    const branchId = req.query.branchId;
    db.all(`SELECT * FROM customers WHERE branch_id = ? ORDER BY name ASC`, [branchId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Create customer
app.post('/api/admin/customers', (req, res) => {
    const { branch_id, name, phone, email, notes } = req.body;
    db.run(`INSERT INTO customers (branch_id, name, phone, email, notes) VALUES (?, ?, ?, ?, ?)`,
        [branch_id, name, phone, email, notes], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, customerId: this.lastID });
        });
});

// Update customer
app.put('/api/admin/customers/:id', (req, res) => {
    const { name, phone, email, notes } = req.body;
    const { id } = req.params;
    db.run(`UPDATE customers SET name = ?, phone = ?, email = ?, notes = ? WHERE id = ?`,
        [name, phone, email, notes, id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
});

// Delete customer
app.delete('/api/admin/customers/:id', (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM customers WHERE id = ?`, [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// --- Super Admin Endpoints ---

// Get global settings
app.get('/api/super/settings', (req, res) => {
    db.all(`SELECT * FROM settings`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const settings = {};
        rows.forEach(row => settings[row.key] = row.value);
        res.json(settings);
    });
});

// Update global setting
app.put('/api/super/settings', (req, res) => {
    const { key, value } = req.body;
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, value], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Get all branches
app.get('/api/super/branches', (req, res) => {
    db.all(`SELECT * FROM branches`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Create new branch (Limit 6, then password)
app.post('/api/super/branches', (req, res) => {
    const { name, address, master_password } = req.body;

    db.get(`SELECT COUNT(*) as count FROM branches`, [], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });

        const count = row.count;
        if (count >= 6 && master_password !== process.env.MASTER_PASSWORD) {
            return res.status(403).json({ success: false, message: 'Límite alcanzado. Se requiere contraseña maestra.' });
        }

        db.run(`INSERT INTO branches (name, address) VALUES (?, ?)`, [name, address || ''], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, branchId: this.lastID });
        });
    });
});

// Delete branch
app.delete('/api/super/branches/:id', (req, res) => {
    const { id } = req.params;
    if (parseInt(id) === 1) return res.status(403).json({ error: 'Cannot delete main branch' });

    db.run(`DELETE FROM branches WHERE id = ?`, [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Update branch geolocation
app.put('/api/super/branches/:id/location', (req, res) => {
    const { latitude, longitude, radius } = req.body;
    const { id } = req.params;
    db.run(`UPDATE branches SET latitude = ?, longitude = ?, radius = ? WHERE id = ?`,
        [latitude, longitude, radius || 100, id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
});

// Get all authorized devices
app.get('/api/super/devices', (req, res) => {
    db.all(`SELECT d.*, b.name as branch_name FROM devices d LEFT JOIN branches b ON d.branch_id = b.id`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Register/Authorize a new device
app.post('/api/super/devices', (req, res) => {
    const { device_token, branch_id, allowed_role, nickname } = req.body;
    db.run(`INSERT INTO devices (device_token, branch_id, allowed_role, nickname) VALUES (?, ?, ?, ?)`,
        [device_token, branch_id, allowed_role, nickname], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, deviceId: this.lastID });
        });
});

// Delete/Deauthorize a device
app.delete('/api/super/devices/:id', (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM devices WHERE id = ?`, [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// ============ TICKET SETTINGS ============
// Get ticket settings
app.get('/api/admin/ticket-settings', (req, res) => {
    db.all(`SELECT * FROM settings WHERE key LIKE 'ticket_%'`, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const settings = {};
        rows.forEach(r => { settings[r.key] = r.value; });
        res.json(settings);
    });
});

// Save ticket settings
app.post('/api/admin/ticket-settings', (req, res) => {
    const settings = req.body; // { ticket_header: '...', ticket_footer: '...', ... }
    const keys = Object.keys(settings);
    let done = 0;
    keys.forEach(key => {
        db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
            [key, settings[key]], (err) => {
                done++;
                if (done === keys.length) {
                    res.json({ success: true });
                }
            });
    });
});

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));
    app.get(/(.*)/, (req, res) => {
        if (!req.url.startsWith('/api/') && !req.url.startsWith('/socket.io/')) {
            res.sendFile(path.join(__dirname, '..', 'client', 'dist', 'index.html'));
        }
    });
}

const PORT = process.env.PORT || 3001;

initDb().then(() => {
    server.listen(PORT, () => {
        console.log(`Cerebro (Server) listening on port ${PORT}`);
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
});
