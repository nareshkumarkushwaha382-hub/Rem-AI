// Talks to the Rem AI backend. The Gemini key lives only on the server.
export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

export class Api {
  constructor(getSettings) {
    this.getSettings = getSettings;
  }

  base() {
    return (this.getSettings().backendUrl || "").trim().replace(/\/+$/, "");
  }

  async _req(method, path, body, timeoutMs = 45000) {
    const s = this.getSettings();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (s.accessCode) headers["X-Rem-Code"] = s.accessCode;
    let res;
    try {
      res = await fetch(this.base() + path, {
        method, headers, signal: ctrl.signal,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new ApiError(
        e.name === "AbortError"
          ? "The server took too long to answer. (Free servers can take ~30s to wake up. Try again.)"
          : "I can't reach my backend. Check the Backend URL in Settings.",
        0
      );
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) throw new ApiError((data && data.error) || `Server error (${res.status})`, res.status);
    return data;
  }

  health() { return this._req("GET", "/api/health", undefined, 15000); }
  chat(message) { return this._req("POST", "/api/chat", { message }); }
  history() { return this._req("GET", "/api/history"); }
  clearHistory() { return this._req("DELETE", "/api/history"); }
  memories() { return this._req("GET", "/api/memories"); }
  addMemory(content, category = "general") { return this._req("POST", "/api/memories", { content, category }); }
  updateMemory(id, content) { return this._req("PUT", `/api/memories/${id}`, { content }); }
  deleteMemory(id) { return this._req("DELETE", `/api/memories/${id}`); }
  importMemories(memories) { return this._req("POST", "/api/memories/import", { memories }); }
}
