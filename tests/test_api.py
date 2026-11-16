from asgi_client import request
from backend import gemini


def fake_reply(monkeypatch, **over):
    out = {"reply": "Hello!", "emotion": "happy", "gesture": "none", "memory_suggestion": None}
    out.update(over)
    calls = []

    def fake(settings, memories, history, msg):
        calls.append((list(memories), list(history), msg))
        return out

    monkeypatch.setattr("backend.app.generate_reply", fake)
    return calls


def test_health_never_leaks_key(app):
    r = request(app, "GET", "/api/health")
    assert r.status_code == 200 and r.json()["gemini_configured"] is True
    assert "test-key-123" not in r.body.decode()


def test_chat_flow_history_and_context(app, monkeypatch):
    calls = fake_reply(monkeypatch, memory_suggestion="Likes chess")
    r = request(app, "POST", "/api/chat", {"message": "  I like   chess "})
    assert r.status_code == 200
    assert r.json()["reply"] == "Hello!" and r.json()["memory_suggestion"] == "Likes chess"
    # suggestion must NOT be auto-saved
    assert request(app, "GET", "/api/memories").json()["memories"] == []
    request(app, "POST", "/api/chat", {"message": "second"})
    assert [m["content"] for m in calls[1][1]] == ["I like chess", "Hello!"]  # context kept
    hist = request(app, "GET", "/api/history").json()["messages"]
    assert len(hist) == 4
    assert request(app, "DELETE", "/api/history").json()["deleted"] == 4
    assert request(app, "GET", "/api/history").json()["messages"] == []


def test_chat_validation_and_errors(app, monkeypatch):
    assert request(app, "POST", "/api/chat", {"message": "  "}).status_code == 400
    assert request(app, "POST", "/api/chat", raw=b"not json").status_code == 400

    def boom(*a):
        raise gemini.GeminiError("down", 502)
    monkeypatch.setattr("backend.app.generate_reply", boom)
    r = request(app, "POST", "/api/chat", {"message": "hi"})
    assert r.status_code == 502 and r.json()["error"] == "down"
    assert request(app, "GET", "/api/history").json()["messages"] == []  # failed turns not logged


def test_memory_crud_and_used_in_chat(app, monkeypatch):
    calls = fake_reply(monkeypatch)
    r = request(app, "POST", "/api/memories", {"content": "Name is Sarwesh", "category": "profile"})
    assert r.status_code == 201
    mid = r.json()["id"]
    assert request(app, "PUT", f"/api/memories/{mid}", {"content": "Name is Sarwesh K"}).json()["content"] == "Name is Sarwesh K"
    request(app, "POST", "/api/chat", {"message": "who am i"})
    assert calls[0][0][0]["content"] == "Name is Sarwesh K"
    assert request(app, "DELETE", f"/api/memories/{mid}").status_code == 200
    assert request(app, "DELETE", f"/api/memories/{mid}").status_code == 404
    assert request(app, "PUT", "/api/memories/999", {"content": "x"}).status_code == 404
    assert request(app, "POST", "/api/memories", {"content": " "}).status_code == 400
    request(app, "POST", "/api/chat", {"message": "again"})
    assert calls[1][0] == []


def test_memory_import_dedupes(app):
    body = {"memories": [{"content": "A"}, {"content": "a"}, {"content": ""}, {"content": "B", "category": "x"}]}
    r = request(app, "POST", "/api/memories/import", body)
    assert r.json() == {"added": 2, "skipped": 2}


def test_access_code(app, monkeypatch):
    monkeypatch.setenv("REM_ACCESS_CODE", "sesame")
    assert request(app, "GET", "/api/memories").status_code == 401
    assert request(app, "GET", "/api/memories", headers={"X-Rem-Code": "nope"}).status_code == 401
    assert request(app, "GET", "/api/memories", headers={"X-Rem-Code": "sesame"}).status_code == 200
    assert request(app, "GET", "/api/health").json()["access_code_required"] is True


def test_rate_limit(app, monkeypatch):
    monkeypatch.setenv("REM_RATE_LIMIT_PER_MIN", "2")
    fake_reply(monkeypatch)
    codes = [request(app, "POST", "/api/chat", {"message": "x"}).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_cors_headers(app, monkeypatch):
    r = request(app, "OPTIONS", "/api/chat", headers={
        "Origin": "https://user.github.io", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-rem-code"})
    assert r.status_code == 200 and "x-rem-code" in r.headers["access-control-allow-headers"].lower()
