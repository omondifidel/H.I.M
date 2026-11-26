"""Interactive study: 1-click summaries (takeaways, key points, prayer points, reflection questions),
"explain simply" for a highlighted sentence, and Bible verses for the scripture popovers."""
import json
import re
import time
from typing import Optional
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.errors import AppError, BadRequest, NotFound
from app.modules.auth.deps import current_user, require_app
from app.modules.auth.models import User
from app.modules.library.service import get_accessible_document
from app.modules.transcription import service as sermons
from app.modules.usage.service import record

router = APIRouter(prefix="/api/study", tags=["study"])
MAX_TEXT = 16000  # characters (~4k tokens): fits Groq's free per-minute limit

SUMMARY = (
    "You help members of a church discipleship programme study a book chapter or a sermon transcript. "
    "Use ONLY the text given; do not invent content or scripture that is not in it. Reply with a JSON object:\n"
    '{"takeaways": [3 to 5 short sentences, the main lessons],\n'
    ' "key_points": [4 to 6 short bullet points, the teaching in order],\n'
    ' "prayer_points": [3 to 5 prayer points drawn from the text, written as prayers in the first person],\n'
    ' "reflection_questions": [3 personal questions that help the reader apply this to their life]}\n'
    "Plain sentences, no markdown."
)
EXPLAIN = (
    "Explain the highlighted words from a Christian book or sermon in simple, warm language a new believer or a "
    "teenager would understand. Use the surrounding text only to understand the meaning. 2 to 4 short sentences, "
    "no markdown, no lists."
)


def chat(system: str, user_text: str, max_tokens: int, as_json: bool = False) -> str:
    if not settings.groq_api_key:
        raise AppError("Study tools are not set up: GROQ_API_KEY is missing on the server.")
    body = {"model": settings.groq_chat_model, "temperature": 0.3, "max_tokens": max_tokens,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user_text}]}
    if as_json:
        body["response_format"] = {"type": "json_object"}
    for attempt in range(2):
        try:
            r = httpx.post("https://api.groq.com/openai/v1/chat/completions",
                           headers={"Authorization": f"Bearer {settings.groq_api_key}"}, json=body, timeout=90.0)
        except httpx.HTTPError:
            raise AppError("Could not reach the study service. Try again.")
        wait = float(r.headers.get("retry-after") or 99)
        if r.status_code != 429 or attempt or wait > 20:
            break
        time.sleep(wait)  # the free tier counts tokens per minute; a chapter often fits after a short wait
    if r.status_code == 429:
        raise AppError("The study helper is busy. Wait a minute and try again.")
    if r.status_code >= 400:
        raise AppError("The study helper had a problem. Try again.")
    return r.json()["choices"][0]["message"]["content"].strip()


class SummaryIn(BaseModel):
    document_id: Optional[str] = None
    transcription_id: Optional[str] = None
    label: str = Field(default="", max_length=200)  # "Chapter 3" or "Pages 12-18", shown to the model
    context: list[str] = Field(default_factory=list, max_length=4000)  # book paragraphs, sent by the reader


class SummaryOut(BaseModel):
    takeaways: list[str] = []
    key_points: list[str] = []
    prayer_points: list[str] = []
    reflection_questions: list[str] = []


def _strings(value, limit: int) -> list[str]:
    return [str(v).strip()[:400] for v in value if str(v).strip()][:limit] if isinstance(value, list) else []


def parse_summary(content: str) -> SummaryOut:
    try:
        data = json.loads(re.search(r"\{.*\}", content, re.S).group(0))
    except (AttributeError, ValueError):
        raise AppError("The study helper gave an unreadable answer. Try again.")
    return SummaryOut(takeaways=_strings(data.get("takeaways"), 5), key_points=_strings(data.get("key_points"), 6),
                      prayer_points=_strings(data.get("prayer_points"), 5),
                      reflection_questions=_strings(data.get("reflection_questions"), 3))


def _source_text(db: Session, user: User, data: SummaryIn) -> tuple[str, str, str]:
    """(text, app, ref). Books send their paragraphs; sermons are read here, with the listening rules."""
    if data.transcription_id:
        sermon = sermons.sermon(db, user, data.transcription_id)  # anyone signed in may listen
        return "\n".join(p.text for p in sermon.paragraphs), "library", sermon.id
    if data.document_id:
        require_app("library")(user)
        get_accessible_document(db, user, data.document_id)
        return "\n".join(data.context), "library", data.document_id
    raise BadRequest("Open a book or sermon first")


def fit(text: str, limit: int = MAX_TEXT) -> str:
    """Long chapters: keep the start, middle and end so the summary covers the whole arc."""
    if len(text) <= limit:
        return text
    third = limit // 3
    mid = len(text) // 2
    return f"{text[:third]}\n…\n{text[mid - third // 2: mid + third // 2]}\n…\n{text[-third:]}"


@router.post("/summary", response_model=SummaryOut)
def summary(data: SummaryIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    text, app, ref = _source_text(db, user, data)
    if not text.strip():
        raise BadRequest("There is no readable text here to summarise.")
    out = parse_summary(chat(SUMMARY, f"{data.label}\n\nTEXT:\n{fit(text)}", 1800, as_json=True))
    record(db, user.id, app, "summary", ref)
    return out


class ExplainIn(BaseModel):
    text: str = Field(min_length=3, max_length=1500)
    around: str = Field(default="", max_length=3000)


@router.post("/explain")
def explain(data: ExplainIn, user: User = Depends(current_user)):
    return {"explanation": chat(EXPLAIN, f"AROUND IT:\n{data.around}\n\nHIGHLIGHTED:\n{data.text}", 700)}


_VERSES: dict = {}  # verses never change; also keeps us well inside bible-api.com's rate limit


def _verse(ref: str, translation: str) -> Optional[tuple[str, str, str]]:
    key = (ref.lower(), translation)
    if key not in _VERSES:
        found = _fetch_verse(ref, translation)
        if found is None:
            return None  # not cached: a network blip should not hide the verse for good
        if len(_VERSES) > 5000:  # ponytail: crude bound, an LRU if memory ever matters
            _VERSES.clear()
        _VERSES[key] = found
    return _VERSES[key]


def _fetch_verse(ref: str, translation: str) -> Optional[tuple[str, str, str]]:
    try:
        r = httpx.get(f"https://bible-api.com/{quote(ref)}", params={"translation": translation}, timeout=15.0)
    except httpx.HTTPError:
        return None
    if r.status_code != 200:
        return None
    d = r.json()
    text = " ".join((d.get("text") or "").split())
    return (d.get("reference") or ref, text, d.get("translation_name") or translation.upper()) if text else None


@router.get("/verse")
def verse(ref: str = Query(min_length=3, max_length=60), translation: str = Query("kjv", pattern="^(kjv|web)$"),
          user: User = Depends(current_user)):
    found = _verse(" ".join(ref.split()), translation)
    if found is None:
        raise NotFound("That passage could not be found.")
    reference, text, name = found
    return {"reference": reference, "text": text[:3000], "translation": name}
