"use client";

import { useEffect, useState, useTransition } from "react";

interface LatestCheck {
  id: string;
  status: "UP" | "DOWN" | "DEGRADED" | "PENDING";
  statusCode: number | null;
  responseTimeMs: number | null;
  errorMessage: string | null;
  checkedAt: string;
}

interface Monitor {
  id: string;
  name: string;
  slug: string;
  url: string;
  method: string;
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatusCode: number;
  currentStatus: "UP" | "DOWN" | "DEGRADED" | "PENDING";
  consecutiveFailures: number;
  lastCheckedAt: string | null;
  createdAt: string;
  latestCheck: LatestCheck | null;
}

export default function Dashboard() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form states
  const [showAddModal, setShowAddModal] = useState(false);
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formMethod, setFormMethod] = useState<"GET" | "HEAD" | "POST">("GET");
  const [formTimeout, setFormTimeout] = useState("5000");
  const [formExpectedStatus, setFormExpectedStatus] = useState("200");
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Per-monitor manual checking state
  const [checkingMonitorId, setCheckingMonitorId] = useState<string | null>(null);

  async function fetchMonitors() {
    try {
      setErrorMessage(null);
      const res = await fetch("/api/monitors");
      const json = await res.json();
      if (json.success) {
        setMonitors(json.data);
      } else {
        setErrorMessage(json.error || "Failed to load monitors.");
      }
    } catch (err: unknown) {
      setErrorMessage("Network error fetching monitors.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchMonitors();
  }, []);

  async function handleCreateMonitor(e: React.FormEvent) {
    e.preventDefault();
    setFormErrors({});
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/monitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName,
          url: formUrl,
          method: formMethod,
          timeoutMs: Number.parseInt(formTimeout, 10),
          expectedStatusCode: Number.parseInt(formExpectedStatus, 10),
        }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        if (json.errors) {
          setFormErrors(json.errors);
        } else {
          setFormErrors({ _form: json.error || "Failed to create monitor." });
        }
        return;
      }

      // Reset form and refresh
      setFormName("");
      setFormUrl("");
      setFormMethod("GET");
      setFormTimeout("5000");
      setFormExpectedStatus("200");
      setShowAddModal(false);
      await fetchMonitors();
    } catch {
      setFormErrors({ _form: "Network error creating monitor." });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleManualCheck(id: string) {
    setCheckingMonitorId(id);
    try {
      const res = await fetch(`/api/monitors/${id}/check`, {
        method: "POST",
      });
      const json = await res.json();
      if (json.success) {
        await fetchMonitors();
      } else {
        alert(json.error || "Check failed.");
      }
    } catch {
      alert("Network error performing check.");
    } finally {
      setCheckingMonitorId(null);
    }
  }

  async function handleDeleteMonitor(id: string, name: string) {
    if (!confirm(`Are you sure you want to delete monitor "${name}"?`)) return;

    try {
      const res = await fetch(`/api/monitors/${id}`, { method: "DELETE" });
      if (res.ok) {
        await fetchMonitors();
      } else {
        alert("Failed to delete monitor.");
      }
    } catch {
      alert("Network error deleting monitor.");
    }
  }

  // Calculate live summary stats
  const totalMonitors = monitors.length;
  const upMonitors = monitors.filter((m) => m.currentStatus === "UP").length;
  const downMonitors = monitors.filter((m) => m.currentStatus === "DOWN").length;
  const checkedMonitors = monitors.filter((m) => m.latestCheck?.responseTimeMs !== null);
  const avgLatency =
    checkedMonitors.length > 0
      ? Math.round(
          checkedMonitors.reduce((acc, m) => acc + (m.latestCheck?.responseTimeMs || 0), 0) /
            checkedMonitors.length
        )
      : null;

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      {/* Top Header */}
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md">
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
                v1.0 Live
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => fetchMonitors()}
              className="text-xs text-slate-400 hover:text-white transition-colors"
              title="Refresh monitors"
            >
              ↻ Refresh
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 transition-colors"
            >
              + Add Monitor
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
        {errorMessage && (
          <div className="mb-6 rounded-lg border border-rose-900/60 bg-rose-950/30 p-4 text-sm text-rose-300">
            {errorMessage}
          </div>
        )}

        {/* Operational Metrics Cards */}
        <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 shadow-sm">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Monitored Endpoints</p>
            <p className="mt-2 text-2xl font-bold text-white">{totalMonitors}</p>
            <p className="mt-1 text-xs text-slate-400">Configured probes</p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 shadow-sm">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Operational (UP)</p>
            <p className="mt-2 text-2xl font-bold text-emerald-400">{upMonitors}</p>
            <p className="mt-1 text-xs text-slate-400">Endpoints passing health checks</p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 shadow-sm">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Disrupted (DOWN)</p>
            <p className={`mt-2 text-2xl font-bold ${downMonitors > 0 ? "text-rose-400" : "text-slate-400"}`}>
              {downMonitors}
            </p>
            <p className="mt-1 text-xs text-slate-400">Endpoints currently failing</p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 shadow-sm">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Average Latency</p>
            <p className="mt-2 text-2xl font-bold text-white">
              {avgLatency !== null ? `${avgLatency} ms` : "-- ms"}
            </p>
            <p className="mt-1 text-xs text-slate-400">Latest probe response time</p>
          </div>
        </section>

        {/* Monitors List Section */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/40 shadow-sm overflow-hidden">
          <div className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">Endpoint Probes</h2>
              <p className="text-xs text-slate-400">Live HTTP/HTTPS targets and real-time response measurements</p>
            </div>
            <button
              onClick={() => setShowAddModal(true)}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors"
            >
              + New Monitor
            </button>
          </div>

          {isLoading ? (
            <div className="p-12 text-center text-sm text-slate-400">Loading monitors from PostgreSQL...</div>
          ) : monitors.length === 0 ? (
            <div className="p-12 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-800/80 text-slate-400 text-xl">
                🌐
              </div>
              <h3 className="mt-4 text-sm font-semibold text-white">No monitors registered yet</h3>
              <p className="mt-1 text-xs text-slate-400 max-w-sm mx-auto">
                Add an HTTP/HTTPS endpoint to start measuring response times and tracking uptime.
              </p>
              <button
                onClick={() => setShowAddModal(true)}
                className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors"
              >
                Register First Monitor
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900/80 text-slate-400 uppercase tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Monitor Name</th>
                    <th className="px-6 py-3">Target Endpoint</th>
                    <th className="px-6 py-3">Latency</th>
                    <th className="px-6 py-3">Last Checked</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {monitors.map((m) => {
                    const isChecking = checkingMonitorId === m.id;
                    const isUp = m.currentStatus === "UP";
                    const isDown = m.currentStatus === "DOWN";

                    return (
                      <tr key={m.id} className="hover:bg-slate-900/30 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          {isUp && (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-950 px-2.5 py-1 font-medium text-emerald-400 border border-emerald-800">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                              Operational
                            </span>
                          )}
                          {isDown && (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-950 px-2.5 py-1 font-medium text-rose-400 border border-rose-800">
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                              Down
                            </span>
                          )}
                          {!isUp && !isDown && (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-950 px-2.5 py-1 font-medium text-amber-400 border border-amber-800">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                              Pending
                            </span>
                          )}
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="font-semibold text-white">{m.name}</div>
                          <div className="text-[11px] text-slate-400">Expected HTTP {m.expectedStatusCode}</div>
                        </td>

                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-300">
                              {m.method}
                            </span>
                            <a
                              href={m.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-xs text-indigo-400 hover:underline max-w-xs truncate inline-block"
                            >
                              {m.url}
                            </a>
                          </div>
                          {m.latestCheck?.errorMessage && (
                            <div className="mt-1 text-[11px] text-rose-400 max-w-sm truncate">
                              ⚠ {m.latestCheck.errorMessage}
                            </div>
                          )}
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap">
                          {m.latestCheck?.responseTimeMs !== null && m.latestCheck?.responseTimeMs !== undefined ? (
                            <span className="font-mono font-medium text-slate-200">
                              {m.latestCheck.responseTimeMs} ms
                            </span>
                          ) : (
                            <span className="text-slate-500 font-mono">-- ms</span>
                          )}
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap text-slate-400">
                          {m.lastCheckedAt ? new Date(m.lastCheckedAt).toLocaleTimeString() : "Never"}
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap text-right space-x-2">
                          <button
                            onClick={() => handleManualCheck(m.id)}
                            disabled={isChecking}
                            className="rounded bg-slate-800 px-2.5 py-1 font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50"
                          >
                            {isChecking ? "Checking..." : "Check Now"}
                          </button>
                          <button
                            onClick={() => handleDeleteMonitor(m.id, m.name)}
                            className="rounded px-2 py-1 text-slate-500 hover:text-rose-400 transition-colors"
                            title="Delete monitor"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* Add Monitor Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <h3 className="text-base font-semibold text-white">Register New Monitor</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateMonitor} className="mt-4 space-y-4">
              {formErrors._form && (
                <div className="rounded-lg bg-rose-950/40 border border-rose-800 p-3 text-xs text-rose-300">
                  {formErrors._form}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300">Monitor Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Production API Health"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
                {formErrors.name && (
                  <p className="mt-1 text-[11px] text-rose-400">{formErrors.name}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300">Target URL (HTTP or HTTPS)</label>
                <input
                  type="url"
                  required
                  placeholder="https://example.com/health"
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  SSRF protected: Localhost, private IPs (10.*, 192.168.*, 127.*), and cloud metadata are blocked.
                </p>
                {formErrors.url && (
                  <p className="mt-1 text-[11px] text-rose-400">{formErrors.url}</p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300">Method</label>
                  <select
                    value={formMethod}
                    onChange={(e) => setFormMethod(e.target.value as any)}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="GET">GET</option>
                    <option value="HEAD">HEAD</option>
                    <option value="POST">POST</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300">Expected Status</label>
                  <input
                    type="number"
                    value={formExpectedStatus}
                    onChange={(e) => setFormExpectedStatus(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                  />
                  {formErrors.expectedStatusCode && (
                    <p className="mt-1 text-[11px] text-rose-400">{formErrors.expectedStatusCode}</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300">Timeout (ms)</label>
                  <input
                    type="number"
                    min="500"
                    max="30000"
                    step="500"
                    value={formTimeout}
                    onChange={(e) => setFormTimeout(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                  />
                  {formErrors.timeoutMs && (
                    <p className="mt-1 text-[11px] text-rose-400">{formErrors.timeoutMs}</p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-lg px-4 py-2 text-xs font-medium text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {isSubmitting ? "Validating & Probing..." : "Register Monitor"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-800 py-6 text-center text-xs text-slate-500">
        Uptime Atlas • Precision Endpoint Monitoring & Incident Tracking Platform
      </footer>
    </div>
  );
}
