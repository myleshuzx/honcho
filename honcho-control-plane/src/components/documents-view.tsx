"use client";

import { FileText, Keyboard, RefreshCw, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { DocumentInfo } from "@/lib/types";

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Unknown";
}

const MAX_IMPORT_CHARS = 25000;

export function DocumentsView({ workspaceId }: { workspaceId: string }) {
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<"file" | "text">("file");
  const [textTitle, setTextTitle] = useState("Pasted text");
  const [textContent, setTextContent] = useState("");
  const [peerId, setPeerId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [createdAt, setCreatedAt] = useState("");
  const [maxChars, setMaxChars] = useState(String(MAX_IMPORT_CHARS));
  const [enqueueProcessing, setEnqueueProcessing] = useState(true);
  const [metadata, setMetadata] = useState("{}");
  const [peerOptions, setPeerOptions] = useState<string[]>([]);

  function loadDocuments() {
    setLoading(true);
    setError(null);
    api
      .getDocuments(workspaceId)
      .then((response) => setDocuments(response.documents))
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadDocuments();
  }, [workspaceId]);

  useEffect(() => {
    api
      .getMemories(workspaceId, { limit: 1, offset: 0 })
      .then((response) => {
        const peers = Array.from(
          new Set(response.peer_pairs.flatMap((pair) => [pair.observer, pair.observed]))
        ).sort((a, b) => a.localeCompare(b));
        setPeerOptions(peers);
        setPeerId((current) => current || peers[0] || "");
      })
      .catch(() => setPeerOptions([]));
  }, [workspaceId]);

  async function uploadDocument() {
    if (!file || !peerId.trim()) return;

    setUploading(true);
    setError(null);
    setUploadMessage(null);
    try {
      JSON.parse(metadata || "{}");
      const formData = new FormData();
      formData.set("file", file);
      formData.set("peer_id", peerId.trim());
      if (sessionId.trim()) formData.set("session_id", sessionId.trim());
      if (createdAt) formData.set("created_at", new Date(createdAt).toISOString());
      if (metadata.trim()) formData.set("metadata", metadata);
      if (maxChars.trim()) formData.set("max_chars", maxChars.trim());
      formData.set("enqueue_processing", String(enqueueProcessing));

      const response = await api.uploadDocument(workspaceId, formData);
      setUploadMessage(
        `${response.document.filename ?? response.document.id}: ${response.messages_created} messages created${response.queued ? " and queued" : ""}.`
      );
      setFile(null);
      loadDocuments();
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
    }
  }

  async function importTextDocument() {
    if (!textContent.trim() || !peerId.trim()) return;

    setUploading(true);
    setError(null);
    setUploadMessage(null);
    try {
      const parsedMetadata = JSON.parse(metadata || "{}");
      const response = await api.importTextDocument(workspaceId, {
        title: textTitle.trim() || "Pasted text",
        content: textContent,
        peer_id: peerId.trim(),
        session_id: sessionId.trim() || undefined,
        created_at: createdAt ? new Date(createdAt).toISOString() : undefined,
        metadata: parsedMetadata,
        max_chars: maxChars.trim() ? Number(maxChars) : undefined,
        enqueue_processing: enqueueProcessing
      });
      setUploadMessage(
        `${response.document.filename ?? response.document.id}: ${response.messages_created} messages created${response.queued ? " and queued" : ""}.`
      );
      setTextContent("");
      loadDocuments();
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
    }
  }

  const canImport =
    importMode === "file"
      ? Boolean(file && peerId && !uploading)
      : Boolean(textContent.trim() && peerId && !uploading);

  return (
    <div>
      <div className="page-title">
        <div>
          <h1>Documents</h1>
          <p>Imported files and message-backed documents in this workspace.</p>
        </div>
        <button className="button" onClick={loadDocuments} disabled={loading}>
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h2 className="card-title">Import Document</h2>
          <p className="card-subtitle">Upload a file or paste text, split it into Honcho messages, and optionally enqueue memory processing.</p>
        </div>
        <div className="card-body">
          <div className="segmented" aria-label="Import mode">
            <button
              className={importMode === "file" ? "active" : ""}
              onClick={() => setImportMode("file")}
              type="button"
            >
              <Upload size={15} /> File
            </button>
            <button
              className={importMode === "text" ? "active" : ""}
              onClick={() => setImportMode("text")}
              type="button"
            >
              <Keyboard size={15} /> Text
            </button>
          </div>
          <div className="toolbar">
            {importMode === "file" ? (
              <input
                className="input file-input"
                type="file"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            ) : (
              <input
                className="input file-input"
                value={textTitle}
                onChange={(event) => setTextTitle(event.target.value)}
                placeholder="document title"
              />
            )}
            <select className="select peer-select" value={peerId} onChange={(event) => setPeerId(event.target.value)}>
              <option value="">peer</option>
              {peerOptions.map((peer) => (
                <option key={peer} value={peer}>{peer}</option>
              ))}
            </select>
            <input
              className="input"
              value={sessionId}
              onChange={(event) => setSessionId(event.target.value)}
              placeholder="session id (optional)"
            />
            <input
              className="input"
              type="datetime-local"
              value={createdAt}
              onChange={(event) => setCreatedAt(event.target.value)}
              title="created_at for imported messages"
            />
            <input
              className="input page-input"
              type="number"
              min={1000}
              max={MAX_IMPORT_CHARS}
              value={maxChars}
              onChange={(event) => setMaxChars(event.target.value)}
              title="max chars per message chunk"
            />
            <label className="check-label">
              <input
                type="checkbox"
                checked={enqueueProcessing}
                onChange={(event) => setEnqueueProcessing(event.target.checked)}
              />
              enqueue
            </label>
            <button
              className="button primary"
              onClick={importMode === "file" ? uploadDocument : importTextDocument}
              disabled={!canImport}
            >
              {importMode === "file" ? <Upload size={16} /> : <Keyboard size={16} />}
              {uploading ? "Importing" : "Import"}
            </button>
          </div>
          {importMode === "text" && (
            <textarea
              className="textarea document-textarea"
              value={textContent}
              onChange={(event) => setTextContent(event.target.value)}
              placeholder="Paste text to import as a document"
            />
          )}
          <textarea
            className="textarea metadata-textarea"
            value={metadata}
            onChange={(event) => setMetadata(event.target.value)}
            placeholder='{"source":"dashboard"}'
          />
          {uploadMessage && <div className="muted">{uploadMessage}</div>}
          {error && <div className="error-text">{error}</div>}
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          {loading ? (
            <div className="empty">Loading documents...</div>
          ) : documents.length === 0 ? (
            <div className="empty">
              <div>
                <FileText size={42} />
                <h2>No uploaded documents</h2>
                <p>File uploads appear here after messages are created with file metadata.</p>
              </div>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Source</th>
                    <th>Type</th>
                    <th>Chunks</th>
                    <th>Peer</th>
                    <th>Session</th>
                    <th>Uploaded</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((document) => (
                    <tr key={document.id}>
                      <td>
                        <div>{document.filename ?? document.id}</div>
                        <div className="muted code">{document.id}</div>
                      </td>
                      <td><span className="pill">{document.source_type.replace("_", " ")}</span></td>
                      <td>{document.content_type ?? "unknown"}</td>
                      <td>{document.chunk_count} / {document.total_chunks}</td>
                      <td>{document.peer_id ?? "unknown"}</td>
                      <td>{document.session_id ?? "unknown"}</td>
                      <td>{formatDate(document.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
