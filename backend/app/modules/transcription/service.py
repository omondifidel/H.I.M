import io
import shutil
from pathlib import Path
from typing import Optional

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import BadRequest, Conflict, Invalid, NotFound, TooLarge
from app.core.utils import utcnow
from app.modules.auth.models import User
from app.modules.transcription import engine as engines
from app.modules.transcription import merge
from app.modules.search import index as search_index
from app.modules.transcription.models import Transcription, TranscriptionChunk
from app.modules.transcription.schemas import (EngineInfo, Paragraph, SermonOut, Segment, TranscriptionCreate,
                                               TranscriptOut, TranscriptPatch, UploadStatus)

PART_SIZE = 8 * 1024 * 1024  # the browser sends the recording in 8 MB pieces
MAX_PART = 16 * 1024 * 1024
ALLOWED = {".mp3", ".m4a", ".wav", ".ogg", ".oga", ".opus", ".flac", ".aac", ".webm", ".mp4", ".mov", ".mkv", ".wma", ".amr", ".3gp"}
ACTIVE = ("uploading", "queued", "processing")


# ---------- files ----------
def work_root() -> Path:
    return settings.storage_dir / "transcribe"


def job_dir(job_id: str) -> Path:
    return work_root() / job_id


def original_path(job: Transcription) -> Optional[Path]:
    folder = job_dir(job.id)
    if folder.exists():
        for candidate in folder.glob("original.*"):
            return candidate
    return None


def remove_files(job_id: str) -> None:
    shutil.rmtree(job_dir(job_id), ignore_errors=True)


def _extension(filename: str) -> str:
    return Path(filename).suffix.lower()


# ---------- lookups ----------
def get_owned(db: Session, user: User, job_id: str) -> Transcription:
    job = db.get(Transcription, job_id)
    if not job or job.user_id != user.id:
        raise NotFound("Transcription not found")
    return job


def info() -> EngineInfo:
    return EngineInfo(configured=engines.is_configured(), engine=settings.transcribe_engine,
                      max_audio_mb=settings.max_audio_bytes // (1024 * 1024), part_size=PART_SIZE)


# ---------- upload (in pieces, so big files and weak connections work) ----------
def create(db: Session, user: User, data: TranscriptionCreate) -> Transcription:
    ext = _extension(data.filename)
    if ext not in ALLOWED:
        raise Invalid("Use an audio or video file such as MP3, M4A, WAV, OGG, FLAC or MP4")
    if data.size > settings.max_audio_bytes:
        raise TooLarge(f"This file is larger than the {settings.max_audio_bytes // (1024 * 1024)} MB limit")
    language = None if data.mixed else ((data.language or "").strip().lower() or None)
    title = (data.title or Path(data.filename).stem or "Untitled recording").strip()[:300]
    job = Transcription(user_id=user.id, title=title, original_name=data.filename[:300], size=data.size,
                        language=language, vocabulary=data.vocabulary.strip()[:600], bible=data.bible,
                        mixed=data.mixed, chunk_seconds=180 if data.mixed else None)
    db.add(job)
    db.commit()
    job_dir(job.id).joinpath("parts").mkdir(parents=True, exist_ok=True)
    return job


def received_parts(job: Transcription) -> list[int]:
    folder = job_dir(job.id) / "parts"
    if not folder.exists():
        return []
    return sorted(int(p.name) for p in folder.iterdir() if p.name.isdigit())


def upload_status(job: Transcription) -> UploadStatus:
    return UploadStatus(id=job.id, status=job.status, received_parts=received_parts(job), part_size=PART_SIZE)


def save_part(db: Session, user: User, job_id: str, number: int, body: bytes) -> UploadStatus:
    job = get_owned(db, user, job_id)
    if job.status != "uploading":
        raise Conflict("This upload is already finished")
    if number < 0 or not body:
        raise Invalid("Empty or invalid piece")
    if len(body) > MAX_PART:
        raise TooLarge("Piece is too large")
    folder = job_dir(job.id) / "parts"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / str(number)).write_bytes(body)
    return upload_status(job)


def complete(db: Session, user: User, job_id: str, total_parts: int) -> Transcription:
    job = get_owned(db, user, job_id)
    if job.status != "uploading":
        raise Conflict("This upload is already finished")
    if not engines.is_configured():
        raise BadRequest("Transcription is not set up on this server yet (missing API key).")
    have = set(received_parts(job))
    missing = [n for n in range(total_parts) if n not in have]
    if missing:
        raise BadRequest(f"{len(missing)} piece(s) are missing. Resume the upload to send them.")
    folder = job_dir(job.id)
    target = folder / f"original{_extension(job.original_name)}"
    written = 0
    with open(target, "wb") as out:
        for n in range(total_parts):
            data = (folder / "parts" / str(n)).read_bytes()
            written += len(data)
            out.write(data)
    if written != job.size:
        target.unlink(missing_ok=True)
        raise BadRequest(f"The upload is incomplete ({written} of {job.size} bytes). Please try again.")
    shutil.rmtree(folder / "parts", ignore_errors=True)
    job.has_audio, job.status, job.note, job.error = True, "queued", "Waiting for its turn", ""
    db.commit()
    return job


# ---------- listing, reading, editing ----------
def list_for(db: Session, user: User) -> list[Transcription]:
    return list(db.scalars(select(Transcription).where(Transcription.user_id == user.id)
                           .order_by(Transcription.created_at.desc()).limit(200)).all())


def _paragraphs(segments: list[dict]) -> list[Paragraph]:
    return [Paragraph(**p) for p in merge.group_paragraphs(segments)]


def transcript(db: Session, user: User, job_id: str) -> TranscriptOut:
    job = get_owned(db, user, job_id)
    if job.status != "done":
        raise BadRequest("This transcription is not finished yet")
    segments = job.segments or []
    return TranscriptOut(id=job.id, title=job.title, duration=job.duration,
                         segments=[Segment(**s) for s in segments], paragraphs=_paragraphs(segments),
                         notes=job.notes or [])


def patch(db: Session, user: User, job_id: str, data: TranscriptPatch) -> TranscriptOut:
    job = get_owned(db, user, job_id)
    if data.title is not None:
        job.title = data.title.strip()[:300] or job.title
    if data.segments is not None:
        if job.status != "done":
            raise BadRequest("Only finished transcriptions can be edited")
        if len(data.segments) > 30000:
            raise Invalid("Too many segments")
        job.segments = [s.model_dump() for s in data.segments]
        job.text = merge.full_text(job.segments)
    if data.notes is not None:
        job.notes = [n.model_dump() for n in data.notes]
    db.commit()
    search_index.index_sermon(db, job)
    return transcript(db, user, job_id) if job.status == "done" else TranscriptOut(
        id=job.id, title=job.title, duration=job.duration, segments=[], paragraphs=[])


def delete_job(db: Session, user: User, job_id: str) -> None:
    job = get_owned(db, user, job_id)
    db.execute(delete(TranscriptionChunk).where(TranscriptionChunk.transcription_id == job.id))
    db.delete(job)
    db.commit()
    search_index.remove_source(db, job_id)
    remove_files(job_id)


def cancel(db: Session, user: User, job_id: str) -> Transcription:
    job = get_owned(db, user, job_id)
    if job.status in ACTIVE:
        job.status, job.note = "cancelled", "Cancelled"
        db.commit()
    return job


def retry(db: Session, user: User, job_id: str) -> Transcription:
    job = get_owned(db, user, job_id)
    if job.status not in ("failed", "cancelled"):
        raise Conflict("Only failed or cancelled transcriptions can be retried")
    if original_path(job) is None:
        raise BadRequest("The recording is no longer on the server. Please upload it again.")
    job.status, job.error, job.note = "queued", "", "Waiting for its turn"
    db.commit()
    return job


# ---------- listening: every finished sermon can be found in search and played by anyone signed in ----------
def _finished(db: Session, job_id: str) -> Transcription:
    job = db.get(Transcription, job_id)
    if not job or job.status != "done":
        raise NotFound("Sermon not found")
    return job


def sermon(db: Session, user: User, job_id: str) -> SermonOut:
    job = _finished(db, job_id)
    return SermonOut(id=job.id, title=job.title, duration=job.duration, paragraphs=_paragraphs(job.segments or []),
                     mine=job.user_id == user.id, has_audio=original_path(job) is not None)


def sermon_audio(db: Session, job_id: str) -> Path:
    path = original_path(_finished(db, job_id))
    if path is None:
        raise NotFound("The recording is no longer stored on the server")
    return path


def audio_file(db: Session, user: User, job_id: str) -> Path:
    job = get_owned(db, user, job_id)
    path = original_path(job)
    if path is None:
        raise NotFound("The recording is no longer stored on the server")
    return path


# ---------- export ----------
def export(db: Session, user: User, job_id: str, fmt: str, timestamps: bool) -> tuple[bytes, str, str]:
    job = get_owned(db, user, job_id)
    if job.status != "done":
        raise BadRequest("This transcription is not finished yet")
    segments = job.segments or []
    base = "".join(c for c in job.title if c.isalnum() or c in " -_").strip() or "transcript"
    fmt = fmt.lower()
    if fmt == "txt":
        return merge.to_txt(segments, timestamps).encode("utf-8"), "text/plain; charset=utf-8", f"{base}.txt"
    if fmt == "md":
        body = f"# {job.title}\n\n" + merge.to_txt(segments, timestamps)
        return body.encode("utf-8"), "text/markdown; charset=utf-8", f"{base}.md"
    if fmt == "srt":
        return merge.to_srt(segments).encode("utf-8"), "application/x-subrip", f"{base}.srt"
    if fmt == "vtt":
        return merge.to_vtt(segments).encode("utf-8"), "text/vtt", f"{base}.vtt"
    if fmt == "docx":
        from docx import Document  # python-docx

        doc = Document()
        doc.add_heading(job.title, level=1)
        for p in merge.group_paragraphs(segments):
            para = doc.add_paragraph()
            if timestamps:
                para.add_run(merge.stamp(p["start"]) + " ").bold = True
            para.add_run(p["text"])
        buffer = io.BytesIO()
        doc.save(buffer)
        return (buffer.getvalue(),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document", f"{base}.docx")
    raise Invalid("Format must be txt, md, srt, vtt or docx")


# ---------- numbers for the admin area ----------
def totals(db: Session) -> dict:
    done = db.scalar(select(func.count(Transcription.id)).where(Transcription.status == "done")) or 0
    seconds = db.scalar(select(func.coalesce(func.sum(Transcription.duration), 0.0)).where(Transcription.status == "done")) or 0.0
    return {"transcriptions": done, "minutes": int(seconds // 60)}


def touch_updated(job: Transcription) -> None:
    job.updated_at = utcnow()


def usage_by_user(db: Session, since) -> dict[str, tuple[int, int]]:
    """{person: (recordings finished, minutes)} since the given time."""
    rows = db.execute(select(Transcription.user_id, func.count(Transcription.id), func.coalesce(func.sum(Transcription.duration), 0.0))
                      .where(Transcription.status == "done", Transcription.finished_at >= since)
                      .group_by(Transcription.user_id)).all()
    return {uid: (int(n), int(seconds // 60)) for uid, n, seconds in rows}
