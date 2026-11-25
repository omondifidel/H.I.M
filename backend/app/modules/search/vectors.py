"""Meaning search: each search chunk gets a Gemini embedding stored in pgvector, so "sermons about trusting
God in hard times" finds passages that never use those words. Optional on purpose: without GEMINI_API_KEY,
or on a database without the pgvector extension, search keeps working with exact words only.
"""
import logging
import threading
import time
from typing import Optional

import httpx
from sqlalchemy import bindparam, cast, column, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session
from sqlalchemy.types import UserDefinedType

from app.core.config import settings
from app.core.database import SessionLocal
from app.modules.search.models import SearchChunk

log = logging.getLogger("search")

DIMS = 768  # pinned: the column, the index and every request must agree, or search silently breaks
MODEL = "gemini-embedding-001"
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:batchEmbedContents"
BATCH = 100  # Gemini's limit per request
# cosine distance; further than this is "not about that". scripts/eval_meaning.py: right answers came in at
# 0.20-0.37, off-topic questions (football, pizza, bitcoin) at 0.45-0.49, so the cut sits in the gap
MAX_DISTANCE = 0.41


class Vector(UserDefinedType):
    """pgvector's type, without needing the pgvector Python package (we only ever send vectors)."""
    cache_ok = True

    def get_col_spec(self, **kw):
        return f"vector({DIMS})"

    def bind_processor(self, dialect):
        return lambda v: None if v is None else "[" + ",".join(f"{x:.6f}" for x in v) + "]"


EMBEDDING = column("embedding", Vector())


def setup(engine: Engine) -> None:
    """Adds the embedding column where pgvector exists (Render, Supabase, Neon...). Safe to run every start."""
    if engine.dialect.name != "postgresql":
        return
    try:
        with engine.begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            conn.execute(text(f"ALTER TABLE search_chunks ADD COLUMN IF NOT EXISTS embedding vector({DIMS})"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_search_chunks_embedding ON search_chunks "
                              "USING hnsw (embedding vector_cosine_ops)"))
    except Exception as exc:  # no pgvector on this database server
        log.info("meaning search is off (pgvector not available): %s", str(exc).splitlines()[0])


_has_column: Optional[bool] = None


def enabled(db: Session) -> bool:
    global _has_column
    if not settings.gemini_api_key or db.bind is None or db.bind.dialect.name != "postgresql":
        return False
    if _has_column is None:
        _has_column = db.execute(text("SELECT 1 FROM information_schema.columns WHERE table_name = 'search_chunks' "
                                      "AND column_name = 'embedding'")).first() is not None
    return _has_column


def embed(texts: list[str], task: str) -> Optional[list[list[float]]]:
    """task: RETRIEVAL_DOCUMENT for what is stored, RETRIEVAL_QUERY for what is searched. None if it failed."""
    if not settings.gemini_api_key or not texts:
        return None
    body = {"requests": [{"model": f"models/{MODEL}", "content": {"parts": [{"text": t[:6000]}]},
                          "taskType": task, "outputDimensionality": DIMS} for t in texts]}
    try:
        r = httpx.post(URL, headers={"x-goog-api-key": settings.gemini_api_key}, json=body, timeout=60)
    except httpx.HTTPError as exc:
        log.warning("embedding request failed: %s", exc)
        return None
    if r.status_code != 200:
        log.warning("embedding request failed: HTTP %s", r.status_code)  # 429 = free-tier limit, retried later
        return None
    return [e["values"] for e in r.json()["embeddings"]]


def embed_missing(db: Session) -> int:
    """Embeds up to one batch of chunks that have none yet. Returns how many were done (0 = nothing to do or failed)."""
    rows = db.execute(text("SELECT id, title, text FROM search_chunks WHERE embedding IS NULL AND text <> '' "
                           "ORDER BY id LIMIT :n"), {"n": BATCH}).all()
    vecs = embed([f"{title}\n{body}" for _, title, body in rows], "RETRIEVAL_DOCUMENT") if rows else None
    if not vecs:
        return 0
    upd = text(f"UPDATE search_chunks SET embedding = CAST(:v AS vector({DIMS})) WHERE id = :id").bindparams(
        bindparam("v", type_=Vector()))
    for (chunk_id, _, _), v in zip(rows, vecs):
        db.execute(upd, {"v": v, "id": chunk_id})
    db.commit()
    return len(rows)


def nearest(db: Session, query: list[float], where: list, limit: int) -> list[tuple[int, float]]:
    """Closest chunks by meaning among those `where` allows: [(id, distance)], nearest first."""
    distance = EMBEDDING.op("<=>")(cast(bindparam("q", query, type_=Vector()), Vector())).label("d")
    rows = db.execute(select(SearchChunk.id, distance).where(*where, EMBEDDING.is_not(None))
                      .order_by(distance).limit(limit)).all()
    return [(i, float(d)) for i, d in rows if d <= MAX_DISTANCE]


def start_worker() -> None:
    """Background thread: embeds new and changed chunks (indexing clears nothing, it adds rows without one)."""
    if not settings.gemini_api_key:
        return

    def run():
        while True:
            try:
                with SessionLocal() as db:
                    done = embed_missing(db) if enabled(db) else 0
            except Exception:
                log.exception("embedding worker")
                done = 0
            time.sleep(2 if done == BATCH else 30)  # more waiting: keep going; otherwise check twice a minute

    threading.Thread(target=run, daemon=True, name="embeddings").start()


def fuse(*rankings: list[int], k: int = 60) -> list[int]:
    """Reciprocal Rank Fusion: ids found by both word and meaning search rise to the top."""
    score: dict[int, float] = {}
    for ranking in rankings:
        for rank, i in enumerate(ranking):
            score[i] = score.get(i, 0.0) + 1.0 / (k + rank + 1)
    return sorted(score, key=lambda i: (-score[i], i))
