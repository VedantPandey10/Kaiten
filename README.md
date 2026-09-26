# Kaiten

AI-assisted business workflow automation, starting with invoice recovery.

## Backend Quick Start

The API reads `KAITEN_DATABASE_URL` from the project-root `.env` when present;
the local ignored `.env` selects PostgreSQL database `Kaiten` on port `5433`.
Without that setting the API falls back to SQLite. Never commit `.env`.

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

The app loads database/JWT/bootstrap settings from the ignored project-root
`.env`. Use strong, private values there when setting up another machine.

Open `http://127.0.0.1:8000/docs` for the API. Run the backend tests with
`python -m pytest` from `backend`. Existing SQLite data is not automatically
migrated into PostgreSQL.

On localhost, **First-time setup** asks for your name, company, email, and
password. The API creates the first administrator, seeds representative Finance
and Support mock records, and returns a JWT automatically; there is no setup
token to copy or paste. Passwords are stored as Argon2 hashes. Bootstrap is
blocked in production. The administrator creates accounts and assigns
`OPERATOR`, `APPROVER`, or `VIEWER` roles in People, and can reset member
passwords there. Login supports Remember me; forgotten passwords are currently
reset by an administrator rather than by email.
Operators manage their own workflows and draft steps, maintain customer and
finance records, and create/assign support tickets. Approvers can inspect
workflows and decide pending actions. Viewers are read-only. Admins manage
accounts and have full access. The API enforces these permissions on every
protected endpoint, including workflow ownership.

## Frontend Quick Start

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

The frontend calls the backend at `http://127.0.0.1:8000` by default. Set
`VITE_API_URL` when the API is hosted elsewhere, and configure
`KAITEN_CORS_ORIGINS` on the backend to allow that frontend origin.

## Supabase and Hosted Deployment

Kaiten uses its FastAPI/SQLAlchemy backend for authenticated, role-checked data
access. Supabase can host the PostgreSQL database; the React app should keep
calling the Kaiten API rather than querying tables directly with
`@supabase/supabase-js`.

Copy the PostgreSQL connection URI from the Supabase dashboard's **Connect**
panel (prefer the session pooler when the backend host cannot use IPv6) and
set it as `KAITEN_SUPABASE_DATABASE_URL` in the backend host's environment.
Locally, `KAITEN_DATABASE_URL` remains the development database; production
selects the Supabase URL when `KAITEN_ENV=production`. Use the database
password from Supabase, URL-encoding any reserved characters. On startup the
backend creates its tables and applies its existing additive workflow schema
upgrades. Never put the database password or a service-role key in frontend
variables or commit them to Git.

Deploy the FastAPI backend separately from the Vercel frontend. Configure the
backend with `KAITEN_DATABASE_URL`, a strong `KAITEN_JWT_SECRET`,
`KAITEN_ENV=production`, and `KAITEN_CORS_ORIGINS` set to the deployed Vercel
origin. Configure Vercel's project root as `frontend`, set
`VITE_API_URL` to the deployed backend URL, and use `dist` as the output
directory. Create the first administrator from a trusted local setup while
the backend points to the Supabase database, before setting production mode;
remote/production bootstrap is intentionally blocked.

The MVP navigation includes Command Center, AI Command, Workflows, Tasks,
Approvals, Finance records, Support tickets, Documents/Contracts, simulated
Communications, Analytics, and Audit. Task assignment and deadlines are
enforced through RBAC and are visible in workflow details and the Task Center.

The invoice-recovery workflow gathers open invoices past their due date that
meet the amount threshold in the objective, joins customer payment history,
checks contract notice requirements and prior communications, then calculates
priority using deterministic business rules. Evidence and recommendations are
persisted on workflow steps. With no matching invoice, the workflow waits for
input; add records in Business records and resume it from the workflow view.
Approval unlocks a simulated email record, followed by response monitoring. No
real email is sent.

Support tickets have CRUD, assignment, priority/status tracking, SLA deadlines,
breach filtering, and ticket event history. Objectives such as “escalate
high-priority support tickets older than 24 hours” gather matching tickets,
request approval, then record a simulated escalation. No external notification
is sent.

Both planners currently use deterministic rules. LLM planning, file ingestion,
real email/API integrations, scheduled monitoring, and retry workers are not
wired yet.