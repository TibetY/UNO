import json
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer

from cardduel.server import Handler


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def req(self, path, body=None):
        data = None if body is None else json.dumps(body).encode()
        r = urllib.request.Request(self.base + path, data=data,
                                   headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(r) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def j(self, path, body=None):
        code, raw = self.req(path, body)
        return code, json.loads(raw)

    def test_static(self):
        code, raw = self.req("/")
        self.assertEqual(code, 200)
        self.assertIn(b"Card Duel", raw)
        self.assertEqual(self.req("/../server.py")[0], 404)

    def test_human_game_to_completion(self):
        code, s = self.j("/api/game", {"p0": "human", "p1": "greedy", "seed": 3, "starter": 0})
        self.assertEqual(code, 200)
        self.assertIsNone(s["hands"][1])  # opponent hidden
        for _ in range(2000):
            if s["end_reason"]:
                break
            if s["bot_to_act"]:
                _, s = self.j(f"/api/game/{s['id']}/advance", {})
            else:
                self.assertTrue(s["legal"])
                _, s = self.j(f"/api/game/{s['id']}/action", {"index": 0})
        self.assertIsNotNone(s["end_reason"])
        self.assertIsNotNone(s["hands"][1])  # revealed at the end

    def test_bad_requests(self):
        _, s = self.j("/api/game", {"p0": "human", "p1": "random", "seed": 1, "starter": 0})
        if not s["bot_to_act"]:
            code, _ = self.j(f"/api/game/{s['id']}/action", {"index": 999})
            self.assertEqual(code, 400)
        self.assertEqual(self.j("/api/game/nope/advance", {})[0], 404)
        self.assertEqual(self.j("/api/game", {"p1": "human"})[0], 400)

    def test_simulate(self):
        code, s = self.j("/api/simulate", {"p0": "greedy", "p1": "random", "games": 50,
                                           "rules": {"draw_until_playable": True}})
        self.assertEqual(code, 200)
        self.assertEqual(s["games"], 50)
        self.assertIn("turns_histogram", s)


if __name__ == "__main__":
    unittest.main()
