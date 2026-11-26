"""The sorting engine without Groq: keyword stage picking, type detection, and never guessing when unsure."""
import dataclasses
import os

os.environ.setdefault("DATABASE_URL", "postgresql://u:p@localhost/x")
os.environ.setdefault("SECRET_KEY", "test")

import pytest  # noqa: E402

from app.modules.library import sorter  # noqa: E402
from app.modules.library.models import Document  # noqa: E402
from app.modules.library.service import kind_of  # noqa: E402


@pytest.fixture(autouse=True)
def no_groq(monkeypatch):
    monkeypatch.setattr(sorter, "settings", dataclasses.replace(sorter.settings, groq_api_key=""))


def test_stage_from_text_and_title():
    pages = ["Prayer is the key. When we pray and intercede, heaven moves. Fasting and prayer go together."] * 3
    s = sorter.classify("The Prayer Code.pdf", pages)
    assert (s.section, s.kind, s.by) == ("Prayer and Intercession", "pdf", "keywords")


def test_long_book_is_a_book():
    s = sorter.classify("Kings and Priests", ["The king and his kingdom, his throne and dominion."] * 60)
    assert (s.section, s.kind) == ("Royalty", "book")


def test_close_call_stays_unsorted():
    s = sorter.classify("Untitled", ["faith prayer anointing royalty restoration excellence"])
    assert s.section == ""


def test_sermon_and_notes_types():
    spoken = "Amen! Turn to your neighbour and say faith. Hallelujah, can I get an amen? Somebody shout! " * 10
    assert sorter.classify("Sunday 3rd", [spoken]).kind == "sermon"
    assert sorter.classify("Faith class notes.pdf", ["faith believe"]).kind == "notes"
    assert sorter.classify("anything", ["x"], kind="sermon").kind == "sermon"


def test_kind_prefers_stored_type():
    assert kind_of(Document(pages=100, doc_type="")) == "book"
    assert kind_of(Document(pages=5, doc_type="")) == "pdf"
    assert kind_of(Document(pages=100, doc_type="notes")) == "notes"
