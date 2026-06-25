# GDC CRM — Backend (MERN core API)

TypeScript Express + MongoDB (Mongoose) REST API implementing the **core** of
`GDC-CRM-Blueprint.md`: the modules the converted React app actually uses.

Built per the blueprint conventions: layered routes → controllers → services,
the standard response envelope, JWT auth, RBAC + branch scoping, audit logging,
and a Socket.IO server for live events.

## Run

```bash
cp .env.example .env      # optional — sensible dev defaults work as-is
npm install
npm run dev               # starts API on http://localhost:4000
```

With no `MONGODB_URI`, an **in-memory MongoDB** is started automatically and the
database is **auto-seeded** with the prototype's data on first boot (downloads a
mongod binary once). For a real DB, set `MONGODB_URI` (local `mongod` or Atlas)
and run `npm run seed`.

**Seeded super admin:** `aarav@gdc.com` / `Admin@12345`
**Seeded employees:** `firstname.lastname@gdc.com` / `Welcome@123` (e.g. `priya.sharma@gdc.com`)

```bash
npm run typecheck   # tsc --noEmit
npm run build       # compile to dist/
npm start           # run compiled build
npm run seed        # (re)seed the database
```

## What's implemented (blueprint modules)

| Module | Endpoints |
|---|---|
| 1 Auth/Security | `/auth/login` `/refresh` `/logout` `/me` `/sessions` — JWT access + httpOnly refresh, rotation, lockout, audit log |
| 2 Dashboard | `/dashboard/summary` (single aggregated call), `/dashboard/inventory` |
| 3 Projects | `/projects` CRUD, `/projects/:id/status` (guarded state machine), `/projects/analytics/*` |
| 4 Catalog | `/categories` `/subcategories` `/website-types` `/servers` (+ `/servers/:id/sites`) |
| 5 QA & Checklists | `/checklist-templates`, `/projects/:id/qa`, `/qa`, `/qa/:id/stage1/items`, `/qa/:id/stage2/assign` (gated), `/qa/:id/stage2/items` |
| 6 Tasks | `/tasks`, `/tasks/:id`, `/tasks/:id/move` (timer start/stop) |
| 7 Attendance | `/attendance/punch`, `/attendance/me`, `/attendance`, `/attendance/:id/regularize` (productivity formula) |
| 8 Branches | `/branches`, `/branches/:id/holidays` |
| 9 Employees | `/employees` CRUD, `/permissions`, `/status`, `/reset-password`, `/reset-2fa` |
| 10 Leave | `/leaves`, `/leaves/me`, `/leaves/:id/decision` |
| 13 Notifications | `/notifications`, `/:id/read`, `/read-all` (+ WS `notification:new`) |
| 15 Notice Board | `/announcements` CRUD, `/read`, `/ack`, `/receipts` (audience scoping) |

**WebSocket events:** `task:moved`, `notification:new`, `announcement:new`.

### Core business rules enforced server-side
- **Project status state machine** — illegal transitions rejected; `completed` requires `qaProgress = 100`; entering `qa` auto-creates the QA process.
- **QA two-stage gate** — Checklist 2 cannot be assigned until Checklist 1 = 100%, and the reviewer must differ from the developer.
- **Task timers** — start on → In Progress, stop & bank `actualSeconds` on → Done; `overdue` cannot be set manually.
- **Attendance productivity** — `productive = totalLogged − idle − lunch − tea`; extra lunch/tea beyond branch allowance reclassified as idle.
- **RBAC + branch scope** — every protected route checks role/permission; employees are scoped to their own data.

## Not in this build (full-blueprint scope)
Desktop monitoring agent + screenshots/S3, BullMQ background jobs, Redis cache/adapter,
2FA TOTP, reports/exports, performance roll-ups. Hooks/conventions are in place to add these next.

## Connecting the React app
Point the frontend at `http://localhost:4000/api/v1` and send the access token as
`Authorization: Bearer <token>`. The response envelope is
`{ success, data, meta, error }` everywhere. See `../gdc-crm-react`.

> Note: passwords use bcryptjs (pure-JS) for zero-native-build portability; the
> blueprint specifies Argon2id — swap `src/utils/password.ts` for `argon2` in prod.
