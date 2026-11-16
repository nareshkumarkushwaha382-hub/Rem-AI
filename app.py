"""Rem AI web API (Starlette). Run with:  uvicorn backend.app:app --reload

Endpoints (all under /api):
  GET    /health
  POST   /chat                 {message}
  GET    /history              DELETE /history
  GET    /memories             POST /memories {content, category?}
  PUT    /memories/{id}        DELETE /memories/{id}
  POST   /memories/import      {memories: [{content, category?}]}
"""
import hmac
import time
from collections import defaultdict, deque

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from . import db
from .config import ROOT_DIR, get_settings
from .gemini import GeminiError, generate_reply

MAX_BODY = 20_000
_hits: dict[str, deque] = defaultdict(deque)


def _err(message: str, status: int) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _rate_limited(request: Request, limit: int) -> bool:
    if limit <= 0:
        return False
    now = time.monotonic()
    q = _hits[_client_ip(request)]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= limit:
        return True
    q.append(now)
    return False


def _check_access(request: Request) -> JSONResponse | None:
    code = get_settings()["access_code"]
    if not code:
        return None
    given = request.headers.get("x-rem-code", "")
    if not hmac.compare_digest(given.encode(), code.encode()):
        return _err("Access code missing or wrong. Set it in Rem's settings.", 401)
    return None


async def _json(request: Request) -> dict | None:
    try:
        raw = await request.body()
        if len(raw) > MAX_BODY:
            return None
        data = await request.json()
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def guarded(handler):
    """Wrap a handler with the access-code check."""

    async def wrapper(request: Request):
        denied = _check_access(request)
        if denied:
            return denied
        return await handler(request)

    return wrapper


# ------------------------------------------------------------------ routes
async def health(request: Request):
    s = get_settings()
    return JSONResponse(
        {
            "status": "ok",
            "gemini_configured": bool(s["gemini_api_key"]),  # never the key itself
            "access_code_required": bool(s["access_code"]),
            "model": s["gemini_model"],
        }
    )


async def chat(request: Request):
    s = get_settings()
    if _rate_limited(request, s["rate_limit_per_min"]):
        return _err("Too many messages. Please wait a minute.", 429)
    data = await _json(request)
    message = " ".join(str((data or {}).get("message", "")).split())
    if not message:
        return _err("Please send a non-empty 'message'.", 400)
    message = message[: db.MAX_MESSAGE_LEN]

    path = s["db_path"]
    history = db.recent_messages(path, s["history_turns"])
    memories = db.list_memories(path)
    try:
        result = generate_reply(s, memories, history, message)
    except GeminiError as exc:
        return _err(str(exc), exc.status)

    # Only the conversation log is stored automatically. Long-term memory is
    # saved only when the user approves a suggestion.
    db.add_message(path, "user", message)
    db.add_message(path, "rem", result["reply"], result["emotion"])
    return JSONResponse(result)


async def get_history(request: Request):
    s = get_settings()
    return JSONResponse({"messages": db.recent_messages(s["db_path"], 100)})


async def clear_history(request: Request):
    s = get_settings()
    return JSONResponse({"deleted": db.clear_messages(s["db_path"])})


async def list_memories(request: Request):
    return JSONResponse({"memories": db.list_memories(get_settings()["db_path"])})


async def create_memory(request: Request):
    s = get_settings()
    data = await _json(request)
    if not data or not str(data.get("content", "")).strip():
        return _err("'content' is required.", 400)
    try:
        mem = db.add_memory(s["db_path"], data["content"], data.get("category", "general"), s["max_memories"])
    except db.MemoryLimitError as exc:
        return _err(str(exc), 409)
    return JSONResponse(mem, status_code=201)


async def update_memory(request: Request):
    s = get_settings()
    data = await _json(request)
    if data is None or ("content" not in data and "category" not in data):
        return _err("Send 'content' and/or 'category'.", 400)
    try:
        mem = db.update_memory(s["db_path"], int(request.path_params["memory_id"]), data.get("content"), data.get("category"))
    except ValueError as exc:
        return _err(str(exc), 400)
    if not mem:
        return _err("Memory not found.", 404)
    return JSONResponse(mem)


async def delete_memory(request: Request):
    ok = db.delete_memory(get_settings()["db_path"], int(request.path_params["memory_id"]))
    if not ok:
        return _err("Memory not found.", 404)
    return JSONResponse({"deleted": True})


async def import_memories(request: Request):
    s = get_settings()
    data = await _json(request)
    items = (data or {}).get("memories")
    if not isinstance(items, list):
        return _err("'memories' must be a list.", 400)
    added, skipped = [], 0
    existing = {m["content"].lower() for m in db.list_memories(s["db_path"])}
    for item in items[:s["max_memories"]]:
        content = str(item.get("content", "")) if isinstance(item, dict) else ""
        norm = " ".join(content.split())
        if not norm or norm.lower() in existing:
            skipped += 1
            continue
        try:
            added.append(db.add_memory(s["db_path"], norm, item.get("category", "general"), s["max_memories"]))
            existing.add(norm.lower())
        except db.MemoryLimitError:
            skipped += 1
            break
    return JSONResponse({"added": len(added), "skipped": skipped}, status_code=201)


def create_app() -> Starlette:
    s = get_settings()
    db.init_db(s["db_path"])
    routes = [
        Route("/api/health", health, methods=["GET"]),
        Route("/api/chat", guarded(chat), methods=["POST"]),
        Route("/api/history", guarded(get_history), methods=["GET"]),
        Route("/api/history", guarded(clear_history), methods=["DELETE"]),
        Route("/api/memories", guarded(list_memories), methods=["GET"]),
        Route("/api/memories", guarded(create_memory), methods=["POST"]),
        Route("/api/memories/import", guarded(import_memories), methods=["POST"]),
        Route("/api/memories/{memory_id:int}", guarded(update_memory), methods=["PUT"]),
        Route("/api/memories/{memory_id:int}", guarded(delete_memory), methods=["DELETE"]),
    ]
    frontend = ROOT_DIR / "docs"
    if s["serve_frontend"] and frontend.is_dir():
        # Convenient for local testing: open http://localhost:8000 on your PC/phone.
        routes.append(Mount("/", app=StaticFiles(directory=str(frontend), html=True), name="frontend"))
    middleware = [
        Middleware(
            CORSMiddleware,
            allow_origins=s["allowed_origins"],
            allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
            allow_headers=["Content-Type", "X-Rem-Code"],
            max_age=600,
        )
    ]
    return Starlette(routes=routes, middleware=middleware)


app = create_app()
