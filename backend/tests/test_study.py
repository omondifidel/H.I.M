"""Study tools without the network: summary parsing, long-text trimming, and the verse cache."""
import os

os.environ.setdefault("DATABASE_URL", "postgresql://u:p@localhost/x")
os.environ.setdefault("SECRET_KEY", "test")

import pytest  # noqa: E402

from app.core.errors import AppError  # noqa: E402
from app.modules.assistant import study  # noqa: E402


def test_summary_is_read_from_the_json_and_capped():
    raw = 'Sure! {"takeaways": ["a", "", "b"], "key_points": ["k"] , "prayer_points": "not a list",' \
          ' "reflection_questions": ["q1", "q2", "q3", "q4"]}'
    out = study.parse_summary(raw)
    assert out.takeaways == ["a", "b"] and out.prayer_points == [] and out.reflection_questions == ["q1", "q2", "q3"]
    with pytest.raises(AppError):
        study.parse_summary("no json here")


def test_long_text_keeps_start_middle_and_end():
    text = "A" * 10000 + "M" * 10000 + "Z" * 10000
    out = study.fit(text, 3000)
    assert out.startswith("A") and "M" in out and out.endswith("Z") and len(out) < 3100


def test_verses_are_cached_but_failures_are_not(monkeypatch):
    calls = []
    answers = iter([None, ("John 3:16", "For God so loved", "KJV")])
    monkeypatch.setattr(study, "_fetch_verse", lambda ref, tr: calls.append(ref) or next(answers))
    study._VERSES.clear()
    assert study._verse("John 3:16", "kjv") is None          # network blip
    assert study._verse("John 3:16", "kjv")[1] == "For God so loved"  # tried again
    assert study._verse("john 3:16", "kjv")[1] == "For God so loved"  # from the cache
    assert len(calls) == 2
