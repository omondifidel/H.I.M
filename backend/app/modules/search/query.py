"""Turns a typed or spoken search into exact phrases, Bible references, topic words and a source hint.

"Find me the sermon where the words 'faith moves mountains' were said"
  -> phrases=["faith moves mountains"], kind="sermon"
"Yohana 3:16" -> refs=[["john 3 16", "yohana 3 16"]]   (either language matches)
Pure functions, no database. Check: python -m app.modules.search.query
"""
import re
from dataclasses import dataclass, field
from typing import Optional

# (English, Kiswahili, other spellings). Numbered books are written without the number here.
BOOKS = [
    ("genesis", "mwanzo", "gen"), ("exodus", "kutoka", "exod ex"), ("leviticus", "walawi", "lev"),
    ("numbers", "hesabu", "num"), ("deuteronomy", "kumbukumbu", "deut"), ("joshua", "yoshua", "josh"),
    ("judges", "waamuzi", "judg"), ("ruth", "ruthu", ""), ("samuel", "samweli", "sam"), ("kings", "wafalme", "kgs"),
    ("chronicles", "nyakati", "chron"), ("ezra", "ezra", ""), ("nehemiah", "nehemia", "neh"), ("esther", "esta", "esth"),
    ("job", "ayubu", ""), ("psalms", "zaburi", "psalm ps psa"), ("proverbs", "mithali", "prov"),
    ("ecclesiastes", "mhubiri", "eccl"), ("song of songs", "wimbo ulio bora", "song of solomon"),
    ("isaiah", "isaya", "isa"), ("jeremiah", "yeremia", "jer"), ("lamentations", "maombolezo", "lam"),
    ("ezekiel", "ezekieli", "ezek"), ("daniel", "danieli", "dan"), ("hosea", "hosea", "hos"), ("joel", "yoeli", ""),
    ("amos", "amosi", ""), ("obadiah", "obadia", "obad"), ("jonah", "yona", ""), ("micah", "mika", "mic"),
    ("nahum", "nahumu", ""), ("habakkuk", "habakuki", "hab"), ("zephaniah", "sefania", "zeph"), ("haggai", "hagai", "hag"),
    ("zechariah", "zekaria", "zech"), ("malachi", "malaki", "mal"), ("matthew", "mathayo", "matt mat mt"),
    ("mark", "marko", "mk"), ("luke", "luka", "lk"), ("john", "yohana", "jn"), ("acts", "matendo", ""),
    ("romans", "warumi", "rom"), ("corinthians", "wakorintho", "cor"), ("galatians", "wagalatia", "gal"),
    ("ephesians", "waefeso", "eph"), ("philippians", "wafilipi", "phil"), ("colossians", "wakolosai", "col"),
    ("thessalonians", "wathesalonike", "thess"), ("timothy", "timotheo", "tim"), ("titus", "tito", ""),
    ("philemon", "filemoni", "phlm"), ("hebrews", "waebrania", "heb"), ("james", "yakobo", "jas"),
    ("peter", "petro", "pet"), ("jude", "yuda", ""), ("revelation", "ufunuo", "rev revelations"),
]
_NAME = {}
for en, sw, other in BOOKS:
    for name in (en, sw, *other.split()):
        _NAME[name] = (en, sw)
_ORDINAL = {"first": "1", "second": "2", "third": "3", "1st": "1", "2nd": "2", "3rd": "3", "i": "1", "ii": "2", "iii": "3"}
_BOOK_RE = "|".join(sorted((re.escape(n) for n in _NAME), key=len, reverse=True))
REF = re.compile(rf"\b(?:([123]|first|second|third|1st|2nd|3rd)\s*)?({_BOOK_RE})\.?\s+(\d{{1,3}})(?:\s*[:.]\s*(\d{{1,3}})(?:\s*[-–]\s*\d{{1,3}})?)?\b", re.I)

QUOTED = re.compile(r"[\"“”]([^\"“”]{2,})[\"“”]|(?<![\w])['‘]([^'‘’]{2,}?)['’](?![\w])")
WORDS_SAID = re.compile(r"\b(?:the )?(?:words?|phrase|line|saying)\s+(.+?)\s+(?:(?:was|were|is|are|got|being)\s+)?(?:said|spoken|mentioned|used|preached|quoted)\b", re.I)
KINDS = {"sermon": "sermon", "sermons": "sermon", "message": "sermon", "messages": "sermon", "mahubiri": "sermon", "hubiri": "sermon",
         "book": "book", "books": "book", "pdf": "book", "pdfs": "book", "kitabu": "book", "vitabu": "book",
         "note": "note", "notes": "note", "maandishi": "note"}
# Conversation words that never help find a passage (English + Kiswahili).
FILLER = set("""
a an the and or of to in on at for from with by about into is are was were be been being am do does did done
i me my we our you your he him his she her they them their it its this that these those there here what which who whom
whose where when why how find show search look give get tell let can could would should will please want need
say says said saying talk talks talked talking speak speaks spoke preach preached preaching mention mentioned mentions
any all some one ones part time sir elvin pastor bishop rev reverend apostle brother page pages
nitafutie tafuta nionyeshe onyesha nipe ambapo ambayo ambao ile hiyo hii kwa na ya wa za la cha vya katika kuhusu
alisema anasema alisema mahali wapi nini gani je
""".split())


@dataclass
class Parsed:
    phrases: list[str] = field(default_factory=list)  # every one must appear, words in this order
    refs: list[list[str]] = field(default_factory=list)  # each ref in English and Kiswahili; one of them must appear
    terms: list[str] = field(default_factory=list)  # topic words: more matches rank higher
    kind: Optional[str] = None  # "sermon" | "book" | "note" when the question names one

    @property
    def empty(self) -> bool:
        return not (self.phrases or self.refs or self.terms)

    def needles(self) -> list[str]:
        """Text to look for inside a match, best first (used to find the exact second in a sermon)."""
        return self.phrases + [r for pair in self.refs for r in pair] + self.terms


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s']", " ", s.lower())).strip(" '")


def parse(q: str) -> Parsed:
    out = Parsed()
    text = q.strip()[:500]

    def take_phrase(m: re.Match, quoted: bool = True) -> str:
        phrase = _clean(next(g for g in m.groups() if g))
        # quoted words are kept as typed ("I am that I am"); unquoted "the words were said" left after a quote is not
        if phrase and (quoted or not all(w in FILLER for w in phrase.split())):
            out.phrases.append(phrase)
        return " "

    text = QUOTED.sub(take_phrase, text)
    text = WORDS_SAID.sub(lambda m: take_phrase(m, quoted=False), text)

    def take_ref(m: re.Match) -> str:
        num, book, chapter, verse = m.groups()
        en, sw = _NAME[book.lower()]
        num = _ORDINAL.get((num or "").lower(), num or "")
        tail = " ".join(x for x in (chapter, verse) if x)
        out.refs.append([" ".join(x for x in (num, name, tail) if x) for name in dict.fromkeys((en, sw))])
        return " "

    for i, phrase in enumerate(out.phrases):  # a quoted "John 3:16" is a reference, not a phrase
        if REF.fullmatch(phrase):
            REF.sub(take_ref, phrase)
            out.phrases[i] = ""
    out.phrases = [p for p in out.phrases if p]
    text = REF.sub(take_ref, text)

    for word in _clean(text).split():
        if word in KINDS:
            out.kind = out.kind or KINDS[word]
        elif word not in FILLER and len(word) > 1 and word not in out.terms:
            out.terms.append(word)
    return out


if __name__ == "__main__":
    p = parse("Find me the sermon where the words 'faith moves mountains' were said")
    assert p.phrases == ["faith moves mountains"] and p.kind == "sermon" and not p.terms, p
    p = parse('What did Sir Elvin say about "grace" in John 3:16?')
    assert p.phrases == ["grace"] and p.refs == [["john 3 16", "yohana 3 16"]] and not p.terms, p
    assert parse("Yohana 3:16").refs == [["john 3 16", "yohana 3 16"]]
    assert parse("1 Cor 13").refs == [["1 corinthians 13", "1 wakorintho 13"]]
    assert parse("first corinthians 13:4-7").refs == [["1 corinthians 13 4", "1 wakorintho 13 4"]]
    assert parse("sermons about forgiveness and marriage").terms == ["forgiveness", "marriage"]
    assert parse("sermons about forgiveness and marriage").kind == "sermon"
    assert parse("tafuta mahubiri kuhusu imani").terms == ["imani"] and parse("tafuta mahubiri kuhusu imani").kind == "sermon"
    assert parse("notes on page 4 about prayer").kind == "note"
    assert parse("Job 1").refs == [["job 1", "ayubu 1"]]
    assert parse("Ezra 3").refs == [["ezra 3"]]  # same name in both languages: searched once
    assert parse("I have a job").refs == [] and parse("I have a job").terms == ["have", "job"]  # needs a chapter number
    assert parse("find me the sermon").empty
    assert parse('"I am that I am"').phrases == ["i am that i am"]  # quoted filler words still count
    assert parse("Mark the words “love never fails” were preached").phrases == ["love never fails"]
    print("query.py: all checks passed")
