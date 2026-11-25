from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.auth.deps import current_user, require_app
from app.modules.auth.models import User
from app.modules.transcription import service
from app.modules.transcription.schemas import (CompleteIn, EngineInfo, SermonOut, TranscriptionCreate, TranscriptionOut,
                                               TranscriptOut, TranscriptPatch, UploadStatus)

router = APIRouter(prefix="/api/transcriptions", tags=["transcription"])
stt_user = require_app("transcribe")


@router.get("/engine", response_model=EngineInfo)
def engine_info(user: User = Depends(stt_user)):
    return service.info()


@router.get("", response_model=list[TranscriptionOut])
def list_transcriptions(user: User = Depends(stt_user), db: Session = Depends(get_db)):
    return service.list_for(db, user)


@router.post("", response_model=UploadStatus)
def start_upload(data: TranscriptionCreate, user: User = Depends(stt_user), db: Session = Depends(get_db)):
    return service.upload_status(service.create(db, user, data))


@router.get("/{job_id}", response_model=TranscriptionOut)
def get_transcription(job_id: str, user: User = Depends(stt_user), db: Session = Depends(get_db)):
    return service.get_owned(db, user, job_id)


@router.get("/{job_id}/upload", response_model=UploadStatus)
def upload_state(job_id: str, user: User = Depends(stt_user), db: Session = Depends(get_db)):
    return service.upload_status(service.get_owned(db, user, job_id))


@router.put("/{job_id}/parts/{number}", response_model=UploadStatus)
async def upload_part(job_id: str, number: int, request: Request, user: User = Depends(stt_user), db: Session = Depends(get_db)):
    return service.save_part(db, user, job_id, number, await request.body())


@router.post("/{job_id}/complete", response_model=TranscriptionOut)
def complete_upload(job_id: str, data: CompleteIn, user: User = Depends(stt_user), db: Session = Depends(get_db)):
    return service.complete(db, user, job_id, data.parts)


@router.get("/{job_id}/transcript", response_model=TranscriptOut)
def get_transcript(job_id: str, user: User = Depends(stt_user), db: Session = Depends(get_db)):
    return service.transcript(db, user, job_id)


@router.patch("/{job_id}", response_model=TranscriptOut)
def edit_transcript(job_id: str, data: TranscriptPatch, user: User = Depends(stt_user), db: Session = Depends(get_db)):
    return service.patch(db, user, job_id, data)


@router.post("/{job_id}/cancel", response_model=TranscriptionOut)
def cancel(job_id: str, user: User = Depends(stt_user), db: Session = Depends(get_db)):
    return service.cancel(db, user, job_id)


@router.post("/{job_id}/retry", response_model=TranscriptionOut)
def retry(job_id: str, user: User = Depends(stt_user), db: Session = Depends(get_db)):
    return service.retry(db, user, job_id)


@router.delete("/{job_id}", status_code=204)
def delete(job_id: str, user: User = Depends(stt_user), db: Session = Depends(get_db)):
    service.delete_job(db, user, job_id)


@router.get("/{job_id}/audio")
def audio(job_id: str, user: User = Depends(stt_user), db: Session = Depends(get_db)):
    return FileResponse(service.audio_file(db, user, job_id))


# Listening (no Transcribe access needed): sermons found in search open read-only for everyone signed in.
@router.get("/{job_id}/listen", response_model=SermonOut)
def listen(job_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return service.sermon(db, user, job_id)


@router.get("/{job_id}/listen/audio")
def listen_audio(job_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return FileResponse(service.sermon_audio(db, job_id))


@router.get("/{job_id}/export")
def export(job_id: str, format: str = Query("txt"), timestamps: bool = Query(False),
           user: User = Depends(stt_user), db: Session = Depends(get_db)):
    body, media_type, filename = service.export(db, user, job_id, format, timestamps)
    return Response(body, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})
