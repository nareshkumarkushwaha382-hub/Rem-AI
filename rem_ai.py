"""Terminal version of Rem AI (same brain and memory as the web app).

    python rem_ai.py

Commands:  /memories   /remember <text>   /forget <id>   /clear   /quit
"""
from backend import db
from backend.config import get_settings
from backend.gemini import GeminiError, generate_reply
from rem_persona import REM_PERSONA  # noqa: F401  (persona is loaded by the backend)


def main():
    s = get_settings()
    db.init_db(s["db_path"])
    print("Rem AI is starting... (type /quit to exit)")
    if not s["gemini_api_key"]:
        print("GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.")
        return
    print("Rem: Hello! Main yahan hoon. Aap kaise hain?")
    while True:
        try:
            text = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not text:
            continue
        if text == "/quit":
            break
        if text == "/memories":
            for m in db.list_memories(s["db_path"]):
                print(f"  [{m['id']}] {m['content']}")
            continue
        if text.startswith("/remember "):
            m = db.add_memory(s["db_path"], text[10:], max_memories=s["max_memories"])
            print(f"Rem: Saved memory #{m['id']}.")
            continue
        if text.startswith("/forget "):
            ok = text[8:].strip().isdigit() and db.delete_memory(s["db_path"], int(text[8:]))
            print("Rem: Forgotten." if ok else "Rem: I couldn't find that memory id.")
            continue
        if text == "/clear":
            db.clear_messages(s["db_path"])
            print("Rem: Chat history cleared.")
            continue
        try:
            res = generate_reply(s, db.list_memories(s["db_path"]), db.recent_messages(s["db_path"], s["history_turns"]), text)
        except GeminiError as exc:
            print(f"Rem (error): {exc}")
            continue
        db.add_message(s["db_path"], "user", text)
        db.add_message(s["db_path"], "rem", res["reply"], res["emotion"])
        print(f"Rem [{res['emotion']}]: {res['reply']}")
        if res["memory_suggestion"]:
            print(f"   (Rem would like to remember: \"{res['memory_suggestion']}\" - use /remember to save it)")


if __name__ == "__main__":
    main()
