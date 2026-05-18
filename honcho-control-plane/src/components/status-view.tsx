"use client";

import { Activity, AlertCircle, CheckCircle2, Clock, Database } from "lucide-react";
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

  if (!status) return <div className="empty card">Loading live status...</div>;

  const observationSeries = status.series.observations.map((bucket) => ({
    date: String(bucket.date),
    explicit: Number(bucket.explicit ?? 0),
    inductive: Number(bucket.inductive ?? 0),
    deductive: Number(bucket.deductive ?? 0)
  }));

  return (
    <div>
      <div className="page-title">
        <div>
          <h1>Live Status</h1>
          <p>Queue progress, errors, and memory growth for this workspace.</p>
        </div>
      </div>

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
    </div>
  );
}
