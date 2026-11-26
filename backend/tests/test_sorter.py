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


def test_groups_can_be_several_and_follow_the_text():
    pages = ["Prayers for your wife and children, for your marriage and your home and family. "
             "The family foundation and the household must be covered."] * 4
    s = sorter.classify("Warfare and the Home", pages)
    assert "Warfare / Wives and Children" in s.groups and "Intercession / Family" in s.groups
    assert sorter.classify("Untitled", ["nothing relevant here"]).groups == []


def test_syllabus_names_the_groups_despite_messy_file_names():
    assert sorter.syllabus_groups("Power_to_Disgrace_the_Oppressor_D_K_Olukoya_Olukoya,_D_K_z_lib_o.pdf") == [
        "Intercession / Family", "Intercession / Welfare of others", "Warfare / The Afflicted"]
    assert sorter.syllabus_groups("101 Weapons of Spiritual Warfar - D. K. Olukoya-1.pdf") == [
        "Intercession / Family", "Intercession / Kings and Authority", "Intercession / Welfare of others"]
    assert sorter.syllabus_groups("Violence_Against_Negative_Voices_Shade_Olukoya_Olukoya,_Shad.pdf")  # syllabus typo
    assert sorter.syllabus_groups("A Book Nobody Listed.pdf") == []
    s = sorter.classify("D. K. Olukoya; - Choosing Your Life Partner.pdf", ["prayer"])
    assert s.groups == ["Warfare / Men", "Warfare / Wives and Children"] and s.by.endswith("+syllabus")
