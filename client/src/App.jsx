import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ShoppingCart, Plus, Minus, Send, LogOut, CheckCircle, Clock, ShieldCheck, Printer, Download } from 'lucide-react';
import { io } from 'socket.io-client';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import QRCode from 'qrcode';
import './index.css';

// In production, API is on the same origin. In dev, it's on port 3001.
const API_URL = window.location.port === '5173'
  ? `http://${window.location.hostname}:3001`
  : '';
const socket = io(API_URL || window.location.origin);

// Helper para calcular el total del carrito de forma robusta
const calculateCartTotal = (items) => {
  return items.reduce((sum, item) => {
    const price = Number(item.price) || 0;
    const qty = Number(item.quantity) || 0;
    return sum + (price * qty);
  }, 0);
};

// Helper para Imprimir Tickets Térmicos (58mm/80mm)
const printThermalTicket = (order, branchInfo) => {
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  document.body.appendChild(iframe);

  const ticketHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        @page { margin: 0; }
        body { font-family: monospace; color: black; margin: 0; padding: 10px; width: 58mm; }
        h1, h2, h3, p { margin: 0; padding: 0; }
        .text-center { text-align: center; }
        .text-bold { font-weight: bold; }
        .text-right { text-align: right; }
        .divider { border-top: 1px dashed black; margin: 5px 0; }
        table { width: 100%; font-size: 12px; border-collapse: collapse; margin-top: 5px; }
        th, td { text-align: left; padding: 2px 0; }
        th.right, td.right { text-align: right; }
      </style>
    </head>
    <body onload="setTimeout(() => { window.print(); window.onafterprint = function(){ parent.document.body.removeChild(window.frameElement); } }, 500);">
      <div class="text-center text-bold" style="font-size: 16px;">${branchInfo?.name || 'LA TAQUERIA'}</div>
      <div class="divider"></div>
      <div>Fecha: ${new Date(order.created_at || Date.now()).toLocaleString()}</div>
      <div>Mesa: ${order.table_number == 0 ? 'Barra/Llevar' : order.table_number}</div>
      <div>Atendió: ${order.waiter_name || 'Caja'}</div>
      <div class="divider"></div>
      <table>
        <thead>
          <tr>
            <th>Cant</th>
            <th>Desc</th>
            <th class="right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${order.items.map(it => `
            <tr>
              <td>${it.quantity}</td>
              <td>${it.product_name || it.name}</td>
              <td class="right">$${(parseFloat(it.price) * it.quantity).toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="divider"></div>
      <div class="text-right text-bold" style="font-size: 14px;">TOTAL: $${parseFloat(order.total).toFixed(2)}</div>
      <div class="divider"></div>
      <div class="text-center" style="margin-top: 10px; font-size: 12px;">¡Gracias por tu preferencia!</div>
      <div style="height: 30px;"></div> <!-- Extra space for printer cut -->
    </body>
    </html>
  `;

  iframe.contentWindow.document.open();
  iframe.contentWindow.document.write(ticketHTML);
  iframe.contentWindow.document.close();
};

// Helper para Imprimir Resumen de Corte (Ticket)
const printCorteTicket = (corte, branchInfo) => {
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  document.body.appendChild(iframe);

  const parsedDetails = typeof corte.details === 'string' ? JSON.parse(corte.details) : (corte.details || {});

  const ticketHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        @page { margin: 0; }
        body { font-family: monospace; color: black; margin: 0; padding: 10px; width: 58mm; }
        h1, h2, h3, p { margin: 0; padding: 0; }
        .text-center { text-align: center; }
        .text-bold { font-weight: bold; }
        .text-right { text-align: right; }
        .divider { border-top: 1px dashed black; margin: 5px 0; }
        table { width: 100%; font-size: 12px; border-collapse: collapse; margin-top: 5px; }
        th, td { text-align: left; padding: 2px 0; }
        th.right, td.right { text-align: right; }
      </style>
    </head>
    <body onload="setTimeout(() => { window.print(); window.onafterprint = function(){ parent.document.body.removeChild(window.frameElement); } }, 500);">
      <div class="text-center text-bold" style="font-size: 16px;">${branchInfo?.name || 'LA TAQUERIA'}</div>
      <div class="text-center">CORTE DE CAJA</div>
      <div class="divider"></div>
      <div>Fecha: ${new Date(corte.created_at || Date.now()).toLocaleString()}</div>
      <div class="divider"></div>
      <div class="text-bold">RESUMEN VENTA:</div>
      <table>
        <tr><td>Efectivo:</td><td class="right">$${parseFloat(corte.expected_cash || 0).toFixed(2)}</td></tr>
        <tr><td>Tarjeta:</td><td class="right">$${parseFloat(corte.card_totals || 0).toFixed(2)}</td></tr>
        <tr><td>Transferencia:</td><td class="right">$${parseFloat(corte.transfer_totals || 0).toFixed(2)}</td></tr>
        <tr><td>Ventas Totales:</td><td class="right text-bold">$${parseFloat(corte.total_sales).toFixed(2)}</td></tr>
        <tr><td>Propinas (Extra):</td><td class="right">$${parseFloat(corte.tips || 0).toFixed(2)}</td></tr>
        <tr><td>Gastos/Egresos:</td><td class="right">-$${parseFloat(corte.total_expenses).toFixed(2)}</td></tr>
        <tr><td>Utilidad Neta:</td><td class="right text-bold">$${parseFloat(corte.net_profit).toFixed(2)}</td></tr>
      </table>
      <div class="divider"></div>
      <div class="text-bold" style="font-size: 11px;">ARQUEO FÍSICO:</div>
      <table>
        <tr><td>Efectivo Esperado:</td><td class="right">$${parseFloat(corte.expected_cash || 0).toFixed(2)}</td></tr>
        <tr><td>Efectivo Declarado:</td><td class="right">$${parseFloat(corte.declared_cash || 0).toFixed(2)}</td></tr>
        <tr><td>Diferencia:</td><td class="right text-bold">${parseFloat(corte.difference || 0) >= 0 ? '+' : ''}$${parseFloat(corte.difference || 0).toFixed(2)}</td></tr>
      </table>
      <div class="divider"></div>
      <div class="text-center" style="margin-top: 5px; font-size: 12px;">Órdenes Pagadas: ${parsedDetails.paid_orders || 0}</div>
      <div style="height: 30px;"></div>
    </body>
    </html>
  `;

  iframe.contentWindow.document.open();
  iframe.contentWindow.document.write(ticketHTML);
  iframe.contentWindow.document.close();
};

// Helper para Descargar Resumen de Corte (PDF)
const downloadCortePDF = (corte, branchInfo) => {
  const doc = new jsPDF();
  const date = new Date(corte.created_at || Date.now()).toLocaleString();

  doc.setFontSize(20);
  doc.text(`Corte de Caja - ${branchInfo?.name || 'Sucursal'}`, 14, 22);

  doc.setFontSize(12);
  doc.text(`Fecha: ${date}`, 14, 32);

  const parsedDetails = typeof corte.details === 'string' ? JSON.parse(corte.details) : (corte.details || {});

  doc.autoTable({
    startY: 40,
    head: [['Concepto', 'Monto']],
    body: [
      ['Ventas Efectivo', `$${parseFloat(corte.expected_cash || 0).toFixed(2)}`],
      ['Ventas Tarjeta', `$${parseFloat(corte.card_totals || 0).toFixed(2)}`],
      ['Ventas Transferencia', `$${parseFloat(corte.transfer_totals || 0).toFixed(2)}`],
      ['Ventas Totales', `$${parseFloat(corte.total_sales).toFixed(2)}`],
      ['Propinas (Extra)', `$${parseFloat(corte.tips || 0).toFixed(2)}`],
      ['Gastos Totales', `-$${parseFloat(corte.total_expenses).toFixed(2)}`],
      ['Utilidad Neta', `$${parseFloat(corte.net_profit).toFixed(2)}`],
      ['Órdenes Pagadas', `${parsedDetails.paid_orders || 0} órdenes`],
      ['---', '---'],
      ['Efectivo Declarado', `$${parseFloat(corte.declared_cash || 0).toFixed(2)}`],
      ['Diferencia Caja', `${parseFloat(corte.difference || 0) >= 0 ? '+' : ''}$${parseFloat(corte.difference || 0).toFixed(2)}`]
    ],
    theme: 'grid',
    headStyles: { fillColor: [249, 115, 22] }
  });

  doc.save(`Corte_${branchInfo?.name || 'Sucursal'}_${new Date(corte.created_at || Date.now()).toISOString().split('T')[0]}.pdf`);
};

// Componente de Login con Geofencing y Device Tracking
const Login = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [branchInfo, setBranchInfo] = useState({ name: '🌮 Taquería El Cerebro', logo: null });

  // Obtener o Generar ID de Dispositivo (Firma digital local)
  const getDeviceToken = () => {
    let token = localStorage.getItem('cerebro_device_id');
    if (!token) {
      token = 'dev_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
      localStorage.setItem('cerebro_device_id', token);
    }
    return token;
  };

  useEffect(() => {
    const fetchBranchContext = async () => {
      try {
        const token = getDeviceToken();
        const res = await axios.get(`${API_URL}/api/device-branch?token=${token}`);
        if (res.data) {
          setBranchInfo({
            name: res.data.name || '🌮 Taquería El Cerebro',
            logo: res.data.logo
          });
        }
      } catch (e) {
        console.error("Failed to load branch context", e);
      }
    };
    fetchBranchContext();
  }, []);

  const getCoordinates = () => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const coords = await getCoordinates();
      const deviceToken = getDeviceToken();

      const res = await axios.post(`${API_URL}/api/login`, {
        username,
        password,
        coords,
        deviceToken
      });

      if (res.data.success) {
        onLogin(res.data.user);
      } else {
        setError(res.data.message || 'Credenciales inválidas');
      }
    } catch (err) {
      const msg = err.response?.data?.message || 'Error al iniciar sesión';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          {branchInfo.logo ? (
            <img src={branchInfo.logo} alt="Logo" style={{ maxWidth: '120px', maxHeight: '120px', marginBottom: '10px', borderRadius: '10px' }} />
          ) : (
            <h1 style={{ fontSize: '2.5rem', marginBottom: '10px' }}>🌮</h1>
          )}
          <h2 style={{ margin: 0 }}>{branchInfo.name}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '5px' }}>Inicia sesión para continuar</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Usuario</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Ej: mesero1"
              required
            />
          </div>
          <div className="form-group">
            <label>Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          {error && <p style={{ color: '#ff4757', marginBottom: '16px', textAlign: 'center' }}>{error}</p>}
          <button type="submit" className="btn-primary">Entrar</button>
        </form>
      </div>
    </div>
  );
};

// Panel del Mesero
const WaiterPanel = ({ user, branchInfo, onLogout }) => {
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [myOrders, setMyOrders] = useState([]);
  const [tableNumber, setTableNumber] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Todas');

  useEffect(() => {
    fetchProducts();
    fetchMyOrders();
    socket.on('order_update', fetchMyOrders);
    return () => socket.off('order_update');
  }, []);

  const fetchMyOrders = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/orders/pending?branchId=${user.branch_id}`);
      // Filter for this waiter's orders
      setMyOrders(res.data.filter(o => o.waiter_id === user.id));
    } catch (err) {
      console.error('Error fetching orders', err);
    }
  };

  const fetchProducts = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/products?branchId=${user.branch_id}`);
      setProducts(res.data);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching products', err);
    }
  };

  const addToCart = (product) => {
    const existing = cart.find(item => item.id === product.id);
    if (existing) {
      setCart(cart.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item));
    } else {
      setCart([...cart, { ...product, quantity: 1 }]);
    }
  };
  const updateItemNote = (id, notes) => {
    setCart(cart.map(item => item.id === id ? { ...item, notes } : item));
  };

  const removeFromCart = (id) => {
    const existing = cart.find(item => item.id === id);
    if (!existing) return;
    if (existing.quantity === 1) {
      setCart(cart.filter(item => item.id !== id));
    } else {
      setCart(cart.map(item => item.id === id ? { ...item, quantity: item.quantity - 1 } : item));
    }
  };

  const sendOrder = async () => {
    if (!tableNumber || cart.length === 0) return alert('Selecciona mesa y productos');

    try {
      // Check if table has an active order
      const activeForTable = myOrders.find(o => o.table_number === parseInt(tableNumber) && (o.status === 'pending' || o.status === 'preparing' || o.status === 'ready'));

      if (activeForTable) {
        if (!confirm(`La Mesa ${tableNumber} ya tiene una orden abierta. ¿Deseas AGREGAR estos productos a la orden existente?`)) return;

        await axios.post(`${API_URL}/api/orders/${activeForTable.id}/append`, {
          branch_id: user.branch_id,
          items: cart.map(item => ({ product_id: item.id, quantity: item.quantity, notes: item.notes || '' }))
        });
        alert('Productos agregados a la orden');
      } else {
        await axios.post(`${API_URL}/api/orders`, {
          table_number: parseInt(tableNumber),
          waiter_id: user.id,
          branch_id: user.branch_id,
          items: cart.map(item => ({ product_id: item.id, quantity: item.quantity, notes: item.notes || '' }))
        });
      }

      setCart([]);
      setTableNumber('');
      fetchMyOrders();
    } catch (err) {
      alert('Error al enviar comanda');
    }
  };

  const getStatusBadge = (status) => {
    const labels = { 'pending': 'Pendiente', 'preparing': 'Preparando', 'ready': 'Listo' };
    return <span className={`badge badge - ${status}`}>{labels[status] || status}</span>;
  };

  return (
    <div className="waiter-workflow">
      <nav className="waiter-navbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {branchInfo?.logo && <img src={branchInfo.logo} alt="Logo" style={{ height: '40px', borderRadius: '8px' }} />}
          <h2 style={{ color: 'var(--accent)' }}>{branchInfo?.name || 'Sucursal'}</h2>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '10px' }}>Mesero: {user.username}</span>
        </div>
        <button onClick={onLogout} style={{ background: 'transparent', color: 'var(--text-muted)' }}>
          <LogOut size={20} />
        </button>
      </nav>

      <div style={{ padding: '24px', display: 'grid', gridTemplateColumns: '1fr 350px', gap: '24px' }}>
        <div>
          <div className="glass-card" style={{ padding: '20px', marginBottom: '24px' }}>
            <h3 style={{ marginBottom: '12px', fontSize: '1.2rem', display: 'flex', justifyContent: 'space-between' }}>
              <span>Seleccionar Mesa</span>
              <span style={{ color: 'var(--accent)' }}>{tableNumber !== '' ? `Mesa #${tableNumber}` : ''}</span>
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(40px, 1fr))', gap: '8px', maxHeight: '180px', overflowY: 'auto', paddingRight: '4px' }}>
              <button
                onClick={() => setTableNumber(0)}
                style={{
                  gridColumn: '1 / -1', padding: '10px', borderRadius: '8px',
                  background: tableNumber === 0 ? 'var(--accent)' : 'var(--surface)',
                  color: tableNumber === 0 ? 'black' : 'white',
                  border: '1px solid var(--glass-border)', cursor: 'pointer', fontWeight: 'bold'
                }}
              >
                Para llevar (0)
              </button>
              {Array.from({ length: 20 }, (_, i) => i + 1).map(t => {
                const isActive = myOrders.some(o => o.table_number === t);
                const isSelected = tableNumber === t;
                return (
                  <button
                    key={t}
                    onClick={() => setTableNumber(t)}
                    style={{
                      aspectRatio: '1', borderRadius: '8px',
                      background: isSelected ? 'var(--accent)' : (isActive ? 'rgba(239, 68, 68, 0.4)' : 'rgba(255,255,255,0.05)'),
                      color: isSelected ? 'black' : (isActive ? '#fca5a5' : 'white'),
                      border: `1px solid ${isSelected ? 'var(--accent)' : (isActive ? '#ef4444' : 'var(--glass-border)')}`,
                      cursor: 'pointer', fontWeight: 'bold', fontSize: '1.1rem',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                    title={isActive ? 'Mesa Ocupada' : 'Mesa Libre'}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          <h3 style={{ marginBottom: '16px', fontSize: '1.5rem' }}>Menú</h3>

          {/* Search & Category Filters */}
          <div style={{ marginBottom: '16px' }}>
            <input
              type="text"
              placeholder="🔍 Buscar producto..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', marginBottom: '12px', padding: '12px 16px', fontSize: '1rem' }}
            />
            <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '8px' }}>
              {['Todas', ...new Set(products.map(p => p.category).filter(Boolean))].map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  style={{
                    padding: '8px 16px', borderRadius: '20px', border: 'none', cursor: 'pointer',
                    whiteSpace: 'nowrap', fontSize: '0.85rem',
                    background: selectedCategory === cat ? 'var(--accent)' : 'var(--surface)',
                    color: selectedCategory === cat ? 'white' : 'var(--text-muted)'
                  }}
                >{cat}</button>
              ))}
            </div>
          </div>

          {loading ? <p>Cargando productos...</p> : (
            <div className="product-grid" style={{ padding: 0 }}>
              {products
                .filter(p => (selectedCategory === 'Todas' || p.category === selectedCategory))
                .filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
                .map(prod => (
                  <div key={prod.id} className="product-card" onClick={() => addToCart(prod)}>
                    <h3>{prod.name}</h3>
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{prod.category}</p>
                    <p className="price">${parseFloat(prod.price).toFixed(2)}</p>
                    <div style={{ marginTop: '12px', opacity: 0.6 }}><Plus size={20} /></div>
                  </div>
                ))}
            </div>
          )}
        </div>

        <div className="glass-card" style={{ padding: '24px', height: 'fit-content' }}>
          <h3 style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Clock size={20} style={{ color: 'var(--accent)' }} /> Mis Comandas
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {myOrders.map(order => (
              <div key={order.id} style={{
                padding: '12px', background: 'rgba(255,255,255,0.03)',
                borderRadius: '12px', border: '1px solid var(--glass-border)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
              }}>
                <div>
                  <span style={{ fontWeight: 'bold' }}>Mesa {order.table_number}</span>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {order.items.length} productos • ${parseFloat(order.total).toFixed(2)}
                  </div>
                </div>
                {getStatusBadge(order.status)}
              </div>
            ))}
            {myOrders.length === 0 && <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>No tienes órdenes activas.</p>}
          </div>
        </div>
      </div>

      {cart.length > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, width: '100%',
          maxHeight: '400px', background: 'var(--surface)',
          borderTop: '1px solid var(--glass-border)', zIndex: 1001,
          boxShadow: '0 -10px 40px rgba(0,0,0,0.5)', overflowY: 'auto',
          padding: '20px'
        }}>
          <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <h4 style={{ marginBottom: '15px', color: 'var(--accent)' }}>Detalles de la Orden</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '80px' }}>
              {cart.map(item => (
                <div key={item.id} style={{
                  display: 'flex', gap: '15px', alignItems: 'center',
                  background: 'rgba(255,255,255,0.03)', padding: '10px', borderRadius: '10px'
                }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 'bold' }}>{item.quantity}x {item.name}</span>
                    <input
                      type="text"
                      placeholder="Instrucciones (ej: sin cebolla, con queso)"
                      value={item.notes || ''}
                      onChange={(e) => updateItemNote(item.id, e.target.value)}
                      style={{
                        width: '100%', background: 'rgba(0,0,0,0.2)',
                        border: '1px solid var(--glass-border)', borderRadius: '6px',
                        padding: '6px 10px', marginTop: '6px', fontSize: '0.85rem'
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <button onClick={() => removeFromCart(item.id)} className="btn-secondary" style={{ padding: '5px 10px' }}><Minus size={14} /></button>
                    <button onClick={() => addToCart(item)} className="btn-secondary" style={{ padding: '5px 10px' }}><Plus size={14} /></button>
                  </div>
                </div>
              ))}
            </div>

            <div className="cart-summary" style={{
              position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
              width: 'calc(100% - 48px)', maxWidth: '800px',
              background: 'rgba(255, 71, 87, 0.95)', padding: '16px 32px',
              borderRadius: '20px', display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', boxShadow: '0 10px 40px rgba(255, 71, 87, 0.4)',
              zIndex: 1002, color: 'white'
            }}>
              <div>
                <span style={{ display: 'block', fontSize: '0.9rem', opacity: 0.8 }}>Pedido Mesa {tableNumber || '?'}</span>
                <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{cart.length} productos • Total: ${calculateCartTotal(cart).toFixed(2)}</span>
              </div>
              <button className="btn-primary" onClick={sendOrder} style={{
                width: 'auto', background: 'white', color: 'var(--primary)',
                padding: '12px 24px', boxShadow: 'none'
              }}>
                <Send size={20} /> ENVIAR A COCINA
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Panel del Taquero (Cocina)
const KitchenPanel = ({ user, branchInfo, onLogout }) => {
  const [orders, setOrders] = useState([]);

  // Audio notification using Web Audio API
  const playNotification = () => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
      oscillator.frequency.setValueAtTime(660, audioCtx.currentTime + 0.15);
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime + 0.3);
      gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
      oscillator.start(audioCtx.currentTime);
      oscillator.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
      console.log('Audio notification not available');
    }
  };

  useEffect(() => {
    fetchPendingOrders();

    socket.on('order_update', (data) => {
      console.log('Update received in kitchen:', data);
      playNotification();
      fetchPendingOrders();
    });

    return () => {
      socket.off('order_update');
    };
  }, []);

  const fetchPendingOrders = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/orders/pending?branchId=${user.branch_id}`);
      setOrders(res.data);
    } catch (err) {
      console.error('Error fetching orders', err);
    }
  };

  const setOrderStatus = async (orderId, status) => {
    try {
      await axios.put(`${API_URL}/api/orders/${orderId}/status`, { status, branch_id: user.branch_id });
      fetchPendingOrders();
    } catch (err) {
      alert('Error al actualizar estado');
    }
  };

  return (
    <div className="kitchen-workflow" style={{ padding: '20px' }}>
      <nav className="waiter-navbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {branchInfo?.logo && <img src={branchInfo.logo} alt="Logo" style={{ height: '40px', borderRadius: '8px' }} />}
          <h2 style={{ color: 'var(--accent)' }}>{branchInfo?.name || 'Cocina'}</h2>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '10px' }}>Usuario: {user.username}</span>
        </div>
        <button onClick={onLogout} style={{ background: 'transparent', color: 'var(--text-muted)' }}>
          <LogOut size={20} />
        </button>
      </nav>

      <div className="orders-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '24px', marginTop: '24px' }}>
        {orders.map(order => (
          <div key={order.id} className="glass-card" style={{
            padding: '24px', position: 'relative', overflow: 'hidden'
          }}>
            <div style={{
              position: 'absolute', top: 0, left: 0, width: '4px', height: '100%',
              background: order.order_type?.startsWith('delivery_') ? ({
                delivery_didi: '#ff6600', delivery_uber: '#333', delivery_rappi: '#00b140', delivery_propio: '#ef4444'
              })[order.order_type] || 'var(--accent)' : (order.status === 'preparing' ? '#3b82f6' : 'var(--accent)')
            }}></div>

            {/* Delivery Platform Badge */}
            {order.order_type && order.order_type !== 'dine_in' && order.order_type !== 'takeout' && (
              <div style={{
                position: 'absolute', top: '12px', right: '12px',
                padding: '4px 10px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem',
                color: 'white', textTransform: 'uppercase',
                background: ({
                  delivery_didi: '#ff6600', delivery_uber: '#333', delivery_rappi: '#00b140', delivery_propio: '#ef4444'
                })[order.order_type] || '#666',
                animation: 'pulse 2s infinite'
              }}>
                🛵 {order.order_type.replace('delivery_', '')}
              </div>
            )}
            {order.order_type === 'takeout' && (
              <div style={{
                position: 'absolute', top: '12px', right: '12px',
                padding: '4px 10px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem',
                color: 'white', background: '#8b5cf6'
              }}>🥡 PARA LLEVAR</div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div>
                <span style={{ fontWeight: '800', fontSize: '1.5rem', display: 'block' }}>
                  {order.order_type?.startsWith('delivery_') ? `🛵 ${order.customer_name || 'Delivery'}` : `Mesa ${order.table_number}`}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{order.waiter_name} • {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                {order.delivery_address && <span style={{ display: 'block', fontSize: '0.8rem', color: '#60a5fa', marginTop: '4px' }}>📍 {order.delivery_address}</span>}
              </div>
              <span className={`badge badge-${order.status}`}>
                {order.status === 'pending' ? 'Pendiente' : 'Preparando'}
              </span>
            </div>

            <div style={{ marginBottom: '24px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {order.items.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <span style={{ fontSize: '1.1rem' }}><strong style={{ color: 'var(--accent)' }}>{item.quantity}x</strong> {item.product_name}</span>
                    {item.notes && <span style={{ fontSize: '0.85rem', color: '#60a5fa', fontStyle: 'italic' }}>"{item.notes}"</span>}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              {order.status === 'pending' ? (
                <button className="btn-primary" onClick={() => setOrderStatus(order.id, 'preparing')} style={{ background: '#3b82f6' }}>
                  COMENZAR PREPARACIÓN
                </button>
              ) : (
                <button className="btn-primary" onClick={() => setOrderStatus(order.id, 'ready')} style={{ background: 'var(--success)', color: 'black' }}>
                  MARCAR COMO LISTO
                </button>
              )}
            </div>
          </div>
        ))}
        {orders.length === 0 && (
          <div className="glass-card" style={{ textAlign: 'center', gridColumn: '1/-1', padding: '60px', color: 'var(--text-muted)' }}>
            <CheckCircle size={48} style={{ marginBottom: '16px', opacity: 0.3 }} />
            <p style={{ fontSize: '1.2rem' }}>No hay comandas pendientes. ¡Buen trabajo!</p>
          </div>
        )}
      </div>
    </div>
  );
};

// Panel de Administración (Caja e Inventario)
const AdminPanel = ({ user, branchInfo, onBranchUpdate, onLogout }) => {
  const [report, setReport] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [activeTab, setActiveTab] = useState('stats'); // 'stats', 'analytics', 'inventory', 'config', 'staff', 'menu', 'expenses'
  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState([]);
  const [products, setProducts] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [deliveryReport, setDeliveryReport] = useState([]);
  const [ticketSettings, setTicketSettings] = useState({
    ticket_header: 'Taquería El Cerebro',
    ticket_footer: '¡Gracias por su compra! Vuelva pronto 🌮',
    ticket_show_logo: '1',
    ticket_qr_url: '',
    ticket_show_qr: '0',
  });
  const [ticketSaving, setTicketSaving] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [editingProduct, setEditingProduct] = useState(null);
  const [managingRecipe, setManagingRecipe] = useState(null);
  const [currentRecipe, setCurrentRecipe] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [editingInventory, setEditingInventory] = useState(null);
  const [cashCuts, setCashCuts] = useState([]);
  const [showCierreModal, setShowCierreModal] = useState(false);
  const [declaredCash, setDeclaredCash] = useState('');

  // States for branding config
  const [tempName, setTempName] = useState(branchInfo?.name || '');
  const [tempLogo, setTempLogo] = useState(branchInfo?.logo || '');

  useEffect(() => {
    if (branchInfo) {
      setTempName(branchInfo.name || '');
      setTempLogo(branchInfo.logo || '');
    }
  }, [branchInfo]);

  useEffect(() => {
    fetchReport();
    fetchInventory();
    fetchStaff();
    fetchProducts();
    fetchExpenses();
    fetchAnalytics();
    fetchCustomers();
    fetchCashCuts();
    fetchTicketSettings();
  }, [user.branch_id]);

  const fetchCashCuts = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/admin/cash-cuts?branchId=${user.branch_id}`);
      setCashCuts(res.data);
    } catch (err) {
      console.error('Error fetching cash cuts', err);
    }
  };

  const fetchExpenses = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/admin/expenses?branchId=${user.branch_id}`);
      setExpenses(res.data);
    } catch (err) {
      console.error('Error fetching expenses', err);
    }
  };

  const fetchRecipe = async (productId) => {
    try {
      const res = await axios.get(`${API_URL}/api/admin/recipes/${productId}`);
      setCurrentRecipe(res.data);
    } catch (err) {
      console.error('Error fetching recipe', err);
    }
  };

  const fetchStaff = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/admin/users?branchId=${user.branch_id}`);
      setStaff(res.data);
    } catch (err) {
      console.error('Error fetching staff', err);
    }
  };

  const fetchProducts = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/products?branchId=${user.branch_id}`);
      setProducts(res.data);
    } catch (err) {
      console.error('Error fetching products', err);
    }
  };

  const fetchReport = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/admin/report?branchId=${user.branch_id}`);
      setReport(res.data);
    } catch (err) {
      console.error('Error fetching report', err);
    }
  };

  const fetchInventory = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/inventory?branchId=${user.branch_id}`);
      setInventory(res.data);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching inventory', err);
    }
  };

  const updateStock = async (id, newQty) => {
    try {
      await axios.put(`${API_URL}/api/inventory/${id}`, { quantity: newQty });
      fetchInventory();
    } catch (err) {
      alert('Error al actualizar inventario');
    }
  };

  const fetchAnalytics = async () => {
    try {
      const [analyticsRes, deliveryRes] = await Promise.all([
        axios.get(`${API_URL}/api/admin/analytics?branchId=${user.branch_id}`),
        axios.get(`${API_URL}/api/admin/delivery-report?branchId=${user.branch_id}`)
      ]);
      setAnalytics(analyticsRes.data);
      setDeliveryReport(deliveryRes.data);
    } catch (err) { console.error('Error fetching analytics', err); }
  };

  const fetchTicketSettings = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/admin/ticket-settings`);
      setTicketSettings(prev => ({ ...prev, ...res.data }));
    } catch (err) { console.error('Error fetching ticket settings', err); }
  };

  const saveTicketSettings = async () => {
    setTicketSaving(true);
    try {
      await axios.post(`${API_URL}/api/admin/ticket-settings`, ticketSettings);
      alert('¡Configuración de ticket guardada!');
    } catch (err) { alert('Error al guardar configuración'); }
    setTicketSaving(false);
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setTempLogo(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const saveBranding = async () => {
    try {
      await axios.put(`${API_URL}/api/admin/branch/${user.branch_id}`, {
        name: tempName,
        logo: tempLogo
      });
      alert('Configuración guardada');
      if (onBranchUpdate) onBranchUpdate();
    } catch (err) {
      alert('Error al guardar configuración');
    }
  };

  const handleCierreCaja = () => {
    setShowCierreModal(true);
    setDeclaredCash('');
  };

  const processCierre = async () => {
    if (!confirm('¿Estás seguro de cerrar la caja? Esto cerrará la sesión de TODOS los empleados de esta sucursal (meseros, cajeros y cocina) hasta el día de mañana.')) return;

    // Calculate current totals
    const tVentas = report.filter(r => r.status === 'paid' || r.status === 'ready').reduce((acc, curr) => acc + (curr.total_products || curr.total || 0), 0);
    const tEfectivo = report.filter(r => (r.status === 'paid' || r.status === 'ready') && r.payment_method === 'cash').reduce((acc, curr) => acc + (curr.total_products || curr.total || 0), 0);
    const tTarjeta = report.filter(r => (r.status === 'paid' || r.status === 'ready') && r.payment_method === 'card').reduce((acc, curr) => acc + (curr.total_products || curr.total || 0), 0);
    const tTransferencia = report.filter(r => (r.status === 'paid' || r.status === 'ready') && r.payment_method === 'transfer').reduce((acc, curr) => acc + (curr.total_products || curr.total || 0), 0);
    const tPropinas = report.filter(r => r.status === 'paid' || r.status === 'ready').reduce((acc, curr) => acc + (curr.total_tips || 0), 0);
    const tGastos = expenses.reduce((acc, curr) => acc + curr.amount, 0);
    const uNeta = tVentas - tGastos;
    const finalDeclared = parseFloat(declaredCash) || 0;
    const diferencia = finalDeclared - tEfectivo;
    const details = {
      paid_orders: report.find(r => r.status === 'paid')?.count || 0
    };

    try {
      await axios.post(`${API_URL}/api/admin/cierre-caja`, {
        branch_id: user.branch_id,
        total_sales: tVentas,
        total_expenses: tGastos,
        net_profit: uNeta,
        expected_cash: tEfectivo,
        declared_cash: finalDeclared,
        difference: diferencia,
        card_totals: tTarjeta,
        transfer_totals: tTransferencia,
        tips: tPropinas,
        details: details
      });
      alert('Corte finalizado y guardado. Las sesiones de la sucursal han sido cerradas.');
      setShowCierreModal(false);
      setDeclaredCash('');

      const fakeCorte = {
        total_sales: tVentas,
        total_expenses: tGastos,
        net_profit: uNeta,
        expected_cash: tEfectivo,
        declared_cash: finalDeclared,
        difference: diferencia,
        card_totals: tTarjeta,
        transfer_totals: tTransferencia,
        tips: tPropinas,
        details: JSON.stringify(details),
        created_at: new Date().toISOString()
      };
      printCorteTicket(fakeCorte, branchInfo); // Trigger thermal print immediately

      fetchCashCuts(); // Refresh history
    } catch (err) {
      alert('Error al procesar el cierre de caja');
    }
  };

  const manageUser = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData);
    data.branch_id = user.branch_id;

    try {
      if (editingUser?.id) {
        await axios.put(`${API_URL}/api/admin/users/${editingUser.id}`, data);
      } else {
        await axios.post(`${API_URL}/api/admin/users`, data);
      }
      setEditingUser(null);
      fetchStaff();
      e.target.reset();
    } catch (err) {
      alert('Error al guardar usuario');
    }
  };

  const deleteUser = async (id) => {
    if (!confirm('¿Borrar este usuario?')) return;
    try {
      await axios.delete(`${API_URL}/api/admin/users/${id}`);
      fetchStaff();
    } catch (err) {
      alert('Error al borrar usuario');
    }
  };

  const manageProduct = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(formData);
    data.branch_id = user.branch_id;
    data.price = parseFloat(data.price);
    data.delivery_price = parseFloat(data.delivery_price || 0);

    try {
      if (editingProduct?.id) {
        await axios.put(`${API_URL}/api/admin/products/${editingProduct.id}`, data);
      } else {
        await axios.post(`${API_URL}/api/admin/products`, data);
      }
      setEditingProduct(null);
      fetchProducts();
      e.target.reset();
    } catch (err) {
      alert('Error al guardar producto');
    }
  };

  const deleteProduct = async (id) => {
    if (!confirm('¿Borrar este producto?')) return;
    try {
      await axios.delete(`${API_URL}/api/admin/products/${id}`);
      fetchProducts();
    } catch (err) {
      alert('Error al borrar producto');
    }
  };

  const manageExpense = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData);
    data.branch_id = user.branch_id;
    data.amount = parseFloat(data.amount);

    try {
      await axios.post(`${API_URL}/api/admin/expenses`, data);
      fetchExpenses();
      e.target.reset();
    } catch (err) {
      alert('Error al guardar gasto');
    }
  };

  const deleteExpense = async (id) => {
    if (!confirm('¿Borrar este gasto?')) return;
    try {
      await axios.delete(`${API_URL}/api/admin/expenses/${id}`);
      fetchExpenses();
    } catch (err) {
      alert('Error al borrar gasto');
    }
  };

  const addRecipeItem = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData);
    data.product_id = managingRecipe.id;
    data.quantity_needed = parseFloat(data.quantity_needed);

    try {
      await axios.post(`${API_URL}/api/admin/recipes`, data);
      fetchRecipe(managingRecipe.id);
      e.target.reset();
    } catch (err) {
      alert('Error al guardar ingrediente');
    }
  };

  const deleteRecipeItem = async (id) => {
    try {
      await axios.delete(`${API_URL}/api/admin/recipes/${id}`);
      fetchRecipe(managingRecipe.id);
    } catch (err) {
      alert('Error al borrar ingrediente');
    }
  };

  const fetchCustomers = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/admin/customers?branchId=${user.branch_id}`);
      setCustomers(res.data);
    } catch (err) {
      console.error('Error fetching customers', err);
    }
  };

  const manageCustomer = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData);
    data.branch_id = user.branch_id;

    try {
      if (editingCustomer?.id) {
        await axios.put(`${API_URL}/api/admin/customers/${editingCustomer.id}`, data);
      } else {
        await axios.post(`${API_URL}/api/admin/customers`, data);
      }
      setEditingCustomer(null);
      fetchCustomers();
      e.target.reset();
    } catch (err) {
      alert('Error al guardar cliente');
    }
  };

  const deleteCustomer = async (id) => {
    if (!confirm('¿Borrar este cliente?')) return;
    try {
      await axios.delete(`${API_URL}/api/admin/customers/${id}`);
      fetchCustomers();
    } catch (err) {
      alert('Error al borrar cliente');
    }
  };

  const manageInventory = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData);
    data.branch_id = user.branch_id;
    data.quantity = parseFloat(data.quantity);

    try {
      if (editingInventory?.id) {
        // Here we could implement an update route if needed, but the original only had stock update.
        // For now, if we add editing for name/unit, we would need a PUT route. Let's just create.
      } else {
        await axios.post(`${API_URL}/api/inventory`, data);
      }
      setEditingInventory(null);
      fetchInventory();
      e.target.reset();
    } catch (err) {
      alert('Error al guardar insumo');
    }
  };

  const deleteInventory = async (id) => {
    if (!confirm('¿Borrar este insumo del inventario?')) return;
    try {
      await axios.delete(`${API_URL}/api/inventory/${id}`);
      fetchInventory();
    } catch (err) {
      alert('Error al borrar insumo');
    }
  };

  const totalVentas = report
    .filter(r => r.status === 'paid' || r.status === 'ready')
    .reduce((acc, curr) => acc + (curr.total_products || curr.total || 0), 0);

  const totalEfectivo = report.filter(r => (r.status === 'paid' || r.status === 'ready') && r.payment_method === 'cash').reduce((acc, curr) => acc + (curr.total_products || curr.total || 0), 0);
  const totalTarjeta = report.filter(r => (r.status === 'paid' || r.status === 'ready') && r.payment_method === 'card').reduce((acc, curr) => acc + (curr.total_products || curr.total || 0), 0);
  const totalTransferencia = report.filter(r => (r.status === 'paid' || r.status === 'ready') && r.payment_method === 'transfer').reduce((acc, curr) => acc + (curr.total_products || curr.total || 0), 0);
  const totalPropinas = report.filter(r => r.status === 'paid' || r.status === 'ready').reduce((acc, curr) => acc + (curr.total_tips || 0), 0);

  const totalGastos = expenses.reduce((acc, curr) => acc + curr.amount, 0);
  const utilidadNeta = totalVentas - totalGastos;

  return (
    <div className="admin-workflow" style={{ padding: '20px' }}>
      <nav className="waiter-navbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {branchInfo?.logo && <img src={branchInfo.logo} alt="Logo" style={{ height: '40px', borderRadius: '8px' }} />}
          <h2 style={{ color: 'var(--accent)' }}>{branchInfo?.name || 'Administración'}</h2>
        </div>
        <button onClick={onLogout} style={{ background: 'transparent', color: 'var(--text-muted)' }}>
          <LogOut size={20} />
        </button>
      </nav>

      {/* Admin Tabs */}
      <div style={{ display: 'flex', gap: '20px', margin: '20px 0', borderBottom: '1px solid rgba(255,255,255,0.1)', overflowX: 'auto' }}>
        <button onClick={() => setActiveTab('stats')} style={{ padding: '10px', background: 'none', border: 'none', color: activeTab === 'stats' ? 'var(--accent)' : 'white', borderBottom: activeTab === 'stats' ? '2px solid var(--accent)' : 'none', whiteSpace: 'nowrap' }}>Estadísticas</button>
        <button onClick={() => setActiveTab('analytics')} style={{ padding: '10px', background: 'none', border: 'none', color: activeTab === 'analytics' ? 'var(--accent)' : 'white', borderBottom: activeTab === 'analytics' ? '2px solid var(--accent)' : 'none', whiteSpace: 'nowrap' }}>📊 Analíticas</button>
        <button onClick={() => setActiveTab('staff')} style={{ padding: '10px', background: 'none', border: 'none', color: activeTab === 'staff' ? 'var(--accent)' : 'white', borderBottom: activeTab === 'staff' ? '2px solid var(--accent)' : 'none', whiteSpace: 'nowrap' }}>Personal</button>
        <button onClick={() => setActiveTab('menu')} style={{ padding: '10px', background: 'none', border: 'none', color: activeTab === 'menu' ? 'var(--accent)' : 'white', borderBottom: activeTab === 'menu' ? '2px solid var(--accent)' : 'none', whiteSpace: 'nowrap' }}>Menú / Carta</button>
        <button onClick={() => setActiveTab('expenses')} style={{ padding: '10px', background: 'none', border: 'none', color: activeTab === 'expenses' ? 'var(--accent)' : 'white', borderBottom: activeTab === 'expenses' ? '2px solid var(--accent)' : 'none', whiteSpace: 'nowrap' }}>Gastos Diario</button>
        <button onClick={() => setActiveTab('customers')} style={{ padding: '10px', background: 'none', border: 'none', color: activeTab === 'customers' ? 'var(--accent)' : 'white', borderBottom: activeTab === 'customers' ? '2px solid var(--accent)' : 'none', whiteSpace: 'nowrap' }}>Clientes</button>
        <button onClick={() => setActiveTab('inventory')} style={{ padding: '10px', background: 'none', border: 'none', color: activeTab === 'inventory' ? 'var(--accent)' : 'white', borderBottom: activeTab === 'inventory' ? '2px solid var(--accent)' : 'none', whiteSpace: 'nowrap' }}>Inventario</button>
        <button onClick={() => setActiveTab('ticket')} style={{ padding: '10px', background: 'none', border: 'none', color: activeTab === 'ticket' ? 'var(--accent)' : 'white', borderBottom: activeTab === 'ticket' ? '2px solid var(--accent)' : 'none', whiteSpace: 'nowrap' }}>🎫 Ticket</button>
        <button onClick={() => setActiveTab('config')} style={{ padding: '10px', background: 'none', border: 'none', color: activeTab === 'config' ? 'var(--accent)' : 'white', borderBottom: activeTab === 'config' ? '2px solid var(--accent)' : 'none', whiteSpace: 'nowrap' }}>Configuración</button>
      </div>

      {activeTab === 'stats' && (
        <div style={{ marginTop: '20px' }}>
          <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
            <div className="product-card">
              <h4 style={{ color: 'var(--text-muted)' }}>Ventas Totales</h4>
              <p style={{ fontSize: '2rem', color: 'var(--success)' }}>${parseFloat(totalVentas).toFixed(2)}</p>
            </div>
            <div className="product-card">
              <h4 style={{ color: 'var(--text-muted)' }}>Órdenes Pagadas</h4>
              <p style={{ fontSize: '2rem' }}>{report.find(r => r.status === 'paid')?.count || 0}</p>
            </div>
            <div className="product-card">
              <h4 style={{ color: 'var(--text-muted)' }}>Gastos del Día</h4>
              <p style={{ fontSize: '2rem', color: '#ef4444' }}>-${parseFloat(totalGastos).toFixed(2)}</p>
            </div>
            <div className="product-card" style={{ border: '2px solid var(--success)', background: 'rgba(16, 185, 129, 0.05)' }}>
              <h4 style={{ color: 'var(--text-muted)' }}>Utilidad Neta</h4>
              <p style={{ fontSize: '2rem', color: utilidadNeta >= 0 ? 'var(--success)' : '#ef4444' }}>${parseFloat(utilidadNeta).toFixed(2)}</p>
            </div>

            <div className="product-card" style={{ border: '2px dashed var(--accent)', background: 'rgba(239, 68, 68, 0.05)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '10px' }}>
              <h4 style={{ color: 'var(--accent)', margin: 0 }}>Cierre de Caja</h4>
              <button
                onClick={handleCierreCaja}
                className="btn-primary"
                style={{ background: 'var(--accent)', color: 'white', width: 'auto', padding: '10px 20px' }}
              >
                FIN DEL DÍA
              </button>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center' }}>Cierra todas las sesiones de la sucursal</p>
            </div>
          </div>

          <div className="cash-cuts-history" style={{ marginTop: '40px', background: 'var(--surface)', borderRadius: '12px', padding: '20px' }}>
            <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Clock size={20} /> Historial de Cortes de Caja
            </h3>
            {cashCuts.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>No hay cortes registrados aún.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '12px' }}>Fecha</th>
                      <th style={{ padding: '12px' }}>Órdenes Pagadas</th>
                      <th style={{ padding: '12px' }}>Ventas</th>
                      <th style={{ padding: '12px' }}>Gastos</th>
                      <th style={{ padding: '12px' }}>Utilidad</th>
                      <th style={{ padding: '12px', textAlign: 'right' }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashCuts.map((corte, index) => (
                      <tr key={index} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: '12px' }}>{new Date(corte.created_at).toLocaleString()}</td>
                        <td style={{ padding: '12px' }}>{corte.details?.paid_orders || 0}</td>
                        <td style={{ padding: '12px', color: 'var(--success)' }}>${parseFloat(corte.total_sales).toFixed(2)}</td>
                        <td style={{ padding: '12px', color: '#ef4444' }}>-${parseFloat(corte.total_expenses).toFixed(2)}</td>
                        <td style={{ padding: '12px', fontWeight: 'bold' }}>${parseFloat(corte.net_profit).toFixed(2)}</td>
                        <td style={{ padding: '12px', textAlign: 'right' }}>
                          <button onClick={() => printCorteTicket(corte, branchInfo)} className="btn-secondary" style={{ padding: '6px 10px', marginRight: '5px', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                            <Printer size={14} /> Ticket
                          </button>
                          <button onClick={() => downloadCortePDF(corte, branchInfo)} className="btn-primary" style={{ padding: '6px 10px', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                            <Download size={14} /> PDF
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'analytics' && (
        <div style={{ marginTop: '20px' }}>
          {!analytics ? <p style={{ color: 'var(--text-muted)' }}>Cargando analíticas...</p> : (
            <>
              {/* Daily Sales Chart */}
              <div className="glass-card" style={{ padding: '24px', marginBottom: '20px' }}>
                <h3 style={{ marginBottom: '16px' }}>📈 Ventas Últimos 7 Días</h3>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', height: '200px', paddingBottom: '30px', position: 'relative' }}>
                  {analytics.daily.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Sin datos de ventas</p>}
                  {analytics.daily.map((d, i) => {
                    const maxSale = Math.max(...analytics.daily.map(x => x.sales || 0), 1);
                    const height = ((d.sales || 0) / maxSale) * 160;
                    return (
                      <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--success)', fontWeight: 'bold' }}>${parseFloat(d.sales || 0).toFixed(0)}</span>
                        <div style={{
                          width: '100%', maxWidth: '50px', borderRadius: '8px 8px 0 0',
                          background: 'linear-gradient(to top, var(--primary), var(--accent))',
                          height: `${height}px`, transition: 'height 0.5s ease',
                          minHeight: '4px'
                        }}></div>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{d.day?.slice(5)}</span>
                        <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{d.orders} ord</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                {/* Top Products */}
                <div className="glass-card" style={{ padding: '24px' }}>
                  <h3 style={{ marginBottom: '16px' }}>🏆 Top 5 Productos</h3>
                  {analytics.topProducts.map((p, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <span>{['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i]} {p.name}</span>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontWeight: 'bold', color: 'var(--accent)' }}>{p.sold} vendidos</span>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--success)' }}>${parseFloat(p.revenue || 0).toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                  {analytics.topProducts.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Sin datos</p>}
                </div>

                {/* Delivery Breakdown */}
                <div className="glass-card" style={{ padding: '24px' }}>
                  <h3 style={{ marginBottom: '16px' }}>🛵 Ventas por Canal</h3>
                  {analytics.byType.map((t, i) => {
                    const labels = { dine_in: '🍽️ Local', takeout: '🥡 Para Llevar', delivery_didi: '🟠 DiDi', delivery_uber: '⚫ Uber', delivery_rappi: '🟢 Rappi', delivery_propio: '🛵 Propio' };
                    const colors = { dine_in: '#3b82f6', takeout: '#8b5cf6', delivery_didi: '#ff6600', delivery_uber: '#333', delivery_rappi: '#00b140', delivery_propio: '#ef4444' };
                    return (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: colors[t.order_type] || '#666', display: 'inline-block' }}></span>
                          {labels[t.order_type] || t.order_type}
                        </span>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontWeight: 'bold' }}>{t.orders} órdenes</span>
                          <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--success)' }}>${parseFloat(t.sales || 0).toFixed(2)}</span>
                        </div>
                      </div>
                    );
                  })}
                  {analytics.byType.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Sin datos de ventas</p>}
                </div>
              </div>

              {/* Delivery Commissions */}
              {deliveryReport.length > 0 && (
                <div className="glass-card" style={{ padding: '24px', marginTop: '20px' }}>
                  <h3 style={{ marginBottom: '16px' }}>💸 Comisiones por Plataforma</h3>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                        <th style={{ padding: '10px' }}>Plataforma</th>
                        <th style={{ padding: '10px' }}>Órdenes</th>
                        <th style={{ padding: '10px' }}>Venta Bruta</th>
                        <th style={{ padding: '10px' }}>Comisiones</th>
                        <th style={{ padding: '10px' }}>Ingreso Neto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deliveryReport.map((r, i) => {
                        const labels = { delivery_didi: '🟠 DiDi', delivery_uber: '⚫ Uber', delivery_rappi: '🟢 Rappi', delivery_propio: '🛵 Propio' };
                        return (
                          <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                            <td style={{ padding: '10px', fontWeight: 'bold' }}>{labels[r.order_type] || r.order_type}</td>
                            <td style={{ padding: '10px' }}>{r.total_orders}</td>
                            <td style={{ padding: '10px' }}>${parseFloat(r.total_sales || 0).toFixed(2)}</td>
                            <td style={{ padding: '10px', color: '#ef4444' }}>-${parseFloat(r.total_commissions || 0).toFixed(2)}</td>
                            <td style={{ padding: '10px', color: 'var(--success)', fontWeight: 'bold' }}>${parseFloat(r.net_income || 0).toFixed(2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'staff' && (
        <div style={{ marginTop: '20px' }}>
          <div className="glass-card" style={{ padding: '24px', marginBottom: '24px' }}>
            <h3>{editingUser ? 'Editar Miembro del Equipo' : 'Nuevo Miembro del Equipo'}</h3>
            <form onSubmit={manageUser} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '15px', marginTop: '15px' }}>
              <div className="form-group">
                <label>Usuario</label>
                <input name="username" defaultValue={editingUser?.username} required />
              </div>
              <div className="form-group">
                <label>Contraseña {editingUser && '(dejar en blanco para no cambiar)'}</label>
                <input name="password" type="password" required={!editingUser} />
              </div>
              <div className="form-group">
                <label>Rol</label>
                <select name="role" defaultValue={editingUser?.role || 'waiter'}>
                  <option value="waiter">Mesero</option>
                  <option value="cashier">Cajero</option>
                  <option value="chef">Cocina</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px' }}>
                <button type="submit" className="btn-primary" style={{ height: '45px' }}>{editingUser ? 'ACTUALIZAR' : 'CREAR'}</button>
                {editingUser && <button type="button" onClick={() => setEditingUser(null)} className="btn-secondary" style={{ height: '45px' }}>CANCELAR</button>}
              </div>
            </form>
          </div>

          <div className="inventory-list" style={{ background: 'var(--surface)', borderRadius: '12px', padding: '16px' }}>
            <h3>Equipo Actual</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  <th style={{ padding: '12px' }}>Usuario</th>
                  <th style={{ padding: '12px' }}>Rol</th>
                  <th style={{ padding: '12px' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {staff.map(s => (
                  <tr key={s.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '12px' }}>{s.username}</td>
                    <td style={{ padding: '12px' }}>
                      <span className={`badge badge - ${s.role === 'admin' ? 'paid' : 'pending'}`}>{s.role}</span>
                    </td>
                    <td style={{ padding: '12px' }}>
                      <button onClick={() => setEditingUser(s)} className="btn-secondary" style={{ padding: '5px 10px', fontSize: '0.8rem', marginRight: '5px' }}>Editar</button>
                      <button onClick={() => deleteUser(s.id)} style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>Borrar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'menu' && (
        <div style={{ marginTop: '20px' }}>
          <div className="glass-card" style={{ padding: '24px', marginBottom: '24px' }}>
            <h3>{editingProduct ? 'Editar Platillo' : 'Nuevo Platillo / Bebida'}</h3>
            <form onSubmit={manageProduct} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '15px', marginTop: '15px' }}>
              <div className="form-group">
                <label>Nombre del Producto</label>
                <input name="name" defaultValue={editingProduct?.name} required />
              </div>
              <div className="form-group">
                <label>Precio Local ($)</label>
                <input name="price" type="number" step="0.01" defaultValue={editingProduct?.price} required />
              </div>
              <div className="form-group">
                <label>Precio Delivery ($)</label>
                <input name="delivery_price" type="number" step="0.01" defaultValue={editingProduct?.delivery_price || ''} placeholder="0 = mismo" />
              </div>
              <div className="form-group">
                <label>Categoría</label>
                <input name="category" placeholder="Tacos, Bebidas, etc." defaultValue={editingProduct?.category} required />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px' }}>
                <button type="submit" className="btn-primary" style={{ height: '45px' }}>{editingProduct ? 'ACTUALIZAR' : 'CREAR'}</button>
                {editingProduct && <button type="button" onClick={() => setEditingProduct(null)} className="btn-secondary" style={{ height: '45px' }}>CANCELAR</button>}
              </div>
            </form>
          </div>

          <div className="inventory-list" style={{ background: 'var(--surface)', borderRadius: '12px', padding: '16px' }}>
            <h3>Menú de la Sucursal</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  <th style={{ padding: '12px' }}>Producto</th>
                  <th style={{ padding: '12px' }}>P. Local</th>
                  <th style={{ padding: '12px' }}>P. Delivery</th>
                  <th style={{ padding: '12px' }}>Categoría</th>
                  <th style={{ padding: '12px' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '12px', fontWeight: 'bold' }}>{p.name}</td>
                    <td style={{ padding: '12px', color: 'var(--success)' }}>${parseFloat(p.price).toFixed(2)}</td>
                    <td style={{ padding: '12px', color: p.delivery_price ? '#ff6600' : 'var(--text-muted)' }}>
                      {p.delivery_price ? `$${parseFloat(p.delivery_price).toFixed(2)}` : '= Local'}
                    </td>
                    <td style={{ padding: '12px' }}>{p.category}</td>
                    <td style={{ padding: '12px' }}>
                      <button onClick={() => setEditingProduct(p)} className="btn-secondary" style={{ padding: '5px 10px', fontSize: '0.8rem', marginRight: '5px' }}>Editar</button>
                      <button onClick={() => { setManagingRecipe(p); fetchRecipe(p.id); }} className="btn-secondary" style={{ padding: '5px 10px', fontSize: '0.8rem', marginRight: '5px', background: 'var(--accent)', color: 'white' }}>Receta</button>
                      <button onClick={() => deleteProduct(p.id)} style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>Borrar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {managingRecipe && (
            <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
              <div className="glass-card" style={{ width: '90%', maxWidth: '600px', padding: '30px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                  <h3>Receta de: {managingRecipe.name}</h3>
                  <button onClick={() => setManagingRecipe(null)} style={{ background: 'none', border: 'none', color: 'white', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
                </div>
                <form onSubmit={addRecipeItem} style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                  <select name="inventory_id" style={{ flex: 2 }} required>
                    <option value="">Seleccionar Insumo...</option>
                    {inventory.map(i => <option key={i.id} value={i.id}>{i.item_name} ({i.unit})</option>)}
                  </select>
                  <input name="quantity_needed" type="number" step="0.001" placeholder="Cant." style={{ flex: 1 }} required />
                  <button type="submit" className="btn-primary" style={{ width: 'auto', padding: '0 15px' }}>Añadir</button>
                </form>
                <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                        <th style={{ padding: '10px' }}>Insumo</th>
                        <th style={{ padding: '10px' }}>Cant. necesaria</th>
                        <th style={{ padding: '10px' }}>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentRecipe.map(r => (
                        <tr key={r.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <td style={{ padding: '10px' }}>{r.item_name}</td>
                          <td style={{ padding: '10px' }}>{r.quantity_needed} {r.unit}</td>
                          <td style={{ padding: '10px' }}>
                            <button onClick={() => deleteRecipeItem(r.id)} style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>Eliminar</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'expenses' && (
        <div style={{ marginTop: '20px' }}>
          <div className="glass-card" style={{ padding: '24px', marginBottom: '24px' }}>
            <h3>Registrar Nuevo Gasto</h3>
            <form onSubmit={manageExpense} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '15px', marginTop: '15px' }}>
              <div className="form-group">
                <label>Descripción</label>
                <input name="description" placeholder="Ej: Pago de Luz, Compra de Carne..." required />
              </div>
              <div className="form-group">
                <label>Monto ($)</label>
                <input name="amount" type="number" step="0.01" required />
              </div>
              <div className="form-group">
                <label>Categoría</label>
                <select name="category">
                  <option value="insumos">Insumos</option>
                  <option value="nomina">Nómina</option>
                  <option value="servicios">Servicios (Luz, Gas, etc.)</option>
                  <option value="renta">Renta</option>
                  <option value="otros">Otros</option>
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button type="submit" className="btn-primary" style={{ height: '45px' }}>GUARDAR GASTO</button>
              </div>
            </form>
          </div>

          <div className="inventory-list" style={{ background: 'var(--surface)', borderRadius: '12px', padding: '16px' }}>
            <h3>Historial de Gastos</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  <th style={{ padding: '12px' }}>Fecha</th>
                  <th style={{ padding: '12px' }}>Descripción</th>
                  <th style={{ padding: '12px' }}>Categoría</th>
                  <th style={{ padding: '12px' }}>Monto</th>
                  <th style={{ padding: '12px' }}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map(e => (
                  <tr key={e.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '12px', fontSize: '0.85rem' }}>{new Date(e.created_at).toLocaleDateString()}</td>
                    <td style={{ padding: '12px' }}>{e.description}</td>
                    <td style={{ padding: '12px' }}><span className="badge badge-pending">{e.category}</span></td>
                    <td style={{ padding: '12px', fontWeight: 'bold', color: '#ef4444' }}>-${e.amount.toFixed(2)}</td>
                    <td style={{ padding: '12px' }}>
                      <button onClick={() => deleteExpense(e.id)} style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>Eliminar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'customers' && (
        <div style={{ marginTop: '20px' }}>
          <div className="glass-card" style={{ padding: '24px', marginBottom: '24px' }}>
            <h3>{editingCustomer ? 'Editar Cliente' : 'Nuevo Cliente'}</h3>
            <form onSubmit={manageCustomer} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '15px', marginTop: '15px' }}>
              <div className="form-group">
                <label>Nombre</label>
                <input name="name" defaultValue={editingCustomer?.name} required />
              </div>
              <div className="form-group">
                <label>Teléfono</label>
                <input name="phone" type="tel" defaultValue={editingCustomer?.phone} />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input name="email" type="email" defaultValue={editingCustomer?.email} />
              </div>
              <div className="form-group">
                <label>Notas</label>
                <input name="notes" placeholder="Alergia, preferencias..." defaultValue={editingCustomer?.notes} />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px' }}>
                <button type="submit" className="btn-primary" style={{ height: '45px' }}>{editingCustomer ? 'ACTUALIZAR' : 'GUARDAR'}</button>
                {editingCustomer && <button type="button" onClick={() => setEditingCustomer(null)} className="btn-secondary" style={{ height: '45px' }}>CANCELAR</button>}
              </div>
            </form>
          </div>

          <div className="inventory-list" style={{ background: 'var(--surface)', borderRadius: '12px', padding: '16px' }}>
            <h3>Base de Clientes ({customers.length})</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  <th style={{ padding: '12px' }}>Nombre</th>
                  <th style={{ padding: '12px' }}>Teléfono</th>
                  <th style={{ padding: '12px' }}>Email</th>
                  <th style={{ padding: '12px' }}>Notas</th>
                  <th style={{ padding: '12px' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {customers.map(c => (
                  <tr key={c.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '12px', fontWeight: 'bold' }}>{c.name}</td>
                    <td style={{ padding: '12px' }}>{c.phone || '-'}</td>
                    <td style={{ padding: '12px' }}>{c.email || '-'}</td>
                    <td style={{ padding: '12px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{c.notes || '-'}</td>
                    <td style={{ padding: '12px' }}>
                      <button onClick={() => setEditingCustomer(c)} className="btn-secondary" style={{ padding: '5px 10px', fontSize: '0.8rem', marginRight: '5px' }}>Editar</button>
                      <button onClick={() => deleteCustomer(c.id)} style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>Borrar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'inventory' && (
        <div style={{ marginTop: '20px' }}>
          <div className="glass-card" style={{ padding: '24px', marginBottom: '24px' }}>
            <h3>{editingInventory ? 'Editar Insumo' : 'Nuevo Insumo'}</h3>
            <form onSubmit={manageInventory} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '15px', marginTop: '15px' }}>
              <div className="form-group">
                <label>Nombre del Insumo</label>
                <input name="item_name" placeholder="Ej: Tomate, Tortillas..." defaultValue={editingInventory?.item_name} required />
              </div>
              <div className="form-group">
                <label>Cantidad Inicial</label>
                <input name="quantity" type="number" step="0.01" defaultValue={editingInventory?.quantity || 0} required />
              </div>
              <div className="form-group">
                <label>Unidad de Medida</label>
                <input name="unit" placeholder="Ej: kg, litros, piezas" defaultValue={editingInventory?.unit} required />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px' }}>
                <button type="submit" className="btn-primary" style={{ height: '45px' }}>{editingInventory ? 'ACTUALIZAR' : 'AGREGAR INSUMO'}</button>
                {editingInventory && <button type="button" onClick={() => setEditingInventory(null)} className="btn-secondary" style={{ height: '45px' }}>CANCELAR</button>}
              </div>
            </form>
          </div>

          <div className="inventory-list" style={{ background: 'var(--surface)', borderRadius: '12px', padding: '16px' }}>
            <h3 style={{ marginBottom: '16px' }}>Inventario Actual</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  <th style={{ padding: '12px' }}>Insumo</th>
                  <th style={{ padding: '12px' }}>Cantidad</th>
                  <th style={{ padding: '12px' }}>Unidad</th>
                  <th style={{ padding: '12px' }}>Ajuste</th>
                  <th style={{ padding: '12px' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map(item => {
                  const isLowStock = item.quantity <= 5;
                  return (
                    <tr key={item.id} style={{
                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                      background: isLowStock ? 'rgba(239, 68, 68, 0.15)' : 'transparent'
                    }}>
                      <td style={{ padding: '12px', fontWeight: 'bold' }}>
                        {item.item_name}
                        {isLowStock && <span style={{ marginLeft: '8px', fontSize: '0.7rem', color: '#fca5a5', border: '1px solid #ef4444', borderRadius: '4px', padding: '2px 4px', background: 'rgba(239, 68, 68, 0.2)' }}>¡STOCK BAJO!</span>}
                      </td>
                      <td style={{ padding: '12px', color: isLowStock ? '#fca5a5' : 'inherit', fontWeight: isLowStock ? 'bold' : 'normal' }}>{item.quantity}</td>
                      <td style={{ padding: '12px' }}>{item.unit}</td>
                      <td style={{ padding: '12px' }}>
                        <button onClick={() => updateStock(item.id, item.quantity + 0.5)} style={{ background: 'var(--secondary)', padding: '5px 10px', marginRight: '5px', color: 'white', borderRadius: '4px', border: 'none', cursor: 'pointer' }}>+</button>
                        <button onClick={() => updateStock(item.id, Math.max(0, item.quantity - 0.5))} style={{ background: 'var(--secondary)', padding: '5px 10px', color: 'white', borderRadius: '4px', border: 'none', cursor: 'pointer' }}>-</button>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <button onClick={() => deleteInventory(item.id)} style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>Borrar</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'ticket' && (
        <div style={{ marginTop: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
          {/* Settings Form */}
          <div className="glass-card" style={{ padding: '24px' }}>
            <h3 style={{ marginBottom: '20px' }}>🎫 Personalizar Ticket</h3>

            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label>Encabezado del Ticket</label>
              <input value={ticketSettings.ticket_header} onChange={e => setTicketSettings({ ...ticketSettings, ticket_header: e.target.value })}
                placeholder="Nombre del negocio" style={{ width: '100%' }} />
            </div>

            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label>Pie del Ticket (Mensaje final)</label>
              <input value={ticketSettings.ticket_footer} onChange={e => setTicketSettings({ ...ticketSettings, ticket_footer: e.target.value })}
                placeholder="¡Gracias por su compra!" style={{ width: '100%' }} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '10px' }}>
              <label style={{ flex: 1, fontSize: '0.9rem' }}>📷 Mostrar Logo en el Ticket</label>
              <button onClick={() => setTicketSettings({ ...ticketSettings, ticket_show_logo: ticketSettings.ticket_show_logo === '1' ? '0' : '1' })}
                style={{
                  padding: '6px 16px', borderRadius: '20px', fontWeight: 'bold',
                  background: ticketSettings.ticket_show_logo === '1' ? 'var(--success)' : 'rgba(255,255,255,0.1)',
                  color: ticketSettings.ticket_show_logo === '1' ? 'black' : 'var(--text-muted)',
                  border: 'none', cursor: 'pointer'
                }}
              >
                {ticketSettings.ticket_show_logo === '1' ? '✅ Sí' : '❌ No'}
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '10px' }}>
              <label style={{ flex: 1, fontSize: '0.9rem' }}>📱 Mostrar QR en el Ticket</label>
              <button onClick={() => setTicketSettings({ ...ticketSettings, ticket_show_qr: ticketSettings.ticket_show_qr === '1' ? '0' : '1' })}
                style={{
                  padding: '6px 16px', borderRadius: '20px', fontWeight: 'bold',
                  background: ticketSettings.ticket_show_qr === '1' ? 'var(--success)' : 'rgba(255,255,255,0.1)',
                  color: ticketSettings.ticket_show_qr === '1' ? 'black' : 'var(--text-muted)',
                  border: 'none', cursor: 'pointer'
                }}
              >
                {ticketSettings.ticket_show_qr === '1' ? '✅ Sí' : '❌ No'}
              </button>
            </div>

            {ticketSettings.ticket_show_qr === '1' && (
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label>URL del Código QR</label>
                <input value={ticketSettings.ticket_qr_url} onChange={e => setTicketSettings({ ...ticketSettings, ticket_qr_url: e.target.value })}
                  placeholder="https://mi-taqueria.com o link de redes sociales" style={{ width: '100%' }} />
                <small style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Puede ser tu página, Instagram, Facebook, Google Maps, etc.</small>
              </div>
            )}

            <button onClick={saveTicketSettings} disabled={ticketSaving}
              className="btn-primary" style={{ marginTop: '12px' }}>
              {ticketSaving ? 'Guardando...' : '💾 GUARDAR CONFIGURACIÓN'}
            </button>
          </div>

          {/* Live Preview */}
          <div className="glass-card" style={{ padding: '24px' }}>
            <h3 style={{ marginBottom: '20px' }}>👁️ Vista Previa del Ticket</h3>
            <div style={{
              background: 'white', color: 'black', padding: '20px', borderRadius: '8px',
              fontFamily: 'monospace', fontSize: '0.8rem', maxWidth: '300px', margin: '0 auto',
              boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
            }}>
              {/* Logo */}
              {ticketSettings.ticket_show_logo === '1' && branchInfo?.logo && (
                <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                  <img src={branchInfo.logo} alt="Logo" style={{ height: '50px', borderRadius: '4px' }} />
                </div>
              )}

              {/* Header */}
              <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: '1rem', borderBottom: '1px dashed #ccc', paddingBottom: '8px', marginBottom: '8px' }}>
                {ticketSettings.ticket_header || 'Mi Taquería'}
              </div>

              {/* Example order */}
              <div style={{ fontSize: '0.7rem', color: '#666', marginBottom: '8px' }}>
                Ticket #001 • {new Date().toLocaleDateString()} {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
              <div style={{ borderBottom: '1px dashed #ccc', paddingBottom: '8px', marginBottom: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>2x Taco al Pastor</span><span>$40.00</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>1x Agua de Horchata</span><span>$25.00</span>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '1rem', marginBottom: '8px' }}>
                <span>TOTAL:</span><span>$65.00</span>
              </div>

              {/* QR Code placeholder */}
              {ticketSettings.ticket_show_qr === '1' && ticketSettings.ticket_qr_url && (
                <div style={{ textAlign: 'center', margin: '12px 0', padding: '8px', background: '#f0f0f0', borderRadius: '4px' }}>
                  <div style={{ width: '80px', height: '80px', background: '#333', margin: '0 auto', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '0.6rem' }}>
                    QR CODE
                  </div>
                  <div style={{ fontSize: '0.6rem', color: '#888', marginTop: '4px' }}>Escanea para visitarnos</div>
                </div>
              )}

              {/* Footer */}
              <div style={{ textAlign: 'center', fontSize: '0.75rem', paddingTop: '8px', borderTop: '1px dashed #ccc', color: '#666' }}>
                {ticketSettings.ticket_footer || '¡Gracias por su compra!'}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'config' && (
        <div className="glass-card" style={{ padding: '30px', maxWidth: '600px' }}>
          <h3 style={{ marginBottom: '20px' }}>Configuración de Sucursal</h3>
          <div className="form-group" style={{ marginBottom: '20px' }}>
            <label>Nombre de la Sucursal</label>
            <input type="text" value={tempName} onChange={(e) => setTempName(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: '20px' }}>
            <label>Logo de la Sucursal</label>
            <input type="file" accept="image/*" onChange={handleLogoUpload} style={{ marginBottom: '10px' }} />
            {tempLogo && (
              <div style={{ marginTop: '10px' }}>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Vista previa:</p>
                <img src={tempLogo} alt="Preview" style={{ height: '80px', borderRadius: '12px', border: '1px solid var(--glass-border)' }} />
              </div>
            )}
          </div>
          <button onClick={saveBranding} className="btn-primary">GUARDAR CAMBIOS</button>
        </div>
      )}
      {/* MODAL PARA CIERRE DE CAJA */}
      {showCierreModal && (
        <div className="modal-overlay" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div className="glass-card" style={{ width: '400px', padding: '30px', textAlign: 'center' }}>
            <h2 style={{ color: 'var(--accent)', marginBottom: '10px' }}>Arqueo Físico de Caja</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '20px', fontSize: '0.9rem' }}>
              Para asegurar que no hay faltantes, por favor cuenta el dinero en efectivo que tienes físicamente en la caja e ingrésalo aquí.
            </p>

            <div style={{ background: 'var(--surface)', padding: '15px', borderRadius: '10px', marginBottom: '20px', textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span>Ventas en Efectivo:</span>
                <span style={{ fontWeight: 'bold' }}>${parseFloat(totalEfectivo).toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                <span>Ventas en Tarjeta:</span>
                <span>${parseFloat(totalTarjeta).toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                <span>Transferencias:</span>
                <span>${parseFloat(totalTransferencia).toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '8px', marginTop: '8px' }}>
                <span style={{ color: 'var(--success)' }}>Total Propinas:</span>
                <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>${parseFloat(totalPropinas).toFixed(2)}</span>
              </div>
            </div>

            <div style={{ marginBottom: '24px', textAlign: 'left' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>¿Cuánto efectivo físico contaste?</label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: '15px', top: '50%', transform: 'translateY(-50%)', fontSize: '1.2rem', color: 'var(--accent)' }}>$</span>
                <input
                  type="number"
                  step="0.01"
                  autoFocus
                  value={declaredCash}
                  onChange={(e) => setDeclaredCash(e.target.value)}
                  placeholder="0.00"
                  style={{ width: '100%', padding: '15px', paddingLeft: '35px', fontSize: '1.2rem', fontWeight: 'bold' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setShowCierreModal(false)}
                style={{ flex: 1, padding: '12px', background: 'var(--surface)', border: 'none', color: 'white', borderRadius: '8px', cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                onClick={processCierre}
                style={{ flex: 2, padding: '12px', background: 'var(--accent)', border: 'none', color: 'black', fontWeight: 'bold', borderRadius: '8px', cursor: 'pointer' }}
              >
                CERRAR EL DÍA AHORA
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

// Panel del Cajero (Cobros y Tickets + Tomar Órdenes)
const CashierPanel = ({ user, branchInfo, onLogout }) => {
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [tableNumber, setTableNumber] = useState('');
  const [activeTab, setActiveTab] = useState('order'); // 'order' o 'pay'
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [tipAmount, setTipAmount] = useState('');
  const [editingOrderId, setEditingOrderId] = useState(null);
  // Delivery state
  const [orderType, setOrderType] = useState('dine_in');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');

  useEffect(() => {
    fetchOrders();
    fetchProducts();
    socket.on('order_update', fetchOrders);
    return () => socket.off('order_update', fetchOrders);
  }, []);

  const fetchOrders = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/orders/pending?branchId=${user.branch_id}`);
      setOrders(res.data);
    } catch (err) {
      console.error('Error fetching orders', err);
    }
  };

  const fetchProducts = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/products?branchId=${user.branch_id}`);
      setProducts(res.data);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching products', err);
    }
  };

  const addToCart = (product) => {
    const existing = cart.find(item => item.id === product.id);
    if (existing) {
      setCart(cart.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item));
    } else {
      setCart([...cart, { ...product, quantity: 1 }]);
    }
  };

  const updateItemNote = (id, notes) => {
    setCart(cart.map(item => item.id === id ? { ...item, notes } : item));
  };

  const removeFromCart = (id) => {
    const existing = cart.find(item => item.id === id);
    if (!existing) return;
    if (existing.quantity === 1) {
      setCart(cart.filter(item => item.id !== id));
    } else {
      setCart(cart.map(item => item.id === id ? { ...item, quantity: item.quantity - 1 } : item));
    }
  };

  const sendOrder = async () => {
    if (cart.length === 0) return alert('Agrega productos al carrito');
    const isDelivery = orderType.startsWith('delivery_');
    if (!isDelivery && !tableNumber && tableNumber !== 0) return alert('Selecciona mesa o tipo de orden');

    try {
      const orderData = {
        table_number: isDelivery ? 0 : parseInt(tableNumber),
        waiter_id: user.id,
        branch_id: user.branch_id,
        items: cart.map(item => ({ product_id: item.id, quantity: item.quantity, notes: item.notes || '' })),
        order_type: orderType,
        customer_name: customerName,
        customer_phone: customerPhone,
        delivery_address: deliveryAddress,
        delivery_notes: deliveryNotes,
        platform_commission: 0
      };

      if (editingOrderId) {
        await axios.put(`${API_URL}/api/orders/${editingOrderId}`, orderData);
        alert('¡Orden actualizada!');
      } else {
        if (!isDelivery) {
          const activeForTable = orders.find(o => o.table_number === parseInt(tableNumber) && (o.status === 'pending' || o.status === 'preparing' || o.status === 'ready'));
          if (activeForTable) {
            if (!confirm(`La Mesa ${tableNumber} ya tiene una orden abierta. ¿Deseas AGREGAR estos productos a la orden existente?`)) return;
            await axios.post(`${API_URL}/api/orders/${activeForTable.id}/append`, {
              branch_id: user.branch_id,
              items: cart.map(item => ({ product_id: item.id, quantity: item.quantity, notes: item.notes || '' }))
            });
            alert('Productos agregados a la orden');
          } else {
            await axios.post(`${API_URL}/api/orders`, orderData);
            alert('¡Orden enviada a cocina!');
          }
        } else {
          await axios.post(`${API_URL}/api/orders`, orderData);
          alert(`¡Pedido ${orderType.replace('delivery_', '').toUpperCase()} enviado a cocina!`);
        }
      }

      setCart([]);
      setTableNumber('');
      setEditingOrderId(null);
      setCustomerName(''); setCustomerPhone(''); setDeliveryAddress(''); setDeliveryNotes('');
      setOrderType('dine_in');
      fetchOrders();
    } catch (err) {
      alert('Error al procesar orden');
    }
  };

  const editOrder = (order) => {
    // Convert current order items into the cart format
    const newCart = order.items.map(it => {
      // Find the product in the products list to get the ID (backend returns name/price but we need product_id)
      const fullProduct = products.find(p => p.name === it.product_name);
      return {
        id: fullProduct?.id,
        name: it.product_name,
        price: parseFloat(it.price),
        quantity: it.quantity,
        notes: it.notes || ''
      };
    }).filter(it => it.id); // Ensure we have the ID

    setCart(newCart);
    setTableNumber(order.table_number.toString());
    setEditingOrderId(order.id);
    setActiveTab('order');
    setSelectedOrder(null);
  };

  const markAsPaid = async (orderId) => {
    try {
      const tip = parseFloat(tipAmount) || 0;
      await axios.put(`${API_URL}/api/orders/${orderId}/status`, {
        status: 'paid',
        payment_method: paymentMethod,
        tip: tip,
        branch_id: user.branch_id
      });
      fetchOrders();
      setSelectedOrder(null);
      setTipAmount('');
      setPaymentMethod('cash');
    } catch (err) {
      alert('Error al procesar pago');
    }
  };

  const cancelOrder = async (orderId) => {
    if (!confirm('¿Seguro que quieres cancelar esta orden y devolver los insumos al inventario?')) return;
    try {
      await axios.put(`${API_URL}/api/orders/${orderId}/cancel`, { branch_id: user.branch_id });
      fetchOrders();
      setSelectedOrder(null);
    } catch (err) {
      alert('Error al cancelar orden');
    }
  };


  return (
    <div className="cashier-workflow" style={{ padding: '20px' }}>
      <nav className="waiter-navbar" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {branchInfo?.logo && <img src={branchInfo.logo} alt="Logo" style={{ height: '35px', borderRadius: '6px' }} />}
          <h2 style={{ color: 'var(--accent)', fontSize: '1.2rem' }}>{branchInfo?.name || 'Caja'}</h2>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '10px' }}>Usuario: {user.username}</span>
        </div>
        <button onClick={onLogout} style={{ background: 'transparent', color: 'var(--text-muted)' }}>
          <LogOut size={20} />
        </button>
      </nav>

      <div style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        marginBottom: '16px', flexWrap: 'wrap'
      }}>

        <div style={{
          display: 'flex', gap: '4px', flex: 1,
          background: 'var(--surface)', borderRadius: '8px', padding: '3px'
        }}>
          <button
            onClick={() => setActiveTab('order')}
            style={{
              flex: 1, padding: '8px 14px', borderRadius: '6px', fontWeight: '600', fontSize: '0.85rem',
              background: activeTab === 'order' ? 'var(--primary)' : 'transparent',
              color: activeTab === 'order' ? 'white' : 'var(--text-muted)',
              border: 'none', cursor: 'pointer', transition: 'all 0.2s ease',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
            }}
          >
            <ShoppingCart size={14} /> Orden
          </button>
          <button
            onClick={() => setActiveTab('pay')}
            style={{
              flex: 1, padding: '8px 14px', borderRadius: '6px', fontWeight: '600', fontSize: '0.85rem',
              background: activeTab === 'pay' ? 'var(--success)' : 'transparent',
              color: activeTab === 'pay' ? 'black' : 'var(--text-muted)',
              border: 'none', cursor: 'pointer', transition: 'all 0.2s ease',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
            }}
          >
            <CheckCircle size={14} /> Cobrar {orders.filter(o => o.status === 'ready').length > 0 && (
              <span style={{
                background: 'var(--accent)', color: 'white', borderRadius: '50%',
                width: '18px', height: '18px', display: 'inline-flex', alignItems: 'center',
                justifyContent: 'center', fontSize: '0.7rem', fontWeight: 'bold'
              }}>{orders.filter(o => o.status === 'ready').length}</span>
            )}
          </button>
        </div>

        <button onClick={onLogout} style={{
          background: 'transparent', color: 'var(--text-muted)', border: 'none',
          cursor: 'pointer', padding: '6px', borderRadius: '6px'
        }}>
          <LogOut size={16} />
        </button>
      </div>

      {/* Tab: Tomar Orden */}
      {activeTab === 'order' && (
        <div style={{ display: 'flex', gap: '20px', minHeight: 'calc(100vh - 180px)' }}>
          {/* Columna Izquierda: Menú */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="glass-card" style={{ padding: '20px', marginBottom: '24px' }}>
              <h3 style={{ marginBottom: '12px', fontSize: '1rem' }}>Tipo de Orden</h3>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px' }}>
                {[
                  { key: 'dine_in', label: '🍽️ Local', color: '#3b82f6' },
                  { key: 'takeout', label: '🥡 P/Llevar', color: '#8b5cf6' },
                  { key: 'delivery_didi', label: '🟠 DiDi', color: '#ff6600' },
                  { key: 'delivery_uber', label: '⚫ Uber', color: '#333333' },
                  { key: 'delivery_rappi', label: '🟢 Rappi', color: '#00b140' },
                  { key: 'delivery_propio', label: '🛵 Propio', color: '#ef4444' },
                ].map(t => (
                  <button
                    key={t.key}
                    onClick={() => { setOrderType(t.key); if (t.key.startsWith('delivery_') || t.key === 'takeout') setTableNumber(0); }}
                    style={{
                      padding: '8px 14px', borderRadius: '8px', fontWeight: 'bold', fontSize: '0.8rem',
                      background: orderType === t.key ? t.color : 'rgba(255,255,255,0.05)',
                      color: orderType === t.key ? 'white' : 'var(--text-muted)',
                      border: `2px solid ${orderType === t.key ? t.color : 'var(--glass-border)'}`,
                      cursor: 'pointer', transition: 'all 0.2s'
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Delivery fields */}
              {orderType.startsWith('delivery_') && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                  <input placeholder="Nombre del cliente" value={customerName} onChange={e => setCustomerName(e.target.value)}
                    style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', color: 'white', fontSize: '0.85rem' }} />
                  <input placeholder="📱 Teléfono" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)}
                    style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', color: 'white', fontSize: '0.85rem' }} />
                  <input placeholder="📍 Dirección de entrega" value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)}
                    style={{ gridColumn: '1 / -1', padding: '8px 12px', borderRadius: '8px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', color: 'white', fontSize: '0.85rem' }} />
                  <input placeholder="Notas de entrega" value={deliveryNotes} onChange={e => setDeliveryNotes(e.target.value)}
                    style={{ gridColumn: '1 / -1', padding: '8px 12px', borderRadius: '8px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', color: 'white', fontSize: '0.85rem' }} />
                  <div style={{ gridColumn: '1 / -1', padding: '8px 12px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', fontSize: '0.8rem', color: '#93c5fd' }}>
                    💰 Se usarán los <strong>precios de delivery</strong> configurados en el menú para este pedido
                  </div>
                </div>
              )}

              {/* Table selector - only for dine_in and takeout */}
              {(orderType === 'dine_in') && (
                <>
                  <h3 style={{ marginBottom: '8px', fontSize: '1rem', display: 'flex', justifyContent: 'space-between' }}>
                    <span>Seleccionar Mesa</span>
                    <span style={{ color: 'var(--accent)' }}>{tableNumber !== '' ? `Mesa #${tableNumber}` : ''}</span>
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(40px, 1fr))', gap: '8px', maxHeight: '150px', overflowY: 'auto', paddingRight: '4px' }}>
                    <button onClick={() => setTableNumber(0)} style={{
                      gridColumn: '1 / -1', padding: '8px', borderRadius: '8px',
                      background: tableNumber === 0 ? 'var(--accent)' : 'var(--surface)',
                      color: tableNumber === 0 ? 'black' : 'white',
                      border: '1px solid var(--glass-border)', cursor: 'pointer', fontWeight: 'bold'
                    }}>Para llevar (0)</button>
                    {Array.from({ length: 20 }, (_, i) => i + 1).map(t => {
                      const isActive = orders.some(o => o.table_number === t);
                      const isSelected = tableNumber === t;
                      return (
                        <button key={t} onClick={() => setTableNumber(t)} style={{
                          aspectRatio: '1', borderRadius: '8px',
                          background: isSelected ? 'var(--accent)' : (isActive ? 'rgba(239, 68, 68, 0.4)' : 'rgba(255,255,255,0.05)'),
                          color: isSelected ? 'black' : (isActive ? '#fca5a5' : 'white'),
                          border: `1px solid ${isSelected ? 'var(--accent)' : (isActive ? '#ef4444' : 'var(--glass-border)')}`,
                          cursor: 'pointer', fontWeight: 'bold', fontSize: '1.1rem',
                          display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }} title={isActive ? 'Mesa Ocupada' : 'Mesa Libre'}>{t}</button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <h3>Menú</h3>
            {loading ? <p>Cargando productos...</p> : (
              <div className="product-grid">
                {products.map(prod => (
                  <div key={prod.id} className="product-card" onClick={() => addToCart(prod)}>
                    <h3>{prod.name}</h3>
                    <p className="price">${parseFloat(prod.price).toFixed(2)}</p>
                    <Plus size={16} style={{ marginTop: '8px', color: 'var(--success)' }} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Columna Derecha: Carrito */}
          <div style={{
            width: '320px', flexShrink: 0,
            background: 'var(--surface)', borderRadius: '16px', padding: '20px',
            position: 'sticky', top: '20px', alignSelf: 'flex-start',
            maxHeight: 'calc(100vh - 200px)', overflowY: 'auto',
            border: '1px solid rgba(255,255,255,0.08)'
          }}>
            <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShoppingCart size={18} /> {editingOrderId ? 'Editando Orden' : 'Nueva Orden'}
              {cart.length > 0 && (
                <span style={{
                  background: 'var(--primary)', color: 'white', borderRadius: '50%',
                  width: '24px', height: '24px', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: '0.8rem', fontWeight: 'bold'
                }}>{cart.length}</span>
              )}
            </h3>

            {cart.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '30px 0', fontSize: '0.9rem' }}>
                Toca un producto para agregarlo
              </p>
            ) : (
              <>
                <div style={{ marginBottom: '16px' }}>
                  {cart.map(item => (
                    <div key={item.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      marginBottom: '10px', paddingBottom: '10px',
                      borderBottom: '1px solid rgba(255,255,255,0.05)'
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: '0.95rem', marginBottom: '4px' }}>{item.name}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>${parseFloat(item.price).toFixed(2)} c/u</span>
                        <input
                          type="text"
                          placeholder="Nota..."
                          value={item.notes || ''}
                          onChange={(e) => updateItemNote(item.id, e.target.value)}
                          style={{
                            width: '100%', background: 'rgba(0,0,0,0.2)',
                            border: '1px solid var(--glass-border)', borderRadius: '6px',
                            padding: '4px 8px', marginTop: '4px', fontSize: '0.75rem',
                            color: 'var(--accent)'
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                        <button onClick={() => removeFromCart(item.id)} style={{
                          background: 'var(--secondary)', padding: '4px 8px', color: 'white',
                          border: 'none', borderRadius: '6px', cursor: 'pointer', lineHeight: 1
                        }}>
                          <Minus size={12} />
                        </button>
                        <span style={{ fontWeight: 'bold', minWidth: '18px', textAlign: 'center', fontSize: '0.95rem' }}>{item.quantity}</span>
                        <button onClick={() => addToCart(item)} style={{
                          background: 'var(--secondary)', padding: '4px 8px', color: 'white',
                          border: 'none', borderRadius: '6px', cursor: 'pointer', lineHeight: 1
                        }}>
                          <Plus size={12} />
                        </button>
                        <span style={{ minWidth: '50px', textAlign: 'right', fontWeight: 'bold', fontSize: '0.95rem' }}>${(parseFloat(item.price) * item.quantity).toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{
                  borderTop: '2px solid rgba(255,255,255,0.1)', paddingTop: '12px', marginBottom: '16px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                  <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>Total:</span>
                  <span style={{ fontWeight: 'bold', fontSize: '1.4rem', color: 'var(--success)' }}>
                    ${calculateCartTotal(cart).toFixed(2)}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button className="btn-primary" onClick={sendOrder} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', flex: 2
                  }}>
                    <Send size={18} /> {editingOrderId ? 'GUARDAR CAMBIOS' : 'ENVIAR A COCINA'}
                  </button>
                  {editingOrderId && (
                    <button className="btn-primary" onClick={() => { setCart([]); setTableNumber(''); setEditingOrderId(null); }} style={{
                      background: 'var(--secondary)', flex: 1, padding: '12px'
                    }}>
                      CANCELAR
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Tab: Cobrar */}
      {activeTab === 'pay' && (
        <div style={{ display: 'flex', gap: '24px' }}>
          <div className="orders-grid" style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
            {orders.filter(o => o.status === 'ready').map(order => (
              <div key={order.id} className="glass-card" onClick={() => setSelectedOrder(order)} style={{
                padding: '20px', borderTop: '4px solid var(--success)', cursor: 'pointer',
                transition: 'all 0.2s ease',
                background: selectedOrder?.id === order.id ? 'rgba(255,255,255,0.05)' : 'var(--surface)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>Mesa {order.table_number}</span>
                  <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>${parseFloat(order.total).toFixed(2)}</span>
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  {order.items.length} productos • {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}
            {orders.filter(o => o.status === 'ready').length === 0 && (
              <div className="glass-card" style={{ textAlign: 'center', gridColumn: '1/-1', padding: '40px', color: 'var(--text-muted)' }}>
                No hay mesas listas para cobrar.
              </div>
            )}
          </div>

          {selectedOrder && (
            <div className="glass-card" style={{ width: '380px', padding: '32px', height: 'fit-content', position: 'sticky', top: '24px' }}>
              <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                <h3 style={{ fontSize: '1.4rem', marginBottom: '4px' }}>Ticket Mesa {selectedOrder.table_number}</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Confirma los detalles del cobro</p>
              </div>

              <div style={{ borderTop: '1px dashed var(--glass-border)', borderBottom: '1px dashed var(--glass-border)', padding: '16px 0', marginBottom: '24px' }}>
                {selectedOrder.items.map((it, idx) => (
                  <div key={idx} style={{ marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem' }}>
                      <span style={{ fontWeight: 'bold' }}>{it.quantity}x {it.product_name}</span>
                      <span>${(parseFloat(it.price) * parseFloat(it.quantity)).toFixed(2)}</span>
                    </div>
                    {it.notes && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--accent)', fontStyle: 'italic', marginTop: '2px' }}>
                        "{it.notes}"
                      </div>
                    )}
                  </div>
                ))}
                <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>Total</span>
                  <span style={{ fontWeight: '800', fontSize: '1.6rem', color: 'var(--success)' }}>${parseFloat(selectedOrder.total).toFixed(2)}</span>
                </div>
              </div>

              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', marginBottom: '12px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>Método de Pago</label>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                  <button
                    onClick={() => setPaymentMethod('cash')}
                    style={{
                      flex: 1, padding: '10px', borderRadius: '8px', fontSize: '0.85rem',
                      background: paymentMethod === 'cash' ? 'var(--primary)' : 'rgba(255,255,255,0.05)',
                      color: paymentMethod === 'cash' ? 'white' : 'var(--text-muted)',
                      border: '1px solid ' + (paymentMethod === 'cash' ? 'var(--primary)' : 'var(--glass-border)')
                    }}
                  >
                    Efectivo
                  </button>
                  <button
                    onClick={() => setPaymentMethod('card')}
                    style={{
                      flex: 1, padding: '10px', borderRadius: '8px', fontSize: '0.85rem',
                      background: paymentMethod === 'card' ? '#3b82f6' : 'rgba(255,255,255,0.05)',
                      color: paymentMethod === 'card' ? 'white' : 'var(--text-muted)',
                      border: '1px solid ' + (paymentMethod === 'card' ? '#3b82f6' : 'var(--glass-border)')
                    }}
                  >
                    Tarjeta
                  </button>
                  <button
                    onClick={() => setPaymentMethod('transfer')}
                    style={{
                      flex: 1, padding: '10px', borderRadius: '8px', fontSize: '0.85rem',
                      background: paymentMethod === 'transfer' ? '#8b5cf6' : 'rgba(255,255,255,0.05)',
                      color: paymentMethod === 'transfer' ? 'white' : 'var(--text-muted)',
                      border: '1px solid ' + (paymentMethod === 'transfer' ? '#8b5cf6' : 'var(--glass-border)')
                    }}
                  >
                    Transf.
                  </button>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '8px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Propina (Opcional)</label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={tipAmount}
                      onChange={e => setTipAmount(e.target.value)}
                      placeholder="0.00"
                      style={{ width: '100%', paddingLeft: '24px' }}
                    />
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px' }}>
                <span style={{ fontWeight: 'bold' }}>Gran Total</span>
                <span style={{ fontWeight: '800', fontSize: '1.4rem', color: 'var(--success)' }}>
                  ${(parseFloat(selectedOrder.total) + (parseFloat(tipAmount) || 0)).toFixed(2)}
                </span>
              </div>

              <button className="btn-primary" onClick={() => markAsPaid(selectedOrder.id)} style={{ background: paymentMethod === 'cash' ? 'var(--success)' : (paymentMethod === 'card' ? '#3b82f6' : '#8b5cf6'), color: paymentMethod === 'cash' ? 'black' : 'white' }}>
                FINALIZAR VENTA ${(parseFloat(selectedOrder.total) + (parseFloat(tipAmount) || 0)).toFixed(2)}
              </button>
              <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                <button
                  onClick={() => printThermalTicket(selectedOrder, branchInfo)}
                  style={{
                    flex: 1, padding: '10px', background: 'var(--accent)',
                    color: 'black', borderRadius: '12px', fontSize: '0.9rem',
                    border: 'none', fontWeight: 'bold'
                  }}
                >
                  🖨️ Imprimir Ticket
                </button>
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                <button
                  onClick={() => editOrder(selectedOrder)}
                  style={{
                    flex: 1, padding: '10px', background: 'rgba(255,255,255,0.05)',
                    color: 'var(--accent)', borderRadius: '12px', fontSize: '0.9rem',
                    border: '1px solid var(--glass-border)'
                  }}
                >
                  Editar Orden
                </button>
                <button
                  onClick={() => cancelOrder(selectedOrder.id)}
                  style={{
                    flex: 1, padding: '10px', background: 'rgba(239, 68, 68, 0.1)',
                    color: '#ef4444', borderRadius: '12px', fontSize: '0.9rem',
                    border: '1px solid rgba(239, 68, 68, 0.3)'
                  }}
                >
                  🗑️ Anular Orden
                </button>
                <button
                  onClick={() => setSelectedOrder(null)}
                  style={{ flex: 1, background: 'transparent', color: 'var(--text-muted)', fontSize: '0.9rem' }}
                >
                  Atrás
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Panel del Administrador Universal (Super Admin)
// Panel del Administrador Universal (Super Admin)
const SuperAdminPanel = ({ user, onLogout }) => {
  const [branches, setBranches] = useState([]);
  const [devices, setDevices] = useState([]);
  const [activeTab, setActiveTab] = useState('branches'); // 'branches' o 'devices'
  const [newBranchName, setNewBranchName] = useState('');
  const [masterPassword, setMasterPassword] = useState('');
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  const [loading, setLoading] = useState(true);

  // Estados para añadir dispositivo
  const [newDeviceToken, setNewDeviceToken] = useState('');
  const [newDeviceBranch, setNewDeviceBranch] = useState('');
  const [newDeviceRole, setNewDeviceRole] = useState('any');
  const [newDeviceNickname, setNewDeviceNickname] = useState('');

  const [securityEnabled, setSecurityEnabled] = useState(true);

  // Estados para gestión de usuarios por sucursal
  const [selectedBranchForUsers, setSelectedBranchForUsers] = useState(null);
  const [branchUsers, setBranchUsers] = useState([]);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'admin' });

  useEffect(() => {
    fetchBranches();
    fetchDevices();
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/super/settings`);
      setSecurityEnabled(res.data.security_enabled === '1');
    } catch (err) {
      console.error('Error fetching settings', err);
    }
  };

  const toggleSecurity = async () => {
    if (securityEnabled) {
      const pin = prompt('Para desactivar la seguridad global, ingresa el PIN de autorización:');
      if (pin !== '1804') {
        alert('PIN incorrecto. No se puede desactivar la seguridad.');
        return;
      }
    }
    const newValue = securityEnabled ? '0' : '1';
    try {
      await axios.put(`${API_URL}/api/super/settings`, { key: 'security_enabled', value: newValue });
      setSecurityEnabled(!securityEnabled);
    } catch (err) {
      alert('Error al cambiar seguridad global');
    }
  };

  const fetchBranches = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/super/branches`);
      setBranches(res.data);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching branches', err);
    }
  };

  const fetchDevices = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/super/devices`);
      setDevices(res.data);
    } catch (err) {
      console.error('Error fetching devices', err);
    }
  };

  const createBranch = async () => {
    if (!newBranchName) return alert('Ingresa nombre de la sucursal');

    try {
      const res = await axios.post(`${API_URL}/api/super/branches`, {
        name: newBranchName,
        master_password: masterPassword
      });
      if (res.data.success) {
        alert('Sucursal creada exitosamente');
        setNewBranchName('');
        setMasterPassword('');
        setShowPasswordInput(false);
        fetchBranches();
      }
    } catch (err) {
      if (err.response?.status === 403) {
        setShowPasswordInput(true);
        alert('Se requiere contraseña maestra para añadir más de 6 sucursales.');
      } else {
        alert('Error al crear sucursal');
      }
    }
  };

  const deleteBranch = async (id) => {
    if (id === 1) return alert('No se puede eliminar la sucursal principal');
    if (!confirm('¿Estás seguro de que deseas eliminar esta sucursal? Esta acción es irreversible.')) return;
    try {
      await axios.delete(`${API_URL}/api/super/branches/${id}`);
      alert('Sucursal eliminada');
      fetchBranches();
    } catch (err) {
      alert('Error al eliminar la sucursal');
    }
  };

  const markLocation = async (branchId) => {
    if (!navigator.geolocation) return alert('GPS no disponible');

    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      const radius = prompt("Radio de acción permitido (metros):", "100");

      try {
        await axios.put(`${API_URL}/api/super/branches/${branchId}/location`, {
          latitude, longitude, radius: parseInt(radius) || 100
        });
        alert('Ubicación guardada con éxito.');
        fetchBranches();
      } catch (err) {
        alert('Error al guardar ubicación');
      }
    }, () => alert('Error al obtener ubicación'), { enableHighAccuracy: true });
  };

  const registerDevice = async () => {
    if (!newDeviceToken || !newDeviceBranch) return alert('Token y Sucursal son obligatorios');
    try {
      await axios.post(`${API_URL}/api/super/devices`, {
        device_token: newDeviceToken,
        branch_id: newDeviceBranch,
        allowed_role: newDeviceRole,
        nickname: newDeviceNickname
      });
      alert('Dispositivo registrado');
      setNewDeviceToken('');
      setNewDeviceNickname('');
      fetchDevices();
    } catch (err) {
      alert('Error registrando dispositivo');
    }
  };

  const deleteDevice = async (id) => {
    if (!confirm('¿Eliminar acceso para este dispositivo?')) return;
    try {
      await axios.delete(`${API_URL}/api/super/devices/${id}`);
      fetchDevices();
    } catch (err) {
      alert('Error al eliminar');
    }
  };

  // --- Funciones de Gestión de Usuarios por Sucursal ---
  const fetchBranchUsers = async (branchId) => {
    try {
      const res = await axios.get(`${API_URL}/api/admin/users?branchId=${branchId}`);
      setBranchUsers(res.data);
    } catch (err) {
      console.error('Error fetching users', err);
    }
  };

  const openUserManagement = (branch) => {
    setSelectedBranchForUsers(branch);
    fetchBranchUsers(branch.id);
  };

  const createUser = async () => {
    if (!newUser.username || !newUser.password) return alert('Llene todos los campos de usuario');
    try {
      await axios.post(`${API_URL}/api/admin/users`, { ...newUser, branch_id: selectedBranchForUsers.id });
      setNewUser({ username: '', password: '', role: 'admin' });
      fetchBranchUsers(selectedBranchForUsers.id);
    } catch (err) {
      alert('Error creando usuario');
    }
  };

  const deleteUser = async (id) => {
    if (!confirm('¿Eliminar este usuario?')) return;
    try {
      await axios.delete(`${API_URL}/api/admin/users/${id}`);
      fetchBranchUsers(selectedBranchForUsers.id);
    } catch (err) {
      alert('Error al eliminar usuario');
    }
  };

  // Obtener el ID del dispositivo actual para copiar y pegar fácilmente
  const currentToken = localStorage.getItem('cerebro_device_id');

  return (
    <div className="admin-workflow" style={{ padding: '40px', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
        <div>
          <h1 style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🌐 Admin Universal</h1>
          <p style={{ color: 'var(--text-muted)' }}>Gestión Global de Sucursales y Seguridad</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div className="glass-card" style={{
            padding: '10px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            border: securityEnabled ? '1px solid var(--success)' : '1px solid var(--accent)',
            background: securityEnabled ? 'rgba(34, 197, 94, 0.05)' : 'rgba(239, 68, 68, 0.05)'
          }}>
            <ShieldCheck size={20} style={{ color: securityEnabled ? 'var(--success)' : 'var(--accent)' }} />
            <div>
              <p style={{ fontSize: '0.75rem', margin: 0, opacity: 0.7 }}>Seguridad Global</p>
              <p style={{ fontSize: '0.9rem', fontWeight: 'bold', margin: 0, color: securityEnabled ? 'var(--success)' : 'var(--accent)' }}>
                {securityEnabled ? 'ACTIVADA' : 'MODO PRUEBA'}
              </p>
            </div>
            <button
              onClick={toggleSecurity}
              className={`btn - ${securityEnabled ? 'primary' : 'secondary'}`}
              style={{
                padding: '6px 12px',
                fontSize: '0.7rem',
                width: 'auto',
                background: securityEnabled ? 'var(--success)' : 'var(--accent)',
                color: securityEnabled ? 'black' : 'white'
              }}
            >
              {securityEnabled ? 'DESACTIVAR' : 'ACTIVAR'}
            </button>
          </div>

          <button onClick={onLogout} className="btn-secondary" style={{ width: 'auto' }}>
            <LogOut size={20} style={{ marginRight: '8px' }} /> Cerrar Sesión
          </button>
        </div>
      </header>

      {/* Navegación por Pestañas */}
      <div style={{ display: 'flex', gap: '20px', marginBottom: '30px', borderBottom: '1px solid var(--glass-border)' }}>
        <button
          onClick={() => setActiveTab('branches')}
          style={{
            padding: '12px 24px', background: 'none', border: 'none',
            color: activeTab === 'branches' ? 'var(--accent)' : 'var(--text-muted)',
            borderBottom: activeTab === 'branches' ? '2px solid var(--accent)' : 'none',
            fontWeight: '600', cursor: 'pointer'
          }}
        >
          SUCURSALES
        </button>
        <button
          onClick={() => setActiveTab('devices')}
          style={{
            padding: '12px 24px', background: 'none', border: 'none',
            color: activeTab === 'devices' ? 'var(--accent)' : 'var(--text-muted)',
            borderBottom: activeTab === 'devices' ? '2px solid var(--accent)' : 'none',
            fontWeight: '600', cursor: 'pointer'
          }}
        >
          DISPOSITIVOS
        </button>
      </div>

      {activeTab === 'branches' ? (
        <>
          <div className="admin-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '24px' }}>
            <div className="glass-card" style={{ padding: '30px' }}>
              <h3 style={{ marginBottom: '20px', color: 'var(--accent)' }}>Añadir Nueva Sucursal</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="form-group">
                  <label>Nombre de la Sucursal</label>
                  <input
                    type="text"
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    placeholder="Ej: Sucursal Norte"
                  />
                </div>
                {showPasswordInput && (
                  <div className="form-group">
                    <label style={{ color: 'var(--primary)' }}>🎫 Contraseña Maestra (Requerida)</label>
                    <input
                      type="password"
                      value={masterPassword}
                      onChange={(e) => setMasterPassword(e.target.value)}
                      placeholder="••••••••"
                    />
                  </div>
                )}
                <button onClick={createBranch} className="btn-primary" style={{ marginTop: '10px' }}>
                  CREAR SUCURSAL
                </button>
              </div>
            </div>

            <div className="glass-card" style={{ padding: '30px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '2px' }}>Total Sucursales</span>
              <span style={{ fontSize: '5rem', fontWeight: '900', color: 'var(--accent)' }}>{branches.length}</span>
              <p style={{ color: 'var(--text-muted)', marginTop: '10px' }}>Límite sugerido: 6 sedes</p>
            </div>
          </div>

          <h2 style={{ margin: '40px 0 20px' }}>Listado de Sedes</h2>
          <div className="admin-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
            {branches.map(branch => (
              <div key={branch.id} className="glass-card" style={{ padding: '20px', borderLeft: '4px solid var(--accent)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {branch.logo && <img src={branch.logo} alt="Logo" style={{ height: '50px', width: '50px', objectFit: 'cover', borderRadius: '8px' }} />}
                  <div>
                    <h3 style={{ fontSize: '1.2rem', margin: '0' }}>{branch.name}</h3>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0' }}>ID: #{branch.id}</p>
                  </div>
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0' }}>{branch.latitude ? '📍 GPS Configurado' : '❌ Sin ubicación'}</p>
                <div style={{ marginTop: 'auto', display: 'flex', gap: '10px' }}>
                  <button onClick={() => markLocation(branch.id)} className="btn-primary" style={{ fontSize: '0.75rem', padding: '8px', background: 'var(--success)', whiteSpace: 'nowrap' }}>📍 Marcar Geofence</button>
                  <button onClick={() => openUserManagement(branch)} className="btn-secondary" style={{ fontSize: '0.75rem', padding: '8px' }}>👤 Usuarios</button>
                  {branch.id !== 1 && (
                    <button onClick={() => deleteBranch(branch.id)} className="btn-secondary" style={{ fontSize: '0.75rem', padding: '8px', background: 'rgba(255, 71, 87, 0.1)', color: '#ff4757', border: '1px solid #ff4757', flexShrink: 0 }}>🗑️ Eliminar</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="admin-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px' }}>
            <div className="glass-card" style={{ padding: '30px' }}>
              <h3 style={{ marginBottom: '20px', color: 'var(--accent)' }}>Autorizar Dispositivo</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '15px' }}>Tu ID temporal: <code style={{ color: 'white' }}>{currentToken}</code></p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="form-group">
                  <label>Token del Dispositivo</label>
                  <input type="text" value={newDeviceToken} onChange={(e) => setNewDeviceToken(e.target.value)} placeholder="Ej: dev_abc123" />
                </div>
                <div className="form-group">
                  <label>Sucursal Destino</label>
                  <select value={newDeviceBranch} onChange={(e) => setNewDeviceBranch(e.target.value)}>
                    <option value="">Selecciona...</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Rol Permitido</label>
                  <select value={newDeviceRole} onChange={(e) => setNewDeviceRole(e.target.value)}>
                    <option value="any">Cualquiera (Multiproposito)</option>
                    <option value="waiter">Solo Meseros</option>
                    <option value="cashier">Solo Cajeros</option>
                    <option value="chef">Solo Cocineros</option>
                    <option value="admin">Solo Administradores</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Nombre/Apodo</label>
                  <input type="text" value={newDeviceNickname} onChange={(e) => setNewDeviceNickname(e.target.value)} placeholder="Ej: Tablet Mesa 5" />
                </div>
                <button onClick={registerDevice} className="btn-primary">REGISTRAR ACCESO</button>
              </div>
            </div>

            <div className="glass-card" style={{ padding: '0', overflow: 'hidden' }}>
              <h3 style={{ padding: '24px', borderBottom: '1px solid var(--glass-border)' }}>Dispositivos Registrados</h3>
              <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
                {devices.map(dev => (
                  <div key={dev.id} style={{ padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h4 style={{ fontSize: '1rem', margin: '0' }}>{dev.nickname || 'Sin nombre'} ({dev.allowed_role})</h4>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>Sede: {dev.branch_name} • Token: {dev.device_token}</p>
                    </div>
                    <button onClick={() => deleteDevice(dev.id)} style={{ padding: '8px', background: 'rgba(255, 71, 87, 0.1)', color: '#ff4757', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Borrar</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {selectedBranchForUsers && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center',
          zIndex: 1000, backdropFilter: 'blur(10px)', padding: '20px'
        }}>
          <div className="glass-card" style={{
            width: '650px', maxWidth: '100%', padding: '40px', maxHeight: '90vh',
            display: 'flex', flexDirection: 'column', gap: '24px', overflowY: 'auto',
            border: '1px solid rgba(255,255,255,0.15)', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--glass-border)', paddingBottom: '16px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.6rem', color: 'var(--accent)' }}>Gestión de Usuarios</h2>
                <p style={{ margin: '4px 0 0', color: 'var(--text-muted)' }}>Sucursal: {selectedBranchForUsers.name}</p>
              </div>
              <button className="btn-secondary" onClick={() => setSelectedBranchForUsers(null)} style={{ border: 'none', background: 'rgba(255,255,255,0.1)', fontSize: '1rem', padding: '8px 12px', borderRadius: '8px' }}>❌ Cerrar</button>
            </div>

            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '24px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <h3 style={{ marginBottom: '16px', fontSize: '1.1rem' }}>✨ Crear Nuevo Usuario</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Nombre de Usuario</label>
                  <input type="text" placeholder="Ej: cajero_norte" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                    style={{ padding: '12px 16px', fontSize: '1rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)' }} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Contraseña</label>
                  <input type="password" placeholder="••••••••" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    style={{ padding: '12px 16px', fontSize: '1rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end' }}>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Rol de Acceso</label>
                  <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                    style={{ padding: '12px 16px', fontSize: '1rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)', cursor: 'pointer' }}>
                    <option value="admin">👨‍💼 Administrador</option>
                    <option value="cashier">💰 Cajero</option>
                    <option value="waiter">📱 Mesero</option>
                    <option value="chef">🍳 Cocinero</option>
                  </select>
                </div>
                <button className="btn-primary" onClick={createUser} style={{ height: '48px', padding: '0 24px', fontSize: '1rem', fontWeight: 'bold' }}>+ Añadir Usuario</button>
              </div>
            </div>

            <div>
              <h3 style={{ marginBottom: '16px', fontSize: '1.1rem', color: 'var(--text-muted)' }}>👥 Usuarios Actuales</h3>
              {branchUsers.length === 0 ? (
                <div style={{ padding: '30px', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px dashed var(--glass-border)' }}>
                  <p style={{ color: 'var(--text-muted)', margin: 0 }}>No hay usuarios registrados en esta sucursal.</p>
                </div>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {branchUsers.map(u => (
                    <li key={u.id} className="glass-card" style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '16px 20px', background: 'var(--surface)', margin: 0,
                      border: '1px solid rgba(255,255,255,0.08)'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{
                          background: 'rgba(255,255,255,0.1)', width: '40px', height: '40px',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%',
                          fontSize: '1.2rem'
                        }}>
                          {u.role === 'admin' ? '👨‍💼' : u.role === 'cashier' ? '💰' : u.role === 'chef' ? '🍳' : '📱'}
                        </div>
                        <div>
                          <strong style={{ fontSize: '1.1rem', display: 'block' }}>{u.username}</strong>
                          <span style={{
                            color: 'var(--accent)', fontSize: '0.8rem',
                            display: 'inline-block', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '1px'
                          }}>
                            {u.role}
                          </span>
                        </div>
                      </div>
                      <button className="btn-secondary" onClick={() => deleteUser(u.id)}
                        style={{ padding: '8px 16px', background: 'rgba(255, 71, 87, 0.1)', color: '#ff4757', border: '1px solid rgba(255, 71, 87, 0.3)', fontSize: '0.9rem', fontWeight: 'bold' }}>
                        Eliminar
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

function App() {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('cerebro_user');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      console.error("Error parsing saved user", e);
      localStorage.removeItem('cerebro_user');
      return null;
    }
  });
  const [branchInfo, setBranchInfo] = useState(null);

  const handleLogout = () => {
    localStorage.removeItem('cerebro_user');
    setUser(null);
    setBranchInfo(null);
    // Reload to ensure all states are clean
    window.location.reload();
  };

  useEffect(() => {
    if (user && user.branch_id) {
      socket.emit('join_branch', user.branch_id);
      fetchBranchInfo();

      // Escuchar cierre de caja forzado
      socket.on('force_logout', () => {
        console.log('Cierre de caja detectado. Cerrando sesión...');
        handleLogout();
      });
    } else {
      setBranchInfo(null);
    }

    return () => {
      socket.off('force_logout');
    };
  }, [user]);

  const fetchBranchInfo = async () => {
    if (!user || !user.branch_id) return;
    try {
      const res = await axios.get(`${API_URL}/api/branches/${user.branch_id}`);
      setBranchInfo(res.data);
    } catch (err) {
      console.error('Error fetching branch info', err);
    }
  };

  if (!user) {
    return <Login onLogin={(u) => {
      localStorage.setItem('cerebro_user', JSON.stringify(u));
      setUser(u);
    }} />;
  }

  if (user.role === 'super_admin') {
    return <SuperAdminPanel user={user} onLogout={handleLogout} />;
  }

  if (user.role === 'waiter') {
    return <WaiterPanel user={user} branchInfo={branchInfo} onLogout={handleLogout} />;
  }

  if (user.role === 'chef') {
    return <KitchenPanel user={user} branchInfo={branchInfo} onLogout={handleLogout} />;
  }

  if (user.role === 'cashier') {
    return <CashierPanel user={user} branchInfo={branchInfo} onLogout={handleLogout} />;
  }

  if (user.role === 'admin') {
    return <AdminPanel user={user} branchInfo={branchInfo} onBranchUpdate={fetchBranchInfo} onLogout={handleLogout} />;
  }

  return (
    <div className="auth-container">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <h1>Panel {user.role}</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>Bienvenido {user.username}. Esta vista está bajo construcción.</p>
        <button onClick={handleLogout} className="btn-primary" style={{ background: 'var(--secondary)' }}>Cerrar Sesión</button>
      </div>
    </div>
  );
}

export default App;
