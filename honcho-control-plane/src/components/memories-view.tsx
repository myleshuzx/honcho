"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type {
  MemoriesResponse,
  Observation,
  ObservationLevel,
  PeerCardResponse,
  PeerPair,
  RepresentationResponse,
  SessionInfo,
  SessionSummaries,
  SourceMessage
} from "@/lib/types";
import { JsonPanel } from "./json-panel";

type Tab = "sessions" | "representation" | "observations" | "summary" | "peer-card";
type ObservationTab = ObservationLevel;

const levels: ObservationTab[] = ["explicit", "inductive", "deductive", "contradiction"];
const PAGE_SIZE = 500;

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "Unknown";
}

function ObservationTable({ observations }: { observations: Observation[] }) {
  if (observations.length === 0) {
    return <div className="empty card">No observations found.</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Observation</th>
            <th>Pair</th>
            <th>Session</th>
            <th>Derived</th>
            <th>Created</th>
            <th>Source time</th>
          </tr>
        </thead>
        <tbody>
          {observations.map((observation) => (
            <tr key={observation.id}>
              <td>
                <span className={`pill ${observation.level}`}>{observation.level}</span>
                <div style={{ marginTop: 8 }}>{observation.content}</div>
                {observation.source_ids.length > 0 && (
                  <div className="muted" style={{ marginTop: 6 }}>
                    sources {observation.source_ids.map((id) => <span className="code" key={id}>{id}</span>)}
                  </div>
                )}
              </td>
              <td>{observation.observer} &rarr; {observation.observed}</td>
              <td>{observation.session_id ?? "global"}</td>
              <td>{observation.times_derived}</td>
              <td>{formatDate(observation.created_at)}</td>
              <td>{formatDate(observation.source_created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DeductiveTable({
  observations,
  selected,
  onSelect
}: {
  observations: Observation[];
  selected: Observation | null;
  onSelect: (observation: Observation) => void;
}) {
  if (observations.length === 0) {
    return <div className="empty card">No deductive observations found on this page.</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Deduction</th>
            <th>Sources</th>
            <th>Session</th>
            <th>Created</th>
            <th>Source time</th>
          </tr>
        </thead>
        <tbody>
          {observations.map((observation) => (
            <tr
              key={observation.id}
              onClick={() => onSelect(observation)}
              style={{
                cursor: "pointer",
                background: selected?.id === observation.id ? "var(--primary-soft)" : undefined
              }}
            >
              <td>
                <span className="pill deductive">deductive</span>
                <div style={{ marginTop: 8 }}>{observation.content}</div>
              </td>
              <td>{observation.source_ids.length}</td>
              <td>{observation.session_id ?? "global"}</td>
              <td>{formatDate(observation.created_at)}</td>
              <td>{formatDate(observation.source_created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DeductionDetail({
  observation,
  sources,
  sourceMessages
}: {
  observation: Observation | null;
  sources: Record<string, Observation>;
  sourceMessages: Record<string, SourceMessage[]>;
}) {
  if (!observation) {
    return <div className="empty card">Select a deductive observation to inspect its sources.</div>;
  }

  const sourceRows = observation.source_ids.map((id) => sources[id]).filter(Boolean);
  const messageRows = observation.source_ids.flatMap((sourceId) =>
    (sourceMessages[sourceId] ?? []).map((message) => ({
      ...message,
      sourceId
    }))
  );

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Deduction Sources</h2>
        <p className="card-subtitle">
          Created {formatDate(observation.created_at)} · source time {formatDate(observation.source_created_at)}
        </p>
      </div>
      <div className="card-body">
        <div style={{ marginBottom: 16, lineHeight: 1.6 }}>{observation.content}</div>
        {sourceRows.length === 0 ? (
          <div className="muted">
            This deduction references {observation.source_ids.length} source id(s), but none are loaded in the current response.
          </div>
        ) : (
          <div className="grid">
            {messageRows.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Message</th>
                      <th>Peer</th>
                      <th>Session</th>
                      <th>Message time</th>
                      <th>Source observation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {messageRows.map((message) => (
                      <tr key={`${message.sourceId}-${message.internal_id}`}>
                        <td>
                          <div>{message.content}</div>
                          <div className="code" style={{ marginTop: 6, display: "inline-block" }}>{message.id}</div>
                        </td>
                        <td>{message.peer_id}</td>
                        <td>{message.session_id}</td>
                        <td>{formatDate(message.created_at)}</td>
                        <td><span className="code">{message.sourceId}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="muted">No source messages are linked to these source observations.</div>
            )}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Source observation</th>
                    <th>Level</th>
                    <th>Created</th>
                    <th>Source time</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceRows.map((source) => (
                    <tr key={source.id}>
                      <td>
                        <div>{source.content}</div>
                        <div className="code" style={{ marginTop: 6, display: "inline-block" }}>{source.id}</div>
                      </td>
                      <td><span className={`pill ${source.level}`}>{source.level}</span></td>
                      <td>{formatDate(source.created_at)}</td>
                      <td>{formatDate(source.source_created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Timeline({ observations }: { observations: Observation[] }) {
  if (observations.length === 0) return <div className="empty card">No timeline data.</div>;
  return (
    <div className="card">
      <div className="card-body timeline">
        {observations.map((observation) => (
          <div className="timeline-item" key={observation.id}>
            <div className="muted" style={{ fontSize: 12 }}>{formatDate(observation.created_at)}</div>
            {observation.source_created_at && observation.source_created_at !== observation.created_at && (
              <div className="muted" style={{ fontSize: 12 }}>
                source {formatDate(observation.source_created_at)}
              </div>
            )}
            <div style={{ marginTop: 4 }}>{observation.content}</div>
            <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
              {observation.observer} &rarr; {observation.observed}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SummaryCard({ title, value }: { title: string; value: Record<string, unknown> | null }) {
  const content = typeof value?.content === "string" ? value.content : null;
  const createdAt = typeof value?.created_at === "string" ? value.created_at : null;
  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">{title}</h2>
        {createdAt && <p className="card-subtitle">Created {formatDate(createdAt)}</p>}
      </div>
      <div className="card-body">
        {content ? (
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.65 }}>{content}</div>
        ) : (
          <div className="muted">No {title.toLowerCase()} available.</div>
        )}
      </div>
    </div>
  );
}

function PeerPairSelector({
  pairs,
  selected,
  onSelect
}: {
  pairs: PeerPair[];
  selected: PeerPair | null;
  onSelect: (pair: PeerPair) => void;
}) {
  return (
    <div className="toolbar">
      {pairs.map((pair) => (
        <button
          key={pair.id}
          className={`button ${selected?.id === pair.id ? "primary" : ""}`}
          onClick={() => onSelect(pair)}
        >
          {pair.observer} &rarr; {pair.observed}
        </button>
      ))}
    </div>
  );
}

export function MemoriesView({ workspaceId }: { workspaceId: string }) {
  const [tab, setTab] = useState<Tab>("observations");
  const [observationTab, setObservationTab] = useState<ObservationTab>("explicit");
  const [data, setData] = useState<MemoriesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  const [sessionSummaries, setSessionSummaries] = useState<SessionSummaries | null>(null);
  const [selectedPair, setSelectedPair] = useState<PeerPair | null>(null);
  const [representation, setRepresentation] = useState<RepresentationResponse | null>(null);
  const [peerCard, setPeerCard] = useState<PeerCardResponse | null>(null);
  const [selectedDeduction, setSelectedDeduction] = useState<Observation | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getMemories(workspaceId, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
      .then(setData)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [workspaceId, page]);

  useEffect(() => {
    setSelectedDeduction(null);
  }, [page, observationTab]);

  const currentObservations = data?.observations[observationTab] ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.pagination.total / data.pagination.limit)) : 1;
  const pageStart = data && data.pagination.total > 0 ? data.pagination.offset + 1 : 0;
  const pageEnd = data
    ? Math.min(data.pagination.offset + data.pagination.limit, data.pagination.total)
    : 0;

  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  function jumpToPage() {
    const parsed = Number.parseInt(pageInput, 10);
    if (!Number.isFinite(parsed)) return;
    setPage(Math.min(Math.max(parsed, 1), totalPages));
  }

  useEffect(() => {
    if (!data) return;
    setSelectedSession((current) => current ?? data.sessions[0] ?? null);
    setSelectedPair((current) => current ?? data.peer_pairs[0] ?? null);
  }, [data]);

  useEffect(() => {
    if (!selectedSession) {
      setSessionSummaries(null);
      return;
    }
    api
      .getSessionSummaries(workspaceId, selectedSession.id)
      .then(setSessionSummaries)
      .catch(() => setSessionSummaries(null));
  }, [workspaceId, selectedSession]);

  useEffect(() => {
    if (!selectedPair) {
      setRepresentation(null);
      setPeerCard(null);
      return;
    }
    api
      .getRepresentation(workspaceId, selectedPair.observer, selectedPair.observed)
      .then(setRepresentation)
      .catch(() => setRepresentation(null));
    api
      .getPeerCard(workspaceId, selectedPair.observer, selectedPair.observed)
      .then(setPeerCard)
      .catch(() => setPeerCard(null));
  }, [workspaceId, selectedPair]);

  return (
    <div>
      <div className="page-title">
        <div>
          <h1>Memories</h1>
          <p>Explore sessions, representations, observations, summaries, and peer cards.</p>
        </div>
      </div>

      <div className="tabs">
        {(["sessions", "representation", "observations", "summary", "peer-card"] as Tab[]).map((item) => (
          <button key={item} className={`tab ${tab === item ? "active" : ""}`} onClick={() => setTab(item)}>
            {item.replace("-", " ")}
          </button>
        ))}
      </div>

      {loading && <div className="empty card">Loading memories...</div>}
      {error && <div className="empty card">{error}</div>}
      {data && tab === "sessions" && (
        <div className="grid cols-2">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.map((session) => (
                  <tr
                    key={session.id}
                    onClick={() => setSelectedSession(session)}
                    style={{ cursor: "pointer", background: selectedSession?.id === session.id ? "var(--primary-soft)" : undefined }}
                  >
                    <td>{session.name}</td>
                    <td><span className="pill">{session.is_active ? "active" : "inactive"}</span></td>
                    <td>{formatDate(session.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid">
            <SummaryCard title="Short Summary" value={sessionSummaries?.short_summary ?? null} />
            <SummaryCard title="Long Summary" value={sessionSummaries?.long_summary ?? null} />
          </div>
        </div>
      )}

      {data && tab === "observations" && (
        <div>
          <div className="tabs">
            {levels.map((level) => (
              <button
                key={level}
                className={`tab ${observationTab === level ? "active" : ""}`}
                onClick={() => setObservationTab(level)}
              >
                {level} ({data.observation_counts[level] ?? 0})
              </button>
            ))}
          </div>
          <div className="toolbar">
            <span className="muted">
              Showing {pageStart.toLocaleString()}-{pageEnd.toLocaleString()} of{" "}
              {data.pagination.total.toLocaleString()} observations
            </span>
            <button
              className="button"
              disabled={!data.pagination.has_previous || loading}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              Previous
            </button>
            <span className="pill">
              Page {page} / {totalPages}
            </span>
            <input
              className="input page-input"
              min={1}
              max={totalPages}
              type="number"
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") jumpToPage();
              }}
              aria-label="Page number"
            />
            <button className="button" disabled={loading} onClick={jumpToPage}>
              Go
            </button>
            <button
              className="button"
              disabled={!data.pagination.has_next || loading}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </button>
          </div>
          {observationTab === "deductive" ? (
            <div className="grid cols-2">
              <DeductiveTable
                observations={currentObservations}
                selected={selectedDeduction}
                onSelect={setSelectedDeduction}
              />
              <DeductionDetail
                observation={selectedDeduction}
                sources={data.source_documents}
                sourceMessages={data.source_messages}
              />
            </div>
          ) : observationTab === "explicit" || observationTab === "inductive" ? (
            <div className="grid cols-2">
              <Timeline observations={currentObservations} />
              <ObservationTable observations={currentObservations} />
            </div>
          ) : (
            <ObservationTable observations={currentObservations} />
          )}
        </div>
      )}

      {data && tab === "representation" && (
        <div>
          <PeerPairSelector pairs={data.peer_pairs} selected={selectedPair} onSelect={setSelectedPair} />
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">
                {selectedPair ? `${selectedPair.observer} -> ${selectedPair.observed}` : "No peer pair selected"}
              </h2>
              <p className="card-subtitle">Working representation</p>
            </div>
            <div className="card-body" style={{ whiteSpace: "pre-wrap", lineHeight: 1.65 }}>
              {representation?.representation || "No representation available."}
            </div>
          </div>
        </div>
      )}

      {data && tab === "summary" && (
        <div className="grid cols-2">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.map((session) => (
                  <tr
                    key={session.id}
                    onClick={() => setSelectedSession(session)}
                    style={{ cursor: "pointer", background: selectedSession?.id === session.id ? "var(--primary-soft)" : undefined }}
                  >
                    <td>{session.name}</td>
                    <td><span className="pill">{session.is_active ? "active" : "inactive"}</span></td>
                    <td>{formatDate(session.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid">
            <SummaryCard title="Short Summary" value={sessionSummaries?.short_summary ?? null} />
            <SummaryCard title="Long Summary" value={sessionSummaries?.long_summary ?? null} />
          </div>
        </div>
      )}

      {data && tab === "peer-card" && (
        <div>
          <PeerPairSelector pairs={data.peer_pairs} selected={selectedPair} onSelect={setSelectedPair} />
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">
                {selectedPair ? `${selectedPair.observer} -> ${selectedPair.observed}` : "No peer pair selected"}
              </h2>
              <p className="card-subtitle">Peer card facts</p>
            </div>
            <div className="card-body">
              {peerCard?.peer_card?.length ? (
                <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
                  {peerCard.peer_card.map((fact, index) => (
                    <li key={`${fact}-${index}`}>{fact}</li>
                  ))}
                </ul>
              ) : (
                <div className="muted">No peer card available.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
