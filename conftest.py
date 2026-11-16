import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("REM_DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-123")
    monkeypatch.delenv("REM_ACCESS_CODE", raising=False)
    monkeypatch.setenv("REM_RATE_LIMIT_PER_MIN", "0")
    monkeypatch.setenv("REM_SERVE_FRONTEND", "0")
    return tmp_path


@pytest.fixture
def app(env):
    from backend.app import create_app, _hits
    _hits.clear()
    return create_app()
