"use client";

import { useEffect, useState } from "react";
import type { PublicStatusPageData } from "@/lib/services/status-page-service";

interface Props {
  initialData: PublicStatusPageData;
  publicId: string;
}

export default function PublicStatusPage({ initialData, publicId }: Props) {
  const [data, setData] = useState<PublicStatusPageData>(initialData);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeWindow, setActiveWindow] = useState<"24h" | "7d" | "30d">("24h");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());

  async function refreshData() {
    setIsRefreshing(true);
    try {
      const res = await fetch(`/api/status/${publicId}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setData(json.data);
          setLastRefreshedAt(new Date());
        }
      }
    } catch {
      // Ignore background refresh network error
    } finally {
      setIsRefreshing(false);
    }
  }

  // Poll for updates every 30 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      refreshData();
    }, 30000);
    return () => clearInterval(timer);
  }, [publicId]);

  const selectedMetrics =
    activeWindow === "24h"
      ? data.analytics.windows.last24Hours
      : activeWindow === "7d"
      ? data.analytics.windows.last7Days
      : data.analytics.windows.last30Days;

  const isOperational = data.currentStatus === "UP" && data.activeIncidents.length === 0;
  const isDown = data.currentStatus === "DOWN" || data.activeIncidents.length > 0;

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

  function getBadgeColor(type: string) {
    const upper = type.toUpperCase();
    if (upper === "DETECTED") return "bg-rose-950 text-rose-300 border-rose-800";
    if (upper === "RESOLVED") return "bg-emerald-950 text-emerald-300 border-emerald-800";
    if (upper === "INVESTIGATING") return "bg-amber-950 text-amber-300 border-amber-800";
    if (upper === "IDENTIFIED") return "bg-purple-950 text-purple-300 border-purple-800";
    return "bg-indigo-950 text-indigo-300 border-indigo-800";
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-30">
        <div className="mx-auto max-w-4xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold text-sm">
              ▲
            </div>
            <div>
              <h1 className="text-base font-semibold text-white tracking-tight">{data.name}</h1>
              <span className="text-[11px] text-slate-400">System Status & Reliability Report</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[11px] text-slate-500 hidden sm:inline">
              Updated {lastRefreshedAt.toLocaleTimeString()}
            </span>
            <button
              onClick={() => refreshData()}
              disabled={isRefreshing}
              className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-1 text-xs text-slate-300 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              {isRefreshing ? "Refreshing..." : "↻ Refresh"}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8 space-y-8">
        {/* Overall System Banner */}
        <section
          className={`rounded-2xl border p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
            isOperational
              ? "border-emerald-900/60 bg-emerald-950/20"
              : isDown
              ? "border-rose-900/60 bg-rose-950/20"
              : "border-amber-900/60 bg-amber-950/20"
          }`}
        >
          <div className="flex items-center gap-4">
            <span
              className={`flex h-12 w-12 items-center justify-center rounded-xl text-2xl font-bold ${
                isOperational
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                  : isDown
                  ? "bg-rose-500/10 text-rose-400 border border-rose-500/30 animate-pulse"
                  : "bg-amber-500/10 text-amber-400 border border-amber-500/30"
              }`}
            >
              {isOperational ? "✓" : isDown ? "⚠" : "○"}
            </span>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">
                {isOperational
                  ? "All Systems Operational"
                  : isDown
                  ? "Service Outage / Disruption Detected"
                  : "Status Pending"}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {data.lastCheckedAt
                  ? `Last verified probe: ${new Date(data.lastCheckedAt).toLocaleString()}`
                  : "Awaiting initial probe result"}
              </p>
            </div>
          </div>

          <div className="sm:text-right">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border ${
                isOperational
                  ? "bg-emerald-950 text-emerald-400 border-emerald-800"
                  : isDown
                  ? "bg-rose-950 text-rose-400 border-rose-800"
                  : "bg-amber-950 text-amber-400 border-amber-800"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  isOperational
                    ? "bg-emerald-400"
                    : isDown
                    ? "bg-rose-400 animate-pulse"
                    : "bg-amber-400"
                }`}
              />
              {data.currentStatus}
            </span>
          </div>
        </section>

        {/* Active Incidents Section */}
        {data.activeIncidents.length > 0 && (
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-rose-400 uppercase tracking-wider flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-rose-500 animate-ping" />
              Active Incident ({data.activeIncidents.length})
            </h3>

            {data.activeIncidents.map((incident, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-rose-900/60 bg-rose-950/20 p-5 space-y-4 shadow-lg"
              >
                <div>
                  <h4 className="text-base font-semibold text-rose-200">{incident.title}</h4>
                  <p className="text-xs text-rose-300/80 mt-1">
                    Started at {new Date(incident.startedAt).toLocaleString()}
                  </p>
                </div>

                {/* Timeline Events */}
                {incident.events.length > 0 && (
                  <div className="space-y-3 border-t border-rose-900/40 pt-4">
                    <span className="text-xs font-semibold text-rose-300 uppercase tracking-wider block">
                      Incident Timeline Updates
                    </span>
                    <div className="relative pl-5 space-y-3 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-rose-900/50">
                      {incident.events.map((event, eIdx) => (
                        <div key={eIdx} className="relative">
                          <div className="absolute -left-[17px] top-1 h-2.5 w-2.5 rounded-full bg-rose-500" />
                          <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3 space-y-1">
                            <div className="flex items-center gap-2">
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold border ${getBadgeColor(
                                  event.type
                                )}`}
                              >
                                {event.type}
                              </span>
                              <span className="text-[11px] font-mono text-slate-500">
                                {new Date(event.createdAt).toLocaleTimeString()}
                              </span>
                            </div>
                            <p className="text-xs text-slate-200 leading-relaxed">{event.message}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </section>
        )}

        {/* Reliability Analytics & Uptime Section */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Historical Reliability & Latency</h3>
              <p className="text-xs text-slate-400">Database-recorded probe metrics across rolling windows</p>
            </div>

            {/* Window selector */}
            <div className="flex items-center gap-1.5 rounded-lg bg-slate-950 p-1 border border-slate-800">
              <button
                onClick={() => setActiveWindow("24h")}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  activeWindow === "24h"
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                24 Hours
              </button>
              <button
                onClick={() => setActiveWindow("7d")}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  activeWindow === "7d"
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                7 Days
              </button>
              <button
                onClick={() => setActiveWindow("30d")}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  activeWindow === "30d"
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                30 Days
              </button>
            </div>
          </div>

          {/* Metric Cards Grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
              <span className="text-[11px] text-slate-400 uppercase tracking-wider block">Uptime</span>
              {selectedMetrics.uptimePercentage !== null ? (
                <p
                  className={`mt-1 text-2xl font-bold font-mono ${
                    selectedMetrics.uptimePercentage >= 99
                      ? "text-emerald-400"
                      : selectedMetrics.uptimePercentage >= 95
                      ? "text-amber-400"
                      : "text-rose-400"
                  }`}
                >
                  {selectedMetrics.uptimePercentage.toFixed(2)}%
                </p>
              ) : (
                <p className="mt-1 text-2xl font-bold font-mono text-slate-500">No data</p>
              )}
              <span className="text-[10px] text-slate-500 mt-0.5 block">
                {selectedMetrics.totalChecks > 0
                  ? `${selectedMetrics.totalChecks} checks recorded`
                  : "0 checks recorded"}
              </span>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
              <span className="text-[11px] text-slate-400 uppercase tracking-wider block">Avg Latency</span>
              <p className="mt-1 text-2xl font-bold font-mono text-white">
                {selectedMetrics.avgResponseTimeMs !== null ? `${selectedMetrics.avgResponseTimeMs} ms` : "--"}
              </p>
              <span className="text-[10px] text-slate-500 mt-0.5 block">Arithmetic mean</span>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
              <span className="text-[11px] text-slate-400 uppercase tracking-wider block">P95 Latency</span>
              <p className="mt-1 text-2xl font-bold font-mono text-indigo-400">
                {selectedMetrics.p95ResponseTimeMs !== null ? `${selectedMetrics.p95ResponseTimeMs} ms` : "--"}
              </p>
              <span className="text-[10px] text-slate-500 mt-0.5 block">95th percentile</span>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
              <span className="text-[11px] text-slate-400 uppercase tracking-wider block">Total Probes</span>
              <p className="mt-1 text-2xl font-bold font-mono text-slate-200">{selectedMetrics.totalChecks}</p>
              <span className="text-[10px] text-slate-500 mt-0.5 block">
                Window: {activeWindow === "24h" ? "24 Hours" : activeWindow === "7d" ? "7 Days" : "30 Days"}
              </span>
            </div>
          </div>

          {/* Methodology Disclaimer */}
          <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-3 text-[11px] text-slate-400 leading-relaxed">
            <span className="font-semibold text-slate-300 block mb-0.5">ℹ Methodology & Limitations</span>
            {data.analytics.limitationNotice}
          </div>
        </section>

        {/* Resolved Incident History */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-white">Incident History</h3>
            <p className="text-xs text-slate-400">Past service disruptions and resolution records</p>
          </div>

          {data.resolvedIncidents.length === 0 ? (
            <div className="rounded-lg border border-slate-800/80 bg-slate-950/40 p-8 text-center">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-950/60 text-emerald-400 border border-emerald-800 mb-2">
                ✓
              </div>
              <p className="text-xs font-semibold text-slate-200">No Incidents Reported</p>
              <p className="text-[11px] text-slate-500 mt-1 max-w-sm mx-auto">
                No service disruptions or outages have been recorded in the past 30 days.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {data.resolvedIncidents.map((inc, iIdx) => (
                <div
                  key={iIdx}
                  className="rounded-lg border border-slate-800 bg-slate-950/40 p-4 space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-emerald-950 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-800">
                          RESOLVED
                        </span>
                        <h4 className="text-xs font-semibold text-white">{inc.title}</h4>
                      </div>
                      <p className="text-[11px] font-mono text-slate-500 mt-1">
                        Started: {new Date(inc.startedAt).toLocaleString()} • Resolved:{" "}
                        {inc.resolvedAt ? new Date(inc.resolvedAt).toLocaleString() : "--"}
                      </p>
                    </div>

                    <div className="text-left sm:text-right">
                      <span className="text-[10px] text-slate-500 block">Downtime</span>
                      <span className="text-xs font-mono font-semibold text-slate-300">
                        {formatDuration(inc.durationSeconds)}
                      </span>
                    </div>
                  </div>

                  {inc.events.length > 0 && (
                    <div className="border-t border-slate-800/80 pt-2.5 space-y-2">
                      {inc.events.map((evt, eIdx) => (
                        <div key={eIdx} className="text-[11px] flex items-start gap-2">
                          <span
                            className={`rounded px-1.5 py-0.2 text-[9px] font-semibold border ${getBadgeColor(
                              evt.type
                            )}`}
                          >
                            {evt.type}
                          </span>
                          <span className="text-slate-300 leading-relaxed">{evt.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-6 text-center text-xs text-slate-500">
        Powered by{" "}
        <a href="/" className="font-semibold text-slate-400 hover:text-white transition-colors">
          Uptime Atlas
        </a>{" "}
        • Precision Endpoint Monitoring & Status Reporting
      </footer>
    </div>
  );
}
