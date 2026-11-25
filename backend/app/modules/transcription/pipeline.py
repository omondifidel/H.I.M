"""Turns one uploaded recording into a transcript: cut into pieces, transcribe each piece, stitch."""
import logging
import math
import shutil
import time
from typing import Callable

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.utils import utcnow
from app.modules.search import index as search_index
from app.modules.transcription import merge
from app.modules.transcription.engine import EngineError, NotConfigured, RateLimited, get_engine
from app.modules.transcription.media import MediaError, make_chunk, probe_duration
from app.modules.transcription.models import Transcription, TranscriptionChunk
from app.modules.transcription.service import job_dir, original_path

log = logging.getLogger("transcription")


class Cancelled(Exception):
    pass


def build_prompt(job: Transcription, tail: str) -> str:
    """Whisper reads only the end of the prompt, so the most useful text goes last:
    vocabulary first, then the last words of the previous piece to keep names and style consistent."""
    parts = []
    if job.mixed:
        parts.append("Mahubiri ya Kiswahili na English. This sermon mixes Swahili and English; write each language as it is spoken.")
    if job.bible:
        parts.append("A sermon with Bible references such as John 3:16 and 1 Corinthians 13.")
    if job.vocabulary:
        parts.append(job.vocabulary)
    if tail:
        parts.append(tail)
    return " ".join(parts)[-700:]


def _check_cancel(db: Session, job: Transcription) -> None:
    db.refresh(job)
    if job.status == "cancelled":
        raise Cancelled()


def _wait(db: Session, job: Transcription, seconds: float, sleep: Callable[[float], None]) -> None:
    waited = 0.0
    while waited < seconds:
        step = min(10.0, seconds - waited)
        sleep(step)
        waited += step
        _check_cancel(db, job)


def _transcribe(db: Session, job: Transcription, engine, audio, prompt: str, sleep: Callable[[float], None]) -> list[dict]:
    attempts = 0
    while attempts < 12:
        attempts += 1
        try:
            result = engine.transcribe(audio, language=job.language, prompt=prompt)
            if job.note:
                job.note = ""
                db.commit()
            return result
        except RateLimited as exc:
            wait = min(exc.retry_after + 2, 3700.0)
            job.note = f"Waiting for the free usage limit to reset (about {math.ceil(wait / 60)} min)"
            db.commit()
            _wait(db, job, wait, sleep)
        except EngineError as exc:
            if exc.retryable and attempts < 5:
                job.note = "The service had a hiccup, trying again"
                db.commit()
                _wait(db, job, 5.0 * attempts, sleep)
                continue
            raise
    raise EngineError("The transcription service kept refusing the request. Please retry later.")


def _process(db: Session, job: Transcription, sleep: Callable[[float], None]) -> None:
    source = original_path(job)
    if source is None:
        raise MediaError("The recording is no longer on the server (it may have restarted). Please upload it again.")
    engine = get_engine()
    if not job.duration:
        job.duration = probe_duration(source)
        db.commit()

    plans = merge.plan_chunks(job.duration, job.chunk_seconds or settings.chunk_seconds, settings.chunk_overlap)
    rows = {r.idx: r for r in db.scalars(select(TranscriptionChunk).where(TranscriptionChunk.transcription_id == job.id)).all()}
    for plan in plans:
        if plan["idx"] not in rows:
            row = TranscriptionChunk(transcription_id=job.id, idx=plan["idx"], status="pending", segments=[])
            db.add(row)
            rows[plan["idx"]] = row
    job.chunks_total = len(plans)
    job.chunks_done = sum(1 for r in rows.values() if r.status == "done")
    db.commit()

    chunk_dir = job_dir(job.id) / "chunks"
    chunk_dir.mkdir(parents=True, exist_ok=True)
    for plan in plans:
        _check_cancel(db, job)
        row = rows[plan["idx"]]
        if row.status == "done":
            continue
        audio = chunk_dir / f"{plan['idx']:05d}.ogg"
        make_chunk(source, audio, plan["a"], plan["b"] - plan["a"])
        previous = rows.get(plan["idx"] - 1)
        tail = " ".join((s.get("text") or "").strip() for s in (previous.segments if previous else [])[-4:])[-300:]
        raw = _transcribe(db, job, engine, audio, build_prompt(job, tail), sleep)
        row.segments, row.status = raw, "done"
        job.chunks_done = sum(1 for r in rows.values() if r.status == "done")
        job.progress = min(99, int(job.chunks_done / job.chunks_total * 100))
        db.commit()
        audio.unlink(missing_ok=True)

    pieces = [{**plan, "segments": rows[plan["idx"]].segments} for plan in plans]
    segments = merge.merge_chunks(pieces)
    job.segments, job.text, job.engine = segments, merge.full_text(segments), engine.name
    job.status, job.progress, job.note, job.finished_at = "done", 100, "", utcnow()
    db.execute(delete(TranscriptionChunk).where(TranscriptionChunk.transcription_id == job.id))  # raw pieces no longer needed
    db.commit()
    search_index.index_sermon(db, job)
    shutil.rmtree(chunk_dir, ignore_errors=True)


def run_job(job_id: str, sleep: Callable[[float], None] = time.sleep) -> None:
    with SessionLocal() as db:
        job = db.get(Transcription, job_id)
        if not job or job.status not in ("queued", "processing"):
            return
        job.status, job.error, job.note = "processing", "", "Starting"
        db.commit()
        try:
            _process(db, job, sleep)
        except Cancelled:
            log.info("job %s cancelled", job_id)
        except (MediaError, EngineError, NotConfigured) as exc:
            db.rollback()
            job.status, job.error, job.note = "failed", str(exc), ""
            db.commit()
        except Exception:
            log.exception("job %s crashed", job_id)
            db.rollback()
            job.status, job.error, job.note = "failed", "Something went wrong while transcribing. Please retry.", ""
            db.commit()
