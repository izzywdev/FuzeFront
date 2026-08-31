"""Framework middleware for verifying FuzeFront M2M bearer tokens.

Submodules (`fastapi`, `flask`) are NOT imported here -- each has its own
optional third-party dependency (`fastapi`/`starlette` or `flask`), and this
package's core (`fuzefront_service_auth`) must stay importable with zero
third-party dependencies for services that use neither framework. Import the
specific submodule you need:

    from fuzefront_service_auth.middleware.fastapi import machine_identity_dependency
    from fuzefront_service_auth.middleware.flask import require_machine_identity
"""
