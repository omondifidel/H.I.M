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


def test_clean_command_keeps_only_real_actions():
    c = a.clean_command
    assert c({"cmd": "page", "arg": "42"}) == {"cmd": "page", "arg": 42}
    assert c({"cmd": "rate", "arg": 9}) == {"cmd": "rate", "arg": 3.0}  # clamped
    assert c({"cmd": "rate", "arg": "+"}) == {"cmd": "rate", "arg": "+"}
    assert c({"cmd": "skip", "arg": -30}) == {"cmd": "skip", "arg": -30}
    assert c({"cmd": "turn", "arg": -5}) == {"cmd": "turn", "arg": -1}
    assert c({"cmd": "theme", "arg": "sepia"}) == {"cmd": "theme", "arg": "sepia"}
    assert c({"cmd": "pause", "arg": "x"}) == {"cmd": "pause"}
    assert c({"cmd": "readBookmark"}) == {"cmd": "readBookmark"} and c({"cmd": "back"}) == {"cmd": "back"}
    assert c({"cmd": "voice", "arg": "Mary"}) == {"cmd": "voice", "arg": "mary"} and c({"cmd": "voice", "arg": "siri"}) is None
    assert c({"cmd": "sleep", "arg": "999"}) == {"cmd": "sleep", "arg": 240}
    assert c({"cmd": "page", "arg": 10**9}) == {"cmd": "page", "arg": 100000}
    assert c({"cmd": "search", "arg": "faith"}) == {"cmd": "search", "arg": "faith"} and c({"cmd": "openBook", "arg": ""}) is None
    assert c({"cmd": "notes", "arg": "false"}) == {"cmd": "notes", "arg": False}
    for bad in [None, "pause", {"cmd": None}, {"cmd": "deleteEverything"}, {"cmd": "page", "arg": 0},
                {"cmd": "page", "arg": "abc"}, {"cmd": "theme", "arg": "neon"}, {"cmd": "ask", "arg": ""}]:
        assert c(bad) is None, bad


def test_understand_reads_model_json(monkeypatch):
    class R:
        status_code = 200
        def __init__(self, content): self.content = content
        def json(self): return {"choices": [{"message": {"content": self.content}}]}

    monkeypatch.setattr(a.httpx, "post", lambda *_, **__: R('{"cmd": "rate", "arg": "+"}'))
    assert a.understand("bump the speed up a bit") == {"cmd": "rate", "arg": "+"}
    monkeypatch.setattr(a.httpx, "post", lambda *_, **__: R("not json"))
    assert a.understand("blah") is None
