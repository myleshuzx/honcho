"""Rerank client for second-stage retrieval scoring."""

import logging
from dataclasses import dataclass
from typing import Any, TypeVar
from urllib.parse import urljoin

import httpx

from src.config import settings

logger = logging.getLogger(__name__)
T = TypeVar("T")


@dataclass(frozen=True)
class RerankResult:
    index: int
    score: float


class RerankError(Exception):
    """Raised when rerank is enabled but the provider call cannot be used."""


def _rerank_url() -> str:
    base_url = settings.RERANK.BASE_URL
    if not base_url:
        raise RerankError("RERANK_BASE_URL must be set when rerank is enabled")
    return urljoin(
        base_url.rstrip("/") + "/",
        settings.RERANK.ENDPOINT_PATH.lstrip("/"),
    )


def _parse_results(payload: dict[str, Any]) -> list[RerankResult]:
    raw_results = payload.get("results")
    if raw_results is None:
        raw_results = payload.get("data")
    if not isinstance(raw_results, list):
        raise RerankError("rerank response must include a results list")

    parsed: list[RerankResult] = []
    for item in raw_results:
        if not isinstance(item, dict):
            continue
        raw_index = item.get("index")
        raw_score = (
            item.get("relevance_score")
            if "relevance_score" in item
            else item.get("score")
        )
        if raw_index is None or raw_score is None:
            continue
        parsed.append(RerankResult(index=int(raw_index), score=float(raw_score)))
    return parsed


async def rerank(
    query: str,
    documents: list[str],
    *,
    top_n: int | None = None,
) -> list[RerankResult]:
    """Rerank documents by relevance to query.

    The expected provider API shape is the common BGE/Jina/Cohere-style
    rerank contract: ``model``, ``query``, ``documents``, and optional
    ``top_n``. The response may expose results as either ``results`` or
    ``data``, with each item carrying ``index`` plus ``relevance_score`` or
    ``score``.
    """
    if not settings.RERANK.ENABLED or not documents:
        return []

    api_key = settings.RERANK.resolved_api_key
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    body: dict[str, Any] = {
        "model": settings.RERANK.MODEL,
        "query": query,
        "documents": documents,
    }
    if top_n is not None:
        body["top_n"] = top_n

    try:
        async with httpx.AsyncClient(timeout=settings.RERANK.TIMEOUT_SECONDS) as client:
            response = await client.post(_rerank_url(), headers=headers, json=body)
            response.raise_for_status()
        results = _parse_results(response.json())
        logger.info(
            "Rerank applied: model=%s candidates=%d returned=%d top_n=%s",
            settings.RERANK.MODEL,
            len(documents),
            len(results),
            top_n,
        )
        return results
    except Exception as e:
        if settings.RERANK.FAIL_OPEN:
            logger.warning("Rerank failed; falling back to retrieval order: %s", e)
            return []
        if isinstance(e, RerankError):
            raise
        raise RerankError(str(e)) from e


def apply_rerank_order(
    items: list[T],
    results: list[RerankResult],
    *,
    limit: int,
) -> list[T]:
    """Apply rerank results, preserving fallback order for ties/misses."""
    if not items or not results:
        return items[:limit]

    original_rank = {index: rank for rank, index in enumerate(range(len(items)))}
    ranked: list[tuple[float, int, T]] = []
    seen: set[int] = set()

    for result in results:
        if result.index < 0 or result.index >= len(items) or result.index in seen:
            continue
        seen.add(result.index)
        ranked.append(
            (-result.score, original_rank[result.index], items[result.index])
        )

    for index, item in enumerate(items):
        if index not in seen:
            ranked.append((0.0, original_rank[index], item))

    ranked.sort(key=lambda row: (row[0], row[1]))
    return [item for _score, _rank, item in ranked[:limit]]
