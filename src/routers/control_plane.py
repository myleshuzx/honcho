import datetime
import json
import logging
import re
from typing import Any, Literal

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Body,
    Depends,
    File,
    Form,
    HTTPException,
    Path,
    Query,
    UploadFile,
)
from nanoid import generate as generate_nanoid
from pydantic import BaseModel, Field
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from src import crud, models, schemas
from src.config import ReasoningLevel, settings
from src.dependencies import db
from src.deriver import enqueue
from src.deriver.enqueue import enqueue_dream
from src.dialectic.chat import agentic_chat
from src.embedding_client import embedding_client
from src.exceptions import FileTooLargeError
from src.security import require_auth
from src.utils import summarizer
from src.utils.files import process_file_uploads_for_messages, split_text_into_chunks
from src.utils.representation import flatten_message_ids
from src.utils.search import search

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/control-plane", tags=["control-plane"])


class ControlPlaneRecallRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=10000)
    observer: str | None = None
    observed: str | None = None
    session_id: str | None = None
    limit: int = Field(default=20, ge=1, le=100)
    include_messages: bool = True
    include_observations: bool = True
    levels: list[Literal["explicit", "inductive", "deductive", "contradiction"]] = (
        Field(default_factory=lambda: ["explicit", "inductive", "deductive"])
    )


class ControlPlaneReflectRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=10000)
    observer: str
    target: str | None = None
    session_id: str | None = None
    reasoning_level: ReasoningLevel = "low"


class ControlPlaneTextImportRequest(BaseModel):
    title: str = Field(default="Pasted text", min_length=1, max_length=256)
    content: str = Field(..., min_length=1)
    peer_id: str = Field(..., min_length=1)
    session_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    configuration: dict[str, Any] | None = None
    created_at: str | None = None
    max_chars: int = Field(
        default=settings.MAX_MESSAGE_SIZE,
        ge=1000,
        le=settings.MAX_MESSAGE_SIZE,
    )
    enqueue_processing: bool = True


class ControlPlaneScheduleDreamRequest(BaseModel):
    observer: str = Field(..., min_length=1)
    observed: str | None = None
    dream_type: schemas.DreamType = schemas.DreamType.OMNI
    session_id: str | None = None


def _iso(value: datetime.datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _message_payload(message: models.Message) -> dict[str, Any]:
    return {
        "id": message.public_id,
        "internal_id": message.id,
        "workspace_id": message.workspace_name,
        "session_id": message.session_name,
        "peer_id": message.peer_name,
        "content": message.content,
        "metadata": message.h_metadata,
        "internal_metadata": message.internal_metadata,
        "token_count": message.token_count,
        "seq_in_session": message.seq_in_session,
        "created_at": _iso(message.created_at),
        "ingested_at": _iso(message.ingested_at),
    }


def _document_payload(document: models.Document) -> dict[str, Any]:
    source_created_at = document.internal_metadata.get("message_created_at")
    observed_at = document.observed_at or document.created_at
    return {
        "id": document.id,
        "workspace_id": document.workspace_name,
        "observer": document.observer,
        "observed": document.observed,
        "session_id": document.session_name,
        "content": document.content,
        "level": document.level,
        "times_derived": document.times_derived,
        "source_ids": document.source_ids or [],
        "metadata": document.internal_metadata,
        "source_created_at": source_created_at
        if isinstance(source_created_at, str)
        else _iso(source_created_at)
        if isinstance(source_created_at, datetime.datetime)
        else None,
        "sync_state": document.sync_state,
        "sync_attempts": document.sync_attempts,
        "last_sync_at": _iso(document.last_sync_at),
        "created_at": _iso(document.created_at),
        "generated_at": _iso(document.generated_at),
        "temporal": {
            "observed_at": _iso(observed_at),
            "occurred_at": _iso(document.occurred_at),
            "generated_at": _iso(document.generated_at),
            "evidence_observed_from": _iso(document.evidence_observed_from),
            "evidence_observed_to": _iso(document.evidence_observed_to),
            "temporal_kind": document.temporal_kind,
            "temporal_confidence": document.temporal_confidence,
            "source_count": len(document.source_ids or []),
        },
    }


def _message_ids_for_document(document: models.Document) -> list[int]:
    message_ids = document.internal_metadata.get("message_ids", [])
    if not isinstance(message_ids, list):
        return []
    return flatten_message_ids(message_ids)


def _safe_session_name(filename: str | None) -> str:
    stem = (filename or "document").rsplit(".", 1)[0]
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "-", stem).strip("-._")
    return f"document-{cleaned or 'upload'}"[:128]


def _parse_json_form(value: str | None) -> dict[str, Any] | None:
    if not value:
        return None
    parsed = json.loads(value)
    if not isinstance(parsed, dict):
        raise ValueError("JSON form fields must be objects")
    return parsed


def _parse_created_at(value: str | None) -> datetime.datetime | None:
    if not value:
        return None
    return datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))


def _title_from_message(message: models.Message) -> str:
    for line in message.content.splitlines()[:12]:
        stripped = line.strip()
        if stripped.startswith("主题:"):
            title = stripped.split(":", 1)[1].strip()
            if title:
                return title
        if stripped.startswith("title:"):
            title = stripped.split(":", 1)[1].strip().strip('"')
            if title:
                return title
    date = message.created_at.date().isoformat() if message.created_at else "undated"
    return f"{message.session_name}/{date}"


async def _workspace_counts(db: AsyncSession, workspace_name: str) -> dict[str, int]:
    counts_stmt = select(
        select(func.count(models.Peer.id))
        .where(models.Peer.workspace_name == workspace_name)
        .scalar_subquery()
        .label("peers"),
        select(func.count(models.Session.id))
        .where(models.Session.workspace_name == workspace_name)
        .scalar_subquery()
        .label("sessions"),
        select(func.count(models.Message.id))
        .where(models.Message.workspace_name == workspace_name)
        .scalar_subquery()
        .label("messages"),
        select(func.count(models.Document.id))
        .where(
            models.Document.workspace_name == workspace_name,
            models.Document.deleted_at.is_(None),
        )
        .scalar_subquery()
        .label("observations"),
    )
    row = (await db.execute(counts_stmt)).one()
    return {
        "peers": int(row.peers or 0),
        "sessions": int(row.sessions or 0),
        "messages": int(row.messages or 0),
        "observations": int(row.observations or 0),
    }


@router.get("/workspaces", dependencies=[Depends(require_auth(admin=True))])
async def list_workspaces_for_control_plane(db: AsyncSession = db) -> dict[str, Any]:
    """List workspaces with lightweight stats for the control plane selector."""
    stmt = (
        select(
            models.Workspace,
            func.count(models.Message.id).label("message_count"),
            func.max(models.Message.created_at).label("last_message_at"),
        )
        .outerjoin(
            models.Message,
            models.Message.workspace_name == models.Workspace.name,
        )
        .group_by(models.Workspace.id)
        .order_by(models.Workspace.created_at.asc())
    )
    rows = (await db.execute(stmt)).all()
    workspaces: list[dict[str, Any]] = []
    for workspace, message_count, last_message_at in rows:
        workspaces.append(
            {
                "id": workspace.name,
                "name": workspace.name,
                "metadata": workspace.h_metadata,
                "configuration": workspace.configuration,
                "created_at": _iso(workspace.created_at),
                "message_count": int(message_count or 0),
                "last_message_at": _iso(last_message_at),
            }
        )
    return {"total": len(workspaces), "workspaces": workspaces}


@router.get(
    "/workspaces/{workspace_id}/overview",
    dependencies=[Depends(require_auth(workspace_name="workspace_id"))],
)
async def get_workspace_overview(
    workspace_id: str = Path(...),
    db: AsyncSession = db,
) -> dict[str, Any]:
    workspace = await crud.get_workspace(db, workspace_id)
    counts = await _workspace_counts(db, workspace_id)
    queue_status = await crud.get_queue_status(db, workspace_name=workspace_id)
    return {
        "workspace": {
            "id": workspace.name,
            "name": workspace.name,
            "metadata": workspace.h_metadata,
            "configuration": workspace.configuration,
            "created_at": _iso(workspace.created_at),
        },
        "counts": counts,
        "queue": queue_status.model_dump(),
    }


@router.get(
    "/workspaces/{workspace_id}/memories",
    dependencies=[Depends(require_auth(workspace_name="workspace_id"))],
)
async def get_workspace_memories(
    workspace_id: str = Path(...),
    observer: str | None = Query(None),
    observed: str | None = Query(None),
    session_id: str | None = Query(None),
    limit: int = Query(default=500, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = db,
) -> dict[str, Any]:
    """Return sessions, peer pairs, and observations for memory exploration."""
    sessions_result = await db.execute(
        select(models.Session)
        .where(models.Session.workspace_name == workspace_id)
        .order_by(models.Session.created_at.desc())
    )
    sessions = [
        {
            "id": session.name,
            "name": session.name,
            "is_active": session.is_active,
            "metadata": session.h_metadata,
            "configuration": session.configuration,
            "created_at": _iso(session.created_at),
        }
        for session in sessions_result.scalars().all()
    ]

    collections_result = await db.execute(
        select(models.Collection)
        .where(models.Collection.workspace_name == workspace_id)
        .order_by(models.Collection.created_at.desc())
    )
    peer_pairs = [
        {
            "id": collection.id,
            "observer": collection.observer,
            "observed": collection.observed,
            "metadata": collection.h_metadata,
            "created_at": _iso(collection.created_at),
        }
        for collection in collections_result.scalars().all()
    ]

    document_conditions = [
        models.Document.workspace_name == workspace_id,
        models.Document.deleted_at.is_(None),
    ]
    if observer:
        document_conditions.append(models.Document.observer == observer)
    if observed:
        document_conditions.append(models.Document.observed == observed)
    if session_id:
        document_conditions.append(models.Document.session_name == session_id)

    level_counts_stmt = (
        select(models.Document.level, func.count(models.Document.id).label("count"))
        .where(*document_conditions)
        .group_by(models.Document.level)
    )
    level_counts = {
        "explicit": 0,
        "inductive": 0,
        "deductive": 0,
        "contradiction": 0,
    }
    for row in (await db.execute(level_counts_stmt)).all():
        level_counts[row.level] = int(row.count or 0)
    total_observations = sum(level_counts.values())

    documents_stmt = (
        select(models.Document)
        .where(*document_conditions)
        .order_by(models.Document.created_at.desc())
        .offset(offset)
        .limit(limit)
    )

    documents_result = await db.execute(documents_stmt)
    documents = list(documents_result.scalars().all())
    observations = [_document_payload(doc) for doc in documents]

    source_ids = sorted(
        {
            source_id
            for document in documents
            for source_id in (document.source_ids or [])
        }
    )
    source_documents: dict[str, dict[str, Any]] = {}
    source_messages: dict[str, list[dict[str, Any]]] = {}
    if source_ids:
        source_docs_result = await db.execute(
            select(models.Document).where(
                models.Document.workspace_name == workspace_id,
                models.Document.id.in_(source_ids),
                models.Document.deleted_at.is_(None),
            )
        )
        source_docs = list(source_docs_result.scalars().all())
        source_documents = {
            source_doc.id: _document_payload(source_doc)
            for source_doc in source_docs
        }
        message_ids_by_source = {
            source_doc.id: _message_ids_for_document(source_doc)
            for source_doc in source_docs
        }
        message_ids = sorted(
            {
                message_id
                for ids in message_ids_by_source.values()
                for message_id in ids
            }
        )
        if message_ids:
            messages_result = await db.execute(
                select(models.Message)
                .where(
                    models.Message.workspace_name == workspace_id,
                    models.Message.id.in_(message_ids),
                )
                .order_by(models.Message.created_at.asc(), models.Message.id.asc())
            )
            messages_by_id = {
                message.id: _message_payload(message)
                for message in messages_result.scalars().all()
            }
            source_messages = {
                source_id: [
                    messages_by_id[message_id]
                    for message_id in ids
                    if message_id in messages_by_id
                ]
                for source_id, ids in message_ids_by_source.items()
            }

    grouped: dict[str, list[dict[str, Any]]] = {
        "explicit": [],
        "inductive": [],
        "deductive": [],
        "contradiction": [],
    }
    for observation in observations:
        grouped.setdefault(observation["level"], []).append(observation)

    graph_nodes = [
        {
            "id": observation["id"],
            "label": observation["content"][:120],
            "level": observation["level"],
            "created_at": observation["created_at"],
        }
        for observation in observations
    ]
    known_ids = {node["id"] for node in graph_nodes}
    graph_edges = [
        {
            "id": f"{source_id}->{observation['id']}",
            "source": source_id,
            "target": observation["id"],
            "type": "derived_from",
        }
        for observation in observations
        for source_id in observation["source_ids"]
        if source_id in known_ids
    ]

    return {
        "workspace_id": workspace_id,
        "sessions": sessions,
        "peer_pairs": peer_pairs,
        "pagination": {
            "limit": limit,
            "offset": offset,
            "total": total_observations,
            "has_next": offset + limit < total_observations,
            "has_previous": offset > 0,
        },
        "observation_counts": level_counts,
        "observations": grouped,
        "source_documents": source_documents,
        "source_messages": source_messages,
        "graph": {"nodes": graph_nodes, "edges": graph_edges},
    }


@router.get(
    "/workspaces/{workspace_id}/sessions/{session_id}/summaries",
    dependencies=[Depends(require_auth(workspace_name="workspace_id"))],
)
async def get_control_plane_session_summaries(
    workspace_id: str = Path(...),
    session_id: str = Path(...),
    db: AsyncSession = db,
) -> dict[str, Any]:
    short_summary, long_summary = await summarizer.get_both_summaries(
        db,
        workspace_name=workspace_id,
        session_name=session_id,
    )
    return {
        "workspace_id": workspace_id,
        "session_id": session_id,
        "short_summary": summarizer.to_schema_summary(short_summary).model_dump()
        if short_summary
        else None,
        "long_summary": summarizer.to_schema_summary(long_summary).model_dump()
        if long_summary
        else None,
    }


@router.get(
    "/workspaces/{workspace_id}/peer-pairs/{observer}/{observed}/representation",
    dependencies=[Depends(require_auth(workspace_name="workspace_id"))],
)
async def get_control_plane_representation(
    workspace_id: str = Path(...),
    observer: str = Path(...),
    observed: str = Path(...),
    session_id: str | None = Query(None),
) -> dict[str, Any]:
    representation = await crud.get_working_representation(
        workspace_id,
        observer=observer,
        observed=observed,
        session_name=session_id,
    )
    return {
        "workspace_id": workspace_id,
        "observer": observer,
        "observed": observed,
        "session_id": session_id,
        "representation": representation.format_as_markdown(),
    }


@router.get(
    "/workspaces/{workspace_id}/peer-pairs/{observer}/{observed}/card",
    dependencies=[Depends(require_auth(workspace_name="workspace_id"))],
)
async def get_control_plane_peer_card(
    workspace_id: str = Path(...),
    observer: str = Path(...),
    observed: str = Path(...),
    db: AsyncSession = db,
) -> dict[str, Any]:
    peer_card = await crud.get_peer_card(
        db,
        workspace_id,
        observer=observer,
        observed=observed,
    )
    return {
        "workspace_id": workspace_id,
        "observer": observer,
        "observed": observed,
        "peer_card": peer_card,
    }


@router.post(
    "/workspaces/{workspace_id}/recall",
    dependencies=[Depends(require_auth(workspace_name="workspace_id"))],
)
async def recall_workspace_memory(
    workspace_id: str = Path(...),
    body: ControlPlaneRecallRequest = Body(...),
    db: AsyncSession = db,
) -> dict[str, Any]:
    """Recall across messages and observations with a unified ranked response."""
    results: list[dict[str, Any]] = []

    if body.include_messages:
        filters: dict[str, Any] = {"workspace_id": workspace_id}
        if body.session_id:
            filters["session_id"] = body.session_id
        if body.observed:
            filters["peer_id"] = body.observed
        messages = await search(body.query, filters=filters, limit=body.limit)
        for rank, message in enumerate(messages, 1):
            results.append(
                {
                    "id": message.public_id,
                    "type": "message",
                    "score": 1.0 / rank,
                    "rank": rank,
                    "item": _message_payload(message),
                }
            )

    if body.include_observations:
        collection_stmt = select(models.Collection).where(
            models.Collection.workspace_name == workspace_id
        )
        if body.observer:
            collection_stmt = collection_stmt.where(models.Collection.observer == body.observer)
        if body.observed:
            collection_stmt = collection_stmt.where(models.Collection.observed == body.observed)
        collections = (await db.execute(collection_stmt)).scalars().all()

        embedding: list[float] | None = None
        if collections:
            embedding = await embedding_client.embed(body.query)

        for collection in collections:
            filters: dict[str, Any] = {"level": {"in": body.levels}}
            if body.session_id:
                filters["session_name"] = body.session_id
            documents = await crud.query_documents(
                db,
                workspace_name=workspace_id,
                query=body.query,
                observer=collection.observer,
                observed=collection.observed,
                filters=filters,
                top_k=body.limit,
                embedding=embedding,
            )
            for rank, document in enumerate(documents, 1):
                results.append(
                    {
                        "id": document.id,
                        "type": document.level,
                        "score": 1.0 / rank,
                        "rank": rank,
                        "item": _document_payload(document),
                    }
                )

    results.sort(key=lambda item: item["score"], reverse=True)
    return {
        "workspace_id": workspace_id,
        "query": body.query,
        "results": results[: body.limit],
    }


@router.post(
    "/workspaces/{workspace_id}/reflect",
    dependencies=[Depends(require_auth(workspace_name="workspace_id"))],
)
async def reflect_workspace_memory(
    workspace_id: str = Path(...),
    body: ControlPlaneReflectRequest = Body(...),
) -> dict[str, Any]:
    observed = body.target if body.target is not None else body.observer
    answer = await agentic_chat(
        workspace_name=workspace_id,
        session_name=body.session_id,
        query=body.query,
        observer=body.observer,
        observed=observed,
        reasoning_level=body.reasoning_level,
    )
    return {
        "workspace_id": workspace_id,
        "query": body.query,
        "observer": body.observer,
        "target": observed,
        "session_id": body.session_id,
        "reasoning_level": body.reasoning_level,
        "answer": answer,
    }


@router.get(
    "/workspaces/{workspace_id}/documents",
    dependencies=[Depends(require_auth(workspace_name="workspace_id"))],
)
async def list_workspace_documents(
    workspace_id: str = Path(...),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = db,
) -> dict[str, Any]:
    file_id_expr = func.jsonb_extract_path_text(models.Message.internal_metadata, "file_id")
    filename_expr = func.jsonb_extract_path_text(models.Message.internal_metadata, "filename")
    content_type_expr = func.jsonb_extract_path_text(
        models.Message.internal_metadata, "content_type"
    )
    original_size_expr = func.jsonb_extract_path_text(
        models.Message.internal_metadata, "original_file_size"
    )
    total_chunks_expr = func.jsonb_extract_path_text(
        models.Message.internal_metadata, "total_chunks"
    )
    source_type_expr = func.jsonb_extract_path_text(
        models.Message.internal_metadata, "source_type"
    )

    file_total = int(
        (
            await db.execute(
                select(func.count(func.distinct(file_id_expr))).where(
                    models.Message.workspace_name == workspace_id,
                    file_id_expr.isnot(None),
                )
            )
        ).scalar_one()
        or 0
    )
    documents: list[dict[str, Any]] = []

    if offset < file_total:
        file_limit = min(limit, file_total - offset)
        stmt = (
            select(
                file_id_expr.label("file_id"),
                filename_expr.label("filename"),
                content_type_expr.label("content_type"),
                original_size_expr.label("original_file_size"),
                total_chunks_expr.label("total_chunks"),
                source_type_expr.label("source_type"),
                func.min(models.Message.created_at).label("created_at"),
                func.max(models.Message.created_at).label("updated_at"),
                func.count(models.Message.id).label("chunk_count"),
                func.min(models.Message.session_name).label("session_id"),
                func.min(models.Message.peer_name).label("peer_id"),
            )
            .where(
                models.Message.workspace_name == workspace_id,
                file_id_expr.isnot(None),
            )
            .group_by(
                file_id_expr,
                filename_expr,
                content_type_expr,
                original_size_expr,
                total_chunks_expr,
                source_type_expr,
            )
            .order_by(func.max(models.Message.created_at).desc())
            .offset(offset)
            .limit(file_limit)
        )
        rows = (await db.execute(stmt)).all()
        documents.extend(
            [
                {
                    "id": row.file_id,
                    "filename": row.filename,
                    "content_type": row.content_type,
                    "original_file_size": int(row.original_file_size or 0),
                    "total_chunks": int(row.total_chunks or row.chunk_count or 0),
                    "chunk_count": int(row.chunk_count or 0),
                    "session_id": row.session_id,
                    "peer_id": row.peer_id,
                    "source_type": row.source_type or "file_upload",
                    "created_at": _iso(row.created_at),
                    "updated_at": _iso(row.updated_at),
                }
                for row in rows
            ]
        )

    imported_conditions = [
        models.Message.workspace_name == workspace_id,
        file_id_expr.is_(None),
        (
            models.Message.session_name.ilike("diary-%")
            | models.Message.session_name.ilike("document-%")
            | models.Message.session_name.ilike("import-%")
            | models.Message.content.startswith("---\n")
        ),
    ]
    imported_total = int(
        (
            await db.execute(
                select(func.count(models.Message.id)).where(*imported_conditions)
            )
        ).scalar_one()
        or 0
    )

    remaining = max(0, limit - len(documents))
    if remaining:
        imported_offset = max(0, offset - file_total)
        imported_stmt = (
            select(models.Message)
            .where(*imported_conditions)
            .order_by(models.Message.created_at.desc(), models.Message.id.desc())
            .offset(imported_offset)
            .limit(remaining)
        )
        imported_messages = (await db.execute(imported_stmt)).scalars().all()
        for message in imported_messages:
            metadata_filename = (
                message.h_metadata.get("filename")
                or message.h_metadata.get("source_file")
                or message.h_metadata.get("path")
                or message.internal_metadata.get("filename")
            )
            title = str(metadata_filename) if metadata_filename else _title_from_message(message)
            documents.append(
                {
                    "id": message.public_id,
                    "filename": title,
                    "content_type": "text/markdown"
                    if message.content.startswith("---\n")
                    else "text/plain",
                    "original_file_size": len(message.content.encode("utf-8")),
                    "total_chunks": 1,
                    "chunk_count": 1,
                    "session_id": message.session_name,
                    "peer_id": message.peer_name,
                    "source_type": "message_import",
                    "created_at": _iso(message.created_at),
                    "updated_at": _iso(message.created_at),
                }
            )
    total = file_total + imported_total
    return {
        "workspace_id": workspace_id,
        "documents": documents,
        "pagination": {
            "limit": limit,
            "offset": offset,
            "total": total,
            "has_next": offset + limit < total,
            "has_previous": offset > 0,
        },
    }


@router.post(
    "/workspaces/{workspace_id}/documents/upload",
    dependencies=[Depends(require_auth(workspace_name="workspace_id"))],
    status_code=201,
)
async def upload_workspace_document(
    background_tasks: BackgroundTasks,
    workspace_id: str = Path(...),
    file: UploadFile = File(...),
    peer_id: str = Form(...),
    session_id: str | None = Form(None),
    metadata: str | None = Form(None),
    configuration: str | None = Form(None),
    created_at: str | None = Form(None),
    max_chars: int = Form(
        default=settings.MAX_MESSAGE_SIZE,
        ge=1000,
        le=settings.MAX_MESSAGE_SIZE,
    ),
    enqueue_processing: bool = Form(default=True),
    db: AsyncSession = db,
) -> dict[str, Any]:
    if file.size and file.size > settings.MAX_FILE_SIZE:
        raise FileTooLargeError(
            f"File size ({file.size} bytes) exceeds maximum allowed size "
            f"({settings.MAX_FILE_SIZE} bytes)",
        )

    parsed_metadata = _parse_json_form(metadata) or {}
    parsed_configuration = _parse_json_form(configuration)
    parsed_created_at = _parse_created_at(created_at)
    target_session_id = session_id or _safe_session_name(file.filename)

    upload_data = await process_file_uploads_for_messages(
        file=file,
        peer_id=peer_id,
        max_chars=max_chars,
        metadata={
            **parsed_metadata,
            "filename": file.filename,
            "dashboard_import": True,
            "source_type": "file_upload",
        },
        configuration=schemas.MessageConfiguration(**parsed_configuration)
        if parsed_configuration
        else None,
        created_at=parsed_created_at,
    )

    message_creates = [item["message_create"] for item in upload_data]
    created_messages = await crud.create_messages(
        db,
        messages=message_creates,
        workspace_name=workspace_id,
        session_name=target_session_id,
    )

    for message, upload_item in zip(created_messages, upload_data, strict=True):
        message.internal_metadata.update(
            {
                **upload_item["file_metadata"],
                "dashboard_import": True,
                "source_type": "file_upload",
            }
        )
        flag_modified(message, "internal_metadata")
    await db.commit()

    if enqueue_processing:
        payloads = [
            {
                "workspace_name": workspace_id,
                "session_name": target_session_id,
                "message_id": message.id,
                "content": message.content,
                "peer_name": message.peer_name,
                "created_at": message.created_at,
                "message_public_id": message.public_id,
                "seq_in_session": message.seq_in_session,
                "configuration": parsed_configuration,
            }
            for message in created_messages
        ]
        background_tasks.add_task(enqueue, payloads)

    file_metadata = upload_data[0]["file_metadata"]
    return {
        "workspace_id": workspace_id,
        "document": {
            "id": file_metadata["file_id"],
            "filename": file.filename,
            "content_type": file.content_type,
            "original_file_size": file.size or 0,
            "total_chunks": len(upload_data),
            "chunk_count": len(created_messages),
            "session_id": target_session_id,
            "peer_id": peer_id,
            "source_type": "file_upload",
            "created_at": _iso(created_messages[0].created_at)
            if created_messages
            else None,
            "updated_at": _iso(created_messages[-1].created_at)
            if created_messages
            else None,
        },
        "messages_created": len(created_messages),
        "queued": enqueue_processing,
    }


@router.post(
    "/workspaces/{workspace_id}/documents/text",
    dependencies=[Depends(require_auth(workspace_name="workspace_id"))],
    status_code=201,
)
async def import_workspace_text_document(
    background_tasks: BackgroundTasks,
    body: ControlPlaneTextImportRequest = Body(...),
    workspace_id: str = Path(...),
    db: AsyncSession = db,
) -> dict[str, Any]:
    content_size = len(body.content.encode("utf-8"))
    if content_size > settings.MAX_FILE_SIZE:
        raise FileTooLargeError(
            f"Text size ({content_size} bytes) exceeds maximum allowed size "
            f"({settings.MAX_FILE_SIZE} bytes)",
        )

    parsed_created_at = _parse_created_at(body.created_at)
    target_session_id = body.session_id or _safe_session_name(body.title)
    configuration = (
        schemas.MessageConfiguration(**body.configuration)
        if body.configuration
        else None
    )
    chunks = split_text_into_chunks(body.content, max_chars=body.max_chars)
    file_id = generate_nanoid()

    message_creates = [
        schemas.MessageCreate(
            content=chunk or "",
            peer_id=body.peer_id,
            metadata={
                **body.metadata,
                "filename": body.title,
                "dashboard_import": True,
                "source_type": "text_input",
            },
            configuration=configuration,
            created_at=parsed_created_at,
        )
        for chunk in chunks
    ]
    created_messages = await crud.create_messages(
        db,
        messages=message_creates,
        workspace_name=workspace_id,
        session_name=target_session_id,
    )

    for index, message in enumerate(created_messages):
        message.internal_metadata.update(
            {
                "file_id": file_id,
                "filename": body.title,
                "chunk_index": index,
                "total_chunks": len(chunks),
                "original_file_size": content_size,
                "content_type": "text/plain",
                "chunk_character_range": [
                    index * body.max_chars,
                    min((index + 1) * body.max_chars, len(body.content)),
                ],
                "dashboard_import": True,
                "source_type": "text_input",
            }
        )
        flag_modified(message, "internal_metadata")
    await db.commit()

    if body.enqueue_processing:
        payloads = [
            {
                "workspace_name": workspace_id,
                "session_name": target_session_id,
                "message_id": message.id,
                "content": message.content,
                "peer_name": message.peer_name,
                "created_at": message.created_at,
                "message_public_id": message.public_id,
                "seq_in_session": message.seq_in_session,
                "configuration": body.configuration,
            }
            for message in created_messages
        ]
        background_tasks.add_task(enqueue, payloads)

    return {
        "workspace_id": workspace_id,
        "document": {
            "id": file_id,
            "filename": body.title,
            "content_type": "text/plain",
            "original_file_size": content_size,
            "total_chunks": len(chunks),
            "chunk_count": len(created_messages),
            "session_id": target_session_id,
            "peer_id": body.peer_id,
            "source_type": "text_input",
            "created_at": _iso(created_messages[0].created_at)
            if created_messages
            else None,
            "updated_at": _iso(created_messages[-1].created_at)
            if created_messages
            else None,
        },
        "messages_created": len(created_messages),
        "queued": body.enqueue_processing,
    }


@router.post(
    "/workspaces/{workspace_id}/dream",
    dependencies=[Depends(require_auth(workspace_name="workspace_id"))],
    status_code=202,
)
async def schedule_workspace_dream_from_control_plane(
    body: ControlPlaneScheduleDreamRequest = Body(...),
    workspace_id: str = Path(...),
) -> dict[str, Any]:
    if not settings.DREAM.ENABLED:
        raise HTTPException(
            status_code=400,
            detail="Dreams are not enabled in the system configuration",
        )

    observed = body.observed if body.observed is not None else body.observer
    await enqueue_dream(
        workspace_id,
        observer=body.observer,
        observed=observed,
        dream_type=body.dream_type,
        session_name=body.session_id,
    )
    return {
        "workspace_id": workspace_id,
        "observer": body.observer,
        "observed": observed,
        "dream_type": body.dream_type.value,
        "session_id": body.session_id,
        "queued": True,
    }


@router.get(
    "/workspaces/{workspace_id}/status",
    dependencies=[Depends(require_auth(workspace_name="workspace_id"))],
)
async def get_workspace_live_status(
    workspace_id: str = Path(...),
    period_days: int = Query(default=30, ge=1, le=365),
    db: AsyncSession = db,
) -> dict[str, Any]:
    since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(
        days=period_days
    )
    counts = await _workspace_counts(db, workspace_id)

    queue_stmt = (
        select(
            models.QueueItem.task_type,
            func.count().label("total"),
            func.count(case((models.QueueItem.processed.is_(True), 1))).label("completed"),
            func.count(case((models.QueueItem.processed.is_(False), 1))).label("pending"),
            func.count(case((models.QueueItem.last_error.isnot(None), 1))).label("errors"),
        )
        .where(models.QueueItem.workspace_name == workspace_id)
        .group_by(models.QueueItem.task_type)
    )
    queue_rows = (await db.execute(queue_stmt)).all()
    queue_by_type = {
        row.task_type: {
            "total": int(row.total or 0),
            "completed": int(row.completed or 0),
            "pending": int(row.pending or 0),
            "errors": int(row.errors or 0),
        }
        for row in queue_rows
    }

    errors_stmt = (
        select(models.QueueItem)
        .where(
            models.QueueItem.workspace_name == workspace_id,
            models.QueueItem.last_error.isnot(None),
        )
        .order_by(models.QueueItem.created_at.desc())
        .limit(25)
    )
    error_items = [
        {
            "id": item.id,
            "task_type": item.task_type,
            "work_unit_key": item.work_unit_key,
            "last_error": item.last_error,
            "retry_count": item.retry_count,
            "created_at": _iso(item.created_at),
        }
        for item in (await db.execute(errors_stmt)).scalars().all()
    ]

    message_series_stmt = (
        select(
            func.date_trunc("day", models.Message.created_at).label("bucket"),
            func.count(models.Message.id).label("count"),
        )
        .where(
            models.Message.workspace_name == workspace_id,
            models.Message.created_at >= since,
        )
        .group_by("bucket")
        .order_by("bucket")
    )
    message_series = [
        {"date": row.bucket.date().isoformat(), "messages": int(row.count or 0)}
        for row in (await db.execute(message_series_stmt)).all()
    ]

    observation_series_stmt = (
        select(
            func.date_trunc("day", models.Document.created_at).label("bucket"),
            models.Document.level,
            func.count(models.Document.id).label("count"),
        )
        .where(
            models.Document.workspace_name == workspace_id,
            models.Document.deleted_at.is_(None),
            models.Document.created_at >= since,
        )
        .group_by("bucket", models.Document.level)
        .order_by("bucket")
    )
    observations_by_day: dict[str, dict[str, Any]] = {}
    for row in (await db.execute(observation_series_stmt)).all():
        key = row.bucket.date().isoformat()
        bucket = observations_by_day.setdefault(
            key,
            {
                "date": key,
                "explicit": 0,
                "inductive": 0,
                "deductive": 0,
                "contradiction": 0,
            },
        )
        bucket[row.level] = int(row.count or 0)

    level_counts_stmt = (
        select(models.Document.level, func.count(models.Document.id).label("count"))
        .where(
            models.Document.workspace_name == workspace_id,
            models.Document.deleted_at.is_(None),
        )
        .group_by(models.Document.level)
    )
    level_counts = {
        row.level: int(row.count or 0)
        for row in (await db.execute(level_counts_stmt)).all()
    }

    return {
        "workspace_id": workspace_id,
        "counts": counts,
        "queue_by_type": queue_by_type,
        "errors": error_items,
        "series": {
            "messages": message_series,
            "observations": list(observations_by_day.values()),
        },
        "observation_levels": level_counts,
    }
