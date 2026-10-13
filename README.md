# Uptime Atlas

**Uptime Atlas** is a website uptime monitoring and incident tracking platform built with **Next.js (App Router)**, **TypeScript**, **PostgreSQL**, and **Prisma**.

---

## Architecture Overview

Uptime Atlas consists of two decoupled, cooperative processes sharing a single PostgreSQL database:

1. **Web Application (`npm run dev`)**:
   - Built with Next.js 16 (App Router), React 19, and Tailwind CSS.
   - Provides operator dashboard, monitor registration form, and API endpoints (`/api/monitors`).
   - Supports manual on-demand checks (`POST /api/monitors/:id/check`).

2. **Background Monitoring Worker (`npm run worker`)**:
   - A standalone, continuous TypeScript process running independently of Next.js.
   - Periodically queries PostgreSQL for active monitors that are due for their next check based on their configured interval (`intervalSeconds`).
   - Uses an atomic database-backed lock (`lockedUntil` via `FOR UPDATE SKIP LOCKED`) to prevent overlapping ticks or multiple worker instances from probing the same endpoint simultaneously.
   - Executes HTTP/HTTPS probes with SSRF protection, measures latency, records results into `CheckResult`, updates monitor health, and releases the lock.

> [!NOTE]
> Monitoring happens asynchronously in PostgreSQL. When the worker process is running, endpoints are polled automatically. If the background worker process is stopped, automatic monitoring pauses until the worker is restarted (manual checks in the web app remain functional).

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

# Optional worker tuning
WORKER_POLL_INTERVAL_MS=5000       # Polling loop frequency in milliseconds (default: 5000)
WORKER_BATCH_SIZE=10              # Maximum monitors claimed per batch (default: 10)
WORKER_LOCK_DURATION_MS=30000     # Lease duration before an uncompleted lock expires (default: 30000)
```

---

## Database Management

* **Apply Schema:** `npm run db:push` (automatically syncs schema to PostgreSQL using `.env.local`)
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
