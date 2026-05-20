"use client";

import { Activity, AlertCircle, Brain, CheckCircle2, Clock, Database } from "lucide-react";
import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import type { StatusResponse } from "@/lib/types";
import { JsonPanel } from "./json-panel";

function Metric({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Database }) {
  return (
    <div className="card">
      <div className="card-body metric">
        <div className="metric-icon"><Icon size={17} /></div>
        <div>
          <div className="metric-label">{label}</div>
          <div className="metric-value">{value.toLocaleString()}</div>
        </div>
      </div>
    </div>
  );
}

export function StatusView({ workspaceId }: { workspaceId: string }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [peerOptions, setPeerOptions] = useState<string[]>([]);
  const [observer, setObserver] = useState("");
  const [observed, setObserved] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [dreamType, setDreamType] = useState("omni");
  const [schedulingDream, setSchedulingDream] = useState(false);
  const [dreamMessage, setDreamMessage] = useState<string | null>(null);
  const [dreamError, setDreamError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      const response = await api.getStatus(workspaceId);
      if (active) setStatus(response);
    }
    load();
    const timer = window.setInterval(load, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [workspaceId]);

  useEffect(() => {
    api
      .getMemories(workspaceId, { limit: 1, offset: 0 })
      .then((response) => {
        const peers = Array.from(
          new Set(response.peer_pairs.flatMap((pair) => [pair.observer, pair.observed]))
        ).sort((a, b) => a.localeCompare(b));
        setPeerOptions(peers);
        setObserver((current) => current || peers[0] || "");
        setObserved((current) => current || peers[0] || "");
      })
      .catch(() => setPeerOptions([]));
  }, [workspaceId]);

  async function scheduleDream() {
    if (!observer.trim()) return;

    setSchedulingDream(true);
    setDreamMessage(null);
    setDreamError(null);
    try {
      await api.scheduleDream(workspaceId, {
        observer: observer.trim(),
        observed: observed.trim() || undefined,
        session_id: sessionId.trim() || undefined,
        dream_type: dreamType
      });
      setDreamMessage("Dream queued.");
      const response = await api.getStatus(workspaceId);
      setStatus(response);
    } catch (err) {
      setDreamError(String(err));
    } finally {
      setSchedulingDream(false);
    }
  }

  const observationSeries = status ? status.series.observations.map((bucket) => ({
    date: String(bucket.date),
    explicit: Number(bucket.explicit ?? 0),
    inductive: Number(bucket.inductive ?? 0),
    deductive: Number(bucket.deductive ?? 0)
  })) : [];
  const peerListId = `dream-peer-options-${workspaceId.replace(/[^A-Za-z0-9_-]/g, "-")}`;

  return (
    <div>
      <div className="page-title">
        <div>
          <h1>Live Status</h1>
          <p>Queue progress, errors, and memory growth for this workspace.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h2 className="card-title">Manual Dream</h2>
          <p className="card-subtitle">Queue an immediate dream task for a peer pair.</p>
        </div>
        <div className="card-body">
          <div className="toolbar">
            <input
              className="input"
              list={peerListId}
              value={observer}
              onChange={(event) => setObserver(event.target.value)}
              placeholder="observer"
            />
            <input
              className="input"
              list={peerListId}
              value={observed}
              onChange={(event) => setObserved(event.target.value)}
              placeholder="observed defaults to observer"
            />
            <datalist id={peerListId}>
              {peerOptions.map((peer) => (
                <option key={peer} value={peer} />
              ))}
            </datalist>
            <input
              className="input"
              value={sessionId}
              onChange={(event) => setSessionId(event.target.value)}
              placeholder="session id (optional)"
            />
            <select className="select" value={dreamType} onChange={(event) => setDreamType(event.target.value)}>
              <option value="omni">omni</option>
            </select>
            <button className="button primary" onClick={scheduleDream} disabled={!observer || schedulingDream}>
              <Brain size={16} /> {schedulingDream ? "Queueing" : "Trigger Dream"}
            </button>
          </div>
          {dreamMessage && <div className="muted">{dreamMessage}</div>}
          {dreamError && <div className="error-text">{dreamError}</div>}
        </div>
      </div>

      {!status ? (
        <div className="empty card">Loading live status...</div>
      ) : (
        <>
          <div className="grid cols-4">
            <Metric label="Sessions" value={status.counts.sessions} icon={Database} />
            <Metric label="Peers" value={status.counts.peers} icon={Activity} />
            <Metric label="Messages" value={status.counts.messages} icon={Clock} />
            <Metric label="Observations" value={status.counts.observations} icon={CheckCircle2} />
          </div>

          <div className="grid cols-2" style={{ marginTop: 16 }}>
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Message Growth</h2>
              </div>
              <div className="card-body" style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={status.series.messages}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Area dataKey="messages" stroke="#009296" fill="#e0f7f7" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Observation Growth</h2>
              </div>
              <div className="card-body" style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={observationSeries}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Area dataKey="explicit" stackId="1" stroke="#009296" fill="#e0f7f7" />
                    <Area dataKey="inductive" stackId="1" stroke="#7c3aed" fill="#ede9fe" />
                    <Area dataKey="deductive" stackId="1" stroke="#2563eb" fill="#dbeafe" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="grid cols-2" style={{ marginTop: 16 }}>
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Queue</h2>
                <p className="card-subtitle">Grouped by Honcho task type.</p>
              </div>
              <div className="card-body">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Total</th>
                        <th>Completed</th>
                        <th>Pending</th>
                        <th>Errors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(status.queue_by_type).map(([type, row]) => (
                        <tr key={type}>
                          <td>{type}</td>
                          <td>{row.total}</td>
                          <td>{row.completed}</td>
                          <td>{row.pending}</td>
                          <td>{row.errors}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Recent Errors</h2>
              </div>
              <div className="card-body">
                {status.errors.length === 0 ? (
                  <div className="empty">
                    <div>
                      <AlertCircle size={36} />
                      <p>No queue errors found.</p>
                    </div>
                  </div>
                ) : (
                  <JsonPanel value={status.errors} />
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
