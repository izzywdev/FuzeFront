"""Framework middleware for verifying FuzeFront platform bearer tokens.

Submodules (`fastapi`, `flask`) are NOT imported here -- each has its own
optional third-party dependency (`fastapi`/`starlette` or `flask`), and this
package's core (`fuzefront_auth`) must stay importable with only PyJWT
installed for a consumer that uses neither framework. Import the specific
submodule you need:

    from fuzefront_auth.middleware.fastapi import require_auth
    from fuzefront_auth.middleware.flask import require_auth
"""
