# Uptime Atlas

**Uptime Atlas** is a self-hosted HTTP and HTTPS availability monitoring platform and automated incident tracking system built with **Next.js (App Router)**, **TypeScript**, **PostgreSQL**, and **Prisma**.

It provides real-time service health tracking, automated failure detection, sample-based uptime analytics, public status pages with privacy boundaries, and single-operator authentication with administrative API protection.

---

## Table of Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Technology Stack](#technology-stack)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Local Setup](#local-setup)
- [Environment Variables](#environment-variables)
- [Operator Provisioning](#operator-provisioning)
- [Testing & Development Commands](#testing--development-commands)
- [API Overview](#api-overview)
- [Security Considerations](#security-considerations)
- [Production Deployment](#production-deployment)
- [Known Limitations & Scope](#known-limitations--scope)
- [Roadmap](#roadmap)
- [License](#license)

---

## Features

### Monitoring & Probing
- **Configurable Endpoints**: Monitor HTTP and HTTPS URLs with customizable request methods (`GET`, `HEAD`, `POST`), timeouts (500ms to 30,000ms), expected status codes, and polling intervals.
- **Independent Background Worker**: An asynchronous worker process continuously polls and probes due targets independently of web server traffic.
- **SSRF Protection**: Probing engine blocks loopback addresses, private RFC 1918 subnets, cloud metadata services (e.g. `169.254.169.254`), documentation ranges, and IPv6 equivalents, while disabling automatic redirects (`redirect: "manual"`).
- **On-Demand Health Checks**: Trigger manual checks directly from the operator dashboard at any time.

### Automated Incident Management
- **Threshold-Based Detection**: Incidents automatically trigger after a configurable threshold of consecutive probe failures (default: 3 consecutive failures).
- **Single Active Incident Guarantee**: PostgreSQL partial unique constraints and row-level locking guarantee at most one open incident exists per monitor.
- **Chronological Incident Timelines**: Tracks diagnostic events (`DETECTED`, `INVESTIGATING`, `IDENTIFIED`, `MONITORING`, `RESOLVED`, `NOTE`).
- **Automated Incident Resolution**: Open incidents automatically resolve when a failing service returns to a healthy status, calculating the outage duration in seconds.

### Reliability Analytics
- **Sample-Based Availability**: Evaluates uptime percentages across rolling **24-hour**, **7-day**, and **30-day** time windows.
- **Latency Tracking**: Calculates average latency and 95th percentile (P95) response times using the nearest-rank method on successful checks.
- **MTTR Calculation**: Tracks Mean Time to Resolution for resolved incidents.
- **90-Day UTC Historical Calendar**: Daily availability statuses (`OPERATIONAL`, `DEGRADED`, `OUTAGE`, `NO_DATA`) calculated with UTC boundaries.

### Public Status Pages & Privacy Boundaries
- **Capability Tokens**: Public access is mediated through non-guessable, URL-safe 128-bit hex tokens (`/status/pub_<hex>`).
- **Data Redaction**: Internal target URLs, monitor IDs, server IP addresses, raw database identifiers, and internal error stack traces are omitted from public HTML and API responses.
- **Instant Token Rotation**: Operators can rotate status links or unpublish status pages at any time.

### Operator Authentication & Administrative Route Protection
- **Single-Operator Model**: Strict single-operator authentication with no public registration.
- **OWASP-Compliant Password Hashing**: Passwords derived using Node.js native `scrypt` ($N=16384, r=8, p=1$, 64-byte key length, 16-byte random salt).
- **Hashed Session Tokens**: Plaintext session tokens are never stored in the database. Only SHA-256 hashes are persisted.
- **Secure Cookie Transport**: Sessions are delivered via `HttpOnly`, `SameSite=lax`, `Path=/`, and `Secure` (in production) cookies.
- **Login Rate Limiting**: In-memory sliding-window protection restricting IP requests (10 req / 60s) and failed credential attempts (5 attempts / 15m) with `Retry-After` headers.
- **CSRF Defense**: Enforces trusted `Origin` and `Referer` validation alongside strict `Content-Type: application/json` media type checks on state-changing endpoints.
- **Zero-Leak Server Gate**: Unauthenticated requests to `/` receive a server-side redirect (`307`) to `/login` before any dashboard code or monitor data is transmitted.

---

## Screenshots

* **Operator Dashboard (`/`)**: Displays active monitor cards, real-time status indicators, active outage banners, manual check triggers, and historical metrics.
* **Operator Login (`/login`)**: Dark-themed credentials form with password visibility toggle, accessible error alerts, and rate-limiting notifications.
* **Monitor Analytics Modal**: Rolling 24h, 7d, and 30d uptime percentages, response latency graphs, P95 values, and active incident details.
* **Incident Timeline Modal**: Chronological timeline of outage detection, diagnostic notes, operator status updates, and manual resolution controls.
* **Public Status Page (`/status/:publicId`)**: Clean, stakeholder-facing availability dashboard with live status indicators, a 90-day interactive calendar, and sanitized outage updates.

### Operator Dashboard
![Operator Dashboard](public/screenshots/dashboard.png)
*Central operator overview displaying monitored endpoints, real-time health statuses, average response latency, and probe management controls.*

### Monitor Analytics
![Monitor Reliability Analytics](public/screenshots/monitor-analytics.png)
*Historical reliability analytics modal showing availability percentages across rolling 24-hour, 7-day, and 30-day windows, P95 latency percentiles, and probe result breakdowns.*

### Incident Timeline
![Incident Tracking and Timeline](public/screenshots/incident-timeline.png)
*Incident management view tracking automated outage detection, resolution states, and chronological event timelines.*

### Public Status Page
![Public Status Page](public/screenshots/public-status.png)
*Stakeholder-facing public status page with a 90-day UTC availability calendar, rolling uptime metrics, and privacy-sanitized endpoint telemetry.*

### Operator Authentication Gate
![Operator Authentication Gate](public/screenshots/login.png)
*Protected single-operator sign-in interface secured by sliding-window rate limiting and scrypt password verification.*

---

## Technology Stack

| Layer | Technology | Details |
|---|---|---|
| **Framework** | [Next.js 16.4](https://nextjs.org/) | App Router, Server Components, Route Handlers, Turbopack, Cache Components |
| **UI Library** | [React 19.3](https://react.dev/) | React Server Components, Client Components, Hooks |
| **Styling** | [Tailwind CSS v4](https://tailwindcss.com/) | Dark-mode interface |
| **Language** | [TypeScript 5](https://www.typescriptlang.org/) | Strict mode, end-to-end type safety |
| **Database** | [PostgreSQL](https://www.postgresql.org/) | Relational database (v15+ tested and recommended; v12+ supported by Prisma ORM) with partial indexes, cascading deletes, and row-level locking |
| **ORM** | [Prisma 6.19](https://www.prisma.io/) | Schema management, type-safe queries, schema synchronization |
| **Cryptography** | Node.js `crypto` | Native `scrypt` password hashing, `randomBytes` session generation, SHA-256 hashing |
| **Testing** | [Vitest 5.0](https://vitest.dev/) | Unit and integration test suite across API routes, crypto, prober, worker, and UI gates |

---

## Architecture

Uptime Atlas consists of two decoupled processes communicating via PostgreSQL:

```mermaid
flowchart TD
    subgraph Clients["Clients & Users"]
        Op["Operator (Browser)"]
        Public["Public Stakeholder (Browser)"]
    end

    subgraph WebProcess["Next.js Web Application (npm run dev / start)"]
        LoginPage["/login (Server Gate & Login Form)"]
        DashPage["/ (Operator Dashboard)"]
        PubPage["/status/:publicId (Public Status Page)"]
        AuthAPIs["/api/auth/* (Login, Logout, Me)"]
        AdminAPIs["/api/monitors/* & /api/incidents/* (Guarded)"]
        PublicAPI["/api/status/:publicId (Public Telemetry)"]
    end

    subgraph WorkerProcess["Monitoring Worker Daemon (npm run worker)"]
        Scheduler["Scheduler (FOR UPDATE SKIP LOCKED)"]
        Prober["HTTP/HTTPS Prober (SSRF Filter & AbortController)"]
        Lifecycle["Incident Lifecycle Engine"]
    end

    subgraph Database["PostgreSQL Database"]
        OpTable[("operators & sessions")]
        MonTable[("monitors & check_results")]
        IncTable[("incidents & incident_events")]
    end

    subgraph Targets["Monitored Services"]
        ExtTarget["External Web Services / Endpoints"]
    end

    Op -->|Session Cookie| LoginPage
    Op -->|Session Cookie| DashPage
    Op -->|Session Cookie| AuthAPIs
    Op -->|Session Cookie| AdminAPIs

    Public -->|Anonymous| PubPage
    Public -->|Anonymous| PublicAPI

    DashPage -.->|adminFetch| AdminAPIs
    LoginPage -.->|fetch| AuthAPIs

    AdminAPIs --> OpTable
    AdminAPIs --> MonTable
    AdminAPIs --> IncTable
    AuthAPIs --> OpTable
    PublicAPI --> MonTable

    Scheduler -->|Claim Due Monitors| MonTable
    Scheduler --> Prober
    Prober -->|Probing Request| ExtTarget
    Prober --> Lifecycle
    Lifecycle -->|Record Probe & Incidents| MonTable
    Lifecycle -->|Open / Resolve Incidents| IncTable
```

### Key Architectural Properties
1. **Process Separation**: The background worker runs in a separate Node.js process using `tsx src/worker/index.ts`. If the web server restarts or experiences high traffic, probe scheduling remains unaffected.
2. **Distributed Queue Locking**: The worker queries due monitors using PostgreSQL `FOR UPDATE SKIP LOCKED`, preventing multiple worker instances from claiming or checking the same monitor concurrently.
3. **Lease Expiration & Recovery**: Each claimed monitor receives a lease timestamp (`lockedUntil`). If a worker process terminates unexpectedly, expired locks are reclaimed on the next iteration.

---

## Prerequisites

Before setting up Uptime Atlas, verify that your environment has:

- **Node.js**: `v20.9.0` or higher (`v24.x` recommended).
- **npm**: `v10.x` or higher.
- **PostgreSQL**: `v12.0` or higher (governed by Prisma 6 engine support; `v15+` is tested and recommended) with network access and permissions to create tables and indexes.

---

## Local Setup

### 1. Clone Repository & Install Dependencies
```bash
git clone https://github.com/your-username/uptime-atlas.git
cd uptime-atlas
npm install
```

### 2. Configure Environment Variables
Copy the example environment file:
```bash
cp .env.example .env.local
```
Edit `.env.local` to provide your PostgreSQL connection string:
```env
DATABASE_URL="postgresql://postgres:yourpassword@localhost:5432/uptime_atlas?schema=public"
APP_URL="http://localhost:3000"
```

### 3. Generate Prisma Client & Synchronize Database Schema (Development)
```bash
npm run db:generate
npm run db:push
```
> [!NOTE]
> In local development, `npm run db:push` directly synchronizes the Prisma schema with your local PostgreSQL database without generating versioned migration files, and automatically executes `scripts/ensure-constraints.js` to establish the partial unique index (`idx_unique_open_incident`) on open incidents. This workflow is intended strictly for rapid local development and prototyping.

### 4. Provision the Initial Operator Account
Run the interactive operator provisioning command:
```bash
npm run db:seed-operator
```
Follow the terminal prompt to enter a username (default: `admin`) and a password (minimum 10 characters). Password input is masked.

### 5. Start the Web Application
```bash
npm run dev
```
The Next.js application will start on [http://localhost:3000](http://localhost:3000).

### 6. Start the Background Monitoring Worker
In a **separate terminal window**, start the monitoring worker daemon:
```bash
npm run worker
```
The worker will begin polling PostgreSQL and probing registered endpoints.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | **Yes** | *None* | PostgreSQL connection string (`postgresql://...`; PostgreSQL >= 12 supported, 15+ recommended). |
| `APP_URL` | **Yes** (Prod) | `http://localhost:3000` | Canonical public application URL and origin (e.g. `https://uptime.example.com`). Must use HTTPS in production. |
| `TRUST_PROXY` | No | `false` | Set to `true` when deployed behind a trusted reverse proxy (e.g. Cloudflare Tunnel, Nginx) that strips and provides client IP headers. |
| `INCIDENT_FAILURE_THRESHOLD` | No | `3` | Number of consecutive failed checks before an incident is opened. |
| `SESSION_LIFETIME_SECONDS` | No | `604800` (7 days) | Session duration in seconds. |
| `WORKER_POLL_INTERVAL_MS` | No | `5000` | Frequency in milliseconds at which the worker polls for due monitors. |
| `WORKER_BATCH_SIZE` | No | `10` | Maximum number of monitors claimed per worker polling cycle. |
| `WORKER_LOCK_DURATION_MS` | No | `30000` | Lease duration in milliseconds for claimed monitors. |
| `OPERATOR_USERNAME` | No | `admin` | Default username used during headless seeding. |
| `OPERATOR_PASSWORD` | No | *None* | Password used during headless seeding (min 10 characters). |

---

## Operator Provisioning

Uptime Atlas implements a single-operator model. Public account creation is disabled.

### Interactive Provisioning (Recommended)
To provision the operator account securely, run:
```bash
npm run db:seed-operator
```
- In an interactive terminal, the command prompts for the operator username and password.
- Password entry uses zero-echo terminal masking.
- Passwords are typed directly into the standard input stream and do not appear in command-line arguments or shell history.

### Headless Provisioning
For automated environments (e.g. container initialization), provide the credentials via environment variables:
```bash
OPERATOR_USERNAME="admin" OPERATOR_PASSWORD="your-strong-password" npm run db:seed-operator
```

> [!WARNING]
> Do not pass passwords as command-line arguments (e.g., `--password <str>`), as command-line arguments are visible in process inspection tables (`ps aux`, Task Manager) and shell history.

Once an operator exists in the database, `provisionOperator` strictly refuses to overwrite the account or create additional operators (`single-operator architecture`).

---

## Testing & Development Commands

Uptime Atlas includes a test suite covering cryptography, session lifecycles, route guards, SSRF protection, worker scheduling, and UI gates.

| Command | Action |
|---|---|
| `npm test` | Runs the full Vitest test suite. |
| `npm run test:watch` | Runs Vitest in watch mode for development. |
| `npm run typecheck` | Performs static TypeScript type-checking (`tsc --noEmit`). |
| `node scripts/db.js validate` | Validates the Prisma schema against database configuration. |
| `npm run build` | Compiles the production Next.js application using Turbopack. |
| `npm run start` | Starts the Next.js production server. |
| `npm run worker` | Runs the standalone background monitoring worker daemon. |
| `npm run db:seed-operator` | Interactively provisions the operator account. |
| `npm run db:studio` | Launches Prisma Studio to inspect database records in a browser. |

---

## API Overview

### 1. Authentication Endpoints (Public)
* `POST /api/auth/login`: Authenticates operator credentials. Requires `Content-Type: application/json`. Sets an `HttpOnly` session cookie on success. Rate-limited per IP and credential attempt.
* `POST /api/auth/logout`: Revokes the current session in PostgreSQL and clears the session cookie.
* `GET /api/auth/me`: Returns the current operator identity (`{ authenticated: boolean, operator: { username } | null }`).

### 2. Administrative Endpoints (Operator Session Required)
*All administrative endpoints require an active session cookie. Unauthenticated requests receive `HTTP 401 Unauthorized`.*

* `GET /api/monitors`: Lists all registered monitors, latest check statuses, and incident statistics.
* `POST /api/monitors`: Registers a new monitor.
* `GET /api/monitors/:id`: Retrieves configuration and diagnostic details for a specific monitor.
* `DELETE /api/monitors/:id`: Deletes a monitor and cascades check and incident histories.
* `POST /api/monitors/:id/check`: Executes an immediate, on-demand HTTP health check.
* `PATCH /api/monitors/:id/publication`: Updates publication settings (`isPublic: boolean`) or rotates the public capability token (`regenerate: true`).
* `GET /api/monitors/:id/analytics?window=24h`: Returns availability percentages, average latency, and P95 latency for 24h, 7d, or 30d windows.
* `GET /api/incidents`: Lists incidents with optional status filtering (`ALL`, `OPEN`, `RESOLVED`).
* `GET /api/incidents/:id`: Retrieves incident details, cause, and chronological timeline events.
* `PATCH /api/incidents/:id`: Manually resolves an open incident.
* `POST /api/incidents/:id/events`: Appends an operator timeline event (`NOTE`, `INVESTIGATING`, `IDENTIFIED`, `MONITORING`).

### 3. Public Status Endpoints (Anonymous Access)
* `GET /api/status/:publicId`: Public read-only telemetry returning sanitized availability stats, 90-day calendar data, and redacted timeline events.
* `GET /status/:publicId`: Public status page interface.

---

## Security Considerations

- **Password Security**: Passwords are hashed using asynchronous Node.js `crypto.scrypt` with a cryptographically random 16-byte salt. Unknown usernames execute a dummy scrypt verification pass to mitigate timing-based user enumeration.
- **Session Tokens**: Plaintext session tokens are generated with 32 bytes of entropy and are never stored in the database. PostgreSQL stores only SHA-256 hashes of session tokens.
- **Cookie Security**: Session cookies use `httpOnly: true` (inaccessible to JavaScript), `sameSite: "lax"`, `path: "/"`, and `secure: true` in production environments.
- **CSRF Defense**: State-changing authentication and administrative endpoints enforce RFC 9110 media-type validation (`Content-Type: application/json`) and verify that incoming `Origin` and `Referer` headers match `CONFIG.APP_URL`.
- **SSRF Hardening**: Outgoing probe requests parse target hostnames and execute pre-flight DNS lookups. Requests to IPv4 loopback (`127.0.0.0/8`), private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local/cloud metadata (`169.254.0.0/16`), multicast, IPv6 loopback (`::1`), IPv6 unique local (`fc00::/7`), and IPv4-mapped IPv6 are rejected. Probes enforce `redirect: "manual"` to prevent open-redirect SSRF bypasses.
- **Public Data Sanitization**: Public status pages omit target URLs, internal database IDs, and exception stack traces. Incident timeline messages are sanitized to redact URLs and IP addresses.
- **Rate Limiting Scope**: Rate limiters use an in-memory sliding window per application process. In multi-instance deployments, rate limits apply per node rather than across a shared cache.
- **Reverse Proxy (`TRUST_PROXY`)**: Set `TRUST_PROXY=true` only when the application is deployed behind a trusted proxy (e.g. Cloudflare Tunnel, Nginx) that strips client-supplied headers and sets verified client IP headers. Ensure direct internet access to the application port is firewalled.

---

## Production Deployment

### 1. Environment & Network Configuration
- Set `NODE_ENV=production`.
- Configure `APP_URL=https://your-domain.com`. In production, non-HTTPS URLs cause `APP_URL` initialization to throw an error.
- If using Cloudflare Tunnel, set `TRUST_PROXY=true`. Configure your firewall so the web application port (e.g. 3000) is only accessible to the tunnel or reverse proxy.

### 2. Database Preparation
- Provision a dedicated PostgreSQL database (version 12 or higher supported by Prisma 6; version 15+ tested and recommended).
- **Production Schema & Migration Status**:
  > [!IMPORTANT]
  > **A versioned production migration history has not yet been established in this repository.** There is currently no `prisma/migrations` directory.
  >
  > - Local development currently relies on `npm run db:push` to synchronize the Prisma schema and execute `scripts/ensure-constraints.js`. **Do not run `db:push` against a production database**, as direct schema pushing can cause unintended data loss, schema drift, and does not record applied migration states.
  > - Running `prisma migrate deploy` against a fresh production database will not initialize tables because no migration files exist in the repository yet.
  > - Prior to running in production, a deliberate migration-baselining step is required:
  >   1. Generate an initial baseline migration archive in a development or staging environment using the Prisma CLI (e.g., `npx prisma migrate dev --name init`).
  >   2. Incorporate the PostgreSQL partial unique constraint from `scripts/ensure-constraints.js` (`CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_open_incident ON incidents ("monitorId") WHERE status = 'OPEN';`) into the migration SQL or an associated migration step.
  >   3. Thoroughly test and review the resulting migration SQL before executing `npx prisma migrate deploy` in your production pipeline.
- Ensure automated, periodic database backups are configured (e.g. via `pg_dump`).

### 3. Operator Provisioning
On the production host, provision the operator account interactively:
```bash
npm run db:seed-operator
```

### 4. Running the Web Application
Compile and start the Next.js production server:
```bash
npm run build
npm run start
```

### 5. Running the Background Monitoring Worker
The monitoring worker must run continuously alongside the web application. Use a process manager such as `systemd`, `Docker`, or `PM2`:

#### Example Systemd Unit File (`/etc/systemd/system/uptime-atlas-worker.service`)
```ini
[Unit]
Description=Uptime Atlas Monitoring Worker
After=network.target postgresql.service

[Service]
Type=simple
User=uptime
WorkingDirectory=/opt/uptime-atlas
ExecStart=/usr/bin/npm run worker
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

---

## Known Limitations & Scope

- **Single-Operator Architecture**: Designed for single-operator administrative access. Role-based access control (RBAC) and multi-tenant operator management are not supported in V1.
- **Protocol Scope**: Supports HTTP and HTTPS probing only. ICMP ping, raw TCP socket checks, and DNS resolution probes are not supported in V1.
- **Discrete Sampled Probes**: Availability metrics reflect discrete probes executed at configured intervals. They represent sampled availability rather than continuous wall-clock uptime.
- **In-Memory Rate Limiting**: The login rate limiter tracks requests in process memory. It is not shared across multiple web processes without an external store (e.g. Redis).
- **Production Migration History**: The repository currently uses unversioned schema synchronization (`db:push`) for local development and does not include a committed `prisma/migrations` archive. Production deployments require an initial migration-baselining step.

---

## Roadmap

Planned future enhancements:
- [ ] Versioned Prisma migration baseline archive for production deployments.
- [ ] Multi-region distributed probing nodes.
- [ ] Automated incident alerting (Webhooks, Slack, Discord, Email).
- [ ] SSL/TLS certificate expiration monitoring.
- [ ] Custom domain mapping for public status pages.
- [ ] Prometheus metrics export endpoint.

---

## License

No license has been selected for this project yet. All rights are reserved pending selection.
