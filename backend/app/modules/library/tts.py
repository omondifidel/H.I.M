import hashlib
from pathlib import Path
import edge_tts
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.core.config import settings

router = APIRouter(prefix="/api/tts", tags=["tts"])

HUMAN_VOICES = {
    "ann": {"id": "en-US-AriaNeural", "name": "Ann", "accent": "US · Warm & natural"},
    "mary": {"id": "en-GB-SoniaNeural", "name": "Mary", "accent": "UK · Calm & clear"},
    "brian": {"id": "en-US-BrianNeural", "name": "Brian", "accent": "US · Deep & steady"},
    "andrew": {"id": "en-US-AndrewNeural", "name": "Andrew", "accent": "US · Expressive storyteller"},
}

LEGACY_MAP = {"aria": "ann", "sonia": "mary"}


class SpeakRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2500)
    voice: str = Field(default="ann")


@router.get("/voices")
def list_voices():
    return [{"key": k, "name": v["name"], "accent": v["accent"]} for k, v in HUMAN_VOICES.items()]


@router.post("/speak")
async def speak(req: SpeakRequest):
    clean = " ".join(req.text.split()).strip()
    if not clean:
        raise HTTPException(status_code=400, detail="Empty text")
    key = LEGACY_MAP.get(req.voice, req.voice)
    v = HUMAN_VOICES.get(key, HUMAN_VOICES["ann"])
    cache_dir = Path(settings.storage_dir) / "tts_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(f"{v['id']}:{clean}".encode("utf-8")).hexdigest()[:32]
    out_file = cache_dir / f"{digest}.mp3"

    if not out_file.exists() or out_file.stat().st_size == 0:
        tmp_file = cache_dir / f"{digest}.tmp.mp3"
        try:
            comm = edge_tts.Communicate(clean, v["id"])
            await comm.save(str(tmp_file))
            tmp_file.replace(out_file)
        except Exception as exc:
            if tmp_file.exists():
                tmp_file.unlink(missing_ok=True)
            raise HTTPException(status_code=502, detail=f"Neural TTS unavailable: {exc}")

    return FileResponse(out_file, media_type="audio/mpeg")
