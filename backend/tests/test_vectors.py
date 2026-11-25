import dataclasses
import os

os.environ.setdefault("DATABASE_URL", "postgresql://u:p@localhost/x")  # never connected in this test
os.environ.setdefault("SECRET_KEY", "test")

from app.modules.search import vectors as v  # noqa: E402


def test_fuse_puts_found_by_both_first():
    assert v.fuse([1, 2, 3], [3, 4]) == [3, 1, 2, 4]  # 3 is in both lists
    assert v.fuse([], [9, 8]) == [9, 8]
    assert v.fuse([5], []) == [5]


def test_vector_is_sent_as_pgvector_text():
    send = v.Vector().bind_processor(None)
    assert send([0.5, -1, 0.123456789]) == "[0.500000,-1.000000,0.123457]"
    assert send(None) is None
    assert v.Vector().get_col_spec() == f"vector({v.DIMS})"


def test_embed_reads_gemini_reply_and_fails_softly(monkeypatch):
    monkeypatch.setattr(v, "settings", dataclasses.replace(v.settings, gemini_api_key="k"))  # settings are read-only
    sent = {}

    class R:
        status_code = 200
        def json(self):
            return {"embeddings": [{"values": [0.1] * v.DIMS}, {"values": [0.2] * v.DIMS}]}

    def post(url, headers, json, timeout):
        sent.update(json)
        return R()

    monkeypatch.setattr(v.httpx, "post", post)
    out = v.embed(["a", "b"], "RETRIEVAL_DOCUMENT")
    assert len(out) == 2 and len(out[0]) == v.DIMS
    assert sent["requests"][0]["outputDimensionality"] == v.DIMS and sent["requests"][0]["taskType"] == "RETRIEVAL_DOCUMENT"

    class Limited:
        status_code = 429
    monkeypatch.setattr(v.httpx, "post", lambda *a, **k: Limited())
    assert v.embed(["a"], "RETRIEVAL_QUERY") is None  # free-tier limit: no crash, the worker retries later
    monkeypatch.setattr(v, "settings", dataclasses.replace(v.settings, gemini_api_key=""))
    assert v.embed(["a"], "RETRIEVAL_QUERY") is None  # no key: meaning search is simply off
