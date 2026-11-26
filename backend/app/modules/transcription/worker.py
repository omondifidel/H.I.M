"""A single background thread that works through queued transcriptions one at a time."""
import datetime as dt
import logging
import threading

from sqlalchemy import select, update

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.utils import utcnow
from app.modules.transcription import pipeline
from app.modules.transcription.models import Transcription
from app.modules.transcription.service import has_audio, remove_files

log = logging.getLogger("transcription")


class Worker:
    def __init__(self) -> None:
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        with SessionLocal() as db:  # work that was running when the server stopped goes back in line
            db.execute(update(Transcription).where(Transcription.status == "processing").values(status="queued", note="Resuming"))
            db.commit()
        self._thread = threading.Thread(target=self._loop, name="transcription-worker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _next_job(self) -> str | None:
        with SessionLocal() as db:
            return db.scalar(select(Transcription.id).where(Transcription.status == "queued").order_by(Transcription.created_at).limit(1))

    def _cleanup(self) -> None:
        """Old recordings are removed to save space; the transcript text is kept."""
        cutoff = utcnow() - dt.timedelta(hours=settings.audio_retention_hours)
        with SessionLocal() as db:
            old = db.scalars(select(Transcription).where(Transcription.has_audio.is_(True), Transcription.updated_at < cutoff,
                                                         Transcription.status.in_(("done", "failed", "cancelled")))).all()
            for job in old:
                remove_files(job.id)
                job.has_audio = has_audio(job)  # still playable from the kept listening copy
                # ponytail: jobs with a kept copy are re-checked every cleanup pass (one storage HEAD each); add a flag column if that grows
            stale = db.scalars(select(Transcription).where(Transcription.status == "uploading", Transcription.created_at < utcnow() - dt.timedelta(hours=24))).all()
            for job in stale:
                remove_files(job.id)
                job.status, job.error = "failed", "The upload was never finished."
            db.commit()

    def _loop(self) -> None:
        ticks = 0
        while not self._stop.is_set():
            try:
                job_id = self._next_job()
                if job_id:
                    pipeline.run_job(job_id)
                    continue
                ticks += 1
                if ticks % 200 == 1:  # about every 10 minutes
                    self._cleanup()
            except Exception:
                log.exception("worker loop error")
            self._stop.wait(3)


worker = Worker()
