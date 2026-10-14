import base64
import json
import time

import pytest
from conftest import AUDIENCE, ISSUER, SECRET, make_token
from fuzefront_auth import AuthError, LegacyHs256Config, create_verifier


def verifier(**kw):
    return create_verifier(LegacyHs256Config(secret=SECRET, **kw))


def code_of(v, token):
    with pytest.raises(AuthError) as info:
        v.verify(token)
    return info.value.code


def test_valid_token_normalises_to_identity():
    ident = verifier().verify(make_token(SECRET, claims={"userId": "u-1", "sessionId": "s-1"}))
    assert ident.user_id == "u-1"
    assert ident.tenant_id is None  # unresolved => unprivileged, never guessed
    assert ident.roles == ()
    assert ident.auth_mode == "legacy-hs256"
    assert ident.expires_at and ident.issued_at


def test_sub_is_accepted_when_userid_absent():
    # The OIDC-callback path carries `sub`; the shape must still normalise.
    assert verifier().verify(make_token(SECRET, claims={"sub": "u-2"})).user_id == "u-2"


def test_expired_rejected():
    now = int(time.time())
    assert code_of(verifier(), make_token(SECRET, claims={"userId": "u", "iat": now - 7200, "exp": now - 3600})) == "EXPIRED"


def test_missing_exp_rejected():
    # A token that never expires must not be accepted.
    assert code_of(verifier(), make_token(SECRET, claims={"userId": "u"}, drop=("exp",))) == "MISSING_CLAIM"


def test_bad_signature_rejected():
    assert code_of(verifier(), make_token("a-different-secret-0123456789abcdefghij", claims={"userId": "u"})) == "INVALID_SIGNATURE"


def test_wrong_algorithm_rejected():
    # HS384 with the right secret: pinned to HS256 only.
    assert code_of(verifier(), make_token(SECRET, alg="HS384", claims={"userId": "u"})) == "INVALID_SIGNATURE"


def test_asymmetric_algorithm_rejected(rsa_key):
    assert code_of(verifier(), make_token(rsa_key, alg="RS256", claims={"userId": "u"})) == "INVALID_SIGNATURE"


def _b64(data: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()


def test_alg_none_rejected():
    exp = int(time.time()) + 3600
    forged = f"{_b64({'alg': 'none', 'typ': 'JWT'})}.{_b64({'userId': 'admin', 'exp': exp})}."
    assert code_of(verifier(), forged) in {"INVALID_SIGNATURE", "MALFORMED"}


def test_malformed_and_empty_rejected():
    assert code_of(verifier(), "not-a-jwt") == "MALFORMED"
    assert code_of(verifier(), "") == "NO_TOKEN"


def test_missing_subject_rejected():
    assert code_of(verifier(), make_token(SECRET, claims={"email": "a@b.c"})) == "MISSING_CLAIM"


def test_not_yet_valid_rejected():
    assert code_of(verifier(), make_token(SECRET, claims={"userId": "u", "nbf": int(time.time()) + 600})) == "NOT_ACTIVE"


def test_issuer_and_audience_enforced_when_configured():
    v = verifier(issuer=ISSUER, audience=AUDIENCE)
    ok = make_token(SECRET, claims={"userId": "u", "iss": ISSUER, "aud": AUDIENCE})
    assert v.verify(ok).issuer == ISSUER
    assert code_of(v, make_token(SECRET, claims={"userId": "u", "iss": "https://evil.invalid", "aud": AUDIENCE})) == "INVALID_ISSUER"
    assert code_of(v, make_token(SECRET, claims={"userId": "u", "iss": ISSUER, "aud": "someone-else"})) == "INVALID_AUDIENCE"
    # Configured => required: today's iss-less token is rejected once enforcement is on.
    assert code_of(v, make_token(SECRET, claims={"userId": "u"})) == "MISSING_CLAIM"


def test_issuer_audience_not_demanded_when_unconfigured():
    # Today's session JWT carries no iss/aud and must keep verifying.
    assert verifier().verify(make_token(SECRET, claims={"userId": "u", "aud": "whatever"})).user_id == "u"


def test_resolver_hydrates_tenant_roles_email():
    v = verifier(resolver=lambda uid: {"tenant_id": "t-1", "roles": ["admin"], "email": "x@y.z"})
    ident = v.verify(make_token(SECRET, claims={"userId": "u"}))
    assert (ident.tenant_id, ident.roles, ident.email) == ("t-1", ("admin",), "x@y.z")


def test_resolver_failure_denies_with_500_and_does_not_leak():
    def boom(uid):
        raise RuntimeError("db password=hunter2 unreachable")

    with pytest.raises(AuthError) as info:
        verifier(resolver=boom).verify(make_token(SECRET, claims={"userId": "u"}))
    assert info.value.code == "VERIFIER_UNAVAILABLE" and info.value.status == 500
    assert "hunter2" not in str(info.value)


def test_empty_secret_fails_at_construction():
    with pytest.raises(AuthError) as info:
        create_verifier(LegacyHs256Config(secret=""))
    assert info.value.code == "VERIFIER_UNAVAILABLE" and info.value.status == 500


def test_errors_never_contain_token_material():
    token = make_token("another-secret-0123456789abcdefghijklmn", claims={"userId": "u"})
    with pytest.raises(AuthError) as info:
        verifier().verify(token)
    for part in token.split("."):
        assert part not in str(info.value)


@pytest.mark.parametrize("kind", ["fuze-org-session", "fuze-workload", "fuze-delegation"])
def test_non_session_token_kinds_are_rejected(kind):
    # Narrowed/machine credentials share the secret but are never a user session;
    # the resolver must not hydrate them with the user's full roles.
    calls = []
    v = verifier(resolver=lambda uid: calls.append(uid) or {"roles": ["admin"]})
    assert code_of(v, make_token(SECRET, claims={"userId": "u", "kind": kind})) == "INVALID_AUDIENCE"
    assert calls == []


def test_fractional_numeric_dates_are_preserved():
    now = time.time()
    ident = verifier().verify(make_token(SECRET, claims={"userId": "u", "iat": now - 0.5, "exp": now + 100.25}))
    assert ident.expires_at == pytest.approx(now + 100.25)


def test_future_iat_is_not_rejected_with_zero_tolerance():
    # Legacy tolerance defaults to 0; an issuer clock a few minutes ahead must not
    # lock users out. `nbf` is the not-before boundary, not `iat`.
    ident = verifier().verify(make_token(SECRET, claims={"userId": "u", "iat": int(time.time()) + 300}))
    assert ident.user_id == "u"


@pytest.mark.parametrize(
    "bad",
    [{"roles": 1}, {"roles": "admin"}, {"roles": [1, 2]}, {"tenant_id": 5}, {"email": ["x"]}, "not-a-dict", ["roles"]],
)
def test_malformed_resolver_output_is_a_500_not_a_crash(bad):
    # Malformed host data must stay inside the failure contract: an AuthError 500
    # (an outage), never a raw TypeError and never an opaque 401.
    with pytest.raises(AuthError) as info:
        verifier(resolver=lambda uid: bad).verify(make_token(SECRET, claims={"userId": "u"}))
    assert info.value.code == "VERIFIER_UNAVAILABLE" and info.value.status == 500


def test_resolver_returning_nothing_is_unprivileged():
    ident = verifier(resolver=lambda uid: None).verify(make_token(SECRET, claims={"userId": "u"}))
    assert (ident.tenant_id, ident.roles) == (None, ())


def test_session_validator_receives_user_session_and_claims():
    seen = []

    def validator(user_id, session_id, claims):
        seen.append((user_id, session_id, claims.get("userId")))
        return True

    ident = verifier(session_validator=validator).verify(make_token(SECRET, claims={"userId": "u", "sessionId": "s-1"}))
    assert seen == [("u", "s-1", "u")] and ident.session_id == "s-1"


@pytest.mark.parametrize("answer", [False, None, 1, "yes", 0])
def test_a_session_that_is_not_confirmed_active_is_denied(answer):
    # Only `True` keeps a logged-out / revoked session alive; anything else denies.
    with pytest.raises(AuthError) as info:
        verifier(session_validator=lambda *a: answer).verify(make_token(SECRET, claims={"userId": "u", "sessionId": "s-1"}))
    assert (info.value.code, info.value.status) == ("EXPIRED", 401)


def test_validator_failure_is_a_retryable_503_and_does_not_leak():
    def boom(*a):
        raise RuntimeError("sessions db password=hunter2")

    with pytest.raises(AuthError) as info:
        verifier(session_validator=boom).verify(make_token(SECRET, claims={"userId": "u", "sessionId": "s-1"}))
    assert info.value.status == 503 and "hunter2" not in str(info.value)


def test_validator_runs_before_the_resolver_hydrates_anything():
    calls = []
    v = verifier(session_validator=lambda *a: False, resolver=lambda uid: calls.append(uid) or {"roles": ["admin"]})
    with pytest.raises(AuthError):
        v.verify(make_token(SECRET, claims={"userId": "u", "sessionId": "s-1"}))
    assert calls == []


@pytest.mark.parametrize("bad", [5, ["p-1"], "", {"id": "p-1"}, True, None])
def test_a_malformed_portal_binding_is_rejected_not_dropped(bad):
    # Normalising a present-but-malformed portalId to "unbound" would widen the token:
    # an unbound token is accepted on the root portal or with no resolver at all.
    calls = []
    v = verifier(resolver=lambda uid: calls.append(uid) or {"roles": ["admin"]})
    with pytest.raises(AuthError) as info:
        v.verify(make_token(SECRET, claims={"userId": "u", "portalId": bad}))
    assert (info.value.code, info.value.status) == ("MALFORMED", 401)
    assert calls == []  # rejected before anything is hydrated


@pytest.mark.parametrize("bad", [5, ["s-1"], "", True])
def test_a_malformed_session_id_is_rejected_not_passed_as_none(bad):
    seen = []
    v = verifier(session_validator=lambda *a: seen.append(a) or True)
    with pytest.raises(AuthError) as info:
        v.verify(make_token(SECRET, claims={"userId": "u", "sessionId": bad}))
    assert info.value.code == "MALFORMED" and seen == []


def test_absent_binding_claims_are_still_fine():
    ident = verifier().verify(make_token(SECRET, claims={"userId": "u"}))
    assert (ident.portal_id, ident.session_id) == (None, None)
