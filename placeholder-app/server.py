from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import os

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            body = json.dumps({"status": "ok", "env": os.getenv("SPRING_PROFILES_ACTIVE", "unknown")}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        print(f"{self.address_string()} - {format % args}", flush=True)

HTTPServer(("", 8080), Handler).serve_forever()
