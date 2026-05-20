import httpx
import pytest

from src.config import settings
from src.rerank_client import RerankError, RerankResult, apply_rerank_order, rerank


def test_apply_rerank_order_uses_scores_and_preserves_misses() -> None:
    items = ["a", "b", "c", "d"]
    results = [RerankResult(index=2, score=0.9), RerankResult(index=0, score=0.2)]

    assert apply_rerank_order(items, results, limit=3) == ["c", "a", "b"]


@pytest.mark.asyncio
async def test_rerank_posts_common_payload_and_parses_results(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings.RERANK, "ENABLED", True)
    monkeypatch.setattr(settings.RERANK, "MODEL", "BAAI/bge-reranker-v2-m3")
    monkeypatch.setattr(settings.RERANK, "BASE_URL", "https://rerank.example/v1")
    monkeypatch.setattr(settings.RERANK, "API_KEY", "test-key")
    monkeypatch.setattr(settings.RERANK, "API_KEY_ENV", None)
    monkeypatch.setattr(settings.RERANK, "ENDPOINT_PATH", "/rerank")

    seen: dict[str, object] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["authorization"] = request.headers.get("Authorization")
        seen["json"] = request.read().decode()
        return httpx.Response(
            200,
            json={
                "results": [
                    {"index": 1, "relevance_score": 0.8},
                    {"index": 0, "relevance_score": 0.3},
                ]
            },
        )

    transport = httpx.MockTransport(handler)
    original_client = httpx.AsyncClient

    def client_factory(*args: object, **kwargs: object) -> httpx.AsyncClient:
        kwargs["transport"] = transport
        return original_client(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", client_factory)

    results = await rerank("query", ["doc one", "doc two"], top_n=2)

    assert seen["url"] == "https://rerank.example/v1/rerank"
    assert seen["authorization"] == "Bearer test-key"
    assert results == [
        RerankResult(index=1, score=0.8),
        RerankResult(index=0, score=0.3),
    ]


@pytest.mark.asyncio
async def test_rerank_fail_closed_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings.RERANK, "ENABLED", True)
    monkeypatch.setattr(settings.RERANK, "BASE_URL", None)
    monkeypatch.setattr(settings.RERANK, "FAIL_OPEN", False)

    with pytest.raises(RerankError):
        await rerank("query", ["doc"])
