#!/usr/bin/env python3
"""
SUPERSEDED — replaced by Authentik blueprints (Plan E, 2026-06-19).
============================================================
This script has been superseded by version-controlled Authentik blueprints:
  deploy/helm/fuzefront/authentik/blueprints/

The blueprints are auto-applied by the Authentik worker on startup (mounted
via ConfigMap authentik-blueprints at /blueprints/fuzefront/). No manual
seeding or out-of-band patching is required.

Blueprint coverage vs. this script:
  - OIDC provider + Application (provider-oidc.yaml) — deterministic client_id/secret
  - Enrollment flow + password policy (flow-enrollment.yaml)
  - Password recovery flow (flow-recovery.yaml)
  - MFA stages: TOTP + WebAuthn (stages-mfa.yaml)
  - Google OAuth source (source-google.yaml)
  - Fuse-seam brand + custom CSS (brand-fuseseam.yaml)

This file is kept for historical reference only. Do NOT run it against a
blueprint-managed Authentik instance — it will create duplicate objects.
============================================================

Seed Authentik for FuzeFront: OIDC provider + application, a strong sign-up
password policy (bound to a FuzeFront enrollment flow), and an initial admin.

Idempotent — safe to re-run. Reads config from env:
  AUTHENTIK_URL    (default http://localhost:9000)   API base host
  AUTHENTIK_TOKEN  (required)                         akadmin API/bootstrap token
  FF_REDIRECT_URI  (default http://fuzefront.dev.local/api/auth/oidc/callback)
  FF_ADMIN_EMAIL   (default admin@fuzefront.dev)
  FF_ADMIN_PASSWORD(default from env or a generated strong one)

On success prints the OIDC client_id / client_secret / issuer for backend wiring.

Run (in-cluster, where the token is accepted):
  kubectl -n fuzefront cp scripts/seed-authentik-fuzefront.py <server-pod>:/tmp/seed.py
  kubectl -n fuzefront exec <server-pod> -- env AUTHENTIK_TOKEN=... python3 /tmp/seed.py
"""
import json
import os
import sys
import urllib.request
import urllib.error
import urllib.parse

BASE = os.environ.get("AUTHENTIK_URL", "http://localhost:9000").rstrip("/") + "/api/v3"
TOKEN = os.environ.get("AUTHENTIK_TOKEN", "")
REDIRECT_URI = os.environ.get(
    "FF_REDIRECT_URI", "http://fuzefront.dev.local/api/auth/oidc/callback"
)
ADMIN_EMAIL = os.environ.get("FF_ADMIN_EMAIL", "admin@fuzefront.dev")
ADMIN_PASSWORD = os.environ.get("FF_ADMIN_PASSWORD", "FuzeFront!Admin2026")

if not TOKEN:
    print("ERROR: AUTHENTIK_TOKEN is required", file=sys.stderr)
    sys.exit(2)


def api(method, path, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode()
            return json.loads(txt) if txt else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode()
        raise SystemExit(f"API {method} {path} -> {e.code}: {detail}")


def first(path):
    """Return the first result of a list endpoint, or None."""
    res = api("GET", path)
    results = res.get("results", [])
    return results[0] if results else None


def get_or_create(list_path, find_query, create_path, payload, label):
    existing = first(list_path + find_query)
    if existing:
        print(f"= {label} exists (pk={existing.get('pk')})")
        return existing
    created = api("POST", create_path, payload)
    print(f"+ {label} created (pk={created.get('pk')})")
    return created


def main():
    print(f"Seeding Authentik at {BASE} ...")

    # --- Resolve the building blocks (flows, signing key, scopes, group) ---
    authz_flow = first("/flows/instances/?slug=default-provider-authorization-explicit-consent")
    invalidation_flow = first("/flows/instances/?slug=default-provider-invalidation-flow") \
        or first("/flows/instances/?slug=default-invalidation-flow")
    if not authz_flow or not invalidation_flow:
        raise SystemExit("Could not resolve default authorization/invalidation flows")

    signing_key = first("/crypto/certificatekeypairs/?has_key=true&ordering=name")
    if not signing_key:
        raise SystemExit("No signing certificate-keypair found")

    scopes = api("GET", "/propertymappings/provider/scope/?managed__isnull=false")
    want = {"goauthentik.io/providers/oauth2/scope-openid",
            "goauthentik.io/providers/oauth2/scope-email",
            "goauthentik.io/providers/oauth2/scope-profile"}
    scope_pks = [m["pk"] for m in scopes.get("results", []) if m.get("managed") in want]

    admins = first("/core/groups/?name=" + urllib.parse.quote("authentik Admins"))

    # --- OAuth2 / OIDC provider ---
    provider = first("/providers/oauth2/?name=FuzeFront")
    if not provider:
        provider = api("POST", "/providers/oauth2/", {
            "name": "FuzeFront",
            "authorization_flow": authz_flow["pk"],
            "invalidation_flow": invalidation_flow["pk"],
            "client_type": "confidential",
            "redirect_uris": [{"matching_mode": "strict", "url": REDIRECT_URI}],
            "property_mappings": scope_pks,
            "signing_key": signing_key["pk"],
            "sub_mode": "user_email",
            "include_claims_in_id_token": True,
        })
        print(f"+ OAuth2 provider created (pk={provider['pk']})")
    else:
        print(f"= OAuth2 provider exists (pk={provider['pk']})")

    # --- Application bound to the provider ---
    get_or_create(
        "/core/applications/", "?slug=fuzefront",
        "/core/applications/",
        {"name": "FuzeFront", "slug": "fuzefront", "provider": provider["pk"],
         "meta_launch_url": "http://fuzefront.dev.local/",
         "meta_description": "FuzeFront runtime microfrontend platform"},
        "Application 'fuzefront'",
    )

    # --- Strong password policy ---
    policy = get_or_create(
        "/policies/password/", "?name=fuzefront-password-policy",
        "/policies/password/",
        {"name": "fuzefront-password-policy",
         "length_min": 12, "amount_uppercase": 1, "amount_lowercase": 1,
         "amount_digits": 1, "amount_symbols": 1, "password_field": "password",
         "error_message": "Password must be 12+ chars with upper, lower, digit and symbol."},
        "Password policy",
    )

    # --- Enrollment (sign-up) flow that enforces the password policy ---
    flow = first("/flows/instances/?slug=fuzefront-enrollment")
    if not flow:
        flow = api("POST", "/flows/instances/", {
            "name": "FuzeFront Sign-up", "slug": "fuzefront-enrollment",
            "title": "Create your FuzeFront account", "designation": "enrollment",
            "authentication": "none",
        })
        print(f"+ Enrollment flow created (pk={flow['pk']})")
    else:
        print(f"= Enrollment flow exists (pk={flow['pk']})")

    # Sign-up prompt fields (Authentik: fields live at /stages/prompt/prompts/,
    # the stage at /stages/prompt/stages/).
    def field(field_key, label, ftype, order):
        ex = first("/stages/prompt/prompts/?name=ff-" + field_key)
        if ex:
            return ex
        return api("POST", "/stages/prompt/prompts/", {
            "name": "ff-" + field_key, "field_key": field_key, "label": label,
            "type": ftype, "required": True, "placeholder": label, "order": order})
    fields = [
        field("email", "Email", "email", 10),
        field("username", "Username", "username", 20),
        field("password", "Password", "password", 30),
        field("password_repeat", "Confirm password", "password", 40),
    ]
    prompt = first("/stages/prompt/stages/?name=fuzefront-enroll-prompt")
    if not prompt:
        prompt = api("POST", "/stages/prompt/stages/", {
            "name": "fuzefront-enroll-prompt",
            "fields": [f["pk"] for f in fields], "validation_policies": []})
        print(f"+ Prompt stage created (pk={prompt['pk']})")
    else:
        print(f"= Prompt stage exists (pk={prompt['pk']})")
    user_write = get_or_create(
        "/stages/user_write/", "?name=fuzefront-enroll-write",
        "/stages/user_write/",
        {"name": "fuzefront-enroll-write", "create_users_as_inactive": False},
        "User-write stage",
    )
    # Bind stages to the flow (order matters: prompt then write)
    for order, stage in ((10, prompt), (20, user_write)):
        b = first(f"/flows/bindings/?target={flow['pk']}&stage={stage['pk']}")
        if not b:
            api("POST", "/flows/bindings/", {
                "target": flow["pk"], "stage": stage["pk"], "order": order})
            print(f"+ bound stage {stage['name']} @ {order}")
    # Enforce the password policy on the sign-up prompt. A PromptStage validates
    # its input via `validation_policies`, not a generic PolicyBinding.
    api("PATCH", f"/stages/prompt/stages/{prompt['pk']}/",
        {"validation_policies": [policy["pk"]]})
    print("= password policy attached to sign-up prompt")

    # --- Initial FuzeFront admin user ---
    user = first(f"/core/users/?username=fuzefront-admin")
    if not user:
        user = api("POST", "/core/users/", {
            "username": "fuzefront-admin", "name": "FuzeFront Admin",
            "email": ADMIN_EMAIL, "is_active": True, "type": "internal",
            "groups": [admins["pk"]] if admins else [],
        })
        print(f"+ admin user created (pk={user['pk']})")
    else:
        print(f"= admin user exists (pk={user['pk']})")
    api("POST", f"/core/users/{user['pk']}/set_password/", {"password": ADMIN_PASSWORD})
    print("= admin password set")

    # --- Output for backend OIDC wiring ---
    issuer = os.environ.get("AUTHENTIK_PUBLIC_URL", "http://auth.fuzefront.dev.local") \
        + "/application/o/fuzefront/"
    print("\n================ FuzeFront OIDC wiring ================")
    print(f"AUTHENTIK_CLIENT_ID={provider['client_id']}")
    print(f"AUTHENTIK_CLIENT_SECRET={provider['client_secret']}")
    print(f"AUTHENTIK_ISSUER_URL={issuer}")
    print(f"AUTHENTIK_REDIRECT_URI={REDIRECT_URI}")
    print(f"Admin: {ADMIN_EMAIL} / (password set)")
    print("======================================================")


if __name__ == "__main__":
    main()
