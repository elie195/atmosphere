#!/usr/bin/env python3
"""Local receiver for Atmosphere's debug logs (Debug mode on).

Listens on 127.0.0.1:47123 only and appends each line to logs/atmosphere.log:
    python3 tools/log-server.py
"""
import json, os, sys, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'logs', 'atmosphere.log')
os.makedirs(os.path.dirname(LOG), exist_ok=True)

class H(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        try:
            batch = json.loads(self.rfile.read(n) or b'[]')
        except Exception:
            batch = []
        with open(LOG, 'a') as f:
            for e in batch if isinstance(batch, list) else [batch]:
                ts = datetime.datetime.fromtimestamp(e.get('t', 0) / 1000).strftime('%H:%M:%S')
                f.write(f"{ts} [{e.get('site', '?')}/{e.get('kind', '-')}] {e.get('msg', '')}"
                        + (f" :: {e['text']}" if e.get('text') else '') + '\n')
        self.send_response(204); self._cors(); self.end_headers()
    def log_message(self, *a):
        pass

if __name__ == '__main__':
    print('Atmosphere log receiver on http://127.0.0.1:47123, writing', os.path.abspath(LOG), flush=True)
    ThreadingHTTPServer(('127.0.0.1', 47123), H).serve_forever()
