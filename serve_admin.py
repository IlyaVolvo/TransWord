"""Tiny HTTP server that serves admin.html as the default page."""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
DIRECTORY = os.path.dirname(os.path.abspath(__file__))


class AdminHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        if self.path in ('/', '/index.html'):
            self.path = '/admin.html'
        super().do_GET()


with http.server.HTTPServer(('', PORT), AdminHandler) as srv:
    print(f'Admin server on http://localhost:{PORT}')
    srv.serve_forever()
