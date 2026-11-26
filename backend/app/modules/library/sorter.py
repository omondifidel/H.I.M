"""The sorting engine: decides what an upload is (book, short teaching, sermon or notes) and which discipleship
stage it belongs to. Groq reads it when GROQ_API_KEY is set; otherwise (or if Groq fails) keyword counts decide.
It only suggests: a stage is left empty ("Not sorted yet") unless the engine is fairly sure.

Practise on your own files:  python -m app.modules.library.sorter path/to/*.pdf
"""
import json
import logging
import re
from dataclasses import dataclass

from app.core.config import settings
from app.modules.library.models import BOOK_PAGES, SECTIONS, SECTION_NAMES

log = logging.getLogger("sorter")
SAMPLE_CHARS = 9000  # what the engine reads: the start of the text plus a slice from the middle

# Words and phrases that point to each stage. Title hits count 5x. Tune these as the real books come in.
STAGE_WORDS = {
    "Intimacy / Presence of God": ["intimacy", "presence", "secret place", "fellowship with god", "communion", "abide",
                                   "abiding", "worship", "seek his face", "dwell", "closeness", "his presence"],
    "Prayer and Intercession": ["prayer", "pray", "praying", "intercession", "intercede", "intercessor", "travail",
                                "fasting", "supplication", "watchman", "altar", "petition"],
    "Faith": ["faith", "believe", "believing", "unbelief", "doubt", "mustard seed", "substance of things hoped",
              "trust god", "confession", "hebrews 11"],
    "Submission and Fatherhood / Prosperity": ["submission", "submit", "fatherhood", "spiritual father", "sonship",
                                               "honour", "honor", "covering", "prosperity", "wealth", "money",
                                               "tithe", "tithing", "giving", "financial", "harvest"],
    "The Supernatural Life": ["supernatural", "miracle", "miracles", "signs and wonders", "healing", "angels",
                              "gifts of the spirit", "deliverance", "spirit realm", "power of god", "the glory"],
    "Light and Illumination": ["light", "illumination", "illuminate", "revelation", "enlightened", "enlightenment",
                               "eyes of your understanding", "mysteries", "darkness", "wisdom", "insight"],
    "Royalty": ["royalty", "royal", "king", "kings", "kingdom", "throne", "reign", "dominion", "crown", "sceptre",
                "scepter", "prince", "priesthood"],
    "Excellence": ["excellence", "excellent spirit", "excellent", "diligence", "diligent", "distinction",
                   "integrity", "skill", "skilful", "skillful", "daniel"],
    "Yadon / Stature": ["yadon", "stature", "maturity", "mature", "spiritual growth", "measure of the stature",
                        "fullness", "capacity", "grow up", "growth"],
    "The Prophetic": ["prophetic", "prophecy", "prophesy", "prophet", "prophets", "seer", "visions", "dreams",
                      "word of the lord", "voice of god"],
    "Anointing": ["anointing", "anointed", "anoint", "oil", "mantle", "unction", "impartation", "elisha", "elijah"],
    "Restoration": ["restoration", "restore", "restored", "redeem", "redemption", "rebuild", "recover",
                    "years the locust", "brokenness", "second chance"],
    "Relationships": ["relationship", "relationships", "marriage", "husband", "wife", "family", "friendship",
                      "friends", "children", "dating", "courtship", "love one another", "unity"],
}
assert set(STAGE_WORDS) == SECTION_NAMES, "every stage needs words (and no unknown stages)"

# a preacher talking to a room, not an author writing a book
SPOKEN = ["amen", "hallelujah", "praise the lord", "turn to your neighbour", "turn to your neighbor", "somebody",
          "can i get", "glory to god", "lift your hands", "raise your hands", "let us pray", "say with me",
          "shout", "are you with me", "come on"]
SERMON_TITLE = ["sermon", "preached", "preaching", "service", "conference", "message", "transcript", "sunday"]
NOTES_TITLE = ["notes", "note", "outline", "summary", "handout", "points", "study guide", "lesson"]


@dataclass
class Sorted:
    kind: str       # "book" | "pdf" (short teaching) | "sermon" | "notes"
    section: str    # a stage name, or "" when unsure
    reason: str
    by: str         # "groq" or "keywords"


def _count(words: list[str], text: str) -> int:
    return sum(len(re.findall(r"\b" + re.escape(w) + r"\b", text)) for w in words)


def sample(pages: list[str]) -> str:
    text = " ".join(p for p in pages if p)
    if len(text) <= SAMPLE_CHARS:
        return text
    head = text[: SAMPLE_CHARS * 2 // 3]
    mid = len(text) // 2
    return head + " … " + text[mid: mid + SAMPLE_CHARS // 3]


def by_keywords(title: str, text: str, pages: int) -> Sorted:
    t, body = title.lower(), text.lower()
    scores = {name: 5 * _count(words, t) + _count(words, body) for name, words in STAGE_WORDS.items()}
    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    (best, top), (_, second) = ranked[0], ranked[1]
    # ponytail: count threshold, fine for clear-cut books; Groq handles the subtle ones
    sure = top >= 6 and top >= 1.5 * max(second, 1)
    section = best if sure else ""

    words = max(1, len(body.split()))
    spoken = _count(SPOKEN, body)
    if _count(NOTES_TITLE, t):
        kind = "notes"
    elif _count(SERMON_TITLE, t) or spoken >= max(5, words / 400):
        kind = "sermon"
    else:
        kind = "book" if pages > BOOK_PAGES else "pdf"
    top3 = ", ".join(f"{n} {s}" for n, s in ranked[:3] if s)
    why = f"stage scores: {top3 or 'no stage words found'}" + ("" if sure else " (too close to call)")
    return Sorted(kind, section, f"{why}; spoken cues {spoken}", "keywords")


PROMPT = (
    "You sort uploads for a church discipleship library. Decide:\n"
    '1. "type": "teaching" (a book or written teaching), "sermon" (a preached message or its transcript, '
    'spoken style), or "notes" (someone\'s study notes, outline or summary).\n'
    '2. "stage": the ONE discipleship stage it mainly teaches, copied exactly from this list, or "" if it '
    "does not clearly fit one:\n- " + "\n- ".join(name for name, _ in SECTIONS) + "\n"
    '3. "sure": true only if the stage is clearly the main theme.\n'
    '4. "reason": one short sentence.\n'
    "Reply with only a JSON object with those four keys."
)


def by_groq(title: str, text: str, pages: int) -> Sorted:
    import httpx

    r = httpx.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": f"Bearer {settings.groq_api_key}"},
        json={"model": settings.groq_chat_model, "temperature": 0, "max_tokens": 700,
              "messages": [{"role": "system", "content": PROMPT},
                           {"role": "user", "content": f"TITLE: {title}\nPAGES: {pages}\n\nTEXT:\n{text}"}]},
        timeout=60.0,
    )
    r.raise_for_status()
    content = r.json()["choices"][0]["message"]["content"]
    data = json.loads(re.search(r"\{.*\}", content, re.S).group(0))
    stage = str(data.get("stage") or "").strip()
    kind = str(data.get("type") or "teaching").strip().lower()
    if kind not in ("sermon", "notes"):
        kind = "book" if pages > BOOK_PAGES else "pdf"
    section = stage if stage in SECTION_NAMES and data.get("sure") is not False else ""
    return Sorted(kind, section, str(data.get("reason") or "")[:300], "groq")


def classify(title: str, pages: list[str], kind: str = "") -> Sorted:
    """pages = the text of each page (a sermon is one long "page"). kind forces the type, e.g. "sermon"."""
    title = re.sub(r"\.pdf$", "", title or "", flags=re.I)
    text = sample(pages)
    result = None
    if settings.groq_api_key and text.strip():
        try:
            result = by_groq(title, text, len(pages))
        except Exception:  # rate limit, network, odd reply: keywords still give an answer
            log.warning("groq sort failed for %r, using keywords", title, exc_info=True)
    result = result or by_keywords(title, text, len(pages))
    if kind:
        result.kind = kind
    return result


if __name__ == "__main__":
    import sys
    from pathlib import Path

    from app.modules.search.index import pdf_pages

    for path in sys.argv[1:]:
        pages = pdf_pages(Path(path).read_bytes())
        s = classify(Path(path).name, pages)
        print(f"{Path(path).name}\n  type: {s.kind}   stage: {s.section or 'Not sorted yet'}   ({s.by}, {len(pages)} pages)\n"
              f"  why: {s.reason}\n")
