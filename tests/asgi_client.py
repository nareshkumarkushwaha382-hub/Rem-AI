"""Tiny ASGI test client (no httpx needed)."""
import asyncio
import json
from urllib.parse import urlsplit


class Response:
    def __init__(self, status, headers, body):
        self.status_code, self.headers, self.body = status, headers, body

    def json(self):
        return json.loads(self.body)


def request(app, method, url, json_body=None, headers=None, raw=None):
    parts = urlsplit(url)
    body = raw if raw is not None else (json.dumps(json_body).encode() if json_body is not None else b"")
    hdrs = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    if json_body is not None:
        hdrs.append((b"content-type", b"application/json"))
    hdrs.append((b"content-length", str(len(body)).encode()))
    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method,
        "path": parts.path, "raw_path": parts.path.encode(), "query_string": parts.query.encode(),
        "headers": hdrs, "client": ("127.0.0.1", 5000), "server": ("test", 80), "scheme": "http", "root_path": "",
    }
    out = {"status": None, "headers": {}, "body": b""}

    async def run():
        sent = False

        async def receive():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": body, "more_body": False}
            await asyncio.sleep(3600)

        async def send(msg):
            if msg["type"] == "http.response.start":
                out["status"] = msg["status"]
                out["headers"] = {k.decode().lower(): v.decode() for k, v in msg["headers"]}
            elif msg["type"] == "http.response.body":
                out["body"] += msg.get("body", b"")

        await app(scope, receive, send)

    asyncio.run(run())
    return Response(out["status"], out["headers"], out["body"])
