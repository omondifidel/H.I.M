"""Voice Q&A: answers a question strictly from the open book page(s) or sermon transcript."""
import json
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


# ---------- understanding any wording of a voice command ----------
# The phone/browser matches common phrasings itself; anything it can't match comes here and the
# chat model maps it to one of the actions the app has. It can only choose from this list.
COMMANDS = """pause: stop reading or playing
resume: start reading or playing again
rate: reading speed; arg is a number 0.5 to 3, or "+" for faster / "-" for slower
page: go to a page; arg is the page number, 1 for the first page, 100000 for the last page
minute: go to a minute in a sermon; arg is the minute number
skip: jump back or forward in a sermon; arg is seconds, negative for back
paragraph: next or previous paragraph; arg is 1 or -1
turn: next or previous page; arg is 1 or -1
bookmark: bookmark (save) the current place
readBookmark: go to the saved bookmark and read or play from it ("reread the bookmarked paragraph")
back: return to where the user was before the last jump ("take me back", "where was I")
repeat: read or play the current paragraph again from its start
theme: change colours; arg is "dark", "light" or "sepia"
note: start a note; arg is the words to write, or "" to just open a new note
notes: show the notes (arg true) or close them (arg false)
lastNote: go to the most recent note
deleteNote: delete the open note
handsfree: turn hands-free listening on (arg true) or off (arg false)
voice: change the reading voice; arg is "ann", "mary", "brian" or "andrew"
sleep: stop reading after some minutes; arg is the minutes, 0 to cancel the sleep timer
highlight: highlight the sentence being read; arg true (on) or false (off)
where: say where the user is (page, paragraph, time in the sermon, how much is left)
home: leave the book or sermon and go back to the library
search: search every book, sermon and note for words or a topic; arg is what to look for
openBook: open another book; arg is its title or part of the title
undo: undo the last edit in the sermon transcript
save: save the sermon transcript now
export: download the sermon transcript as a file
nextCheck: go to the next uncertain word in the sermon transcript
help: say which commands exist
ask: a question about the open book or sermon; arg is the question"""
INTENT = (
    "Map one spoken request (English, Kiswahili or mixed) to exactly one app action. Actions:\n" + COMMANDS +
    '\nReply with JSON only: {"cmd": "<action>", "arg": <value or null>}. '
    'If the request matches none of them, reply {"cmd": null}.'
)
_NO_ARG = {"pause", "resume", "bookmark", "readBookmark", "back", "repeat", "lastNote", "deleteNote", "help",
           "where", "home", "undo", "save", "export", "nextCheck"}
_VOICES = ("ann", "mary", "brian", "andrew")


class HeardText(BaseModel):
    text: str = Field(min_length=1, max_length=300)


class CommandOut(BaseModel):
    command: Optional[dict] = None


def clean_command(raw) -> Optional[dict]:
    """Keeps only actions the app has, with sensible values. Anything else becomes None."""
    if not isinstance(raw, dict) or not isinstance(raw.get("cmd"), str):
        return None
    cmd, arg = raw["cmd"], raw.get("arg")
    try:
        if cmd in _NO_ARG:
            return {"cmd": cmd}
        if cmd == "rate":
            return {"cmd": cmd, "arg": arg if arg in ("+", "-") else min(3.0, max(0.5, float(arg)))}
        if cmd in ("page", "minute"):
            n = min(100000, int(float(arg)))
            return {"cmd": cmd, "arg": n} if n >= (1 if cmd == "page" else 0) else None
        if cmd == "voice":
            v = str(arg or "").strip().lower()
            return {"cmd": cmd, "arg": v} if v in _VOICES else None
        if cmd == "sleep":
            return {"cmd": cmd, "arg": max(0, min(240, int(float(arg or 0))))}
        if cmd == "highlight":
            return {"cmd": cmd, "arg": arg is True or str(arg).lower() in ("true", "on", "1")}
        if cmd == "skip":
            return {"cmd": cmd, "arg": max(-3600, min(3600, int(float(arg))))}
        if cmd in ("paragraph", "turn"):
            return {"cmd": cmd, "arg": -1 if float(arg) < 0 else 1}
        if cmd == "theme":
            return {"cmd": cmd, "arg": arg} if arg in ("dark", "light", "sepia") else None
        if cmd in ("notes", "handsfree"):
            return {"cmd": cmd, "arg": arg is True or str(arg).lower() in ("true", "on", "1")}
        if cmd in ("note", "ask", "search", "openBook"):
            text = str(arg or "").strip()[:500]
            return {"cmd": cmd, "arg": text} if text or cmd == "note" else None
    except (TypeError, ValueError):
        return None
    return None


def understand(text: str) -> Optional[dict]:
    if not settings.groq_api_key:
        return None  # the fixed phrases still work without a key
    try:
        r = httpx.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {settings.groq_api_key}"},
            json={
                "model": settings.groq_chat_model,
                "temperature": 0,
                "max_tokens": 400,  # reasoning models think first
                "response_format": {"type": "json_object"},
                "messages": [{"role": "system", "content": INTENT}, {"role": "user", "content": text}],
            },
            timeout=20.0,
        )
        if r.status_code >= 400:
            return None
        return clean_command(json.loads(r.json()["choices"][0]["message"]["content"]))
    except (httpx.HTTPError, ValueError, KeyError, IndexError):
        return None


@router.post("/command", response_model=CommandOut)
def command(data: HeardText, user: User = Depends(current_user)):
    return CommandOut(command=understand(data.text))
