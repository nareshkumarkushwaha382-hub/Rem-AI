"""Configuration, read from environment variables (never hard-code secrets).

For local development you can put values in a `.env` file (see .env.example).
On a hosting service, set them in the service's "Environment / Secrets" panel.
"""
import os
from pathlib import Path

try:  # python-dotenv is optional at runtime
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:  # pragma: no cover
    pass

ROOT_DIR = Path(__file__).resolve().parent.parent


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def get_settings() -> dict:
    """Read settings at call time so tests can change the environment."""
    origins = os.environ.get("REM_ALLOWED_ORIGINS", "*")
    return {
        "gemini_api_key": os.environ.get("GEMINI_API_KEY", "").strip(),
        "gemini_model": os.environ.get("GEMINI_MODEL", "gemini-2.5-flash").strip(),
        "gemini_api_base": os.environ.get(
            "GEMINI_API_BASE", "https://generativelanguage.googleapis.com/v1beta"
        ).rstrip("/"),
        "db_path": os.environ.get("REM_DB_PATH", str(ROOT_DIR / "rem_memory.db")),
        "access_code": os.environ.get("REM_ACCESS_CODE", "").strip(),
        "allowed_origins": [o.strip() for o in origins.split(",") if o.strip()],
        "rate_limit_per_min": _int("REM_RATE_LIMIT_PER_MIN", 20),
        "history_turns": _int("REM_HISTORY_TURNS", 12),
        "max_memories": _int("REM_MAX_MEMORIES", 200),
        "serve_frontend": os.environ.get("REM_SERVE_FRONTEND", "1") != "0",
    }
