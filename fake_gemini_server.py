"""A fake Gemini endpoint for offline smoke tests:  python tests/fake_gemini_server.py 9100"""
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer


class H(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        key = self.headers.get("x-goog-api-key")
        if key != "live-test-key":
            self.send_response(403); self.end_headers()
            self.wfile.write(json.dumps({"error": {"message": "API key not valid"}}).encode()); return
        last = body["contents"][-1]["parts"][0]["text"]
        mem = "<memories>" in body["systemInstruction"]["parts"][0]["text"]
        out = {"reply": f"Echo: {last[-40:]} (path={self.path.split('?')[0]})", "emotion": "blushing" if "love" in last else "happy",
               "gesture": "wave" if "hello" in last.lower() else "none",
               "memory_suggestion": "Likes anime" if "anime" in last else None}
        data = json.dumps({"candidates": [{"content": {"parts": [{"text": json.dumps(out)}]}}]}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(data)

    def log_message(self, *a): pass


HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
