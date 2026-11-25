"""Application entry point: wires the modules together. No business logic lives here."""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.core.database import Base, SessionLocal, engine
from app.core.errors import AppError
from app.core.migrations import run_migrations
from app.modules.admin.router import router as admin_router
from app.modules.notifications.router import router as notifications_router
from app.modules.auth import service as auth_service
from app.modules.auth.router import router as auth_router
from app.modules.library.router import router as library_router
from app.modules.library.tts import router as tts_router
from app.modules.transcription.router import router as transcription_router
from app.modules.transcription.worker import worker

# Importing the models registers their tables with SQLAlchemy.
from app.modules.auth import models as _auth_models  # noqa: F401
from app.modules.library import models as _library_models  # noqa: F401
from app.modules.transcription import models as _transcription_models  # noqa: F401
from app.modules.usage import models as _usage_models  # noqa: F401
from app.modules.notifications import models as _notification_models  # noqa: F401

ROOT = Path(__file__).resolve().parents[2]  # the project folder (contains backend/ and the frontends)


def init_database() -> None:
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(engine)
    run_migrations(engine)
    with SessionLocal() as db:
        auth_service.sync_admins(db)


def create_app() -> FastAPI:
    init_database()
    @asynccontextmanager
    async def lifespan(_: FastAPI):
        worker.start()  # the background thread that transcribes recordings
        yield
        worker.stop()

    app = FastAPI(title="Read-Aloud PDF", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])

    @app.exception_handler(AppError)
    async def handle_app_error(_: Request, exc: AppError):
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)

    app.include_router(auth_router)
    app.include_router(library_router)
    app.include_router(tts_router)
    app.include_router(transcription_router)
    app.include_router(admin_router)
    app.include_router(notifications_router)

    @app.get("/api/health")
    def health():
        return {"ok": True}

    # Each frontend is a static build. The library is served at "/", the others under their own path.
    @app.get("/admin")
    def admin_redirect():
        return RedirectResponse("/admin/")

    @app.get("/transcribe")
    def transcribe_redirect():
        return RedirectResponse("/transcribe/")

    admin_dir = ROOT / "frontend-admin" / "out"
    if admin_dir.exists():
        app.mount("/admin", StaticFiles(directory=admin_dir, html=True), name="admin")
    stt_dir = ROOT / "frontend-stt" / "out"
    if stt_dir.exists():
        app.mount("/transcribe", StaticFiles(directory=stt_dir, html=True), name="transcribe")
    library_dir = ROOT / "frontend" / "out"
    if library_dir.exists():
        app.mount("/", StaticFiles(directory=library_dir, html=True), name="library")  # keep LAST
    return app


app = create_app()
