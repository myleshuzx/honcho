export type WorkspaceInfo = {
  id: string;
  name: string;
  metadata: Record<string, unknown>;
  configuration: Record<string, unknown>;
  created_at: string | null;
  message_count: number;
  last_message_at: string | null;
};

export type WorkspaceListResponse = {
  total: number;
  workspaces: WorkspaceInfo[];
};

export type OverviewResponse = {
  workspace: WorkspaceInfo;
  counts: {
    peers: number;
    sessions: number;
    messages: number;
    observations: number;
  };
  queue: Record<string, unknown>;
};

export type ObservationLevel = "explicit" | "inductive" | "deductive" | "contradiction";

export type ObservationTemporal = {
  observed_at: string | null;
  occurred_at: string | null;
  generated_at: string | null;
  evidence_observed_from: string | null;
  evidence_observed_to: string | null;
  temporal_kind: string | null;
  temporal_confidence: string | null;
  source_count: number;
};

export type Observation = {
  id: string;
  workspace_id: string;
  observer: string;
  observed: string;
  session_id: string | null;
  content: string;
  level: ObservationLevel;
  times_derived: number;
  source_ids: string[];
  metadata: Record<string, unknown>;
  source_created_at: string | null;
  sync_state: string;
  sync_attempts: number;
  last_sync_at: string | null;
  created_at: string | null;
  generated_at: string | null;
  temporal: ObservationTemporal | null;
};

export type SourceMessage = {
  id: string;
  internal_id: number;
  workspace_id: string;
  session_id: string;
  peer_id: string;
  content: string;
  metadata: Record<string, unknown>;
  internal_metadata: Record<string, unknown>;
  token_count: number;
  seq_in_session: number;
  created_at: string | null;
  ingested_at: string | null;
};

export type SessionInfo = {
  id: string;
  name: string;
  is_active: boolean;
  metadata: Record<string, unknown>;
  configuration: Record<string, unknown>;
  created_at: string | null;
};

export type PeerPair = {
  id: string;
  observer: string;
  observed: string;
  metadata: Record<string, unknown>;
  created_at: string | null;
};

export type MemoriesResponse = {
  workspace_id: string;
  sessions: SessionInfo[];
  peer_pairs: PeerPair[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    has_next: boolean;
    has_previous: boolean;
  };
  observation_counts: Record<ObservationLevel, number>;
  observations: Record<ObservationLevel, Observation[]>;
  source_documents: Record<string, Observation>;
  source_messages: Record<string, SourceMessage[]>;
  graph: {
    nodes: { id: string; label: string; level: ObservationLevel; created_at: string | null }[];
    edges: { id: string; source: string; target: string; type: string }[];
  };
};

export type RecallResult = {
  id: string;
  type: string;
  score: number;
  rank: number;
  item: Record<string, unknown> & {
    content?: string;
    session_id?: string | null;
    peer_id?: string | null;
    observer?: string;
    observed?: string;
    created_at?: string | null;
  };
};

export type StatusResponse = {
  workspace_id: string;
  counts: OverviewResponse["counts"];
  queue_by_type: Record<string, { total: number; completed: number; pending: number; errors: number }>;
  errors: Array<Record<string, unknown>>;
  series: {
    messages: Array<{ date: string; messages: number }>;
    observations: Array<Record<string, number | string>>;
  };
  observation_levels: Record<string, number>;
};

export type DocumentInfo = {
  id: string;
  filename: string | null;
  content_type: string | null;
  original_file_size: number;
  total_chunks: number;
  chunk_count: number;
  session_id: string | null;
  peer_id: string | null;
  source_type: "file_upload" | "message_import" | "text_input";
  created_at: string | null;
  updated_at: string | null;
};

export type DocumentListResponse = {
  workspace_id: string;
  documents: DocumentInfo[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    has_next: boolean;
    has_previous: boolean;
  };
};

export type SessionSummaries = {
  workspace_id: string;
  session_id: string;
  short_summary: Record<string, unknown> | null;
  long_summary: Record<string, unknown> | null;
};

export type RepresentationResponse = {
  workspace_id: string;
  observer: string;
  observed: string;
  session_id: string | null;
  representation: string;
};

export type PeerCardResponse = {
  workspace_id: string;
  observer: string;
  observed: string;
  peer_card: string[] | null;
};
