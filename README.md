# Uptime Atlas

**Uptime Atlas** is a website uptime monitoring and incident tracking platform built with **Next.js (App Router)**, **TypeScript**, **PostgreSQL**, and **Prisma**.

---

## Architecture Overview

Uptime Atlas consists of two decoupled, cooperative processes sharing a single PostgreSQL database:

1. **Web Application (`npm run dev`)**:
   - Built with Next.js 16 (App Router), React 19, and Tailwind CSS.
   - Provides operator dashboard, monitor registration form, reliability analytics modals, incident timelines, and RESTful API endpoints.
   - Supports manual on-demand checks (`POST /api/monitors/:id/check`).

2. **Background Monitoring Worker (`npm run worker`)**:
   - A standalone, continuous TypeScript process running independently of Next.js.
   - Periodically queries PostgreSQL for active monitors that are due for their next check based on their configured interval (`intervalSeconds`).
   - Uses an atomic database-backed lock (`lockedUntil` via `FOR UPDATE SKIP LOCKED`) to prevent overlapping ticks or multiple worker instances from probing the same endpoint simultaneously.
   - Executes HTTP/HTTPS probes with SSRF protection, measures latency, records results into `CheckResult`, updates monitor health, and releases the lock.

> [!NOTE]
> Monitoring happens asynchronously in PostgreSQL. When the worker process is running, endpoints are polled automatically. If the background worker process is stopped, automatic monitoring pauses until the worker is restarted (manual checks in the web app remain functional).

---

## Incident Management & Lifecycle

Uptime Atlas features an automated, transactional incident lifecycle shared by both background worker checks and manual dashboard checks:

* **Detection Threshold:** An incident is automatically opened after a configurable threshold of consecutive failures (default: **3 consecutive failed checks**, configurable via `INCIDENT_FAILURE_THRESHOLD`).
* **Concurrency Protection:** A PostgreSQL partial unique constraint (`idx_unique_open_incident` on `incidents ("monitorId") WHERE status = 'OPEN'`) paired with row-level transaction locks guarantees that at most one open incident exists per monitor at any time.
* **Timeline Events:** Every incident records chronological events (`IncidentEvent` model: `DETECTED`, `RESOLVED`, `NOTE`, `INVESTIGATING`, etc.). Operators can post notes and updates through the API or UI.
* **Automatic Resolution:** When a failing monitor recovers (`status === "UP"`), the open incident is automatically marked as `RESOLVED`, computing the exact outage duration in seconds (`durationSeconds`) and appending a `RESOLVED` timeline event.

---

## Reliability Analytics Methodology

Uptime Atlas computes sample-based reliability metrics across rolling **24-hour**, **7-day**, and **30-day** time windows:

### 1. Sample-Based Uptime Calculation
* **Formula:** $\text{Uptime \%} = \left(\frac{\text{UP Probes}}{\text{Total Probes}}\right) \times 100$
* **Zero-Check Window Handling ("No data"):** When a selected window contains zero recorded probes (`totalChecks === 0`), the uptime percentage explicitly evaluates to `null` and is rendered in the UI as **"No data"** with "0 checks recorded", rather than incorrectly assuming 100% uptime.
* **Genuine 100% Uptime:** When at least one check is recorded in the window and every check succeeded (`totalChecks > 0` and `upChecks === totalChecks`), uptime accurately reports `100.00%`.
* **Methodology Limitations:** Sample-based uptime computes the ratio of successful discrete probes to total probes executed. It does not measure continuous wall-clock downtime between polling intervals or periods when the monitoring worker was stopped.

### 2. Latency Metrics & Percentiles
* **Average Latency:** Arithmetic mean of response times for successful (`UP`) probes in the window.
* **P95 Latency:** 95th percentile response time calculated using the nearest-rank method on sorted successful check latencies:
  $$\text{Index} = \lceil 0.95 \times N \rceil - 1$$
* **MTTR (Mean Time to Resolution):** Average duration in seconds of all resolved incidents originating within the window.

---

## Running in Development

Running Uptime Atlas requires two terminal windows:

### Terminal 1: Next.js Web App
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser to view the dashboard and register monitors.

### Terminal 2: Background Monitoring Worker
```bash
npm run worker
```
The worker will start polling for due monitors at the configured interval (default: every 5 seconds).

---

## Configuration (`.env.local`)

Create a `.env.local` file in the project root:

```env
DATABASE_URL="postgresql://postgres:<YOUR_PASSWORD>@localhost:5432/uptime_atlas?schema=public"

# Incident detection threshold
INCIDENT_FAILURE_THRESHOLD=3        # Consecutive failed checks before opening an incident (default: 3)

# Optional worker tuning
WORKER_POLL_INTERVAL_MS=5000       # Polling loop frequency in milliseconds (default: 5000)
WORKER_BATCH_SIZE=10              # Maximum monitors claimed per batch (default: 10)
WORKER_LOCK_DURATION_MS=30000     # Lease duration before an uncompleted lock expires (default: 30000)
```

---

## Database Management

* **Apply Schema & Constraints:** `npm run db:push` (automatically syncs schema and verifies PostgreSQL partial unique indexes)
* **Generate Client:** `npm run db:generate`
* **Browse Database:** `npm run db:studio`

---

## Public Status Pages & Privacy Boundary

Uptime Atlas provides clean, public-facing status pages for external stakeholders with a strict privacy boundary:

* **Stable Non-Guessable Identifier (`publicId`):** Each published monitor is accessed via a dedicated route `/status/:publicId` using a cryptographically secure 128-bit hex token (e.g., `pub_7f8a1...`).
* **Strict Privacy Boundary:** Target URLs (`url`), database primary keys (`id`, `monitorId`), internal worker errors, stack traces, and server network details are **never** exposed publicly. Public tokens are omitted from response bodies to prevent token leakage in client caches or logs. Error responses on public endpoints return sanitized messages without exception details.
* **Timeline Message Sanitization:** Automated incident events (`DETECTED`, `RESOLVED`) display clean, user-friendly descriptions. Operator timeline notes automatically redact URLs, internal IP addresses, and credential tokens.
* **Explicit Opt-in Publication:** Monitors default to private (`isPublic: false`). A status page is only visible when an operator explicitly publishes it via the dashboard toggle or API.
* **404 Handling:** Requests to disabled, private, or non-existent status tokens return a clean 404 response without leaking monitor existence or configuration details.
* **Token Rotation:** Operators can rotate/regenerate the `publicId` token at any time via `PATCH /api/monitors/:id/publication` or the dashboard **Rotate Link** button, instantly invalidating the previous public URL.
* **Live Refresh:** Public status pages automatically poll for updates every 30 seconds with an interactive manual refresh control and time-window selector (24h, 7d, 30d).

---

## 90-Day Historical Uptime Calendar

Public status pages include an interactive 90-calendar-day historical availability calendar:

* **Deterministic UTC Day Boundaries:** Every daily interval is evaluated strictly in UTC (`00:00:00.000` to `23:59:59.999 UTC`), ensuring consistent day boundaries across all client timezones.
* **Actual Recorded Checks (No Estimates):** Availability is computed from discrete recorded checks:
  $$\text{Daily Uptime \%} = \left(\frac{\text{UP Probes}}{\text{Total Probes}}\right) \times 100$$
* **Explicit "No Data" Categorization:** Days with zero recorded probes evaluate to `status: "NO_DATA"` with `uptimePercentage: null`. Days without recorded probes are **never** assumed or displayed as 100% uptime.
* **Daily Status Categories:**
  - `OPERATIONAL` (Emerald): $\text{Total Checks} > 0$ and $\text{Down Checks} = 0$ (100% uptime).
  - `DEGRADED` (Amber): $\text{Total Checks} > 0$, $\text{Down Checks} > 0$, and $\text{Up Checks} > 0$ (partial outage).
  - `OUTAGE` (Rose): $\text{Total Checks} > 0$ and $\text{Up Checks} = 0$ (0% uptime).
  - `NO_DATA` (Slate): $\text{Total Checks} = 0$ (no probes executed on this calendar day).
* **Interactive Day Inspection:** Clicking or tapping any day block reveals a detailed inspection card showing formatted UTC date, status badge, daily availability %, total/up/down check counts, average response latency, and any overlapping incidents with timestamps and outage durations.
* **Current Partial Day Handling:** Today (day 0) is evaluated from 00:00:00 UTC up to the current timestamp.

---

## API Endpoints

### Operator Endpoints (Private)
* `GET /api/monitors`: List all monitors with health summaries and incident counts.
* `POST /api/monitors`: Register a new monitor (`isPublic` defaults to `false`).
* `GET /api/monitors/:id`: Retrieve full monitor details including target URL and configuration.
* `POST /api/monitors/:id/check`: Trigger an immediate on-demand HTTP check.
* `GET /api/monitors/:id/analytics?window=24h`: Retrieve sample-based reliability metrics for 24h, 7d, or 30d windows.
* `GET /api/monitors/:id/incidents`: List open and resolved incidents for a monitor.
* `PATCH /api/monitors/:id/publication`: Toggle publication (`{ "isPublic": true|false }`) or rotate token (`{ "regenerate": true }`).
* `GET /api/incidents/:id`: Retrieve incident details and full chronological timeline events.
* `POST /api/incidents/:id/events`: Add operator timeline note (`INVESTIGATING`, `IDENTIFIED`, `MONITORING`, `NOTE`).
* `POST /api/incidents/:id/resolve`: Manually resolve an open incident with a closing note.

### Public Endpoints
* `GET /api/status/:publicId`: Public read-only endpoint returning sanitized monitor telemetry, 90-day calendar, rolling metrics, and incident timelines.
* `GET /status/:publicId`: Public status page UI.

---

## Testing

Run unit and integration test suites:

```bash
npm run test
```

Tests cover:
* **SSRF Protection:** Loopback, private IP ranges (RFC 1918), cloud metadata (169.254.169.254), and DNS rebinding checks.
* **Input Validation:** Name lengths, bounded timeouts, status codes, publication flags, and slug generators.
* **HTTP Prober:** Mocked network calls, timeouts, stream cancellation, and latency tracking.
* **Worker Scheduler & Runner:** Due-monitor selection, atomic claim locking, failure isolation, and graceful shutdown.
* **Incident Lifecycle:** Threshold triggering (3rd consecutive failure), non-duplication of open incidents, recovery resolution, duration calculation, and concurrent race safety (`P2002`).
* **Reliability Analytics:** Empty windows (`null` / No data), all-success windows (100%), all-failure windows (0%), mixed windows, and P95 latency percentile math.
* **Timeline Events:** Chronological event tracking, operator notes validation, and manual incident resolution.
* **Public Status Pages & Privacy:** Secure token generation, publication state toggles, token rotation, 404 responses for unpublished or missing monitors, token omission from response bodies, error message redaction, and assertions verifying target URLs and internal IDs are never leaked.
* **90-Day Historical Calendar:** 90 calendar days in UTC, empty day handling (never 100%), daily uptime calculations, latency aggregation, partial day handling, and overlapping incident associations.
