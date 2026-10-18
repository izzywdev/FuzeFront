import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from typing import Annotated

from conftest import SECRET, make_token
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from fuzefront_auth import Identity, LegacyHs256Config, ResolvedPortal, create_verifier
from fuzefront_auth.middleware.fastapi import (
    auth_dependency,
    require_roles,
    require_tenant,
)


def build(resolver=None):
    verifier = create_verifier(LegacyHs256Config(secret=SECRET, resolver=resolver))
    auth = auth_dependency(verifier)
    maybe = auth_dependency(verifier, optional=True)
    app = FastAPI()

    @app.get("/private")
    def private(identity: Annotated[Identity, Depends(auth)]):
        return {"user": identity.user_id}

    @app.get("/open")
    def open_route(identity: Annotated[Identity | None, Depends(maybe)]):
        return {"user": identity.user_id if identity else None}

    @app.get("/admin")
    def admin(identity: Annotated[Identity, Depends(require_roles(auth, ["admin"]))]):
        return {"ok": True}

    @app.get("/t1")
    def tenant(identity: Annotated[Identity, Depends(require_tenant(auth, "t-1"))]):
        return {"ok": True}

    return TestClient(app)


def bearer(secret=SECRET):
    return {"Authorization": f"Bearer {make_token(secret, claims={'userId': 'u-1'})}"}


def test_valid_token():
    r = build().get("/private", headers=bearer())
    assert r.status_code == 200 and r.json() == {"user": "u-1"}


def test_missing_and_bad_tokens_are_401_with_stable_body():
    c = build()
    r = c.get("/private")
    assert r.status_code == 401 and r.json()["detail"] == {"error": "no bearer token presented", "code": "NO_TOKEN"}
    r = c.get("/private", headers=bearer("another-secret-0123456789abcdefghijklmn"))
    assert r.status_code == 401 and r.json()["detail"]["code"] == "INVALID_SIGNATURE"


def test_optional_never_half_built():
    c = build()
    assert c.get("/open").json() == {"user": None}
    assert c.get("/open", headers={"Authorization": "Bearer garbage"}).json() == {"user": None}
    assert c.get("/open", headers=bearer()).json() == {"user": "u-1"}


def test_roles_and_tenant_guards():
    r = build().get("/admin", headers=bearer())
    assert r.status_code == 403 and r.json()["detail"]["code"] == "FORBIDDEN"
    assert build(resolver=lambda uid: {"roles": ["admin"]}).get("/admin", headers=bearer()).status_code == 200
    r = build().get("/t1", headers=bearer())
    assert r.status_code == 403 and r.json()["detail"]["code"] == "MISSING_CLAIM"
    assert build(resolver=lambda uid: {"tenant_id": "t-2"}).get("/t1", headers=bearer()).status_code == 403
    assert build(resolver=lambda uid: {"tenant_id": "t-1"}).get("/t1", headers=bearer()).status_code == 200


def test_portal_bound_token_is_enforced_by_the_dependency():
    verifier = create_verifier(LegacyHs256Config(secret=SECRET))
    token = make_token(SECRET, claims={"userId": "u-1", "portalId": "p-1"})
    headers = {"Authorization": f"Bearer {token}"}

    def build_portal(resolver):
        auth = auth_dependency(verifier, portal=resolver)
        app = FastAPI()

        @app.get("/private")
        def private(identity: Annotated[Identity, Depends(auth)]):
            return {"user": identity.user_id}

        return TestClient(app)

    assert build_portal(lambda req: ResolvedPortal(id="p-1")).get("/private", headers=headers).status_code == 200
    r = build_portal(lambda req: ResolvedPortal(id="p-2")).get("/private", headers=headers)
    assert r.status_code == 401 and r.json()["detail"]["code"] == "INVALID_AUDIENCE"
    assert build_portal(None).get("/private", headers=headers).status_code == 401

    plain = {"Authorization": f"Bearer {make_token(SECRET, claims={'userId': 'u-1'})}"}
    assert build_portal(lambda req: ResolvedPortal(id="p-1")).get("/private", headers=plain).status_code == 401
    assert build_portal(lambda req: ResolvedPortal(id="root", is_root=True)).get("/private", headers=plain).status_code == 200

    def down(req):
        raise RuntimeError("db down")

    assert build_portal(down).get("/private", headers=headers).status_code == 503


def test_optional_degrades_client_failures_but_surfaces_server_failures():
    token = make_token(SECRET, claims={"userId": "u-1", "portalId": "p-1"})
    headers = {"Authorization": f"Bearer {token}"}

    def build_optional(resolver, verifier=None):
        verifier = verifier or create_verifier(LegacyHs256Config(secret=SECRET))
        maybe = auth_dependency(verifier, optional=True, portal=resolver)
        app = FastAPI()

        @app.get("/open")
        def open_route(identity: Annotated[Identity | None, Depends(maybe)]):
            return {"user": identity.user_id if identity else None}

        return TestClient(app)

    assert build_optional(lambda req: ResolvedPortal(id="p-2")).get("/open", headers=headers).json() == {"user": None}

    def down(req):
        raise RuntimeError("portal lookup down")

    assert build_optional(down).get("/open", headers=headers).status_code == 503

    def validator_down(*a):
        raise RuntimeError("sessions down")

    broken = create_verifier(LegacyHs256Config(secret=SECRET, session_validator=validator_down))
    plain = {"Authorization": f"Bearer {make_token(SECRET, claims={'userId': 'u-1'})}"}
    assert build_optional(None, broken).get("/open", headers=plain).status_code == 503
