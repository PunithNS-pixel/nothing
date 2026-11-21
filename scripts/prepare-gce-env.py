#!/usr/bin/env python3
"""Create or update a *private* persistent GCE demo env without logging secrets.

On first run, derive mail settings from backend/.env and generate distinct strong
VM-only database/JWT/Rabbit/admin credentials. Later runs reuse backend/.env.gce
so the PostgreSQL password never changes unexpectedly across redeployments.
"""
import argparse
import base64
import os
from pathlib import Path
import re
import secrets
import tempfile


def parse_env(path):
    result = {}
    if not path.is_file():
        raise ValueError(f"Missing {path}. Create backend/.env from backend/.env.example first.")
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
            continue
        k, value = line.split("=", 1)
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", k):
            continue
        # Compose accepts unquoted secrets; preserve values exactly, including '='.
        result[k] = value.strip()
    return result


def prepare(source, destination, domain):
    if not re.fullmatch(r"[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?", domain):
        raise ValueError("SITE_DOMAIN must be a plain DNS hostname, without scheme or port")
    if domain.count(".") < 1 or ".." in domain:
        raise ValueError("SITE_DOMAIN must be a public DNS hostname")
    if destination.is_symlink():
        raise ValueError("Refusing to overwrite a symlinked .env.gce")
    prior = destination.is_file()
    config = parse_env(destination if prior else source)
    if not prior:
        # Never reuse laptop/demo passwords or JWTs for a remotely exposed VM.
        config["LOCAL_DB_PASSWORD"] = secrets.token_urlsafe(36)
        config["DATABASE_PASSWORD"] = config["LOCAL_DB_PASSWORD"]
        config["RABBITMQ_PASSWORD"] = secrets.token_urlsafe(36)
        config["JWT_SECRET"] = base64.b64encode(secrets.token_bytes(48)).decode("ascii")
        if not config.get("ADMIN_USERNAME"):
            config["ADMIN_USERNAME"] = "nothingadmin"
            config["ADMIN_PASSWORD"] = secrets.token_urlsafe(24)
    for k in ("LOCAL_DB_PASSWORD", "RABBITMQ_PASSWORD", "JWT_SECRET"):
        if not config.get(k):
            raise ValueError(f"Missing required {k} in the persistent GCE env")
    key = config.get("STRIPE_SECRET_KEY", "")
    if key and not key.startswith("sk_test_"):
        raise ValueError("For this public DEMO, only Stripe TEST keys are allowed. Remove the live/unknown Stripe key.")
    mail_provider = config.get("MAIL_PROVIDER", "smtp")
    if mail_provider not in ("smtp", "gmail-api", "resend"):
        raise ValueError("MAIL_PROVIDER must be smtp, gmail-api or resend")
    if config.get("MAIL_NOTIFICATIONS_ENABLED", "false").lower() == "true":
        common = ("EMAIL_FROM",)
        provider_fields = (("GMAIL_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_SECRET", "GMAIL_OAUTH_REFRESH_TOKEN")
                           if mail_provider == "gmail-api" else
                           ("RESEND_API_KEY",) if mail_provider == "resend" else
                           ("SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"))
        if any(not config.get(k) for k in common + provider_fields):
            # Do not claim delivery is configured if OAuth/SMTP is incomplete.
            config["MAIL_NOTIFICATIONS_ENABLED"] = "false"
            print("Email notifications disabled: private mail provider credentials incomplete.")
    if mail_provider == "gmail-api" and any(
        not config.get(k) for k in ("GMAIL_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_SECRET", "GMAIL_OAUTH_REFRESH_TOKEN", "EMAIL_FROM")
    ):
        # The JavaMailSender bean is enabled by MAIL_PROVIDER regardless of notification flag.
        config["MAIL_PROVIDER"] = "smtp"
        config["MAIL_NOTIFICATIONS_ENABLED"] = "false"
        print("Gmail API authentication incomplete; falling back to disabled SMTP for demo.")
    if mail_provider == "resend" and any(not config.get(k) for k in ("RESEND_API_KEY", "EMAIL_FROM")):
        config["MAIL_PROVIDER"] = "smtp"
        config["MAIL_NOTIFICATIONS_ENABLED"] = "false"
        print("Resend API credentials incomplete; falling back to disabled SMTP for demo.")
    config.update({
        "SITE_DOMAIN": domain.lower(),
        "FRONTEND_URL": f"https://{domain.lower()}/",
        "JWT_COOKIE_SECURE": "true",
        "STRIPE_SUCCESS_URL": f"https://{domain.lower()}/?checkout=stripe-success",
        "STRIPE_CANCEL_URL": f"https://{domain.lower()}/?checkout=stripe-cancel",
        "SEED_RETAIL_CATALOG": config.get("SEED_RETAIL_CATALOG", "true") or "true",
        "SEED_OFFERS": config.get("SEED_OFFERS", "true") or "true",
    })
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Atomic replacement, with restrictive permissions, no credential output.
    fd, temp_name = tempfile.mkstemp(prefix=".gce-private-", dir=destination.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            out.write("# PRIVATE GCE DEMO SETTINGS. NEVER COMMIT THIS FILE.\n")
            out.write("# Preserve this file across deployments to retain DB/JWT identities.\n")
            for k, v in config.items():
                out.write(f"{k}={v}\n")
        os.replace(temp_name, destination)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)
    print(f"Private {'existing' if prior else 'new'} GCE env ready at {destination} (mode 0600).")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=Path("backend/.env"))
    parser.add_argument("--target", type=Path, default=Path("backend/.env.gce"))
    parser.add_argument("--domain", required=True)
    args = parser.parse_args()
    try:
        prepare(args.source, args.target, args.domain)
    except (ValueError, OSError) as exc:
        parser.exit(1, f"Configuration error: {exc}\n")


if __name__ == "__main__":
    main()
