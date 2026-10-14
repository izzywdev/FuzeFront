import pytest
from conftest import SECRET, make_token
from fuzefront_auth import (
    AuthError,
    Identity,
    LegacyHs256Config,
    create_verifier,
    enforce_portal,
)


def ident(portal_id):
    return Identity(user_id="u", tenant_id=None, roles=(), auth_mode="legacy-hs256", portal_id=portal_id)


def test_unbound_token_needs_no_portal_check():
    enforce_portal(ident(None), object(), None)
    enforce_portal(ident(None), object(), lambda req: "anything")


def test_bound_token_matching_the_request_portal_is_accepted():
    enforce_portal(ident("p-1"), object(), lambda req: "p-1")


@pytest.mark.parametrize("resolved", ["p-2", None])
def test_bound_token_on_another_or_no_portal_is_rejected(resolved):
    with pytest.raises(AuthError) as info:
        enforce_portal(ident("p-1"), object(), lambda req: resolved)
    assert (info.value.code, info.value.status) == ("INVALID_AUDIENCE", 401)


def test_bound_token_without_a_resolver_fails_closed():
    # A claimed binding with nothing to check it against must never fall through.
    with pytest.raises(AuthError) as info:
        enforce_portal(ident("p-1"), object(), None)
    assert info.value.status == 401


def test_resolver_failure_is_a_retryable_503_and_does_not_leak():
    def boom(req):
        raise RuntimeError("portal_domains password=hunter2")

    with pytest.raises(AuthError) as info:
        enforce_portal(ident("p-1"), object(), boom)
    assert info.value.status == 503 and "hunter2" not in str(info.value)


def test_legacy_verifier_exposes_portal_id():
    v = create_verifier(LegacyHs256Config(secret=SECRET))
    assert v.verify(make_token(SECRET, claims={"userId": "u", "portalId": "p-1"})).portal_id == "p-1"
    assert v.verify(make_token(SECRET, claims={"userId": "u"})).portal_id is None
