import type {
  DocumentInfo,
  MemoriesResponse,
  OverviewResponse,
  PeerCardResponse,
  RecallResult,
  RepresentationResponse,
  SessionSummaries,
  StatusResponse,
  WorkspaceListResponse
} from "./types";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function fetchForm<T>(path: string, formData: FormData): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    body: formData,
    cache: "no-store"
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function cp(path: string) {
  return `/api/control-plane${path}`;
}

export const api = {
  listWorkspaces() {
    return fetchJson<WorkspaceListResponse>(cp("/workspaces"));
  },

  getOverview(workspaceId: string) {
    return fetchJson<OverviewResponse>(cp(`/workspaces/${encodeURIComponent(workspaceId)}/overview`));
  },

  getMemories(workspaceId: string, params: Record<string, string | number | undefined> = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") query.set(key, String(value));
    }
    const qs = query.toString();
    return fetchJson<MemoriesResponse>(
      cp(`/workspaces/${encodeURIComponent(workspaceId)}/memories${qs ? `?${qs}` : ""}`)
    );
  },

  recall(workspaceId: string, body: Record<string, unknown>) {
    return fetchJson<{ workspace_id: string; query: string; results: RecallResult[] }>(
      cp(`/workspaces/${encodeURIComponent(workspaceId)}/recall`),
      { method: "POST", body: JSON.stringify(body) }
    );
  },

  reflect(workspaceId: string, body: Record<string, unknown>) {
    return fetchJson<Record<string, unknown> & { answer?: string | null }>(
      cp(`/workspaces/${encodeURIComponent(workspaceId)}/reflect`),
      { method: "POST", body: JSON.stringify(body) }
    );
  },

  getDocuments(workspaceId: string) {
    return fetchJson<{ workspace_id: string; documents: DocumentInfo[] }>(
      cp(`/workspaces/${encodeURIComponent(workspaceId)}/documents`)
    );
  },

  uploadDocument(workspaceId: string, formData: FormData) {
    return fetchForm<{
      workspace_id: string;
      document: DocumentInfo;
      messages_created: number;
      queued: boolean;
    }>(cp(`/workspaces/${encodeURIComponent(workspaceId)}/documents/upload`), formData);
  },

  importTextDocument(workspaceId: string, body: Record<string, unknown>) {
    return fetchJson<{
      workspace_id: string;
      document: DocumentInfo;
      messages_created: number;
      queued: boolean;
    }>(cp(`/workspaces/${encodeURIComponent(workspaceId)}/documents/text`), {
      method: "POST",
      body: JSON.stringify(body)
    });
  },

  getSessionSummaries(workspaceId: string, sessionId: string) {
    return fetchJson<SessionSummaries>(
      cp(
        `/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/summaries`
      )
    );
  },

  getRepresentation(workspaceId: string, observer: string, observed: string) {
    return fetchJson<RepresentationResponse>(
      cp(
        `/workspaces/${encodeURIComponent(workspaceId)}/peer-pairs/${encodeURIComponent(observer)}/${encodeURIComponent(observed)}/representation`
      )
    );
  },

  getPeerCard(workspaceId: string, observer: string, observed: string) {
    return fetchJson<PeerCardResponse>(
      cp(
        `/workspaces/${encodeURIComponent(workspaceId)}/peer-pairs/${encodeURIComponent(observer)}/${encodeURIComponent(observed)}/card`
      )
    );
  },

  getStatus(workspaceId: string) {
    return fetchJson<StatusResponse>(cp(`/workspaces/${encodeURIComponent(workspaceId)}/status`));
  },

  scheduleDream(workspaceId: string, body: Record<string, unknown>) {
    return fetchJson<Record<string, unknown> & { queued: boolean }>(
      cp(`/workspaces/${encodeURIComponent(workspaceId)}/dream`),
      { method: "POST", body: JSON.stringify(body) }
    );
  }
};

export function workspaceRoute(workspaceId: string, view = "memories") {
  return `/workspaces/${encodeURIComponent(workspaceId)}?view=${encodeURIComponent(view)}`;
}
