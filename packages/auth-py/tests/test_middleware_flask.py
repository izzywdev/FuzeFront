import pytest

flask = pytest.importorskip("flask")

from conftest import SECRET, make_token
from fuzefront_auth import LegacyHs256Config, ResolvedPortal, create_verifier
from fuzefront_auth.middleware.flask import (
    require_auth,
    require_roles,
    require_tenant,
)


def build(resolver=None):
    verifier = create_verifier(LegacyHs256Config(secret=SECRET, resolver=resolver))
    app = flask.Flask(__name__)

    @app.get("/private")
    @require_auth(verifier)
    def private():
        return {"user": flask.g.identity.user_id}

    @app.get("/open")
    @require_auth(verifier, optional=True)
    def open_route():
        return {"user": flask.g.identity.user_id if flask.g.identity else None}

    @app.get("/admin")
    @require_auth(verifier)
    @require_roles(["admin"])
    def admin():
        return {"ok": True}

    @app.get("/t1")
    @require_auth(verifier)
    @require_tenant("t-1")
    def tenant():
        return {"ok": True}

    return app.test_client()


def bearer(claims=None, secret=SECRET):
    return {"Authorization": f"Bearer {make_token(secret, claims=claims or {'userId': 'u-1'})}"}


def test_valid_token_reaches_view():
    r = build().get("/private", headers=bearer())
    assert r.status_code == 200 and r.json == {"user": "u-1"}


def test_missing_and_bad_tokens_are_401_with_stable_body():
    c = build()
    r = c.get("/private")
    assert r.status_code == 401 and r.json == {"error": "no bearer token presented", "code": "NO_TOKEN"}
    r = c.get("/private", headers={"Authorization": "Basic abc"})
    assert r.status_code == 401 and r.json["code"] == "NO_TOKEN"
    r = c.get("/private", headers=bearer(secret="another-secret-0123456789abcdefghijklmn"))
    assert r.status_code == 401 and r.json["code"] == "INVALID_SIGNATURE"


def test_scheme_is_case_insensitive():
    token = make_token(SECRET, claims={"userId": "u-1"})
    assert build().get("/private", headers={"Authorization": f"bearer {token}"}).status_code == 200


def test_optional_continues_without_identity_never_half_built():
    c = build()
    assert c.get("/open").json == {"user": None}
    assert c.get("/open", headers={"Authorization": "Bearer garbage"}).json == {"user": None}
    assert c.get("/open", headers=bearer()).json == {"user": "u-1"}


def test_roles_403_not_401_and_empty_roles_deny():
    c = build()
    r = c.get("/admin", headers=bearer())  # no resolver => no roles => no role-gated access
    assert r.status_code == 403 and r.json["code"] == "FORBIDDEN"
    c = build(resolver=lambda uid: {"roles": ["admin"]})
    assert c.get("/admin", headers=bearer()).status_code == 200


def test_tenant_unresolved_is_denied_not_wildcard():
    r = build().get("/t1", headers=bearer())
    assert r.status_code == 403 and r.json["code"] == "MISSING_CLAIM"
    assert build(resolver=lambda uid: {"tenant_id": "t-2"}).get("/t1", headers=bearer()).status_code == 403
    assert build(resolver=lambda uid: {"tenant_id": "t-1"}).get("/t1", headers=bearer()).status_code == 200


def test_guard_without_auth_is_401():
    verifier = create_verifier(LegacyHs256Config(secret=SECRET))
    app = flask.Flask(__name__)

    @app.get("/miswired")
    @require_roles(["admin"])
    def miswired():
        return {"ok": True}

    assert app.test_client().get("/miswired").status_code == 401
    assert verifier  # constructed fine


def test_decorator_without_verifier_fails_at_wiring_time():
    from fuzefront_auth import AuthError

    with pytest.raises(AuthError):
        require_auth(None)


def test_portal_bound_token_is_enforced_by_the_decorator():
    verifier = create_verifier(LegacyHs256Config(secret=SECRET))
    token = make_token(SECRET, claims={"userId": "u-1", "portalId": "p-1"})
    headers = {"Authorization": f"Bearer {token}"}

    def build_portal(resolver):
        app = flask.Flask(__name__)

        @app.get("/private")
        @require_auth(verifier, portal=resolver)
        def private():
            return {"user": flask.g.identity.user_id}

        return app.test_client()

    assert build_portal(lambda req: ResolvedPortal(id="p-1")).get("/private", headers=headers).status_code == 200
    r = build_portal(lambda req: ResolvedPortal(id="p-2")).get("/private", headers=headers)
    assert r.status_code == 401 and r.json["code"] == "INVALID_AUDIENCE"
    assert build_portal(None).get("/private", headers=headers).status_code == 401  # fail closed

    # A pre-portal token (no portalId) is valid only on the root portal.
    plain = {"Authorization": f"Bearer {make_token(SECRET, claims={'userId': 'u-1'})}"}
    assert build_portal(lambda req: ResolvedPortal(id="p-1")).get("/private", headers=plain).status_code == 401
    assert build_portal(lambda req: ResolvedPortal(id="root", is_root=True)).get("/private", headers=plain).status_code == 200

    def down(req):
        raise RuntimeError("db down")

    assert build_portal(down).get("/private", headers=headers).status_code == 503
