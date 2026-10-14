import pytest
from conftest import AUDIENCE, ISSUER, SECRET, make_token
from fuzefront_auth import AuthError, verifier_from_env


def test_legacy_from_env_verifies_and_enforces_optional_iss_aud():
    env = {"FUZEFRONT_AUTH_MODE": "legacy-hs256", "FUZEFRONT_JWT_SECRET": SECRET}
    assert verifier_from_env(env).verify(make_token(SECRET, claims={"userId": "u"})).user_id == "u"
    env |= {"FUZEFRONT_JWT_ISSUER": ISSUER, "FUZEFRONT_JWT_AUDIENCE": AUDIENCE}
    with pytest.raises(AuthError) as info:
        verifier_from_env(env).verify(make_token(SECRET, claims={"userId": "u"}))
    assert info.value.code == "MISSING_CLAIM"


@pytest.mark.parametrize(
    "env",
    [
        {},
        {"FUZEFRONT_AUTH_MODE": "bogus"},
        {"FUZEFRONT_AUTH_MODE": "legacy-hs256"},
        {"FUZEFRONT_AUTH_MODE": "federated-jwks", "FUZEFRONT_AUTH_ISSUER": ISSUER},
        {"FUZEFRONT_AUTH_MODE": "federated-jwks", "FUZEFRONT_AUTH_AUDIENCE": AUDIENCE},
    ],
)
def test_unset_or_incomplete_config_fails_closed_at_wiring_time(env):
    with pytest.raises(AuthError) as info:
        verifier_from_env(env)
    assert info.value.code == "VERIFIER_UNAVAILABLE" and info.value.status == 500
