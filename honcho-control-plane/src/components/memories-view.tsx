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
  SourceMessage
} from "@/lib/types";

type Tab = "sessions" | "representation" | "observations" | "peer-card";
type ObservationTab = ObservationLevel;

const levels: ObservationTab[] = ["explicit", "deductive", "inductive", "contradiction"];
const PAGE_SIZE = 500;
const SESSION_PAGE_SIZE = 100;

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "Unknown";
}

function formatDateCompact(value?: string | null) {
  return value ? new Date(value).toLocaleString() : null;
}

function TemporalDetails({ observation }: { observation: Observation }) {
  const temporal = observation.temporal;
  const observedAt = formatDateCompact(temporal?.observed_at ?? observation.source_created_at ?? observation.created_at);
  const occurredAt = formatDateCompact(temporal?.occurred_at);
  const generatedAt = formatDateCompact(temporal?.generated_at ?? observation.generated_at);
  const evidenceFrom = formatDateCompact(temporal?.evidence_observed_from);
  const evidenceTo = formatDateCompact(temporal?.evidence_observed_to);
  const kind = temporal?.temporal_kind || "unknown";
  const confidence = temporal?.temporal_confidence || "none";
  const sourceCount = temporal?.source_count ?? observation.source_ids.length;

  return (
    <div className="temporal-stack">
      {observedAt && (
        <div>
          <span>Observed</span>
          <strong>{observedAt}</strong>
        </div>
      )}
      {occurredAt && (
        <div>
          <span>Occurred</span>
          <strong>{occurredAt}</strong>
        </div>
      )}
      {generatedAt && (
        <div>
          <span>Generated</span>
          <strong>{generatedAt}</strong>
        </div>
      )}
      {(evidenceFrom || evidenceTo) && (
        <div>
          <span>Evidence range</span>
          <strong>
            {evidenceFrom ?? "Unknown"} - {evidenceTo ?? "Unknown"}
          </strong>
        </div>
      )}
      <div className="temporal-pills">
        <span className="pill">{kind}</span>
        <span className="pill">{confidence}</span>
        {sourceCount > 0 && <span className="pill">{sourceCount} sources</span>}
      </div>
    </div>
  );
}

function SourceMessageTimeDetails({ message }: { message: SourceMessage }) {
  return (
    <div className="temporal-stack">
      {message.created_at && (
        <div>
          <span>Observed</span>
          <strong>{formatDate(message.created_at)}</strong>
        </div>
      )}
      {message.ingested_at && (
        <div>
          <span>Ingested</span>
          <strong>{formatDate(message.ingested_at)}</strong>
        </div>
      )}
    </div>
  );
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
            <th>Time</th>
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
              <td><TemporalDetails observation={observation} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DerivedObservationTable({
  observations,
  selected,
  onSelect,
  level
}: {
  observations: Observation[];
  selected: Observation | null;
  onSelect: (observation: Observation) => void;
  level: "inductive" | "deductive";
}) {
  if (observations.length === 0) {
    return <div className="empty card">No {level} observations found on this page.</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{level === "deductive" ? "Deduction" : "Induction"}</th>
            <th>Sources</th>
            <th>Session</th>
            <th>Time</th>
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
                <span className={`pill ${level}`}>{level}</span>
                <div style={{ marginTop: 8 }}>{observation.content}</div>
              </td>
              <td>{observation.source_ids.length}</td>
              <td>{observation.session_id ?? "global"}</td>
              <td><TemporalDetails observation={observation} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DerivationDetail({
  observation,
  sources,
  sourceMessages,
  level
}: {
  observation: Observation | null;
  sources: Record<string, Observation>;
  sourceMessages: Record<string, SourceMessage[]>;
  level: "inductive" | "deductive";
}) {
  const label = level === "deductive" ? "deduction" : "induction";
  const title = level === "deductive" ? "Deduction Sources" : "Induction Sources";

  if (!observation) {
    return <div className="empty card">Select a {label} observation to inspect its sources.</div>;
  }

  const sourceRows = observation.source_ids.map((id) => sources[id]).filter(Boolean);
  const messageRows = observation.source_ids.flatMap((sourceId) =>
    (sourceMessages[sourceId] ?? []).map((message) => ({
      ...message,
      sourceId
    }))
  );
  const dedupedMessageRows = Array.from(
    messageRows.reduce((acc, message) => {
      const existing = acc.get(message.internal_id);
      if (existing) {
        existing.sourceIds.push(message.sourceId);
      } else {
        acc.set(message.internal_id, { ...message, sourceIds: [message.sourceId] });
      }
      return acc;
    }, new Map<number, SourceMessage & { sourceId: string; sourceIds: string[] }>())
  ).map(([, message]) => message);

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">{title}</h2>
        <p className="card-subtitle">
          Observed {formatDate(observation.temporal?.observed_at ?? observation.source_created_at ?? observation.created_at)}
        </p>
      </div>
      <div className="card-body">
        <div style={{ marginBottom: 16, lineHeight: 1.6 }}>{observation.content}</div>
        <div style={{ marginBottom: 16 }}>
          <TemporalDetails observation={observation} />
        </div>
        {sourceRows.length === 0 ? (
          <div className="muted">
            This {label} references {observation.source_ids.length} source id(s), but none are loaded in the current response.
          </div>
        ) : (
          <div className="grid">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Source observation ({sourceRows.length})</th>
                    <th>Level</th>
                    <th>Time</th>
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
                      <td><TemporalDetails observation={source} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {dedupedMessageRows.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Underlying message ({dedupedMessageRows.length})</th>
                      <th>Peer</th>
                      <th>Session</th>
                      <th>Time</th>
                      <th>Linked source observations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dedupedMessageRows.map((message) => (
                      <tr key={message.internal_id}>
                        <td>
                          <div>{message.content}</div>
                          <div className="code" style={{ marginTop: 6, display: "inline-block" }}>{message.id}</div>
                        </td>
                        <td>{message.peer_id}</td>
                        <td>{message.session_id}</td>
                        <td><SourceMessageTimeDetails message={message} /></td>
                        <td>
                          {message.sourceIds.map((sourceId) => (
                            <span className="code" key={sourceId} style={{ marginRight: 6 }}>{sourceId}</span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="muted">No source messages are linked to these source observations.</div>
            )}
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
            <div className="muted" style={{ fontSize: 12 }}>
              observed {formatDate(observation.temporal?.observed_at ?? observation.source_created_at ?? observation.created_at)}
            </div>
            {observation.temporal?.occurred_at && (
              <div className="muted" style={{ fontSize: 12 }}>
                occurred {formatDate(observation.temporal.occurred_at)}
              </div>
            )}
            <div style={{ marginTop: 4 }}>{observation.content}</div>
            <div style={{ marginTop: 8 }}>
              <TemporalDetails observation={observation} />
            </div>
            <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
              {observation.observer} &rarr; {observation.observed}
            </div>
          </div>
        ))}
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
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionPageInput, setSessionPageInput] = useState("1");
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  const [selectedPair, setSelectedPair] = useState<PeerPair | null>(null);
  const [representation, setRepresentation] = useState<RepresentationResponse | null>(null);
  const [peerCard, setPeerCard] = useState<PeerCardResponse | null>(null);
  const [selectedDerivation, setSelectedDerivation] = useState<Observation | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getMemories(workspaceId, {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        sessions_limit: SESSION_PAGE_SIZE,
        sessions_offset: (sessionPage - 1) * SESSION_PAGE_SIZE
      })
      .then(setData)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [workspaceId, page, sessionPage]);

  useEffect(() => {
    setSelectedDerivation(null);
  }, [page, observationTab]);

  const currentObservations = data?.observations[observationTab] ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.pagination.total / data.pagination.limit)) : 1;
  const pageStart = data && data.pagination.total > 0 ? data.pagination.offset + 1 : 0;
  const pageEnd = data
    ? Math.min(data.pagination.offset + data.pagination.limit, data.pagination.total)
    : 0;
  const sessionTotalPages = data
    ? Math.max(1, Math.ceil(data.sessions_pagination.total / data.sessions_pagination.limit))
    : 1;
  const sessionPageStart = data && data.sessions_pagination.total > 0 ? data.sessions_pagination.offset + 1 : 0;
  const sessionPageEnd = data
    ? Math.min(data.sessions_pagination.offset + data.sessions.length, data.sessions_pagination.total)
    : 0;

  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  useEffect(() => {
    setSessionPageInput(String(sessionPage));
  }, [sessionPage]);

  function jumpToPage() {
    const parsed = Number.parseInt(pageInput, 10);
    if (!Number.isFinite(parsed)) return;
    setPage(Math.min(Math.max(parsed, 1), totalPages));
  }

  function jumpToSessionPage() {
    const parsed = Number.parseInt(sessionPageInput, 10);
    if (!Number.isFinite(parsed)) return;
    setSessionPage(Math.min(Math.max(parsed, 1), sessionTotalPages));
  }

  useEffect(() => {
    setSessionPage(1);
    setSessionPageInput("1");
  }, [workspaceId]);

  useEffect(() => {
    if (!data) return;
    setSelectedSession((current) => current ?? data.sessions[0] ?? null);
    setSelectedPair((current) => current ?? data.peer_pairs[0] ?? null);
  }, [data]);

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
          <p>Explore sessions, representations, observations, and peer cards.</p>
        </div>
      </div>

      <div className="tabs">
        {(["sessions", "representation", "observations", "peer-card"] as Tab[]).map((item) => (
          <button key={item} className={`tab ${tab === item ? "active" : ""}`} onClick={() => setTab(item)}>
            {item.replace("-", " ")}
          </button>
        ))}
      </div>

      {loading && <div className="empty card">Loading memories...</div>}
      {error && <div className="empty card">{error}</div>}
      {data && tab === "sessions" && (
        <div>
          <div className="toolbar">
            <span className="muted">
              Showing {sessionPageStart.toLocaleString()}-{sessionPageEnd.toLocaleString()} of{" "}
              {data.sessions_pagination.total.toLocaleString()} sessions
            </span>
            <button
              className="button"
              disabled={!data.sessions_pagination.has_previous || loading}
              onClick={() => setSessionPage((value) => Math.max(1, value - 1))}
            >
              Previous
            </button>
            <span className="pill">
              Page {sessionPage} / {sessionTotalPages}
            </span>
            <input
              className="input page-input"
              min={1}
              max={sessionTotalPages}
              type="number"
              value={sessionPageInput}
              onChange={(event) => setSessionPageInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") jumpToSessionPage();
              }}
              aria-label="Session page number"
            />
            <button className="button" disabled={loading} onClick={jumpToSessionPage}>
              Go
            </button>
            <button
              className="button"
              disabled={!data.sessions_pagination.has_next || loading}
              onClick={() => setSessionPage((value) => value + 1)}
            >
              Next
            </button>
          </div>
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
          {observationTab === "inductive" || observationTab === "deductive" ? (
            <div className="grid cols-2">
              <DerivedObservationTable
                observations={currentObservations}
                selected={selectedDerivation}
                onSelect={setSelectedDerivation}
                level={observationTab}
              />
              <DerivationDetail
                observation={selectedDerivation}
                sources={data.source_documents}
                sourceMessages={data.source_messages}
                level={observationTab}
              />
            </div>
          ) : observationTab === "explicit" ? (
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
