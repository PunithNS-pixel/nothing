"""Offline safety checks for the GCE private environment generator."""
import base64
from pathlib import Path
import stat
import tempfile
import unittest

import importlib.util

script = Path(__file__).with_name("prepare-gce-env.py")
spec = importlib.util.spec_from_file_location("prepare_gce_env", script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
prepare, parse_env = module.prepare, module.parse_env


class GcePrivateEnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / ".env"
        self.target = self.root / ".env.gce"
        self.source.write_text(
            "LOCAL_DB_PASSWORD=weak-local\n"
            "DATABASE_PASSWORD=weak-local\n"
            "RABBITMQ_PASSWORD=weak-rabbit\n"
            "JWT_SECRET=placeholder\n"
            "STRIPE_SECRET_KEY=sk_test_example\n"
            "MAIL_PROVIDER=smtp\n"
            "MAIL_NOTIFICATIONS_ENABLED=false\n",
            encoding="utf-8")

    def test_distinct_secure_passwords_and_https_are_private(self):
        prepare(self.source, self.target, "demo.example.org")
        generated = parse_env(self.target)
        self.assertNotEqual("weak-local", generated["LOCAL_DB_PASSWORD"])
        self.assertNotEqual("weak-rabbit", generated["RABBITMQ_PASSWORD"])
        self.assertNotEqual(generated["LOCAL_DB_PASSWORD"], generated["RABBITMQ_PASSWORD"])
        self.assertGreaterEqual(len(base64.b64decode(generated["JWT_SECRET"])), 32)
        self.assertEqual(generated["DATABASE_PASSWORD"], generated["LOCAL_DB_PASSWORD"])
        self.assertEqual("https://demo.example.org/", generated["FRONTEND_URL"])
        self.assertEqual("true", generated["JWT_COOKIE_SECURE"])
        self.assertEqual("demo.example.org", generated["SITE_DOMAIN"])
        self.assertEqual("true", generated["SEED_OFFERS"])
        self.assertEqual(0o600, stat.S_IMODE(self.target.stat().st_mode))
        self.assertIn("weak-local", self.source.read_text())

    def test_repeat_deployment_does_not_rotate_database_or_jwt_credentials(self):
        prepare(self.source, self.target, "demo.example.org")
        first = parse_env(self.target)
        prepare(self.source, self.target, "demo2.example.org")
        second = parse_env(self.target)
        for key in ["LOCAL_DB_PASSWORD", "RABBITMQ_PASSWORD", "JWT_SECRET"]:
            self.assertEqual(first[key], second[key])
        self.assertEqual("https://demo2.example.org/", second["FRONTEND_URL"])

    def test_live_stripe_secret_is_rejected(self):
        self.source.write_text("STRIPE_SECRET_KEY=sk_live_private\n")
        with self.assertRaisesRegex(ValueError, "TEST keys"):
            prepare(self.source, self.target, "demo.example.org")

    def test_missing_google_auth_falls_back_without_startup_failure(self):
        self.source.write_text("MAIL_PROVIDER=gmail-api\nMAIL_NOTIFICATIONS_ENABLED=true\n")
        prepare(self.source, self.target, "demo.example.org")
        generated = parse_env(self.target)
        self.assertEqual("smtp", generated["MAIL_PROVIDER"])
        self.assertEqual("false", generated["MAIL_NOTIFICATIONS_ENABLED"])

    def test_valid_resend_configuration_preserved(self):
        self.source.write_text(
            "MAIL_PROVIDER=resend\nRESEND_API_KEY=re_test_only\n"
            "EMAIL_FROM=orders@verified.example.org\nMAIL_NOTIFICATIONS_ENABLED=true\n")
        prepare(self.source, self.target, "demo.example.org")
        output = parse_env(self.target)
        self.assertEqual("resend", output["MAIL_PROVIDER"])
        self.assertEqual("true", output["MAIL_NOTIFICATIONS_ENABLED"])

    def test_missing_resend_key_disables_sender(self):
        self.source.write_text("MAIL_PROVIDER=resend\nMAIL_NOTIFICATIONS_ENABLED=true\n")
        prepare(self.source, self.target, "demo.example.org")
        output = parse_env(self.target)
        self.assertEqual("smtp", output["MAIL_PROVIDER"])
        self.assertEqual("false", output["MAIL_NOTIFICATIONS_ENABLED"])

    def test_reject_invalid_hostname(self):
        with self.assertRaisesRegex(ValueError, "DNS hostname"):
            prepare(self.source, self.target, "https://evil.example.org/;rm")


if __name__ == "__main__":
    unittest.main()
