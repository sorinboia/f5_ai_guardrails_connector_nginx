#!/usr/bin/env python3
"""
Dual stub servers for integration tests:
- Backend stub on port 18080 echoes request JSON and provides streaming/SSE responses.
- Guardrails stub on port 18081 emulates the Calypso AI scan API with deterministic outcomes.

Usage:
  python3 tests/servers/stub_servers.py            # uses default ports 18080/18081
  BACKEND_PORT=8080 GUARDRAILS_PORT=8081 python3 tests/servers/stub_servers.py
"""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import json
import os
import threading
import time


BACKEND_PORT = int(os.environ.get("BACKEND_PORT", "18080"))
GUARDRAILS_PORT = int(os.environ.get("GUARDRAILS_PORT", "18081"))


def read_json(body):
  try:
    return json.loads(body)
  except Exception:
    return None


class BackendHandler(BaseHTTPRequestHandler):
  server_version = "TestsBackend/1.0"

  def _read_body(self):
    length = int(self.headers.get("content-length", "0") or "0")
    data = self.rfile.read(length) if length else b""
    return data

  def _send_json(self, payload, status=200, headers=None):
    body = json.dumps(payload).encode("utf-8")
    self.send_response(status)
    self.send_header("content-type", "application/json")
    self.send_header("content-length", str(len(body)))
    if headers:
      for k, v in headers.items():
        self.send_header(k, v)
    self.end_headers()
    self.wfile.write(body)

  def do_POST(self):
    path = self.path.split("?", 1)[0]
    body_bytes = self._read_body()
    body_text = body_bytes.decode("utf-8", errors="replace")
    parsed = read_json(body_text) or {}

    if path == "/api/stream":
      # SSE-style stream with two chunks; the second contains STREAM_FLAG to trigger blocking.
      self.send_response(200)
      self.send_header("content-type", "text/event-stream")
      self.end_headers()
      chunks = [
        json.dumps({"choices": [{"delta": {"content": "Hello from stream chunk 1."}}]}),
        json.dumps({"choices": [{"delta": {"content": "STREAM_FLAG found in chunk 2."}}]})
      ]
      for chunk in chunks:
        data = f"data: {chunk}\n\n".encode("utf-8")
        self.wfile.write(data)
        self.wfile.flush()
        time.sleep(0.05)
      return

    if path == "/api/response-flag":
      return self._send_json({"message": {"content": "Backend says RESP_FLAG"}}, status=200)

    # Default: echo back the request payload to validate redaction and pass-through
    last_msg = ""
    try:
      msgs = parsed.get("messages") or []
      if msgs:
        last_msg = msgs[-1].get("content", "")
    except Exception:
      last_msg = ""

    response = {
      "echo": parsed,
      "message": {
        "content": last_msg
      }
    }
    return self._send_json(response, status=200)

  def log_message(self, fmt, *args):
    # Quiet logging to keep test output clean.
    return


class GuardrailsHandler(BaseHTTPRequestHandler):
  server_version = "TestsGuardrails/1.0"

  def _read_body(self):
    length = int(self.headers.get("content-length", "0") or "0")
    data = self.rfile.read(length) if length else b""
    return data

  def _send_json(self, payload, status=200):
    body = json.dumps(payload).encode("utf-8")
    self.send_response(status)
    self.send_header("content-type", "application/json")
    self.send_header("content-length", str(len(body)))
    self.end_headers()
    self.wfile.write(body)

  def _make_redaction_matches(self, extracted, kind):
    if kind == "fail":
      start = len(extracted) + 5
      end = start + 3
      return [{"outcome": "redacted", "data": {"type": "regex", "matches": [[start, end]]}, "scannerId": "regex_fail"}]
    return [{"outcome": "redacted", "data": {"type": "regex", "matches": [[1, max(1, len(extracted))]]}, "scannerId": "regex_ok"}]

  def do_POST(self):
    body = self._read_body().decode("utf-8", errors="replace")
    payload = read_json(body) or {}
    extracted = str(payload.get("input", ""))

    outcome = "cleared"
    scanner_results = []

    if "BLOCK_ME" in extracted or "RESP_FLAG" in extracted or "STREAM_FLAG" in extracted:
      outcome = "flagged"
    elif "REDACT_ME" in extracted:
      outcome = "redacted"
      scanner_results = self._make_redaction_matches(extracted, "ok")
    elif "REDACT_FAIL" in extracted:
      outcome = "redacted"
      scanner_results = self._make_redaction_matches(extracted, "fail")

    response = {
      "result": {
        "outcome": outcome,
        "scannerResults": scanner_results
      }
    }
    return self._send_json(response, status=200)

  def log_message(self, fmt, *args):
    return


def serve_forever(server):
  server.serve_forever(poll_interval=0.2)


def main():
  backend = ThreadingHTTPServer(("0.0.0.0", BACKEND_PORT), BackendHandler)
  guardrails = ThreadingHTTPServer(("0.0.0.0", GUARDRAILS_PORT), GuardrailsHandler)

  threads = [
    threading.Thread(target=serve_forever, args=(backend,), daemon=True),
    threading.Thread(target=serve_forever, args=(guardrails,), daemon=True),
  ]
  for t in threads:
    t.start()

  print(f"Backend stub running on http://127.0.0.1:{BACKEND_PORT}")
  print(f"Guardrails stub running on http://127.0.0.1:{GUARDRAILS_PORT}")
  print("Press Ctrl+C to stop.")

  try:
    while True:
      time.sleep(1)
  except KeyboardInterrupt:
    pass

  backend.shutdown()
  guardrails.shutdown()


if __name__ == "__main__":
  main()
