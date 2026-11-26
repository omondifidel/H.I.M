import os

os.environ.setdefault("DATABASE_URL", "postgresql://u:p@localhost/x")  # never connected in this test
os.environ.setdefault("SECRET_KEY", "test")

import pytest  # noqa: E402

from app.core import storage  # noqa: E402
from app.core.errors import NotFound  # noqa: E402
from app.modules.transcription import service as s  # noqa: E402


def test_editor_audio_falls_back_to_kept_copy(tmp_path, monkeypatch):
    """Once the original recording is cleaned up, the editor still gets the small listening copy."""
    monkeypatch.setattr(s, "get_owned", lambda db, user, job_id: type("J", (), {"id": job_id})())
    monkeypatch.setattr(s, "job_dir", lambda job_id: tmp_path / "transcribe" / job_id)
    monkeypatch.setattr(s, "get_storage", lambda: storage.LocalStorage(tmp_path))
    with pytest.raises(NotFound):
        s.audio_response(None, None, "j1")
    copy = tmp_path / "listen.ogg"
    copy.write_bytes(b"OggS")
    storage.LocalStorage(tmp_path).put_file(s.listen_key("j1"), copy)
    r = s.audio_response(None, None, "j1")
    assert r.media_type == "audio/ogg"
