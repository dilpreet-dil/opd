import express from 'express';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { departments } from '../src/data/departments.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(here, 'data');
const dbFile = path.join(dataDir, 'hospital-state.json');
const patientCsvFile = path.join(dataDir, 'patient-register.csv');
// Keep the API on its own port so it does not collide with other local demos.
const port = Number(process.env.PORT || 3010);
const isProduction = process.env.NODE_ENV === 'production';
const staffPin = process.env.STAFF_PIN || (isProduction ? '' : '2468');
const alertThreshold = Math.max(1, Number(process.env.QUEUE_ALERT_THRESHOLD || 12));
const loginAttempts = new Map();
const app = express();
const http = createServer(app);
const io = new Server(http, { cors: { origin: true } });
const sessions = new Map();
let state;

const initialState = () => ({ patients: [], flags: [], statuses: {}, history: {}, lastId: 0, called: {}, clientPatients: {}, events: [] });
async function loadState() {
  await mkdir(dataDir, { recursive: true });
  try { state = { ...initialState(), ...JSON.parse(await readFile(dbFile, 'utf8')) }; }
  catch { state = initialState(); await persist(); }
}
function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function patientRegisterCsv() {
  const rows = [['Serial No.', 'Patient Name', 'Slip Number', 'Department', 'Status', 'Registered At']];
  for (const [index, patient] of state.patients.entries()) {
    rows.push([
      index + 1,
      patient.name || '',
      patient.token || '',
      departments.find((d) => d.id === patient.department)?.name || patient.department || '',
      patient.status || '',
      patient.created ? new Date(patient.created).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '',
    ]);
  }
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
async function persist() {
  await mkdir(dataDir, { recursive: true });
  await writeFile(dbFile, JSON.stringify(state, null, 2));
  await writeFile(patientCsvFile, patientRegisterCsv(), 'utf8');
}
const cleanId = (value) => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
const byTime = (a, b) => a.created - b.created || a.id - b.id;
const tokenFor = (patient) => patient ? patient.token : '—';
function publicSnapshot(clientId = '') {
  const id = state.clientPatients?.[clientId];
  const own = state.patients.find((p) => p.id === id);
  const currentToken = Object.fromEntries(departments.map((d) => [d.id, tokenFor(state.patients.find((p) => p.id === state.called[d.id]))]));
  const queues = Object.fromEntries(departments.map((d) => {
    const waiting = state.patients.filter((p) => p.department === d.id && p.status === 'waiting').sort(byTime);
    const history = state.history[d.id] || [];
    const average = history.length ? history.slice(-10).reduce((sum, n) => sum + n, 0) / Math.min(10, history.length) : d.average;
    const ahead = own?.department === d.id ? Math.max(0, waiting.findIndex((p) => p.id === own.id)) : 0;
    const delay = Number(state.statuses[d.id]?.delay || 0);
    return [d.id, {
      waiting: waiting.length,
      nextTokens: waiting.slice(0, 6).map((patient) => patient.token),
      currentToken: currentToken[d.id],
      average,
      delay,
      ahead,
      waitMins: Math.ceil((ahead * average + delay) / 5) * 5,
      queueWaitMins: Math.ceil((waiting.length * average + delay) / 5) * 5,
    }];
  }));
  const patient = own ? { ...own, ahead: queues[own.department].ahead, waitMins: queues[own.department].waitMins } : null;
  return { patients: patient ? [patient] : [], flags: [], statuses: state.statuses, history: {}, called: {}, currentToken, queues, lastId: state.lastId, updatedAt: Date.now(), online: true };
}
function staffOnly(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) return res.status(401).json({ error: 'Staff PIN required.' });
  req.staffToken = token;
  next();
}
function analyticsSnapshot() {
  const now = Date.now();
  const active = state.patients.filter((p) => ['waiting', 'called'].includes(p.status));
  const completed = state.patients.filter((p) => p.status === 'done');
  const departmentsSummary = departments.map((d) => {
    const waiting = active.filter((p) => p.department === d.id && p.status === 'waiting').length;
    const called = active.filter((p) => p.department === d.id && p.status === 'called').length;
    const durations = (state.history[d.id] || []).slice(-50).filter((n) => Number.isFinite(Number(n)) && Number(n) > 0);
    const averageWait = durations.length ? Math.round(durations.reduce((a, b) => a + Number(b), 0) / durations.length) : d.average;
    return { id: d.id, name: d.name, waiting, called, completed: state.patients.filter((p) => p.department === d.id && p.status === 'done').length, averageWait, delay: Number(state.statuses[d.id]?.delay || 0), congested: waiting >= alertThreshold };
  });
  const oldestWaiting = active.filter((p) => p.status === 'waiting').reduce((max, p) => Math.max(max, now - Number(p.created || now)), 0);
  return { generatedAt: new Date(now).toISOString(), totals: { registered: state.patients.length, waiting: active.filter((p) => p.status === 'waiting').length, called: active.filter((p) => p.status === 'called').length, completed: completed.length, openAlerts: state.flags.filter((f) => !f.seen).length, longestWaitMinutes: Math.floor(oldestWaiting / 60000) }, departments: departmentsSummary };
}
function recordEvent(type, details = {}) {
  state.events = Array.isArray(state.events) ? state.events : [];
  state.events.unshift({ id: randomBytes(8).toString('hex'), type, at: Date.now(), ...details });
  state.events = state.events.slice(0, 1000);
}
function updateCongestionAlerts() {
  state.flags = Array.isArray(state.flags) ? state.flags : [];
  for (const d of departments) {
    const waiting = state.patients.filter((p) => p.department === d.id && p.status === 'waiting').length;
    const alreadyOpen = state.flags.some((f) => !f.seen && f.kind === 'congestion' && f.department === d.id);
    if (waiting >= alertThreshold && !alreadyOpen) {
      state.flags.unshift({ id: Date.now() + Math.floor(Math.random() * 1000), time: new Date().toLocaleTimeString(), createdAt: Date.now(), seen: false, kind: 'congestion', department: d.id, reason: `High queue load in ${d.name}: ${waiting} patients waiting.` });
      recordEvent('congestion_alert', { department: d.id, waiting });
    }
  }
  state.flags = state.flags.slice(0, 300);
}
function publish() {
  updateCongestionAlerts();
  io.emit('queue:changed', { updatedAt: Date.now() });
  io.to('staff').emit('staff:state', state);
  io.to('staff').emit('staff:analytics', analyticsSnapshot());
  persist().catch((error) => console.error('Could not persist hospital state:', error.message));
}
app.use(express.json({ limit: '64kb' }));
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); next(); });
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'opd-saathi-api', updatedAt: Date.now(), persistence: 'json-file' }));
app.get('/api/public/analytics-summary', (_req, res) => { const a = analyticsSnapshot(); res.json({ generatedAt: a.generatedAt, totals: a.totals, departments: a.departments.map(({ id, name, waiting, called, completed, averageWait, delay, congested }) => ({ id, name, waiting, called, completed, averageWait, delay, congested })) }); });
app.get('/api/public/state', (req, res) => res.json(publicSnapshot(cleanId(req.get('x-client-id')))));
app.get('/api/public/patient', async (req, res) => {
  const token = String(req.query.token || '').trim().toUpperCase();
  const clientId = cleanId(req.get('x-client-id'));
  const patient = state.patients.find((item) => item.token.toUpperCase() === token);
  if (!patient || !clientId) return res.status(404).json({ error: 'Token not found.' });
  state.clientPatients = { ...(state.clientPatients || {}), [clientId]: patient.id };
  await persist();
  res.json({ patient, snapshot: publicSnapshot(clientId) });
});
app.get('/api/public/patient/qr/:qrToken', async (req, res) => {
  const clientId = cleanId(req.get('x-client-id'));
  const patient = state.patients.find((item) => item.qrToken && item.qrToken === req.params.qrToken);
  if (!patient || !clientId) return res.status(404).json({ error: 'Slip QR not found.' });
  state.clientPatients = { ...(state.clientPatients || {}), [clientId]: patient.id };
  await persist();
  res.json({ patient, snapshot: publicSnapshot(clientId) });
});
app.get('/api/public/board', (_req, res) => res.json({ departments: departments.map((d) => {
  const current = state.patients.find((p) => p.id === state.called[d.id]);
  const waiting = state.patients.filter((p) => p.department === d.id && p.status === 'waiting').sort(byTime);
  return { id: d.id, currentToken: current?.token || '—', waiting: waiting.length, nextTokens: waiting.slice(0, 6).map((patient) => patient.token), status: state.statuses[d.id] || { state: 'available' } };
}), updatedAt: Date.now() }));
app.post('/api/staff/login', (req, res) => {
  if (!staffPin) return res.status(503).json({ error: 'Staff authentication is not configured. Set STAFF_PIN on the server.' });
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const attempt = loginAttempts.get(key) || { count: 0, until: 0 };
  if (attempt.until > Date.now()) return res.status(429).json({ error: 'Too many login attempts. Try again in a minute.' });
  if (String(req.body?.pin || '') !== staffPin) {
    attempt.count += 1;
    if (attempt.count >= 5) { attempt.count = 0; attempt.until = Date.now() + 60_000; }
    loginAttempts.set(key, attempt);
    return res.status(401).json({ error: 'Incorrect staff PIN.' });
  }
  loginAttempts.delete(key);
  const token = randomBytes(24).toString('base64url');
  sessions.set(token, { expires: Date.now() + 12 * 60 * 60 * 1000 });
  res.json({ token, state });
});
app.post('/api/staff/logout', staffOnly, (req, res) => { sessions.delete(req.staffToken); res.json({ ok: true }); });
app.get('/api/staff/state', staffOnly, (_req, res) => res.json(state));
app.get('/api/staff/analytics', staffOnly, (_req, res) => res.json(analyticsSnapshot()));
app.get('/api/staff/patient-register', staffOnly, (_req, res) => {
  res.json({ patients: state.patients.map((p, index) => ({ serialNumber: index + 1, name: p.name || '', slipNumber: p.token || '', department: departments.find((d) => d.id === p.department)?.name || p.department || '', status: p.status || '', registeredAt: p.created || null })) });
});
app.get('/api/staff/patient-register.csv', staffOnly, (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="opd-saathi-patient-register.csv"');
  res.send(patientRegisterCsv());
});
app.get('/api/staff/events', staffOnly, (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  res.json({ events: (state.events || []).slice(0, limit) });
});
app.post('/api/staff/alerts/:id/acknowledge', staffOnly, async (req, res) => {
  const flag = state.flags.find((f) => String(f.id) === String(req.params.id));
  if (!flag) return res.status(404).json({ error: 'Alert not found.' });
  flag.seen = true; flag.acknowledgedAt = Date.now();
  recordEvent('alert_acknowledged', { alertId: flag.id });
  await persist(); publish(); res.json({ ok: true, flag });
});
app.post('/api/staff/queue/:department/call-next', staffOnly, async (req, res) => {
  const d = departments.find((item) => item.id === req.params.department);
  if (!d) return res.status(404).json({ error: 'Department not found.' });
  const current = state.patients.find((p) => p.id === state.called[d.id] && p.status === 'called');
  if (current) return res.status(409).json({ error: 'Complete the currently called patient first.', currentToken: current.token });
  const next = state.patients.filter((p) => p.department === d.id && p.status === 'waiting').sort(byTime)[0];
  if (!next) return res.status(404).json({ error: 'No patients are waiting in this department.' });
  next.status = 'called'; next.calledAt = Date.now(); state.called[d.id] = next.id;
  recordEvent('patient_called', { department: d.id, patientId: next.id, token: next.token });
  await persist(); publish(); res.json({ ok: true, patient: next, analytics: analyticsSnapshot() });
});
app.post('/api/staff/patients/:id/complete', staffOnly, async (req, res) => {
  const patient = state.patients.find((p) => String(p.id) === String(req.params.id));
  if (!patient) return res.status(404).json({ error: 'Patient not found.' });
  if (!['called', 'waiting'].includes(patient.status)) return res.status(409).json({ error: 'Patient is not active in the queue.' });
  const started = Number(patient.calledAt || patient.created || Date.now());
  const duration = Math.max(1, Math.min(240, Math.round((Date.now() - started) / 60000)));
  patient.status = 'done'; patient.completedAt = Date.now();
  if (state.called[patient.department] === patient.id) delete state.called[patient.department];
  state.history[patient.department] = [...(state.history[patient.department] || []), duration].slice(-100);
  recordEvent('patient_completed', { department: patient.department, patientId: patient.id, token: patient.token, durationMinutes: duration });
  await persist(); publish(); res.json({ ok: true, patient, analytics: analyticsSnapshot() });
});
app.get('/api/staff/analytics.csv', staffOnly, (_req, res) => {
  const a = analyticsSnapshot();
  const rows = [['Department','Waiting','Called','Completed','Average consultation minutes','Delay minutes','Congested'], ...a.departments.map((d) => [d.name,d.waiting,d.called,d.completed,d.averageWait,d.delay,d.congested ? 'yes' : 'no'])];
  const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="opd-saathi-analytics.csv"'); res.send(csv);
});
app.post('/api/staff/state', staffOnly, async (req, res) => {
  const incoming = req.body?.state;
  if (!incoming || !Array.isArray(incoming.patients) || !Array.isArray(incoming.flags) || typeof incoming.statuses !== 'object') return res.status(400).json({ error: 'Invalid hospital state.' });
  state = { ...initialState(), ...incoming, events: Array.isArray(incoming.events) ? incoming.events : (state.events || []) };
  await persist(); publish();
  res.json({ ok: true, state });
});
app.post('/api/patients', async (req, res) => {
  const clientId = cleanId(req.get('x-client-id'));
  const { name, age, gender, mobile, department } = req.body || {};
  const d = departments.find((item) => item.id === department);
  if (!clientId || !d || !String(name || '').trim()) return res.status(400).json({ error: 'Name and a valid department are required.' });
  if (age && (!Number.isFinite(Number(age)) || Number(age) < 0 || Number(age) > 120)) return res.status(400).json({ error: 'Age must be between 0 and 120.' });
  if (mobile && !/^[+0-9 ()-]{7,24}$/.test(String(mobile))) return res.status(400).json({ error: 'Please enter a valid mobile number or leave it blank.' });
  const existingId = state.clientPatients?.[clientId];
  const existing = state.patients.find((p) => p.id === existingId && ['waiting', 'called'].includes(p.status));
  if (existing) return res.json({ patient: existing, snapshot: publicSnapshot(clientId) });
  const id = ++state.lastId;
  const patient = { id, qrToken: randomBytes(18).toString('base64url'), token: `${d.prefix}-${String(40 + id).padStart(3, '0')}`, name: String(name).trim().slice(0, 80), age: String(age || '').slice(0, 3), gender: String(gender || '').slice(0, 40), mobile: String(mobile || '').slice(0, 24), department: d.id, status: 'waiting', created: Date.now() };
  state.patients.push(patient);
  recordEvent('patient_registered', { department: d.id, patientId: id, token: patient.token });
  state.clientPatients = { ...(state.clientPatients || {}), [clientId]: id };
  await persist(); publish();
  res.status(201).json({ patient, snapshot: publicSnapshot(clientId) });
});
app.post('/api/urgent', async (req, res) => {
  const reason = String(req.body?.reason || 'Emergency assistance requested').slice(0, 120);
  const flag = { id: Date.now(), time: new Date().toLocaleTimeString(), createdAt: Date.now(), seen: false, kind: 'urgent', reason };
  state.flags = [flag, ...(state.flags || [])].slice(0, 300);
  recordEvent('urgent_assistance_requested', { alertId: flag.id, reason });
  await persist(); publish();
  res.status(201).json({ ok: true });
});
app.use(express.static(path.resolve(here, '../dist')));
app.use((err, _req, res, _next) => { console.error('API error:', err.message); res.status(400).json({ error: 'Invalid request.' }); });
app.get('*path', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.resolve(here, '../dist/index.html'));
});
io.on('connection', (socket) => {
  const auth = (token) => {
    const session = sessions.get(token);
    if (session && session.expires > Date.now()) { socket.join('staff'); socket.emit('staff:state', state); }
  };
  auth(socket.handshake.auth?.staffToken);
  socket.on('staff:auth', auth);
});
await loadState();
http.listen(port, '0.0.0.0', () => console.log(`OPD Saathi API and Socket.IO listening on http://0.0.0.0:${port}`));
