# fuzefront-selection-list-client

Python client for the FuzeFront SelectionList service. Peer of
`@fuzeone/selection-list-client` (Node). Zero runtime dependencies —
uses `urllib.request` (stdlib only).

## Install

```bash
pip install fuzefront-selection-list-client
```

## Quick start

```python
from fuzefront_selection_list_client import SelectionListClient

client = SelectionListClient(
    base_url="http://fuzefront-selection-list-service:3008",
    token="<your-bearer-token>",
)

# List all active lists in the caller's organisation
page = client.get_lists()
for sl in page.items:
    print(sl.id, sl.name)

# Walk every page with the paginate() generator
for sl in client.paginate(client.get_lists):
    print(sl.id, sl.name)

# Create a list (service mints the id)
created = client.create_list(key="countries", name="Countries")
print(created.id)  # front_sl_01h455vb4pex5vsknk084sn02q

# Bulk-resolve persisted item ids to their display labels (hot path)
result = client.resolve_ids(["front_sli_01h455vb4pex5vsknk084sn02q"])
for item_id, resolved in result.results.items():
    print(item_id, resolved.label)
```

## Authorship and seed provenance (2.0.0, contract 4.0.0)

`created_by` (lists, items) and `granted_by` (access grants) are not always
users. Each is a `usr_` user id, a `system:<service>` principal (rows written by
seeding carry `system:selection-list-service`), or the literal
`DELETED_USER_SENTINEL` (`"[deleted-user]"`, after the author was deleted).
Branch before treating one as a user:

```python
from fuzefront_selection_list_client import AuthorPrincipalKind, author_principal_kind, is_user_author

if is_user_author(sl.created_by):
    show_profile(sl.created_by)
elif author_principal_kind(sl.created_by) is AuthorPrincipalKind.SYSTEM:
    render("Seeded")
```

`SelectionList.seed` / `SelectionListItem.seed` is a `SeedProvenance`
(`source`, `pack_key`, `pack_version`, `user_modified`) on seeded rows and
`None` on user-authored ones.

## Shared and common lists, forks (2.1.0, contract 4.1.0)

Lists carry a `visibility` (`private` / `org` / `platform`): `org` lists are
readable by every member of their org and `platform` lists are common lists
readable by every org — read-only for anyone without an instance role
(`editable` is `False`). Look a list up by key the way a picker should, and
fork a common list before changing it.

At contract 4.1.0 `visibility`, `forked_from`, `editable` and
`origin_item_id` are **optional on the wire**: the service implements them
behind the default-OFF flag `fuzefront.selection-lists.shared-lists` and omits
`editable` while it is OFF (a pre-4.1.0 service omits all four). The parser maps absence to the 4.0.0 meaning —
`visibility` → `PRIVATE`, `forked_from` / `origin_item_id` → `None`, and
`editable` → `None` (unknown: behave as at 4.0.0 and let each mutation's own
authorization decide; never read `None` as `False`).

```python
sl = client.get_effective_list("priority")  # own org's list/fork first, else the common list
try:
    client.update_list(sl.id, name="Urgency")
except SelectionListApiError as exc:
    if exc.is_fork_required:
        fork, created = client.fork_list(exc.source_list_id)  # same key, items keep origin_item_id
        client.update_list(fork.id, name="Urgency")
    else:
        raise
```

`get_lists(include_shared=True)` also returns lists readable through
visibility; the default is unchanged. `resolve_ids` resolves common-list item
ids everywhere and, inside an org holding an `org`-visible fork, returns the
fork item's label with `effective_item_id` set.

## Is a fork behind its source? (2.2.0, contract 4.2.0)

`SelectionList.revision` is the per-list counter the events carry as
`listRevision` (`1` at creation, +1 per committed change event about the list
or anything inside it, never decreasing). A fork's `forked_from.revision` is the
source's revision at copy time.

```python
from fuzefront_selection_list_client import ForkSourceComparison, compare_fork_to_source

source = client.get_list(fork.forked_from.list_id)
if compare_fork_to_source(fork, source) is ForkSourceComparison.BEHIND:
    ...  # informational: no merge/sync operation exists
```

`revision` is optional on the wire at 4.2.0 (the service emits it once its
implementation ships); the parser maps absence to `None`, which compares as
`ForkSourceComparison.UNKNOWN` ("comparison unavailable"). The helper never
looks at `updated_at`.

## Token provider

Pass a callable if your token is short-lived (it is called once per request):

```python
client = SelectionListClient(
    base_url="http://fuzefront-selection-list-service:3008",
    token=my_auth_library.get_access_token,
)
```

## Error handling

```python
from fuzefront_selection_list_client import SelectionListApiError

try:
    client.create_list(key="countries", name="Countries")
except SelectionListApiError as exc:
    if exc.code == "QUOTA_EXCEEDED":
        print(f"Quota hit: {exc.scope} {exc.current}/{exc.limit}")
    elif exc.code == "CONFLICT":
        print("Key already exists in this organisation")
    else:
        raise
```

## Development

```bash
pip install -e '.[dev]'
pytest
```
