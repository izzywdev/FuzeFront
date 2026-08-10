# fuzefront-selection-list-client

Python client for the FuzeFront SelectionList service. Peer of
`@fuzefront/selection-list-client` (Node). Zero runtime dependencies —
uses `urllib.request` (stdlib only).

## Install

```bash
pip install fuzefront-selection-list-client
```

## Quick start

```python
from fuzefront_selection_list_client import SelectionListClient

client = SelectionListClient(
    base_url="http://fuzefront-selection-list-service:3011",
    token="eyJhbGciOiJSUzI1NiJ9...",
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
print(created.id)  # sl_01h455vb4pex5vsknk084sn02q

# Bulk-resolve persisted item ids to their display labels (hot path)
result = client.resolve_ids(["sli_01h455vb4pex5vsknk084sn02q"])
for item_id, resolved in result.results.items():
    print(item_id, resolved.label)
```

## Token provider

Pass a callable if your token is short-lived (it is called once per request):

```python
client = SelectionListClient(
    base_url="http://fuzefront-selection-list-service:3011",
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
