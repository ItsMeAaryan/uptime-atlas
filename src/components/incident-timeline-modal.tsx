"use client";

import { useEffect, useState } from "react";

interface IncidentEvent {
  id: string;
  incidentId: string;
  type: string;
  message: string;
  createdAt: string;
}

interface IncidentDetail {
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
  events: IncidentEvent[];
}

interface Props {
  incidentId: string;
  onClose: () => void;
  onIncidentUpdated?: () => void;
}

export default function IncidentTimelineModal({
  incidentId,
  onClose,
  onIncidentUpdated,
}: Props) {
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Note form state
  const [noteMessage, setNoteMessage] = useState("");
  const [noteType, setNoteType] = useState("NOTE");
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);
  const [isResolving, setIsResolving] = useState(false);

  async function loadIncident() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/incidents/${incidentId}`);
      const json = await res.json();
      if (json.success) {
        setIncident(json.data);
      } else {
        setError(json.error || "Failed to load incident.");
      }
    } catch {
      setError("Network error loading incident.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadIncident();
  }, [incidentId]);

  async function handleAddEvent(e: React.FormEvent) {
    e.preventDefault();
    if (!noteMessage.trim()) return;

    setIsSubmittingNote(true);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: noteMessage.trim(),
          type: noteType,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setNoteMessage("");
        await loadIncident();
        onIncidentUpdated?.();
      } else {
        alert(json.error || "Failed to post update.");
      }
    } catch {
      alert("Network error posting update.");
    } finally {
      setIsSubmittingNote(false);
    }
  }

  async function handleResolveManually() {
    if (!confirm("Are you sure you want to mark this incident as resolved?")) return;

    setIsResolving(true);
    try {
      const res = await fetch(`/api/incidents/${incidentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "RESOLVED",
          note: "Incident manually resolved by operator via dashboard.",
        }),
      });

      const json = await res.json();
      if (json.success) {
        await loadIncident();
        onIncidentUpdated?.();
      } else {
        alert(json.error || "Failed to resolve incident.");
      }
    } catch {
      alert("Network error resolving incident.");
    } finally {
      setIsResolving(false);
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

  function getTypeBadge(type: string) {
    const upper = type.toUpperCase();
    if (upper === "DETECTED") {
      return (
        <span className="rounded bg-rose-950 px-2 py-0.5 text-[10px] font-semibold text-rose-400 border border-rose-800">
          DETECTED
        </span>
      );
    }
    if (upper === "RESOLVED") {
      return (
        <span className="rounded bg-emerald-950 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-800">
          RESOLVED
        </span>
      );
    }
    if (upper === "INVESTIGATING") {
      return (
        <span className="rounded bg-amber-950 px-2 py-0.5 text-[10px] font-semibold text-amber-400 border border-amber-800">
          INVESTIGATING
        </span>
      );
    }
    if (upper === "IDENTIFIED") {
      return (
        <span className="rounded bg-purple-950 px-2 py-0.5 text-[10px] font-semibold text-purple-400 border border-purple-800">
          IDENTIFIED
        </span>
      );
    }
    return (
      <span className="rounded bg-indigo-950 px-2 py-0.5 text-[10px] font-semibold text-indigo-400 border border-indigo-800">
        {upper}
      </span>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border ${
                  incident?.status === "OPEN"
                    ? "bg-rose-950 text-rose-400 border-rose-800"
                    : "bg-emerald-950 text-emerald-400 border-emerald-800"
                }`}
              >
                {incident?.status === "OPEN" && (
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse" />
                )}
                {incident?.status || "Loading..."}
              </span>
              <h3 className="text-base font-semibold text-white">Incident Timeline</h3>
            </div>
            {incident && (
              <p className="text-xs text-slate-400 mt-1">
                Monitor: <span className="text-slate-200 font-medium">{incident.monitor.name}</span>
                <span className="mx-2 text-slate-600">•</span>
                <span className="font-mono text-slate-400">{incident.monitor.url}</span>
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {isLoading ? (
            <div className="py-12 text-center text-xs text-slate-400">Loading timeline...</div>
          ) : error ? (
            <div className="py-8 text-center text-xs text-rose-400">{error}</div>
          ) : incident ? (
            <>
              {/* Incident summary panel */}
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                <div className="font-semibold text-sm text-white">{incident.title}</div>
                {incident.cause && (
                  <div className="mt-1 text-xs text-rose-300 font-mono bg-rose-950/20 rounded p-2 border border-rose-900/30">
                    ⚠ {incident.cause}
                  </div>
                )}
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-800/80 pt-3 text-xs">
                  <div>
                    <span className="text-slate-500 block text-[10px]">Detected At</span>
                    <span className="text-slate-300 font-mono">
                      {new Date(incident.startedAt).toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Resolved At</span>
                    <span className="text-slate-300 font-mono">
                      {incident.resolvedAt ? new Date(incident.resolvedAt).toLocaleString() : "Still Open"}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Downtime Duration</span>
                    <span className="text-slate-300 font-mono font-semibold">
                      {formatDuration(incident.durationSeconds)}
                    </span>
                  </div>
                </div>

                {incident.status === "OPEN" && (
                  <div className="mt-4 pt-3 border-t border-slate-800 flex justify-end">
                    <button
                      onClick={handleResolveManually}
                      disabled={isResolving}
                      className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors disabled:opacity-50"
                    >
                      {isResolving ? "Resolving..." : "Mark Incident as Resolved"}
                    </button>
                  </div>
                )}
              </div>

              {/* Chronological Event Timeline */}
              <div>
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-4">
                  Timeline Events ({incident.events.length})
                </h4>

                {incident.events.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">No events recorded for this incident.</p>
                ) : (
                  <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                    {incident.events.map((event) => (
                      <div key={event.id} className="relative group">
                        {/* Dot marker */}
                        <div className="absolute -left-[19px] top-1 h-3 w-3 rounded-full border-2 border-slate-900 bg-emerald-500 group-first:bg-rose-500" />

                        <div className="rounded-lg border border-slate-800/80 bg-slate-950/40 p-3.5 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              {getTypeBadge(event.type)}
                              <span className="text-[11px] font-mono text-slate-500">
                                {new Date(event.createdAt).toLocaleTimeString()} •{" "}
                                {new Date(event.createdAt).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                          <p className="text-xs text-slate-200 leading-relaxed break-words">
                            {event.message}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add Operator Event / Note Form */}
              <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
                <h4 className="text-xs font-semibold text-slate-300 mb-3">Add Incident Timeline Update</h4>
                <form onSubmit={handleAddEvent} className="space-y-3">
                  <div className="flex gap-2">
                    <select
                      value={noteType}
                      onChange={(e) => setNoteType(e.target.value)}
                      className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="NOTE">NOTE</option>
                      <option value="INVESTIGATING">INVESTIGATING</option>
                      <option value="IDENTIFIED">IDENTIFIED</option>
                      <option value="MONITORING">MONITORING</option>
                      <option value="UPDATE">UPDATE</option>
                    </select>

                    <input
                      type="text"
                      required
                      placeholder="e.g. Investigating database failover in us-east-1..."
                      value={noteMessage}
                      onChange={(e) => setNoteMessage(e.target.value)}
                      className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                    />

                    <button
                      type="submit"
                      disabled={isSubmittingNote}
                      className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50"
                    >
                      {isSubmittingNote ? "Posting..." : "Post Note"}
                    </button>
                  </div>
                </form>
              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-slate-800 px-6 py-3.5 bg-slate-900/80">
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
