export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Top Navigation */}
      <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold text-lg">
              ▲
            </div>
            <div>
              <span className="text-lg font-semibold tracking-tight text-white">
                Uptime Atlas
              </span>
              <span className="ml-2 rounded-full bg-emerald-950/80 px-2 py-0.5 text-[11px] font-medium text-emerald-400 border border-emerald-800">
                System Active
              </span>
            </div>
          </div>

          <nav className="flex items-center gap-6 text-sm font-medium text-slate-400">
            <span className="text-white hover:text-white transition-colors cursor-pointer">
              Dashboard
            </span>
            <span className="hover:text-slate-200 transition-colors cursor-pointer">
              Monitors
            </span>
            <span className="hover:text-slate-200 transition-colors cursor-pointer">
              Incidents
            </span>
            <span className="hover:text-slate-200 transition-colors cursor-pointer">
              Status Page
            </span>
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
        {/* Environment & Setup Status Banner */}
        <div className="mb-8 rounded-xl border border-blue-900/50 bg-blue-950/20 p-5 backdrop-blur-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
                <h2 className="text-sm font-semibold text-blue-200 uppercase tracking-wider">
                  Core Scaffold Ready
                </h2>
              </div>
              <p className="text-sm text-slate-300">
                Next.js App Router, Tailwind CSS, Prisma 6, and Vitest are operational. Local PostgreSQL service is running and ready for database connection testing.
              </p>
            </div>
            <div className="text-xs text-slate-400 font-mono bg-slate-900/80 px-3 py-2 rounded-lg border border-slate-800">
              Stack: Next.js 16 • React 19 • PostgreSQL 17
            </div>
          </div>
        </div>

        {/* Operational Metrics Grid */}
        <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-5 shadow-sm">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Overall Uptime</p>
            <p className="mt-2 text-2xl font-bold text-emerald-400">100.0%</p>
            <p className="mt-1 text-xs text-slate-400">Past 30 days average</p>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-5 shadow-sm">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Monitored Endpoints</p>
            <p className="mt-2 text-2xl font-bold text-white">0</p>
            <p className="mt-1 text-xs text-slate-400">Configured probes</p>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-5 shadow-sm">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Avg Response Time</p>
            <p className="mt-2 text-2xl font-bold text-white">-- ms</p>
            <p className="mt-1 text-xs text-slate-400">P95 latency baseline</p>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-5 shadow-sm">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Active Incidents</p>
            <p className="mt-2 text-2xl font-bold text-emerald-400">0</p>
            <p className="mt-1 text-xs text-slate-400">No unresolved outages</p>
          </div>
        </section>

        {/* Monitors List / Initial Empty State */}
        <section className="rounded-xl border border-slate-800/80 bg-slate-900/50 shadow-sm overflow-hidden">
          <div className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">Configured Monitors</h2>
              <p className="text-xs text-slate-400">Live HTTP/HTTPS target status and latency metrics</p>
            </div>
            <button
              type="button"
              className="rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 transition-colors"
            >
              + New Monitor
            </button>
          </div>

          <div className="p-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-800/60 text-slate-400 text-xl">
              🌐
            </div>
            <h3 className="mt-4 text-sm font-semibold text-white">No endpoints configured yet</h3>
            <p className="mt-1 text-xs text-slate-400 max-w-sm mx-auto">
              Once local PostgreSQL credentials are verified, monitors will poll target HTTP/HTTPS endpoints on custom intervals.
            </p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-6 text-center text-xs text-slate-400">
        Uptime Atlas • Precision Endpoint Monitoring & Incident Tracking Platform
      </footer>
    </div>
  );
}
