"use client";

import { useEffect, useState } from "react";
import MonitorAnalyticsModal from "./monitor-analytics-modal";
import IncidentTimelineModal from "./incident-timeline-modal";

interface LatestCheck {
  id: string;
  status: "UP" | "DOWN" | "PENDING";
  statusCode: number | null;
  responseTimeMs: number | null;
  errorMessage: string | null;
  checkedAt: string;
}

interface OpenIncidentSummary {
  id: string;
  title: string;
  cause: string | null;
  startedAt: string;
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
  currentStatus: "UP" | "DOWN" | "PENDING";
  consecutiveFailures: number;
  lastCheckedAt: string | null;
  createdAt: string;
  isPublic: boolean;
  publicId: string | null;
  openIncident: OpenIncidentSummary | null;
  latestCheck: LatestCheck | null;
}

interface IncidentListItem {
  id: string;
  monitorId: string;
  status: "OPEN" | "RESOLVED";
  title: string;
  cause: string | null;
  startedAt: string;
  resolvedAt: string | null;
  durationSeconds: number | null;
  monitor: {
    id: string;
    name: string;
    slug: string;
    url: string;
    currentStatus: string;
  };
  eventCount: number;
  latestEvent: {
    id: string;
    type: string;
    message: string;
    createdAt: string;
  } | null;
}

export default function Dashboard() {
  const [activeView, setActiveView] = useState<"monitors" | "incidents">("monitors");
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [incidents, setIncidents] = useState<IncidentListItem[]>([]);
  const [incidentFilter, setIncidentFilter] = useState<"ALL" | "OPEN" | "RESOLVED">("ALL");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form states
  const [showAddModal, setShowAddModal] = useState(false);
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formMethod, setFormMethod] = useState<"GET" | "HEAD" | "POST">("GET");
  const [formTimeout, setFormTimeout] = useState("5000");
  const [formExpectedStatus, setFormExpectedStatus] = useState("200");
  const [formIsPublic, setFormIsPublic] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Modal inspection states
  const [checkingMonitorId, setCheckingMonitorId] = useState<string | null>(null);
  const [analyticsTarget, setAnalyticsTarget] = useState<{ id: string; name: string } | null>(null);
  const [timelineIncidentId, setTimelineIncidentId] = useState<string | null>(null);

  async function fetchMonitors() {
    try {
      const res = await fetch("/api/monitors");
      const json = await res.json();
      if (json.success) {
        setMonitors(json.data);
      } else {
        setErrorMessage(json.error || "Failed to load monitors.");
      }
    } catch {
      setErrorMessage("Network error fetching monitors.");
    }
  }

  async function fetchIncidents() {
    try {
      const res = await fetch("/api/incidents");
      const json = await res.json();
      if (json.success) {
        setIncidents(json.data);
      }
    } catch {
      // Gracefully ignore background incident fetch error
    }
  }

  async function refreshAll() {
    setIsLoading(true);
    setErrorMessage(null);
    await Promise.all([fetchMonitors(), fetchIncidents()]);
    setIsLoading(false);
  }

  useEffect(() => {
    refreshAll();
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
          isPublic: formIsPublic,
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

      setFormName("");
      setFormUrl("");
      setFormMethod("GET");
      setFormTimeout("5000");
      setFormExpectedStatus("200");
      setFormIsPublic(false);
      setShowAddModal(false);
      await refreshAll();
    } catch {
      setFormErrors({ _form: "Network error creating monitor." });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleTogglePublication(id: string, currentIsPublic: boolean) {
    try {
      const res = await fetch(`/api/monitors/${id}/publication`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: !currentIsPublic }),
      });
      const json = await res.json();
      if (json.success) {
        await refreshAll();
      } else {
        alert(json.error || "Failed to update publication settings.");
      }
    } catch {
      alert("Network error updating publication settings.");
    }
  }

  function handleCopyStatusLink(publicId: string) {
    const url = `${window.location.origin}/status/${publicId}`;
    navigator.clipboard.writeText(url);
    alert(`Copied public status page URL to clipboard:\n${url}`);
  }

  async function handleManualCheck(id: string) {
    setCheckingMonitorId(id);
    try {
      const res = await fetch(`/api/monitors/${id}/check`, {
        method: "POST",
      });
      const json = await res.json();
      if (json.success) {
        await refreshAll();
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
        await refreshAll();
      } else {
        alert("Failed to delete monitor.");
      }
    } catch {
      alert("Network error deleting monitor.");
    }
  }

  function formatDuration(seconds: number | null): string {
    if (seconds === null || seconds === undefined) return "--";
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) return `${mins}m ${secs}s`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}h ${remMins}m`;
  }

  // Summary operational metrics
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

  const openIncidents = incidents.filter((i) => i.status === "OPEN");
  const filteredIncidents = incidents.filter((i) => {
    if (incidentFilter === "OPEN") return i.status === "OPEN";
    if (incidentFilter === "RESOLVED") return i.status === "RESOLVED";
    return true;
  });

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      {/* Top Header */}
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
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

            {/* Navigation Tabs */}
            <nav className="flex items-center gap-1 border-l border-slate-800 pl-6">
              <button
                onClick={() => setActiveView("monitors")}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  activeView === "monitors"
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:text-white hover:bg-slate-900"
                }`}
              >
                Monitors ({monitors.length})
              </button>
              <button
                onClick={() => setActiveView("incidents")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  activeView === "incidents"
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:text-white hover:bg-slate-900"
                }`}
              >
                Incidents
                {openIncidents.length > 0 ? (
                  <span className="rounded-full bg-rose-600 px-1.5 py-0.2 text-[10px] font-bold text-white">
                    {openIncidents.length}
                  </span>
                ) : (
                  <span className="text-slate-500 text-[11px]">({incidents.length})</span>
                )}
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => refreshAll()}
              className="text-xs text-slate-400 hover:text-white transition-colors"
              title="Refresh monitors and incidents"
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

        {/* Global Active Outage Banner */}
        {openIncidents.length > 0 && (
          <div className="mb-8 rounded-xl border border-rose-900/60 bg-rose-950/20 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-900/60 text-rose-400 text-xs font-bold animate-pulse">
                  ⚠
                </span>
                <div>
                  <div className="text-sm font-semibold text-rose-300">
                    Active Incident Detected ({openIncidents.length} ongoing)
                  </div>
                  <div className="mt-1 text-xs text-rose-200/90">
                    {openIncidents.map((inc) => (
                      <span key={inc.id} className="block mt-0.5">
                        • <span className="font-semibold">{inc.monitor.name}</span>: {inc.title}{" "}
                        {inc.cause ? `(${inc.cause})` : ""}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  setActiveView("incidents");
                  setIncidentFilter("OPEN");
                }}
                className="whitespace-nowrap rounded-lg bg-rose-900/40 border border-rose-700/60 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-900/60 transition-colors"
              >
                Inspect Incidents →
              </button>
            </div>
          </div>
        )}

        {activeView === "monitors" ? (
          <>
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
                <p className="mt-1 text-xs text-slate-400">Passing health checks</p>
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
                  <p className="text-xs text-slate-400">
                    Live targets, response times, and reliability analytics
                  </p>
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
                    Add an HTTP/HTTPS endpoint to start measuring response times and tracking incidents.
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
                              <div className="flex flex-col gap-1 items-start">
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

                                {m.openIncident && (
                                  <button
                                    onClick={() => setTimelineIncidentId(m.openIncident!.id)}
                                    className="inline-flex items-center gap-1 rounded bg-rose-900/60 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300 hover:bg-rose-900 border border-rose-700/60 transition-colors"
                                    title="View active incident timeline"
                                  >
                                    ⚠ Outage Active
                                  </button>
                                )}
                              </div>
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

                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-slate-300">
                                {m.lastCheckedAt ? new Date(m.lastCheckedAt).toLocaleTimeString() : "Never checked"}
                              </div>
                              <div className="text-[10px] text-slate-500 font-mono">
                                Interval: {m.intervalSeconds}s
                              </div>
                            </td>

                            <td className="px-6 py-4 whitespace-nowrap text-right space-x-2">
                              {m.isPublic && m.publicId ? (
                                <>
                                  <a
                                    href={`/status/${m.publicId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="rounded bg-emerald-950/80 border border-emerald-800 px-2 py-1 font-medium text-emerald-300 hover:bg-emerald-900 transition-colors inline-block text-[11px]"
                                    title="Open public status page"
                                  >
                                    Public ↗
                                  </a>
                                  <button
                                    onClick={() => handleCopyStatusLink(m.publicId!)}
                                    className="rounded bg-slate-800 px-2 py-1 font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors text-[11px]"
                                    title="Copy public status page link"
                                  >
                                    Copy Link
                                  </button>
                                  <button
                                    onClick={() => handleTogglePublication(m.id, true)}
                                    className="rounded px-1.5 py-1 text-slate-400 hover:text-rose-400 transition-colors text-[11px]"
                                    title="Disable public status page (make private)"
                                  >
                                    Unpublish
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => handleTogglePublication(m.id, false)}
                                  className="rounded bg-slate-800/80 border border-slate-700 px-2 py-1 font-medium text-slate-400 hover:text-white hover:bg-slate-700 transition-colors text-[11px]"
                                  title="Publish public status page"
                                >
                                  Publish
                                </button>
                              )}

                              <button
                                onClick={() => setAnalyticsTarget({ id: m.id, name: m.name })}
                                className="rounded bg-slate-800 px-2.5 py-1 font-medium text-indigo-300 hover:bg-slate-700 hover:text-white transition-colors"
                                title="View historical uptime and P95 latency"
                              >
                                Analytics
                              </button>
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
          </>
        ) : (
          /* Incidents View */
          <section className="rounded-xl border border-slate-800 bg-slate-900/40 shadow-sm overflow-hidden">
            <div className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white">Incident Tracking</h2>
                <p className="text-xs text-slate-400">
                  Automated outage detection, resolution tracking, and event timelines
                </p>
              </div>

              {/* Status filter buttons */}
              <div className="flex items-center gap-1.5 rounded-lg bg-slate-950 p-1 border border-slate-800">
                <button
                  onClick={() => setIncidentFilter("ALL")}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    incidentFilter === "ALL" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"
                  }`}
                >
                  All ({incidents.length})
                </button>
                <button
                  onClick={() => setIncidentFilter("OPEN")}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    incidentFilter === "OPEN" ? "bg-rose-950 text-rose-300 border border-rose-800" : "text-slate-400 hover:text-white"
                  }`}
                >
                  Open ({openIncidents.length})
                </button>
                <button
                  onClick={() => setIncidentFilter("RESOLVED")}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    incidentFilter === "RESOLVED" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"
                  }`}
                >
                  Resolved ({incidents.filter((i) => i.status === "RESOLVED").length})
                </button>
              </div>
            </div>

            {filteredIncidents.length === 0 ? (
              <div className="p-12 text-center text-xs text-slate-400">
                No {incidentFilter === "ALL" ? "" : incidentFilter.toLowerCase()} incidents recorded.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900/80 text-slate-400 uppercase tracking-wider border-b border-slate-800">
                    <tr>
                      <th className="px-6 py-3">Status</th>
                      <th className="px-6 py-3">Incident Title</th>
                      <th className="px-6 py-3">Affected Monitor</th>
                      <th className="px-6 py-3">Started</th>
                      <th className="px-6 py-3">Duration</th>
                      <th className="px-6 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filteredIncidents.map((inc) => (
                      <tr key={inc.id} className="hover:bg-slate-900/30 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          {inc.status === "OPEN" ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-950 px-2.5 py-1 font-semibold text-rose-400 border border-rose-800">
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse" />
                              OPEN
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-950 px-2.5 py-1 font-semibold text-emerald-400 border border-emerald-800">
                              ✓ RESOLVED
                            </span>
                          )}
                        </td>

                        <td className="px-6 py-4">
                          <div className="font-semibold text-white">{inc.title}</div>
                          {inc.cause && (
                            <div className="text-[11px] text-rose-400 max-w-sm truncate mt-0.5">
                              {inc.cause}
                            </div>
                          )}
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="font-medium text-slate-200">{inc.monitor.name}</div>
                          <div className="text-[11px] font-mono text-slate-400 max-w-xs truncate">
                            {inc.monitor.url}
                          </div>
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap text-slate-300">
                          <div>{new Date(inc.startedAt).toLocaleTimeString()}</div>
                          <div className="text-[10px] text-slate-500 font-mono">
                            {new Date(inc.startedAt).toLocaleDateString()}
                          </div>
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap font-mono text-slate-300">
                          {formatDuration(inc.durationSeconds)}
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <button
                            onClick={() => setTimelineIncidentId(inc.id)}
                            className="rounded bg-slate-800 px-3 py-1 font-medium text-indigo-300 hover:bg-slate-700 hover:text-white transition-colors"
                          >
                            Timeline ({inc.eventCount})
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
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

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="formIsPublic"
                  checked={formIsPublic}
                  onChange={(e) => setFormIsPublic(e.target.checked)}
                  className="rounded border-slate-800 bg-slate-950 text-emerald-600 focus:ring-emerald-500 h-4 w-4"
                />
                <label htmlFor="formIsPublic" className="text-xs text-slate-300 select-none cursor-pointer">
                  Publish public status page (opt-in; private by default)
                </label>
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

      {/* Analytics Modal */}
      {analyticsTarget && (
        <MonitorAnalyticsModal
          monitorId={analyticsTarget.id}
          monitorName={analyticsTarget.name}
          onClose={() => setAnalyticsTarget(null)}
        />
      )}

      {/* Incident Timeline Modal */}
      {timelineIncidentId && (
        <IncidentTimelineModal
          incidentId={timelineIncidentId}
          onClose={() => setTimelineIncidentId(null)}
          onIncidentUpdated={() => refreshAll()}
        />
      )}

      {/* Footer */}
      <footer className="border-t border-slate-800 py-6 text-center text-xs text-slate-500">
        Uptime Atlas • Precision Endpoint Monitoring & Incident Tracking Platform
      </footer>
    </div>
  );
}
