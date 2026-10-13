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

## Testing

Run unit and integration test suites:

```bash
npm run test
```

Tests cover:
* **SSRF Protection:** Loopback, private IP ranges (RFC 1918), cloud metadata (169.254.169.254), and DNS rebinding checks.
* **Input Validation:** Name lengths, bounded timeouts, status codes, and slug generators.
* **HTTP Prober:** Mocked network calls, timeouts, stream cancellation, and latency tracking.
* **Worker Scheduler & Runner:** Due-monitor selection, atomic claim locking, failure isolation, and graceful shutdown.
* **Incident Lifecycle:** Threshold triggering (3rd consecutive failure), non-duplication of open incidents, recovery resolution, duration calculation, and concurrent race safety (`P2002`).
* **Reliability Analytics:** Empty windows (`null` / No data), all-success windows (100%), all-failure windows (0%), mixed windows, and P95 latency percentile math.
* **Timeline Events:** Chronological event tracking, operator notes validation, and manual incident resolution.
