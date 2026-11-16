import json
import pytest
from backend import gemini
from backend.gemini import GeminiError, parse_model_output, _build_contents

S = {"gemini_api_key": "k", "gemini_model": "m", "gemini_api_base": "http://x/v1"}


class Fake:
    def __init__(self, status=200, payload=None):
        self.status_code, self._p = status, payload

    def json(self):
        if self._p is None:
            raise ValueError
        return self._p


def ok(obj):
    return Fake(200, {"candidates": [{"content": {"parts": [{"text": json.dumps(obj)}]}}]})


def test_parse_valid_and_invalid_values():
    r = parse_model_output(json.dumps({"reply": "Hi", "emotion": "angry", "gesture": "dance", "memory_suggestion": "null"}))
    assert r == {"reply": "Hi", "emotion": "neutral", "gesture": "none", "memory_suggestion": None}


def test_parse_plain_text_fallback_and_embedded_json():
    assert parse_model_output("just text")["reply"] == "just text"
    r = parse_model_output('noise {"reply":"A","emotion":"happy"} tail')
    assert r["reply"] == "A" and r["emotion"] == "happy"


def test_contents_merge_and_start_with_user():
    hist = [{"role": "rem", "content": "old"}, {"role": "user", "content": "a"}, {"role": "user", "content": "b"}]
    c = _build_contents(hist, "now")
    assert c[0]["role"] == "user" and len(c) == 1
    assert c[0]["parts"][0]["text"] == "a\nb\nnow"


def test_generate_sends_key_in_header_and_memories(monkeypatch):
    seen = {}

    def fake_post(url, json=None, headers=None, timeout=None):
        seen.update(url=url, body=json, headers=headers)
        return ok({"reply": "Namaste", "emotion": "happy", "gesture": "wave", "memory_suggestion": "Likes tea"})

    monkeypatch.setattr(gemini.requests, "post", fake_post)
    r = gemini.generate_reply(S, [{"id": 1, "content": "Name is Sarwesh"}], [], "hello")
    assert r["emotion"] == "happy" and r["gesture"] == "wave" and r["memory_suggestion"] == "Likes tea"
    assert seen["headers"]["x-goog-api-key"] == "k"
    assert "k" not in seen["url"].split("?")[-1] if "?" in seen["url"] else True
    assert "Name is Sarwesh" in seen["body"]["systemInstruction"]["parts"][0]["text"]


@pytest.mark.parametrize("status,payload,expect", [
    (429, {}, 429),
    (400, {"error": {"message": "API key not valid"}}, 502),
    (500, {"error": {"message": "boom"}}, 502),
])
def test_http_errors(monkeypatch, status, payload, expect):
    monkeypatch.setattr(gemini.requests, "post", lambda *a, **k: Fake(status, payload))
    with pytest.raises(GeminiError) as e:
        gemini.generate_reply(S, [], [], "hi")
    assert e.value.status == expect


def test_blocked_and_missing_key(monkeypatch):
    monkeypatch.setattr(gemini.requests, "post", lambda *a, **k: Fake(200, {"promptFeedback": {"blockReason": "SAFETY"}}))
    with pytest.raises(GeminiError, match="SAFETY"):
        gemini.generate_reply(S, [], [], "hi")
    with pytest.raises(GeminiError) as e:
        gemini.generate_reply({**S, "gemini_api_key": ""}, [], [], "hi")
    assert e.value.status == 503


def test_network_error(monkeypatch):
    def boom(*a, **k):
        raise gemini.requests.ConnectionError("secret-detail")
    monkeypatch.setattr(gemini.requests, "post", boom)
    with pytest.raises(GeminiError) as e:
        gemini.generate_reply(S, [], [], "hi")
    assert "secret-detail" not in str(e.value)
