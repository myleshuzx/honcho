"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { RecallResult } from "@/lib/types";
import { JsonPanel } from "./json-panel";

export function RecallView({ workspaceId }: { workspaceId: string }) {
  const [query, setQuery] = useState("");
  const [observer, setObserver] = useState("");
  const [observed, setObserved] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [results, setResults] = useState<RecallResult[]>([]);
  const [raw, setRaw] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  async function runRecall() {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const response = await api.recall(workspaceId, {
        query,
        observer: observer || undefined,
        observed: observed || undefined,
        session_id: sessionId || undefined,
        limit: 30
      });
      setResults(response.results);
      setRaw(response);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h1>Recall</h1>
          <p>Search messages and observations with a unified ranked result set.</p>
        </div>
      </div>
      <div className="card">
        <div className="card-body">
          <div className="toolbar">
            <input className="input" style={{ flex: 1 }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search memory..." />
            <input className="input" value={observer} onChange={(e) => setObserver(e.target.value)} placeholder="observer" />
            <input className="input" value={observed} onChange={(e) => setObserved(e.target.value)} placeholder="observed / peer" />
            <input className="input" value={sessionId} onChange={(e) => setSessionId(e.target.value)} placeholder="session" />
            <button className="button primary" onClick={runRecall} disabled={loading}>
              <Search size={16} /> {loading ? "Searching" : "Recall"}
            </button>
          </div>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Ranked Results</h2>
            <p className="card-subtitle">Messages, explicit observations, inductions, and deductions.</p>
          </div>
          <div className="card-body">
            {results.length === 0 ? (
              <div className="empty">No results yet.</div>
            ) : (
              results.map((result) => (
                <div key={`${result.type}-${result.id}`} style={{ borderBottom: "1px solid var(--card-border)", padding: "12px 0" }}>
                  <div className="toolbar" style={{ marginBottom: 6 }}>
                    <span className={`pill ${result.type}`}>{result.type}</span>
                    <span className="muted">score {result.score.toFixed(3)}</span>
                    <span className="muted">rank {result.rank}</span>
                  </div>
                  <div>{String(result.item.content ?? "")}</div>
                  <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                    {String(result.item.session_id ?? "global")} · {String(result.item.peer_id ?? result.item.observed ?? "")}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        <JsonPanel value={raw ?? {}} />
      </div>
    </div>
  );
}
