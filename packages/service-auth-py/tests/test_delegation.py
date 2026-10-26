import json
from types import SimpleNamespace

from fuzefront_service_auth.delegation import DelegationClient


def test_optional_organization_selector():
    payloads = []
    def post(url, payload, timeout, **kwargs):
        payloads.append(payload)
        return 200, json.dumps({"accessToken": "synthetic", "expiresIn": 60, "scope": "read", "subject": "user", "audience": "service:keys", "actor": {"sub": "service:front"}})
    auth = SimpleNamespace(get_token=lambda: SimpleNamespace(authorization_header="Bearer synthetic"))
    client = DelegationClient("https://security.invalid", auth, http_post=post)
    client.exchange("synthetic-session", "service:keys", ["read"])
    client.exchange("synthetic-session", "service:keys", ["read"], tenant="organization-proof-selector")
    assert "tenant" not in payloads[0]
    assert payloads[1]["tenant"] == "organization-proof-selector"
