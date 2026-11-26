"""All settings come from environment variables (or backend/.env). Nothing else reads os.environ."""
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# The apps a person can be given access to. The admin area is controlled by role, not by this list.
APPS = ("library", "transcribe")


def _database_url() -> str:
    url = os.environ["DATABASE_URL"]
    # Hosts such as Neon give "postgresql://..." links; this app uses the psycopg 3 driver.
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def _csv(name: str, default: str = "") -> list[str]:
    return [x.strip().lower() for x in os.environ.get(name, default).split(",") if x.strip()]


@dataclass(frozen=True)
class Settings:
    database_url: str
    secret_key: str
    invite_code: str
    storage_dir: Path
    max_upload_bytes: int
    cors_origins: list[str]
    admin_emails: list[str]
    default_apps: list[str]
    # transcription
    transcribe_engine: str = "groq"          # "groq" or "openai"
    groq_api_key: str = ""
    groq_model: str = "whisper-large-v3"
    groq_chat_model: str = "openai/gpt-oss-120b"  # voice Q&A
    openai_api_key: str = ""
    openai_model: str = "whisper-1"
    max_audio_bytes: int = 4096 * 1024 * 1024
    chunk_seconds: int = 600                 # each piece sent for transcription
    chunk_overlap: int = 2                   # extra seconds on each side so words are not cut
    audio_retention_hours: int = 48          # how long the original recording stays on the server
    # where PDFs are kept: "local" (the server's disk) or "s3" (any S3-compatible bucket: permanent)
    storage_backend: str = "local"
    s3_endpoint: str = ""
    s3_bucket: str = ""
    s3_access_key: str = ""
    s3_secret_key: str = ""
    s3_region: str = "auto"
    token_days: int = 30


def load_settings() -> Settings:
    default_apps = [a for a in _csv("DEFAULT_APPS", "library") if a in APPS] or ["library"]
    return Settings(
        database_url=_database_url(),
        secret_key=os.environ["SECRET_KEY"],
        invite_code=os.environ.get("INVITE_CODE", ""),
        storage_dir=Path(os.environ.get("STORAGE_DIR", "./storage")),
        max_upload_bytes=int(os.environ.get("MAX_UPLOAD_MB", "100")) * 1024 * 1024,
        cors_origins=[o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001").split(",") if o.strip()],
        admin_emails=_csv("ADMIN_EMAILS"),
        default_apps=default_apps,
        transcribe_engine=os.environ.get("TRANSCRIBE_ENGINE", "groq").strip().lower(),
        groq_api_key=os.environ.get("GROQ_API_KEY", "").strip(),
        groq_model=os.environ.get("GROQ_MODEL", "whisper-large-v3").strip(),
        groq_chat_model=os.environ.get("GROQ_CHAT_MODEL", "openai/gpt-oss-120b").strip(),
        openai_api_key=os.environ.get("OPENAI_API_KEY", "").strip(),
        openai_model=os.environ.get("OPENAI_MODEL", "whisper-1").strip(),
        max_audio_bytes=int(os.environ.get("MAX_AUDIO_MB", "4096")) * 1024 * 1024,
        chunk_seconds=int(os.environ.get("CHUNK_SECONDS", "600")),
        chunk_overlap=int(os.environ.get("CHUNK_OVERLAP_SECONDS", "2")),
        audio_retention_hours=int(os.environ.get("AUDIO_RETENTION_HOURS", "48")),
        storage_backend=os.environ.get("STORAGE_BACKEND", "local").strip().lower(),
        s3_endpoint=os.environ.get("S3_ENDPOINT", "").strip(),
        s3_bucket=os.environ.get("S3_BUCKET", "").strip(),
        s3_access_key=os.environ.get("S3_ACCESS_KEY", "").strip(),
        s3_secret_key=os.environ.get("S3_SECRET_KEY", "").strip(),
        s3_region=os.environ.get("S3_REGION", "auto").strip() or "auto",
    )


settings = load_settings()
