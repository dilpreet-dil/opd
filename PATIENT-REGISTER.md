# OPD Saathi — Patient Register

OPD Saathi now automatically keeps a patient register containing each patient's **serial number, name, slip number, department, status, and registration time**.

## Where the file is saved

The backend generates `patient-register.csv` inside the configured data directory (`DATA_DIR`). By default, that is `server/data/patient-register.csv`. On Render, use the persistent disk data directory configured in `render.yaml` (normally `/var/data`), so the register survives restarts and redeploys.

The CSV is refreshed whenever the hospital state is saved. Open it with Microsoft Excel, Google Sheets, or any spreadsheet app.

## View or download the register

1. Sign in to the staff area to obtain a staff session token.
2. Send an authenticated `GET /api/staff/patient-register` request to view the patient list as JSON.
3. Send an authenticated `GET /api/staff/patient-register.csv` request to download the CSV.

For either API request, include the header `Authorization: Bearer YOUR_STAFF_SESSION_TOKEN`.

**Privacy:** The register is staff-protected. It deliberately stores only the name and queue details in this CSV, not patient mobile numbers or other extra personal information. Keep the server's data directory private and persistent.
