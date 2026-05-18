"use client";

import { Play, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { JsonPanel } from "./json-panel";

type Mode = "answer" | "trace" | "json";
type PeerOption = { id: string; label: string };

export function ReflectView({ workspaceId }: { workspaceId: string }) {
  const [query, setQuery] = useState("");
  const [observer, setObserver] = useState("");
  const [target, setTarget] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [reasoningLevel, setReasoningLevel] = useState("low");
  const [mode, setMode] = useState<Mode>("answer");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [peerOptions, setPeerOptions] = useState<PeerOption[]>([]);

  useEffect(() => {
    api
      .getMemories(workspaceId, { limit: 1, offset: 0 })
      .then((data) => {
        const peers = Array.from(
          new Set(data.peer_pairs.flatMap((pair) => [pair.observer, pair.observed]))
        )
          .sort((a, b) => a.localeCompare(b))
          .map((peer) => ({ id: peer, label: peer }));
        setPeerOptions(peers);
        setObserver((current) => current || peers[0]?.id || "");
      })
      .catch(() => setPeerOptions([]));
  }, [workspaceId]);

  const targetOptions = useMemo(
    () => [{ id: "", label: "target peer (optional)" }, ...peerOptions],
    [peerOptions]
  );

  async function runReflect() {
    if (!query.trim() || !observer.trim()) return;
    setLoading(true);
    setMode("answer");
    try {
      const response = await api.reflect(workspaceId, {
        query,
        observer,
        target: target || undefined,
        session_id: sessionId || undefined,
        reasoning_level: reasoningLevel
      });
      setResult(response);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h1>Reflect</h1>
          <p>Ask Honcho to answer using the selected workspace memory and peer perspective.</p>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <textarea className="textarea" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="What should I know about this peer?" />
          <div className="toolbar" style={{ marginTop: 12 }}>
            <select className="select peer-select" value={observer} onChange={(e) => setObserver(e.target.value)}>
              <option value="">observer peer</option>
              {peerOptions.map((peer) => (
                <option key={peer.id} value={peer.id}>{peer.label}</option>
              ))}
            </select>
            <select className="select peer-select" value={target} onChange={(e) => setTarget(e.target.value)}>
              {targetOptions.map((peer) => (
                <option key={peer.id || "none"} value={peer.id}>{peer.label}</option>
              ))}
            </select>
            <input className="input" value={sessionId} onChange={(e) => setSessionId(e.target.value)} placeholder="session (optional)" />
            <select className="select" value={reasoningLevel} onChange={(e) => setReasoningLevel(e.target.value)}>
              <option value="minimal">minimal</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="max">max</option>
            </select>
            <button className="button primary" onClick={runReflect} disabled={loading}>
              <Play size={16} /> {loading ? "Reflecting" : "Reflect"}
            </button>
          </div>
        </div>
      </div>

      <div className="tabs" style={{ marginTop: 18 }}>
        {(["answer", "trace", "json"] as Mode[]).map((item) => (
          <button key={item} className={`tab ${mode === item ? "active" : ""}`} onClick={() => setMode(item)}>
            {item}
          </button>
        ))}
      </div>

      {mode === "answer" && (
        <div className="card">
          <div className="card-body">
            {!result ? (
              <div className="empty">
                <div>
                  <Sparkles size={40} />
                  <h2>No reflection yet</h2>
                </div>
              </div>
            ) : (
              <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
                {String(result.answer ?? "")}
              </div>
            )}
          </div>
        </div>
      )}
      {mode === "trace" && (
        <JsonPanel
          value={{
            workspace_id: workspaceId,
            observer,
            target: target || observer,
            session_id: sessionId || null,
            reasoning_level: reasoningLevel,
            note: "Detailed agent tool trace is not exposed by the current Honcho dialectic API."
          }}
        />
      )}
      {mode === "json" && <JsonPanel value={result ?? {}} />}
    </div>
  );
}
