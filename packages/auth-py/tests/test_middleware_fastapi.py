import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi import Depends, FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from fuzefront_auth import Identity, LegacyHs256Config, create_verifier  # noqa: E402
from fuzefront_auth.middleware.fastapi import auth_dependency, require_roles, require_tenant  # noqa: E402
from conftest import SECRET, make_token  # noqa: E402


def build(resolver=None):
    verifier = create_verifier(LegacyHs256Config(secret=SECRET, resolver=resolver))
    auth = auth_dependency(verifier)
    maybe = auth_dependency(verifier, optional=True)
    app = FastAPI()

    @app.get("/private")
    def private(identity: Identity = Depends(auth)):
        return {"user": identity.user_id}

    @app.get("/open")
    def open_route(identity: Identity | None = Depends(maybe)):
        return {"user": identity.user_id if identity else None}

    @app.get("/admin")
    def admin(identity: Identity = Depends(require_roles(auth, ["admin"]))):
        return {"ok": True}

    @app.get("/t1")
    def tenant(identity: Identity = Depends(require_tenant(auth, "t-1"))):
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
