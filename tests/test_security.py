"""Regression tests use an isolated database, dummy credentials, and no external services."""
import importlib
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch


class LocalSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workspace = tempfile.TemporaryDirectory(prefix="studysync-security-")
        root = Path(cls.workspace.name)
        source = Path(__file__).resolve().parents[1]
        for name in ("app.py", "backend.py", "index.html", "app.js", "style.css"):
            shutil.copyfile(source / name, root / name)
        (root / ".env").write_text("CANVAS_API_TOKEN=DUMMY_NOT_A_REAL_KEY\n")
        (root / ".git").mkdir()
        (root / ".git/config").write_text("DUMMY_GIT_CONFIG")
        sys.path.insert(0, str(root))
        with patch("dotenv.load_dotenv", return_value=False), patch.dict(os.environ, {}, clear=True):
            cls.module = importlib.import_module("app")
        cls.module.app.config["TESTING"] = True
        cls.module.app.config["LOCAL_API_TOKEN"] = "dummy-test-token"

    @classmethod
    def tearDownClass(cls):
        sys.path.remove(cls.workspace.name)
        for name in ("app", "backend"):
            sys.modules.pop(name, None)
        cls.workspace.cleanup()

    def setUp(self):
        self.client = self.module.app.test_client()
        self.headers = {"X-StudySync-Token": "dummy-test-token"}
        self.get_guard = patch("requests.get", side_effect=AssertionError("Network access in security test"))
        self.post_guard = patch("requests.post", side_effect=AssertionError("Network access in security test"))
        self.get_guard.start()
        self.post_guard.start()
        self.addCleanup(self.get_guard.stop)
        self.addCleanup(self.post_guard.stop)

    def test_private_files_are_never_static(self):
        for path in ("/.env", "/./.env", "/%2e/.env", "/./studysync.db", "/./.git/config", "/./backend.py", "/static/.env", "/../.env"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 404)
                self.assertNotIn(b"DUMMY_NOT_A_REAL_KEY", response.data)
                self.assertFalse(response.data.startswith(b"SQLite format 3"))

    def test_page_and_explicit_assets_still_load(self):
        page = self.client.get("/")
        self.assertEqual(page.status_code, 200)
        self.assertIn(b'content="dummy-test-token"', page.data)
        self.assertEqual(page.headers["Cache-Control"], "no-store")
        self.assertEqual(page.headers["X-Frame-Options"], "DENY")
        for path in ("/app.js", "/style.css"):
            with self.client.get(path) as response:
                self.assertEqual(response.status_code, 200)

    def test_api_requires_token_and_accepts_same_origin(self):
        self.assertEqual(self.client.get("/api/assignments").status_code, 403)
        self.assertEqual(self.client.get("/api/assignments", headers={"X-StudySync-Token": "wrong"}).status_code, 403)
        response = self.client.post("/api/settings", json={"college_name": "Dummy University"}, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.module.db.get_setting("college_name"), "Dummy University")
        self.assertEqual(self.client.get("/api/assignments", headers=self.headers).status_code, 200)

    def test_query_token_only_works_for_event_stream(self):
        self.assertEqual(self.client.get("/api/settings?token=dummy-test-token").status_code, 403)
        self.assertEqual(self.client.get("/api/sync").status_code, 403)
        with patch.object(self.module, "initialize_components", return_value=False):
            response = self.client.get("/api/sync?token=dummy-test-token")
            self.assertEqual(response.status_code, 200)
            self.assertIn(b"Canvas API not configured", response.data)

    def test_rejects_remote_clients_and_rebinding_hosts(self):
        for host in ("http://untrusted.invalid", "http://localhost.untrusted.invalid"):
            self.assertEqual(self.client.get("/", base_url=host).status_code, 400)
        self.assertEqual(self.client.get("/", environ_overrides={"REMOTE_ADDR": "192.0.2.1"}).status_code, 403)
        for host in ("http://localhost:5001", "http://127.0.0.1:5001"):
            self.assertEqual(self.client.get("/", base_url=host).status_code, 200)

    def test_rejects_cross_site_even_with_token(self):
        for extra in ({"Origin": "https://untrusted.invalid"}, {"Origin": "null"}, {"Sec-Fetch-Site": "cross-site"}):
            response = self.client.post("/api/settings", json={"college_name": "Must not save"}, headers={**self.headers, **extra})
            self.assertEqual(response.status_code, 403)
        self.assertNotEqual(self.module.db.get_setting("college_name"), "Must not save")
        response = self.client.get("/api/settings", base_url="http://localhost:5001", headers={**self.headers, "Origin": "http://localhost:5001"})
        self.assertEqual(response.status_code, 200)

    def test_reminder_text_is_arguments_not_script(self):
        manager = importlib.import_module("backend").RemindersManager
        text = '-Title"\\\nend tell\ndo shell script "false"\n& \'\u2603'
        with patch("subprocess.run") as run:
            manager.add_reminder(text, "Dummy date", text, text)
            args = run.call_args.args[0]
            self.assertNotIn(text, args[2])
            self.assertEqual(args[3:], ["--", text, "Dummy date", text, text])
            self.assertTrue(run.call_args.kwargs["check"])
            manager.remove_existing_reminder(text, text)
            args = run.call_args.args[0]
            self.assertNotIn(text, args[2])
            self.assertEqual(args[3:], ["--", text, text])


if __name__ == "__main__":
    unittest.main()
