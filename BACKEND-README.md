# OPD Saathi backend

The backend is an Express + Socket.IO service in `server/index.js`. It stores prototype state as JSON and serves the built Vite frontend from `dist/` in production.

## Run locally

```bash
npm install
cp .env.example .env
# Set STAFF_PIN and DATA_DIR in .env (Node does not load .env automatically).
npm run dev
```

For environment variables in Windows PowerShell, for example:

```powershell
$env:STAFF_PIN="change-this-pin"
$env:DATA_DIR="./server/data"
npm run dev
```

Open the Vite URL shown in the terminal. The API defaults to port 3010 and Vite proxies `/api` and `/socket.io` to it. For a production-like local run, run `npm run build`, then set `PORT=3010` and run `npm start`.

## API endpoints

### Public
- `GET /api/health` — service health.
- `GET /api/public/state` — public queue snapshot scoped to `x-client-id`.
- `GET /api/public/board` — anonymized waiting-room board.
- `GET /api/public/analytics-summary` — anonymized counts and department-level congestion indicators.
- `GET /api/public/patient?token=...` — attach a browser client to a token.
- `GET /api/public/patient/qr/:qrToken` — retrieve a patient slip using its secret QR token.
- `POST /api/patients` — register a patient; requires `x-client-id` and `{name, age, gender, mobile, department}`.
- `POST /api/urgent` — create an urgent assistance alert for staff.

### Staff (send `Authorization: Bearer <token>`)
- `POST /api/staff/login` with `{ "pin": "..." }` — creates a 12-hour staff session.
- `POST /api/staff/logout` — revokes the session.
- `GET /api/staff/state` and `POST /api/staff/state` — read/write the staff dashboard state.
- `GET /api/staff/analytics` — department and hospital metrics.
- `GET /api/staff/events?limit=50` — recent audit events.
- `GET /api/staff/analytics.csv` — download department metrics as CSV.
- `POST /api/staff/alerts/:id/acknowledge` — acknowledge an alert.
- `POST /api/staff/queue/:department/call-next` — call the next waiting patient.
- `POST /api/staff/patients/:id/complete` — complete a visit and record an estimated duration.

## Automation

- Queue updates broadcast over Socket.IO and trigger client refreshes.
- Queue congestion generates a staff alert at `QUEUE_ALERT_THRESHOLD` waiting patients (default 12), avoiding duplicate open congestion alerts for the same department.
- Staff events are retained in the JSON state for basic auditability.
- Department waiting-time estimates use recent recorded durations, falling back to configured department averages.

## Deployment notes

For Render, use `npm install` as the build setup step together with `npm run build`, and `npm start` as the start command. Configure `STAFF_PIN` as a secret environment variable. Configure `DATA_DIR=/var/data` and attach a persistent disk mounted at `/var/data` if using Render's disk-supported service type; without a persistent disk, JSON state may be lost on redeploy/restart. Keep the service and disk in the same region.

## Important production limitations

This is a functional prototype backend, not yet a hospital-grade production system. JSON-file persistence is suitable for demos/small pilots but not concurrent multi-instance deployment. Use PostgreSQL or another transactional database before real hospital use. Add HTTPS, stronger identity-based staff accounts and roles, backups, audit retention policies, consent/privacy review, monitoring, and a configured SMS/WhatsApp provider before sending real notifications. Emergency alerts currently reach the staff dashboard in real time; they do not contact emergency services automatically. Emergency care must never be delayed by queue software.
