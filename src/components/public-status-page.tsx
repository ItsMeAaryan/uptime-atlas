"use client";

import { useEffect, useState } from "react";
import type {
  PublicStatusPageData,
  PublicDailyUptime,
} from "@/lib/services/status-page-service";

interface Props {
  initialData: PublicStatusPageData;
  publicId: string;
}

export default function PublicStatusPage({ initialData, publicId }: Props) {
  const [data, setData] = useState<PublicStatusPageData>(initialData);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeWindow, setActiveWindow] = useState<"24h" | "7d" | "30d">("24h");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());
  const [selectedDay, setSelectedDay] = useState<PublicDailyUptime | null>(
    initialData.calendar?.days?.[initialData.calendar.days.length - 1] || null
  );

  async function refreshData() {
    setIsRefreshing(true);
    try {
      const res = await fetch(`/api/status/${publicId}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setData(json.data);
          setLastRefreshedAt(new Date());
          // Update selected day if it matches the current selection date
          if (selectedDay) {
            const updatedMatch = json.data.calendar?.days?.find(
              (d: PublicDailyUptime) => d.date === selectedDay.date
            );
            if (updatedMatch) setSelectedDay(updatedMatch);
          }
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

  function getBadgeColor(type: string): string {
    switch (type.toUpperCase()) {
      case "RESOLVED":
        return "bg-emerald-950 text-emerald-300 border-emerald-800";
      case "INVESTIGATING":
        return "bg-amber-950 text-amber-300 border-amber-800";
      case "IDENTIFIED":
        return "bg-indigo-950 text-indigo-300 border-indigo-800";
      case "MONITORING":
        return "bg-sky-950 text-sky-300 border-sky-800";
      case "DETECTED":
        return "bg-rose-950 text-rose-300 border-rose-800";
      default:
        return "bg-slate-800 text-slate-300 border-slate-700";
    }
  }

  function getDayColor(day: PublicDailyUptime): string {
    switch (day.status) {
      case "OPERATIONAL":
        return "bg-emerald-500 hover:bg-emerald-400";
      case "DEGRADED":
        return "bg-amber-500 hover:bg-amber-400";
      case "OUTAGE":
        return "bg-rose-500 hover:bg-rose-400";
      case "NO_DATA":
      default:
        return "bg-slate-800 hover:bg-slate-700";
    }
  }

  function formatDayDate(dateStr: string): string {
    const parts = dateStr.split("-").map(Number);
    if (parts.length === 3) {
      const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
    }
    return dateStr;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500/20">
      {/* Top Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 shadow-md shadow-emerald-950/40 font-bold text-white text-base">
              UA
            </div>
            <div>
              <h1 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                {data.name}
              </h1>
              <p className="text-[11px] text-slate-400 font-medium">Service Status Page</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[11px] text-slate-400 hidden sm:inline">
              Refreshed: {lastRefreshedAt.toLocaleTimeString()}
            </span>
            <button
              onClick={refreshData}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50"
              title="Refresh status data"
            >
              <span className={`h-2 w-2 rounded-full bg-emerald-400 ${isRefreshing ? "animate-ping" : ""}`} />
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Banner: Overall Operational State */}
        <section
          className={`rounded-2xl border p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xl ${
            isOperational
              ? "bg-emerald-950/30 border-emerald-800/80 shadow-emerald-950/20"
              : isDown
              ? "bg-rose-950/30 border-rose-800/80 shadow-rose-950/20"
              : "bg-amber-950/30 border-amber-800/80 shadow-amber-950/20"
          }`}
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span
                className={`relative flex h-3.5 w-3.5 rounded-full ${
                  isOperational
                    ? "bg-emerald-400"
                    : isDown
                    ? "bg-rose-500 animate-pulse"
                    : "bg-amber-400"
                }`}
              >
                <span
                  className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    isOperational
                      ? "animate-ping bg-emerald-400"
                      : isDown
                      ? "animate-ping bg-rose-400"
                      : "animate-ping bg-amber-400"
                  }`}
                />
              </span>
              <h2 className="text-xl font-bold text-white tracking-tight">
                {isOperational
                  ? "All Systems Operational"
                  : isDown
                  ? "Service Experiencing Outage"
                  : "Service State Degraded"}
              </h2>
            </div>
            <p className="text-xs text-slate-300">
              {isOperational
                ? "All monitored probes are responding normally with expected status codes."
                : isDown
                ? "Automated probes have detected service failures or open incidents are being investigated."
                : "Recent probe checks have reported elevated response latency or warnings."}
            </p>
          </div>

          <div className="flex sm:flex-col items-baseline sm:items-end justify-between border-t sm:border-t-0 border-slate-800/60 pt-3 sm:pt-0">
            <span className="text-[11px] text-slate-400">Current Health</span>
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${
                isOperational
                  ? "bg-emerald-950 text-emerald-300 border-emerald-800"
                  : isDown
                  ? "bg-rose-950 text-rose-300 border-rose-800"
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

        {/* 90-Day Historical Uptime Calendar Section */}
        {data.calendar && (
          <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-sm font-semibold text-white">90-Day Historical Uptime</h3>
                <p className="text-xs text-slate-400">
                  Daily availability calculated from recorded probes (evaluated in UTC)
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <span className="text-[11px] text-slate-400 block">90-Day Availability</span>
                  <span
                    className={`text-sm font-bold font-mono ${
                      data.calendar.overallUptimePercentage !== null
                        ? data.calendar.overallUptimePercentage >= 99
                          ? "text-emerald-400"
                          : data.calendar.overallUptimePercentage >= 95
                          ? "text-amber-400"
                          : "text-rose-400"
                        : "text-slate-500"
                    }`}
                  >
                    {data.calendar.overallUptimePercentage !== null
                      ? `${data.calendar.overallUptimePercentage.toFixed(2)}%`
                      : "No data"}
                  </span>
                </div>
              </div>
            </div>

            {/* Calendar Bars: 90 daily pills */}
            <div className="space-y-2">
              <div className="flex items-end gap-[3px] sm:gap-1 h-10 w-full overflow-x-auto py-1">
                {data.calendar.days.map((day) => {
                  const isSelected = selectedDay?.date === day.date;
                  return (
                    <button
                      key={day.date}
                      type="button"
                      onClick={() => setSelectedDay(day)}
                      title={`${formatDayDate(day.date)}: ${
                        day.uptimePercentage !== null
                          ? `${day.uptimePercentage.toFixed(2)}% uptime (${day.totalChecks} checks)`
                          : "No data recorded"
                      }`}
                      aria-label={`Inspect ${day.date}`}
                      className={`flex-1 min-w-[6px] h-8 rounded-sm transition-all duration-150 ${getDayColor(
                        day
                      )} ${
                        isSelected
                          ? "ring-2 ring-white scale-110 z-10"
                          : "opacity-90 hover:opacity-100 hover:scale-105"
                      }`}
                    />
                  );
                })}
              </div>

              {/* Range labels and legend */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 text-[11px] text-slate-500">
                <span className="font-mono">
                  {formatDayDate(data.calendar.periodStart)} (90 days ago)
                </span>

                {/* Legend */}
                <div className="flex items-center gap-3 self-center">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    <span>Operational</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-amber-500" />
                    <span>Degraded</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-rose-500" />
                    <span>Outage</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-slate-800 border border-slate-700" />
                    <span>No data</span>
                  </div>
                </div>

                <span className="font-mono text-right">
                  Today ({formatDayDate(data.calendar.periodEnd)})
                </span>
              </div>
            </div>

            {/* Selected Day Inspector Panel */}
            {selectedDay && (
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-4 space-y-3 transition-all">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/60 pb-3">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
                      Daily Inspection
                    </span>
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      {formatDayDate(selectedDay.date)}
                      <span className="text-[10px] text-slate-500 font-mono font-normal">
                        (00:00 - 23:59 UTC)
                      </span>
                    </h4>
                  </div>

                  <div>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                        selectedDay.status === "OPERATIONAL"
                          ? "bg-emerald-950 text-emerald-300 border-emerald-800"
                          : selectedDay.status === "DEGRADED"
                          ? "bg-amber-950 text-amber-300 border-amber-800"
                          : selectedDay.status === "OUTAGE"
                          ? "bg-rose-950 text-rose-300 border-rose-800"
                          : "bg-slate-900 text-slate-400 border-slate-800"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          selectedDay.status === "OPERATIONAL"
                            ? "bg-emerald-400"
                            : selectedDay.status === "DEGRADED"
                            ? "bg-amber-400"
                            : selectedDay.status === "OUTAGE"
                            ? "bg-rose-400"
                            : "bg-slate-500"
                        }`}
                      />
                      {selectedDay.status === "OPERATIONAL"
                        ? "100.00% Operational"
                        : selectedDay.status === "DEGRADED"
                        ? `${selectedDay.uptimePercentage?.toFixed(2)}% Degraded`
                        : selectedDay.status === "OUTAGE"
                        ? "0.00% Major Outage"
                        : "No Data Recorded"}
                    </span>
                  </div>
                </div>

                {/* Day stats grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="rounded bg-slate-900/60 border border-slate-800/80 p-2.5">
                    <span className="text-slate-400 block text-[10px] uppercase">Daily Availability</span>
                    <p className="text-base font-bold font-mono text-white mt-0.5">
                      {selectedDay.uptimePercentage !== null
                        ? `${selectedDay.uptimePercentage.toFixed(2)}%`
                        : "No data"}
                    </p>
                  </div>

                  <div className="rounded bg-slate-900/60 border border-slate-800/80 p-2.5">
                    <span className="text-slate-400 block text-[10px] uppercase">Recorded Probes</span>
                    <p className="text-base font-bold font-mono text-white mt-0.5">
                      {selectedDay.totalChecks}
                    </p>
                    <span className="text-[10px] text-slate-500 block">
                      {selectedDay.upChecks} UP / {selectedDay.downChecks} DOWN
                    </span>
                  </div>

                  <div className="rounded bg-slate-900/60 border border-slate-800/80 p-2.5">
                    <span className="text-slate-400 block text-[10px] uppercase">Avg Latency</span>
                    <p className="text-base font-bold font-mono text-white mt-0.5">
                      {selectedDay.avgResponseTimeMs !== null
                        ? `${selectedDay.avgResponseTimeMs} ms`
                        : "--"}
                    </p>
                  </div>

                  <div className="rounded bg-slate-900/60 border border-slate-800/80 p-2.5">
                    <span className="text-slate-400 block text-[10px] uppercase">Day Incidents</span>
                    <p
                      className={`text-base font-bold font-mono mt-0.5 ${
                        selectedDay.incidentCount > 0 ? "text-rose-400" : "text-emerald-400"
                      }`}
                    >
                      {selectedDay.incidentCount}
                    </p>
                  </div>
                </div>

                {/* Incidents associated with this day */}
                {selectedDay.incidents.length > 0 ? (
                  <div className="pt-2 border-t border-slate-800/60 space-y-2">
                    <span className="text-[11px] font-semibold text-rose-300 uppercase tracking-wider block">
                      Incidents On This Day ({selectedDay.incidents.length})
                    </span>
                    <div className="space-y-2">
                      {selectedDay.incidents.map((inc, incIdx) => (
                        <div
                          key={incIdx}
                          className="rounded border border-rose-950 bg-rose-950/20 p-2.5 text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-rose-200">{inc.title}</span>
                            <span className="text-[10px] text-slate-400">
                              Duration: {formatDuration(inc.durationSeconds)}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 flex flex-wrap gap-x-4">
                            <span>Started: {new Date(inc.startedAt).toUTCString()}</span>
                            {inc.resolvedAt && (
                              <span>Resolved: {new Date(inc.resolvedAt).toUTCString()}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500 italic pt-1">
                    No service disruptions or incidents were reported on this day.
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        {/* Reliability Analytics & Uptime Section */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Rolling Window Metrics</h3>
              <p className="text-xs text-slate-400">Probe availability and latency computed across rolling timeframes</p>
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
                        <h4 className="text-sm font-semibold text-white">{inc.title}</h4>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Started: {new Date(inc.startedAt).toLocaleString()}
                        {inc.resolvedAt && ` • Resolved: ${new Date(inc.resolvedAt).toLocaleString()}`}
                      </p>
                    </div>

                    <div className="text-left sm:text-right">
                      <span className="text-[11px] text-slate-400 block">Outage Duration</span>
                      <span className="text-xs font-mono font-semibold text-slate-200">
                        {formatDuration(inc.durationSeconds)}
                      </span>
                    </div>
                  </div>

                  {inc.events.length > 0 && (
                    <div className="border-t border-slate-800/80 pt-3 space-y-2">
                      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                        Timeline Updates
                      </span>
                      <div className="space-y-2">
                        {inc.events.map((event, eIdx) => (
                          <div
                            key={eIdx}
                            className="rounded bg-slate-900/60 border border-slate-800/60 p-2.5 text-xs space-y-1"
                          >
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
                            <p className="text-slate-300 text-xs leading-relaxed">{event.message}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-900/30 py-6 text-center text-xs text-slate-500">
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Powered by <strong>Uptime Atlas</strong></span>
          <span className="text-[11px]">Continuous Availability Monitoring & Reliability Analytics</span>
        </div>
      </footer>
    </div>
  );
}
