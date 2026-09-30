require('dotenv').config();
const path = require('path');
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'vehicle_service',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true, // keep DATE columns as 'YYYY-MM-DD'
});
const SECRET = process.env.JWT_SECRET || 'change-me';

// ---------- helpers ----------
class HttpErr extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const wrap = fn => (req, res) => fn(req, res).catch(e => {
  if (e instanceof HttpErr) return res.status(e.status).json({ error: e.message });
  if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That value already exists' });
  console.error(e);
  res.status(500).json({ error: 'Server error' });
});
// auth(role): verifies the JWT and, if a role is given, enforces it.
const auth = role => (req, res, next) => {
  try {
    const p = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), SECRET);
    if (role && p.role !== role) return res.status(403).json({ error: 'You do not have access to this' });
    req.user = p; next();
  } catch { res.status(401).json({ error: 'Please log in' }); }
};
// tx(fn): runs fn inside a MySQL transaction (ACID) and rolls back on any error.
async function tx(fn) {
  const c = await db.getConnection();
  try { await c.beginTransaction(); const r = await fn(c); await c.commit(); return r; }
  catch (e) { await c.rollback(); throw e; }
  finally { c.release(); }
}
const notify = (bookingId, msg) => db.query(
  `INSERT INTO notification (user_id, message)
   SELECT v.customer_id, ? FROM booking b JOIN vehicle v ON v.vehicle_id = b.vehicle_id
   WHERE b.booking_id = ?`, [msg + ` (booking #${bookingId})`, bookingId]);

const BOOKINGS = `
  SELECT b.booking_id, b.booking_date, b.status, v.registration_no, v.model, u.name AS customer,
         s.service_name, s.base_price, t.name AS technician, i.subtotal, i.gst, i.total, i.paid,
         (SELECT GROUP_CONCAT(CONCAT(bp.qty, ' x ', p.part_name) SEPARATOR ', ')
            FROM booking_part bp JOIN part p ON p.part_id = bp.part_id
           WHERE bp.booking_id = b.booking_id) AS parts_used
    FROM booking b
    JOIN vehicle v ON v.vehicle_id = b.vehicle_id
    JOIN users u ON u.user_id = v.customer_id
    JOIN service s ON s.service_id = b.service_id
    LEFT JOIN technician t ON t.technician_id = b.technician_id
    LEFT JOIN invoice i ON i.booking_id = b.booking_id`;

// ---------- auth ----------
app.post('/api/auth/register', wrap(async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !/^\S+@\S+\.\S+$/.test(email || '')) throw new HttpErr(400, 'Enter your name and a valid email');
  if (!password || password.length < 6) throw new HttpErr(400, 'Password must be at least 6 characters');
  const hash = await bcrypt.hash(password, 10);
  await db.query('INSERT INTO users (name, email, phone, password_hash) VALUES (?,?,?,?)', [name, email, phone || null, hash]);
  res.status(201).json({ ok: true });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const [[u]] = await db.query('SELECT * FROM users WHERE email = ?', [req.body.email || '']);
  if (!u || !(await bcrypt.compare(req.body.password || '', u.password_hash))) throw new HttpErr(401, 'Wrong email or password');
  const token = jwt.sign({ id: u.user_id, role: u.role, name: u.name }, SECRET, { expiresIn: '8h' });
  res.json({ token, name: u.name, role: u.role });
}));

// ---------- shared ----------
app.get('/api/services', auth(), wrap(async (req, res) => res.json((await db.query('SELECT * FROM service'))[0])));
app.get('/api/notifications', auth(), wrap(async (req, res) => res.json((await db.query(
  'SELECT message, created_at FROM notification WHERE user_id = ? ORDER BY notification_id DESC LIMIT 15', [req.user.id]))[0])));

// ---------- customer ----------
app.get('/api/vehicles', auth('customer'), wrap(async (req, res) =>
  res.json((await db.query('SELECT vehicle_id, registration_no, model FROM vehicle WHERE customer_id = ?', [req.user.id]))[0])));

app.post('/api/vehicles', auth('customer'), wrap(async (req, res) => {
  const reg = (req.body.registration_no || '').trim().toUpperCase(), model = (req.body.model || '').trim();
  if (!/^[A-Z]{2}\d{2}[A-Z]{1,3}\d{4}$/.test(reg)) throw new HttpErr(400, 'Registration number should look like TS09AB1234');
  if (!model) throw new HttpErr(400, 'Enter the vehicle model');
  await db.query('INSERT INTO vehicle (customer_id, registration_no, model) VALUES (?,?,?)', [req.user.id, reg, model]);
  res.status(201).json({ ok: true });
}));

app.post('/api/bookings', auth('customer'), wrap(async (req, res) => {
  const { vehicle_id, service_id, booking_date } = req.body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(booking_date || '') || booking_date < new Date().toISOString().slice(0, 10))
    throw new HttpErr(400, 'Choose today or a future date');
  const [[v]] = await db.query('SELECT 1 AS ok FROM vehicle WHERE vehicle_id = ? AND customer_id = ?', [vehicle_id, req.user.id]);
  if (!v) throw new HttpErr(404, 'Vehicle not found');
  const [r] = await db.query('INSERT INTO booking (vehicle_id, service_id, booking_date) VALUES (?,?,?)', [vehicle_id, service_id, booking_date]);
  await notify(r.insertId, 'Booking received for ' + booking_date);
  res.status(201).json({ booking_id: r.insertId });
}));

app.get('/api/bookings/mine', auth('customer'), wrap(async (req, res) =>
  res.json((await db.query(BOOKINGS + ' WHERE v.customer_id = ? ORDER BY b.booking_id DESC', [req.user.id]))[0])));

// Payment is simulated. To use Razorpay: create an order here, verify the payment signature, then set paid = TRUE.
app.post('/api/bookings/:id/pay', auth('customer'), wrap(async (req, res) => {
  const [r] = await db.query(
    `UPDATE invoice i JOIN booking b ON b.booking_id = i.booking_id JOIN vehicle v ON v.vehicle_id = b.vehicle_id
        SET i.paid = TRUE, i.paid_at = NOW()
      WHERE b.booking_id = ? AND v.customer_id = ? AND i.paid = FALSE`, [req.params.id, req.user.id]);
  if (!r.affectedRows) throw new HttpErr(409, 'No unpaid invoice for this booking');
  await notify(req.params.id, 'Payment received (test mode)');
  res.json({ ok: true });
}));

// ---------- service center ----------
app.get('/api/center/bookings', auth('center'), wrap(async (req, res) =>
  res.json((await db.query(BOOKINGS + ' ORDER BY b.booking_id DESC'))[0])));
app.get('/api/center/technicians', auth('center'), wrap(async (req, res) => res.json((await db.query('SELECT * FROM technician'))[0])));
app.get('/api/center/parts', auth('center'), wrap(async (req, res) => res.json((await db.query('SELECT * FROM part ORDER BY part_id'))[0])));
app.post('/api/center/parts/:id/restock', auth('center'), wrap(async (req, res) => {
  await db.query('UPDATE part SET stock = stock + 10 WHERE part_id = ?', [req.params.id]);
  res.json({ ok: true });
}));

app.post('/api/center/bookings/:id/jobcard', auth('center'), wrap(async (req, res) => {
  const [r] = await db.query(
    "UPDATE booking SET status = 'Job card created', technician_id = ? WHERE booking_id = ? AND status = 'Booked'",
    [req.body.technician_id, req.params.id]);
  if (!r.affectedRows) throw new HttpErr(409, 'Booking is not waiting for a job card');
  await notify(req.params.id, 'Job card created and technician assigned');
  res.json({ ok: true });
}));

app.post('/api/center/bookings/:id/start', auth('center'), wrap(async (req, res) => {
  const [r] = await db.query("UPDATE booking SET status = 'In service' WHERE booking_id = ? AND status = 'Job card created'", [req.params.id]);
  if (!r.affectedRows) throw new HttpErr(409, 'Booking has no job card yet');
  await notify(req.params.id, 'Service started on your vehicle');
  res.json({ ok: true });
}));

// Row lock (FOR UPDATE) inside a transaction: two jobs can never take the same last part.
app.post('/api/center/bookings/:id/parts', auth('center'), wrap(async (req, res) => {
  const qty = parseInt(req.body.qty, 10);
  if (!(qty > 0)) throw new HttpErr(400, 'Quantity must be at least 1');
  await tx(async c => {
    const [[b]] = await c.query('SELECT status FROM booking WHERE booking_id = ? FOR UPDATE', [req.params.id]);
    if (!b || b.status !== 'In service') throw new HttpErr(409, 'Parts can only be added while the vehicle is in service');
    const [[p]] = await c.query('SELECT price, stock, part_name FROM part WHERE part_id = ? FOR UPDATE', [req.body.part_id]);
    if (!p) throw new HttpErr(404, 'Part not found');
    if (p.stock < qty) throw new HttpErr(409, `Only ${p.stock} of ${p.part_name} in stock`);
    await c.query('UPDATE part SET stock = stock - ? WHERE part_id = ?', [qty, req.body.part_id]);
    await c.query(
      `INSERT INTO booking_part (booking_id, part_id, qty, unit_price) VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty)`, [req.params.id, req.body.part_id, qty, p.price]);
  });
  res.json({ ok: true });
}));

app.post('/api/center/bookings/:id/ready', auth('center'), wrap(async (req, res) => {
  const total = await tx(async c => {
    const [[b]] = await c.query(
      `SELECT b.status, s.base_price FROM booking b JOIN service s ON s.service_id = b.service_id
        WHERE b.booking_id = ? FOR UPDATE`, [req.params.id]);
    if (!b || b.status !== 'In service') throw new HttpErr(409, 'Booking is not in service');
    const [[p]] = await c.query('SELECT COALESCE(SUM(qty * unit_price), 0) AS parts FROM booking_part WHERE booking_id = ?', [req.params.id]);
    const sub = Number(b.base_price) + Number(p.parts), gst = Math.round(sub * 18) / 100;
    await c.query('INSERT INTO invoice (booking_id, subtotal, gst, total) VALUES (?,?,?,?)', [req.params.id, sub, gst, sub + gst]);
    await c.query("UPDATE booking SET status = 'Ready' WHERE booking_id = ?", [req.params.id]);
    return sub + gst;
  });
  await notify(req.params.id, `Vehicle is ready. Invoice total Rs ${total.toFixed(2)}`);
  res.json({ ok: true });
}));

// ---------- start ----------
async function ensureCenterUser() {
  const [[u]] = await db.query("SELECT 1 AS ok FROM users WHERE email = 'service@center.com'");
  if (!u) {
    await db.query("INSERT INTO users (name, email, password_hash, role) VALUES ('Service Center', 'service@center.com', ?, 'center')",
      [await bcrypt.hash('center123', 10)]);
    console.log('Created service-center login: service@center.com / center123');
  }
}
const PORT = process.env.PORT || 3000;
ensureCenterUser()
  .then(() => app.listen(PORT, () => console.log(`Running at http://localhost:${PORT}`)))
  .catch(e => { console.error('Could not connect to MySQL. Check .env and that schema.sql was run.\n', e.message); process.exit(1); });
