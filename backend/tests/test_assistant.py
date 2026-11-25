import os

os.environ.setdefault("DATABASE_URL", "postgresql://u:p@localhost/x")  # never connected in this test
os.environ.setdefault("SECRET_KEY", "test")
os.environ["GROQ_API_KEY"] = "k"

from app.modules.assistant import router as a  # noqa: E402


def test_answer_sends_text_and_question(monkeypatch):
    sent = {}

    class R:
        status_code = 200
        def json(self):
            return {"choices": [{"message": {"content": " Faith comes by hearing. "}}]}

    def fake_post(url, json, **_):
        sent.update(json)
        return R()

    monkeypatch.setattr(a.httpx, "post", fake_post)
    assert a.answer("what about faith?", "[p. 3] Faith comes by hearing.") == "Faith comes by hearing."
    user = sent["messages"][1]["content"]
    assert "Faith comes by hearing" in user and "what about faith?" in user


def test_pick_keeps_relevant_chunks_in_order():
    chunks = ["grace " * 50, "faith and hope", "love " * 50, "faith again"]
    out = a.pick(chunks, "what about faith", limit=40)
    assert out == "faith and hope\nfaith again"
    assert a.pick(["a", "b"], "q") == "a\nb"
