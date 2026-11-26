"""Deep Word Finder: one search over book pages, sermon paragraphs and your notes.

Who sees what: sermons are searchable by everyone; books only by people who may open them (owner or shared,
same rule as the library); notes only by the person who wrote them.
"""
import re
from functools import reduce
from typing import Optional

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import BadRequest
from app.modules.auth.groups import group_ids_for
from app.modules.auth.models import User
from app.modules.auth.service import user_apps
from app.modules.library.models import Document, DocumentShare
from app.modules.library.service import _share_condition
from app.modules.search.models import SearchChunk
from app.modules.search.query import Parsed, parse
from app.modules.transcription.models import Transcription

ON, OFF = "\x02", "\x03"  # highlight markers, never present in real text
HEADLINE = f"StartSel={ON}, StopSel={OFF}, MaxWords=35, MinWords=15, MaxFragments=2, FragmentDelimiter=\" … \""
KINDS = ("sermon", "book", "note")


def _join(parts: list, op: str):
    return reduce(lambda a, b: a.op(op)(b), parts)


def _queries(p: Parsed):
    """(what must match, what ranks higher). Phrases and references are required; topic words rank."""
    phrase = lambda s: func.phraseto_tsquery("simple", s)  # noqa: E731
    required = [phrase(x) for x in p.phrases] + [_join([phrase(v) for v in ref], "||") for ref in p.refs]
    terms = _join([func.plainto_tsquery("simple", t) for t in p.terms], "||") if p.terms else None
    if not required:
        return terms, terms
    must = _join(required, "&&")
    return must, (_join([must, terms], "||") if terms is not None else must)


def _visible(db: Session, user: User):
    library = "library" in user_apps(user)
    rules = [SearchChunk.kind == "sermon",
             and_(SearchChunk.kind == "note", SearchChunk.user_id == user.id,
                  or_(SearchChunk.start.is_not(None), library))]  # book notes open in the library
    if library:
        shared = select(DocumentShare.document_id).where(_share_condition(user, group_ids_for(db, user)))
        rules.append(and_(SearchChunk.kind == "book", or_(SearchChunk.user_id == user.id, SearchChunk.source_id.in_(shared))))
    return or_(*rules)


def exact_second(text: str, start: Optional[float], times: Optional[list], needles: list[str]) -> Optional[float]:
    """The second the first matching words were spoken, from the paragraph's sentence start times."""
    low = text.casefold()
    for needle in needles:
        m = re.search(r"\b" + r"\W+".join(map(re.escape, needle.split())) + r"\b", low)
        if m:
            best = start
            for offset, seconds in times or []:
                if offset > m.start():
                    break
                best = seconds
            return best
    return start


def snippet_parts(s: str) -> list[dict]:
    """ "a \x02b\x03 c" -> [{t: "a "}, {t: "b", hit: True}, {t: " c"}] so the page never renders HTML."""
    parts = []
    for i, piece in enumerate(re.split(f"[{ON}{OFF}]", s)):
        if piece:
            parts.append({"t": piece, "hit": i % 2 == 1})
    return parts


def _in_section(section: str):
    """Discipleship Stage: PDFs and sermons sorted into that section, and your notes on them."""
    return SearchChunk.source_id.in_(select(Document.id).where(Document.section == section)
                                     .union(select(Transcription.id).where(Transcription.section == section)))


def _sqlite_search(db: Session, user: User, parsed: Parsed, kind: str, limit: int, section: str = "") -> dict:
    where = [_visible(db, user)]
    if kind in KINDS:
        where.append(SearchChunk.kind == kind)
    if section:
        where.append(_in_section(section))
    chunks = db.execute(select(SearchChunk).where(*where)).scalars().all()

    def _has_phrase(norm_text: str, phrase: str) -> bool:
        return bool(re.search(r"\b" + r"\W+".join(map(re.escape, phrase.split())) + r"\b", norm_text))

    scored = []
    needles = parsed.needles()
    for ch in chunks:
        low = f"{ch.title or ''} {ch.text or ''}".casefold()
        if any(not _has_phrase(low, ph) for ph in parsed.phrases):
            continue
        if any(not any(_has_phrase(low, v) for v in ref) for ref in parsed.refs):
            continue
        hits = sum(len(re.findall(r"\b" + r"\W+".join(map(re.escape, n.split())) + r"\b", low)) for n in needles)
        if hits == 0:
            continue
        scored.append((hits, ch))

    scored.sort(key=lambda item: (-item[0], item[1].id))
    results = []
    pat = re.compile("(" + "|".join(r"\b" + r"\W+".join(map(re.escape, n.split())) + r"\b" for n in needles) + ")", re.I)
    for hits, ch in scored[:limit]:
        raw = ch.text or ""
        m = pat.search(raw)
        c_start = max(0, (m.start() - 90) if m else 0)
        c_end = min(len(raw), c_start + 240)
        window = ("… " if c_start > 0 else "") + raw[c_start:c_end].strip() + (" …" if c_end < len(raw) else "")
        marked = pat.sub(f"{ON}\\1{OFF}", window)
        start = exact_second(raw, ch.start, ch.times, needles) if ch.kind == "sermon" else ch.start
        results.append({
            "kind": ch.kind, "id": ch.source_id, "title": ch.title, "page": ch.page,
            "start": start, "snippet": snippet_parts(marked), "mine": ch.user_id == user.id,
            "score": round(float(hits) * 0.1, 4),
        })
    return {"kind": kind, "parsed": {"phrases": parsed.phrases, "refs": [r[0] for r in parsed.refs], "terms": parsed.terms},
            "results": results}


def search(db: Session, user: User, q: str, kind: str = "all", limit: int = 30, section: str = "") -> dict:
    parsed = parse(q)
    if parsed.empty:
        raise BadRequest("Type a word, a phrase in quotes, or a Bible verse to search for")
    if kind == "all" and parsed.kind:
        kind = parsed.kind
    if db.bind is not None and db.bind.dialect.name == "sqlite":
        return _sqlite_search(db, user, parsed, kind, limit, section)
    must, rank = _queries(parsed)
    where = [SearchChunk.tsv.op("@@")(must), _visible(db, user)]
    if kind in KINDS:
        where.append(SearchChunk.kind == kind)
    if section:
        where.append(_in_section(section))
    # rank first, then build snippets only for the rows that are returned
    top = (select(SearchChunk.id, func.ts_rank_cd(SearchChunk.tsv, rank).label("rank"))
           .where(*where).order_by(func.ts_rank_cd(SearchChunk.tsv, rank).desc(), SearchChunk.id).limit(limit).subquery())
    rows = db.execute(select(SearchChunk, top.c.rank, func.ts_headline("simple", SearchChunk.text, rank, HEADLINE))
                      .join(top, top.c.id == SearchChunk.id).order_by(top.c.rank.desc(), SearchChunk.id)).all()
    needles = parsed.needles()
    results = []
    for chunk, score, headline in rows:
        start = exact_second(chunk.text, chunk.start, chunk.times, needles) if chunk.kind == "sermon" else chunk.start
        results.append({"kind": chunk.kind, "id": chunk.source_id, "title": chunk.title, "page": chunk.page,
                        "start": start, "snippet": snippet_parts(headline), "mine": chunk.user_id == user.id,
                        "score": round(float(score), 4)})
    return {"kind": kind, "parsed": {"phrases": parsed.phrases, "refs": [r[0] for r in parsed.refs], "terms": parsed.terms},
            "results": results}
