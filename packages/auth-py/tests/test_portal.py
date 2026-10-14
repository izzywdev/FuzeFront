import pytest
from conftest import SECRET, make_token
from fuzefront_auth import (
    AuthError,
    Identity,
    LegacyHs256Config,
    ResolvedPortal,
    create_verifier,
    enforce_portal,
)

ROOT = ResolvedPortal(id="root", is_root=True)
P1 = ResolvedPortal(id="p-1")
P2 = ResolvedPortal(id="p-2")


def ident(portal_id):
    return Identity(user_id="u", tenant_id=None, roles=(), auth_mode="legacy-hs256", portal_id=portal_id)


def denied(identity, resolver, status=401):
    with pytest.raises(AuthError) as info:
        enforce_portal(identity, object(), resolver)
    assert info.value.status == status
    return info.value


# --- bound tokens -----------------------------------------------------------------

def test_bound_token_matching_the_request_portal_is_accepted():
    enforce_portal(ident("p-1"), object(), lambda req: P1)


@pytest.mark.parametrize("resolved", [P2, ROOT, None])
def test_bound_token_on_another_or_no_portal_is_rejected(resolved):
    assert denied(ident("p-1"), lambda req: resolved).code == "INVALID_AUDIENCE"


def test_bound_token_without_a_resolver_fails_closed():
    # A claimed binding with nothing to check it against must never fall through.
    denied(ident("p-1"), None)


# --- claimless (pre-portal / flag-off) tokens ---------------------------------------

def test_claimless_token_is_valid_on_the_root_portal():
    enforce_portal(ident(None), object(), lambda req: ROOT)


def test_claimless_token_is_rejected_on_a_non_root_portal():
    # It carries no verifiable binding; the host rejects it on a tenant host, and so
    # must a service reached directly through one.
    err = denied(ident(None), lambda req: P1)
    assert err.code == "INVALID_AUDIENCE"


@pytest.mark.parametrize("resolver", [None, lambda req: None])
def test_claimless_token_is_accepted_when_there_is_no_portal_context(resolver):
    enforce_portal(ident(None), object(), resolver)


# --- resolver faults -----------------------------------------------------------------

@pytest.mark.parametrize("portal_id", ["p-1", None])
def test_resolver_failure_is_a_retryable_503_for_bound_and_claimless_alike(portal_id):
    def boom(req):
        raise RuntimeError("portal_domains password=hunter2")

    err = denied(ident(portal_id), boom, status=503)
    assert "hunter2" not in str(err)


@pytest.mark.parametrize("wrong", ["p-1", 1, {"id": "p-1"}, object()])
def test_resolver_returning_the_wrong_type_is_a_503_not_a_guess(wrong):
    denied(ident("p-1"), lambda req: wrong, status=503)
    denied(ident(None), lambda req: wrong, status=503)


def test_legacy_verifier_exposes_portal_id():
    v = create_verifier(LegacyHs256Config(secret=SECRET))
    assert v.verify(make_token(SECRET, claims={"userId": "u", "portalId": "p-1"})).portal_id == "p-1"
    assert v.verify(make_token(SECRET, claims={"userId": "u"})).portal_id is None
