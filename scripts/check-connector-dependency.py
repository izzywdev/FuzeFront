"""Fail closed when the deployed credential service lacks our runtime protocol."""
import http.client
import json
import sys
import urllib.request

HEALTH_URL = "https://api.keys.prod.fuzefront.com/health"
REQUIRED_PROTOCOL = "google-shared-v1"


def check_dependency() -> None:
    request = urllib.request.Request(
        HEALTH_URL,
        headers={"Accept": "application/json", "Cache-Control": "no-cache"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        if response.status != 200:
            raise ValueError("credential dependency health is unavailable")
        body = response.read(65537)
        if len(body) > 65536:
            raise ValueError("credential dependency health response is too large")
    health = json.loads(body)
    if not isinstance(health, dict) or health.get("status") != "healthy":
        raise ValueError("credential dependency is not healthy")
    if health.get("database") != "connected (PostgreSQL)":
        raise ValueError("credential dependency production database is not connected")
    if health.get("connector_credential_protocol") != REQUIRED_PROTOCOL:
        raise ValueError("credential dependency has not deployed the shared Google protocol")


def main() -> int:
    try:
        check_dependency()
    except (OSError, ValueError, http.client.HTTPException):
        # Health bodies and exception details are deliberately not reflected.
        print(
            "::error::FuzeKeys production must be healthy and advertise "
            "connector_credential_protocol=google-shared-v1 before this release. "
            "Deploy and verify FuzeKeys first, then rerun this release.",
            file=sys.stderr,
        )
        return 1
    print("FuzeKeys production shared Google credential protocol is ready.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
