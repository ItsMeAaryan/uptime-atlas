"use client";

import { useEffect, useState } from "react";
import { adminFetch } from "@/lib/api-client";

interface WindowMetrics {
  windowLabel: string;
  totalChecks: number;
  upChecks: number;
  downChecks: number;
  uptimePercentage: number | null;
  avgResponseTimeMs: number | null;
  p95ResponseTimeMs: number | null;
  totalIncidents: number;
  resolvedIncidents: number;
  meanTimeToResolutionSeconds: number | null;
}

interface MonitorAnalyticsData {
  monitor: { id: string; name: string };
  analytics: {
    monitorId: string;
    timestamp: string;
    limitationNotice: string;
    windows: {
      last24Hours: WindowMetrics;
      last7Days: WindowMetrics;
      last30Days: WindowMetrics;
    };
    activeIncident: {
      id: string;
      title: string;
      cause: string | null;
      startedAt: string;
      durationSecondsSoFar: number;
    } | null;
  };
}

interface Props {
  monitorId: string;
  monitorName: string;
  onClose: () => void;
}

export default function MonitorAnalyticsModal({ monitorId, monitorName, onClose }: Props) {
  const [data, setData] = useState<MonitorAnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"24h" | "7d" | "30d">("24h");

  useEffect(() => {
    let isMounted = true;
    async function loadAnalytics() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await adminFetch(`/api/monitors/${monitorId}/analytics`);
        const json = await res.json();
        if (json.success && isMounted) {
          setData(json.data);
        } else if (isMounted) {
          setError(json.error || "Failed to load analytics.");
        }
      } catch {
        if (isMounted) setError("Network error loading analytics.");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    loadAnalytics();
    return () => {
      isMounted = false;
    };
  }, [monitorId]);

  const selectedMetrics: WindowMetrics | null = data
    ? activeTab === "24h"
      ? data.analytics.windows.last24Hours
      : activeTab === "7d"
      ? data.analytics.windows.last7Days
      : data.analytics.windows.last30Days
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h3 className="text-base font-semibold text-white">Reliability Analytics</h3>
            <p className="text-xs text-slate-400 font-mono mt-0.5">{monitorName}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-xs text-slate-400">
            Calculating historical probe metrics and percentiles from PostgreSQL...
          </div>
        ) : error ? (
          <div className="py-8 text-center text-xs text-rose-400">{error}</div>
        ) : selectedMetrics ? (
          <div className="mt-4 space-y-5">
            {/* Window selector tabs */}
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
              <button
                onClick={() => setActiveTab("24h")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === "24h"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-800/80 text-slate-400 hover:text-white"
                }`}
              >
                Last 24 Hours
              </button>
              <button
                onClick={() => setActiveTab("7d")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === "7d"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-800/80 text-slate-400 hover:text-white"
                }`}
              >
                Last 7 Days
              </button>
              <button
                onClick={() => setActiveTab("30d")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === "30d"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-800/80 text-slate-400 hover:text-white"
                }`}
              >
                Last 30 Days
              </button>
            </div>

            {/* Metrics cards grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3.5">
                <span className="text-[11px] text-slate-400 uppercase tracking-wider">Uptime</span>
                {selectedMetrics.uptimePercentage !== null ? (
                  <p
                    className={`mt-1 text-xl font-bold font-mono ${
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
                  <p className="mt-1 text-xl font-bold font-mono text-slate-500">
                    No data
                  </p>
                )}
                <span className="text-[10px] text-slate-500">
                  {selectedMetrics.totalChecks > 0
                    ? `${selectedMetrics.upChecks} / ${selectedMetrics.totalChecks} checks`
                    : "0 checks recorded"}
                </span>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3.5">
                <span className="text-[11px] text-slate-400 uppercase tracking-wider">Avg Latency</span>
                <p className="mt-1 text-xl font-bold font-mono text-white">
                  {selectedMetrics.avgResponseTimeMs !== null ? `${selectedMetrics.avgResponseTimeMs} ms` : "--"}
                </p>
                <span className="text-[10px] text-slate-500">Arithmetic mean</span>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3.5">
                <span className="text-[11px] text-slate-400 uppercase tracking-wider">P95 Latency</span>
                <p className="mt-1 text-xl font-bold font-mono text-indigo-400">
                  {selectedMetrics.p95ResponseTimeMs !== null ? `${selectedMetrics.p95ResponseTimeMs} ms` : "--"}
                </p>
                <span className="text-[10px] text-slate-500">95th percentile</span>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3.5">
                <span className="text-[11px] text-slate-400 uppercase tracking-wider">MTTR</span>
                <p className="mt-1 text-xl font-bold font-mono text-slate-200">
                  {selectedMetrics.meanTimeToResolutionSeconds !== null
                    ? `${selectedMetrics.meanTimeToResolutionSeconds}s`
                    : "--"}
                </p>
                <span className="text-[10px] text-slate-500">
                  {selectedMetrics.resolvedIncidents} resolved outage(s)
                </span>
              </div>
            </div>

            {/* Check Breakdown */}
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
              <h4 className="text-xs font-semibold text-slate-300 mb-2">Probe Breakdown ({selectedMetrics.windowLabel})</h4>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded bg-slate-900 p-2">
                  <span className="text-slate-400 block text-[10px]">Total Probes</span>
                  <span className="font-mono font-bold text-white text-sm">{selectedMetrics.totalChecks}</span>
                </div>
                <div className="rounded bg-emerald-950/40 border border-emerald-900/50 p-2">
                  <span className="text-emerald-400 block text-[10px]">Successful (UP)</span>
                  <span className="font-mono font-bold text-emerald-400 text-sm">{selectedMetrics.upChecks}</span>
                </div>
                <div className="rounded bg-rose-950/40 border border-rose-900/50 p-2">
                  <span className="text-rose-400 block text-[10px]">Failed (DOWN)</span>
                  <span className="font-mono font-bold text-rose-400 text-sm">{selectedMetrics.downChecks}</span>
                </div>
              </div>
            </div>

            {/* Disclaimer / Limitations note */}
            <div className="rounded-lg border border-slate-800/80 bg-slate-950/80 p-3 text-[11px] text-slate-400 leading-relaxed">
              <span className="font-semibold text-slate-300 block mb-0.5">ℹ Methodology & Limitations</span>
              {data?.analytics.limitationNotice}
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex justify-end border-t border-slate-800 pt-4">
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
