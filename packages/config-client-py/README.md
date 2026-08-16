# fuzefront-config-client

Python client for the FuzeFront **config-service** -- namespaced,
hierarchical key/value configuration with typed key metadata and
provenance-carrying resolution. Peer of `@fuzefront/config-client` (Node).
Zero runtime dependencies -- uses `urllib.request` (stdlib only).

Hand-authored from
[`services/config-service/openapi.yaml`](../../services/config-service/openapi.yaml)
v1.0.0. **That spec is the frozen contract; this package is a projection of
it.** If the two disagree, the spec wins and this package is the bug.

> Delivered by **FFRNT-259** (FF-EPIC-17-S10). The Node client is FFRNT-153;
> the served Swagger UI is FFRNT-258. All three are projections of one
> contract -- none of them is a second source of truth.

## Install

```bash
pip install fuzefront-config-client
```

Distributed as a **GitHub Release asset** (wheel + sdist), the same
mechanism `packages/identity-py` uses -- GitHub Packages has no PyPI-style
registry, so a signed Release asset is the private-by-default artifact
store the family already authenticates against:

```bash
pip install https://github.com/izzywdev/FuzeFront/releases/download/config-client-py-v1.0.0/fuzefront_config_client-1.0.0-py3-none-any.whl
```

## Use

```python
from fuzefront_config_client import ConfigClient, Scope, ScopeType, is_not_modified

client = ConfigClient(
    base_url="http://fuzefront-config-service:3013",  # Kubernetes Service DNS
    token=lambda: session.access_token,
)

resolved = client.get_effective_config(
    "fuzefront.chat", Scope(scope_type=ScopeType.ORG, scope_id=org_id)
)
```

### Read the provenance, not just the value

Every entry says where its value came from and whether this caller may
change it. Reading only `value` produces a form that looks correct and
misrepresents its own contents.

```python
if not is_not_modified(resolved):
    for entry in resolved.entries:
        if entry.locked:
            # An ancestor pinned this. `entry.locked_by` names which one.
            render(entry, disabled=True, badge=f"Locked by {entry.locked_by.scope_type.value}")
        elif entry.source.scope_type != ScopeType.ORG:
            render(entry, badge=f"Inherited from {entry.source.scope_type.value}")
        else:
            render(entry, badge="Set here")
```

### Writes are atomic

```python
from fuzefront_config_client import ConfigOperation, ConfigOperationType, ConfigWriteRequest

client.write_config_values(
    ConfigWriteRequest(
        namespace="fuzefront.chat",
        scope=Scope(scope_type=ScopeType.ORG, scope_id=org_id),
        operations=[
            ConfigOperation(key="ui.theme.density", op=ConfigOperationType.SET, value="compact"),
            # `unset` falls back to the parent and keeps tracking it -- writing
            # the parent's current value instead would pin a copy that stops
            # following it.
            ConfigOperation(key="ui.sidebar.collapsed", op=ConfigOperationType.UNSET),
        ],
        expected_version=resolved.version,  # optimistic concurrency
    )
)
```

### Two refusals worth distinguishing

```python
from fuzefront_config_client import ConfigApiError

try:
    client.write_config_values(request)
except ConfigApiError as error:
    if error.is_locked_by_ancestor:
        # Policy: an ancestor scope locked this key. `error.locked_by` names it.
        # Retrying will not help.
        ...
    elif error.is_version_conflict:
        # Collision: somebody else saved first. Re-read at
        # `error.current_version` and merge -- do NOT blind-retry, which
        # would overwrite their change.
        ...
```

`error.code` is what to branch on. `error.message` is human-facing and may
change without a contract version bump. A response that is not a contract
response at all -- an ingress 502, a proxy timeout, an HTML error page --
reports `"UNKNOWN"` rather than being mapped onto a real contract code,
because guessing would send the caller down the wrong recovery path.

### Cheap polling -- 304 is a result, not an error

`get_effective_config` takes an `if_none_match` version and returns a
distinct `NotModified` result (never raises) when nothing changed:

```python
result = client.get_effective_config(namespace, scope, if_none_match=resolved.version)
if is_not_modified(result):
    return  # nothing changed -- use the previous `resolved`
resolved = result
```

### Cursor pagination

Every collection endpoint returns `{ items, page_info: { has_next_page,
next_cursor } }` and the client walks it for you:

```python
for ns in client.paginate(client.list_namespaces):
    print(ns.namespace)
```

`limit`'s bounds (1-200, default 50) are enforced **server-side** per the
contract; this client forwards whatever you pass without its own clamping.

## Same-origin / relative base URLs

The Node browser client requires a same-origin relative `baseUrl`
(`'/api/config'`) so it never triggers a mixed-content block under TLS.
This Python client is for **server-side** microservices, which have a real
DNS host (Kubernetes Service DNS, an internal ingress) rather than a
browser page origin to resolve a relative path against.

Consequently:

- A relative `base_url` is accepted at construction and is **never**
  silently rewritten into a fabricated absolute host (e.g.
  `http://localhost/api/config`) -- that would be worse than failing,
  because it would appear to work and quietly talk to the wrong place.
- Making an actual request with a relative `base_url` raises a clear
  `ValueError` explaining why (`urllib` has no browser origin to fall back
  on) -- pass the service's absolute base URL instead.
- Whatever path prefix your `base_url` **does** carry (e.g. an ingress
  rewrite to `https://host/api/config`) is preserved exactly:
  URLs are built by plain string concatenation, never
  `urllib.parse.urljoin`, which would silently drop that prefix the moment
  an endpoint path starts with `/` (every endpoint path in this client
  does).

## This is not the feature-flag system

Unleash owns feature flags. **Configuration** is durable, typed, user- and
tenant-authored settings. **Flags** are rollout, targeting, kill-switches
and experiments, authored by engineering. See the `feature-flags` skill.

## Cross-client parity

`tests/test_contract_parity.py` parses `services/config-service/openapi.yaml`
directly and fails if this package's `ConfigErrorCode` (or the pagination
envelope's required fields) has drifted from the frozen contract, and
separately fails if it has drifted from the Node client's
`config-client/src/types.ts` / `errors.ts`. This is a **self**-check
proving this client agrees with the contract it implements -- it is not the
independent, full operation-by-operation cross-client acceptance suite (the
epic assigns that to QA as a separate sub-task).

## Development

```bash
pip install -e '.[dev]'
pytest
```
