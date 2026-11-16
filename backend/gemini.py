"""Minimal Gemini REST client (uses `requests`, no extra SDK needed).

The API key is sent in the `x-goog-api-key` header from the server only.
"""
import json

import requests

from .persona import EMOTIONS, GESTURES, build_system_prompt


class GeminiError(Exception):
    """Raised for any problem talking to Gemini. `status` is a suggested HTTP status."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "reply": {"type": "STRING"},
        "emotion": {"type": "STRING", "enum": EMOTIONS},
        "gesture": {"type": "STRING", "enum": GESTURES},
        "memory_suggestion": {"type": "STRING", "nullable": True},
    },
    "required": ["reply", "emotion"],
}


def _build_contents(history: list[dict], user_message: str) -> list[dict]:
    contents = []
    for m in history:
        role = "user" if m["role"] == "user" else "model"
        # Gemini wants alternating-ish roles; merge consecutive same-role turns.
        if contents and contents[-1]["role"] == role:
            contents[-1]["parts"][0]["text"] += "\n" + m["content"]
        else:
            contents.append({"role": role, "parts": [{"text": m["content"]}]})
    if contents and contents[-1]["role"] == "user":
        contents[-1]["parts"][0]["text"] += "\n" + user_message
    else:
        contents.append({"role": "user", "parts": [{"text": user_message}]})
    # Conversation must start with a user turn.
    while contents and contents[0]["role"] != "user":
        contents.pop(0)
    return contents


def parse_model_output(text: str) -> dict:
    """Turn the model's JSON into a safe dict; fall back to plain text."""
    data = None
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        start, end = (text or "").find("{"), (text or "").rfind("}")
        if start != -1 and end > start:
            try:
                data = json.loads(text[start : end + 1])
            except ValueError:
                data = None
    if not isinstance(data, dict):
        return {"reply": (text or "").strip(), "emotion": "neutral", "gesture": "none", "memory_suggestion": None}

    reply = str(data.get("reply") or "").strip()
    emotion = data.get("emotion") if data.get("emotion") in EMOTIONS else "neutral"
    gesture = data.get("gesture") if data.get("gesture") in GESTURES else "none"
    sug = data.get("memory_suggestion")
    sug = " ".join(str(sug).split())[:500] if isinstance(sug, str) and sug.strip() else None
    if sug and sug.lower() in ("null", "none", "n/a"):
        sug = None
    return {"reply": reply, "emotion": emotion, "gesture": gesture, "memory_suggestion": sug}


def generate_reply(settings: dict, memories: list[dict], history: list[dict], user_message: str) -> dict:
    key = settings["gemini_api_key"]
    if not key:
        raise GeminiError("Gemini API key is not configured on the server (set GEMINI_API_KEY).", 503)

    url = f"{settings['gemini_api_base']}/models/{settings['gemini_model']}:generateContent"
    body = {
        "systemInstruction": {"parts": [{"text": build_system_prompt(memories)}]},
        "contents": _build_contents(history, user_message),
        "generationConfig": {
            "temperature": 0.8,
            "maxOutputTokens": 1024,
            "responseMimeType": "application/json",
            "responseSchema": RESPONSE_SCHEMA,
        },
    }
    try:
        resp = requests.post(
            url, json=body, timeout=40,
            headers={"x-goog-api-key": key, "Content-Type": "application/json"},
        )
    except requests.RequestException as exc:
        raise GeminiError(f"Could not reach Gemini: {type(exc).__name__}") from exc

    if resp.status_code != 200:
        try:
            msg = resp.json().get("error", {}).get("message", "")
        except ValueError:
            msg = ""
        if resp.status_code == 429:
            raise GeminiError("Gemini rate limit or quota reached. Try again in a moment.", 429)
        if resp.status_code in (400, 403) and "API key" in msg:
            raise GeminiError("Gemini rejected the API key. Check GEMINI_API_KEY.", 502)
        raise GeminiError(f"Gemini error {resp.status_code}: {msg[:200]}")

    try:
        payload = resp.json()
        candidates = payload.get("candidates") or []
        if not candidates:
            reason = (payload.get("promptFeedback") or {}).get("blockReason", "no candidates")
            raise GeminiError(f"Gemini returned no answer ({reason}).")
        parts = (candidates[0].get("content") or {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts)
    except ValueError as exc:
        raise GeminiError("Gemini sent an unreadable response.") from exc

    result = parse_model_output(text)
    if not result["reply"]:
        raise GeminiError("Gemini returned an empty reply.")
    return result
