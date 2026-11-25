"""Voice Q&A: answers a question strictly from the open book page(s) or sermon transcript."""
import re
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.errors import AppError, BadRequest
from app.modules.auth.deps import current_user, require_app
from app.modules.auth.models import User
from app.modules.library.service import get_accessible_document
from app.modules.transcription.service import get_owned
from app.modules.usage.service import record

router = APIRouter(prefix="/api/assistant", tags=["assistant"])

MAX_CONTEXT = 16000  # characters (~4k tokens): fits Groq's free per-minute limit
SYSTEM = (
    "You answer questions about one text: a book or a sermon transcript. Use ONLY the text given. "
    "If the answer is not in it, reply with exactly these four words and nothing else: The text doesn't say. "
    "Answer in under 80 words of plain sentences (it will be read aloud), no lists or markdown. "
    "Mention the page or time when the text shows it."
)


class AskIn(BaseModel):
    question: str = Field(min_length=2, max_length=500)
    document_id: Optional[str] = None
    transcription_id: Optional[str] = None
    context: list[str] = Field(default_factory=list, max_length=400)  # book paragraphs, sent by the reader


class AskOut(BaseModel):
    answer: str


class HeardOut(BaseModel):
    text: str


MAX_CLIP = 5 * 1024 * 1024  # one spoken phrase is far smaller
HINT = "Hey Nasoma. Pause. Resume. Read faster. Go to page 42. Go to minute 5. Bookmark this paragraph. Sepia mode. Take a note. Stop note."


def _words(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z']{3,}", s.lower())}


def pick(chunks: list[str], question: str, limit: int = MAX_CONTEXT) -> str:
    """Keeps the chunks that share the most words with the question, in their original order."""
    if sum(map(len, chunks)) <= limit:
        return "\n".join(chunks)
    q = _words(question)
    ranked = sorted(range(len(chunks)), key=lambda i: -len(q & _words(chunks[i])))
    keep, size = set(), 0
    for i in ranked:
        if size + len(chunks[i]) > limit:
            continue
        keep.add(i)
        size += len(chunks[i])
    # ponytail: word-overlap ranking, swap for embeddings if answers miss relevant passages
    return "\n".join(chunks[i] for i in sorted(keep))


def answer(question: str, text: str) -> str:
    if not settings.groq_api_key:
        raise AppError("Voice Q&A is not set up: GROQ_API_KEY is missing on the server.")
    if not text.strip():
        return "There is no readable text here to answer from."
    try:
        r = httpx.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {settings.groq_api_key}"},
            json={
                "model": settings.groq_chat_model,
                "temperature": 0.2,
                "max_tokens": 600,  # reasoning models spend some tokens thinking first
                "messages": [
                    {"role": "system", "content": SYSTEM},
                    {"role": "user", "content": f"TEXT:\n{text}\n\nQUESTION: {question}"},
                ],
            },
            timeout=60.0,
        )
    except httpx.HTTPError:
        raise AppError("Could not reach the answer service. Try again.")
    if r.status_code == 429:
        raise AppError("Too many questions right now. Wait a minute and ask again.")
    if r.status_code >= 400:
        raise AppError("The answer service had a problem. Try again.")
    return r.json()["choices"][0]["message"]["content"].strip()


@router.post("/ask", response_model=AskOut)
def ask(data: AskIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if data.transcription_id:
        require_app("transcribe")(user)
        job = get_owned(db, user, data.transcription_id)
        chunks = [f"[{int(s['start']) // 60}:{int(s['start']) % 60:02d}] {s['text'].strip()}" for s in job.segments or []]
        app, ref = "transcribe", job.id
    elif data.document_id:
        require_app("library")(user)
        get_accessible_document(db, user, data.document_id)
        chunks, app, ref = data.context, "library", data.document_id
    else:
        raise BadRequest("Open a book or sermon first")
    result = answer(data.question, pick(chunks, data.question))
    record(db, user.id, app, "ask", ref)
    return AskOut(answer=result)


@router.post("/listen", response_model=HeardOut)
def listen(file: UploadFile = File(...), user: User = Depends(current_user)):
    """Speech-to-text for one spoken phrase, used when the browser's own recognition is unavailable."""
    if not settings.groq_api_key:
        raise AppError("Voice is not set up: GROQ_API_KEY is missing on the server.")
    clip = file.file.read(MAX_CLIP + 1)
    if not clip or len(clip) > MAX_CLIP:
        raise BadRequest("Send one short spoken phrase")
    try:
        r = httpx.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {settings.groq_api_key}"},
            files={"file": (file.filename or "speech.webm", clip, file.content_type or "audio/webm")},
            data={"model": settings.groq_model, "response_format": "json", "temperature": "0", "prompt": HINT},
            timeout=30.0,
        )
    except httpx.HTTPError:
        raise AppError("Could not reach the speech service. Try again.")
    if r.status_code == 429:
        raise AppError("Too many voice commands right now. Wait a minute and try again.")
    if r.status_code >= 400:
        raise AppError("The speech service could not understand that recording.")
    return HeardOut(text=r.json().get("text", "").strip())
