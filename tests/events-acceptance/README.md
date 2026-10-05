# Events acceptance suite (slice B3)

Independent verification of the events foundation against the FROZEN contract
(`contracts/events/*`, `packages/conformance-vectors/events/*`, FuzeSDLC data-consistency
standard §3-§4). It never imports package internals: each language has ONE adapter file
(`ts/adapter.ts`, `py/adapter.py`) and only those change when the package APIs move.

| Case | TS (`ts/*.test.ts`) | Py (`py/test_*.py`) |
|---|---|---|
| 1 outbox atomicity / crash-after-commit | outbox.test.ts | test_outbox.py |
| 2 relay ordering, head-of-line block, DLQ | relay.test.ts | test_relay.py |
| 3 dedupe | consumer.test.ts | test_consumer.py |
| 4 version guard (version-guard.json) | consumer.test.ts | test_consumer.py |
| 5 replay + shuffled delivery | consumer.test.ts | test_consumer.py |
| 6 v1 envelope back-compat | consumer.test.ts | test_consumer.py |
| 7 cross-language | `cross/test_cross_language.py` | |

While a package is absent its tests are RED by design (`test.failing` / `xfail`, reason names the
missing package). When the package lands they run for real; no edit needed. Cross-language tests
are skipped-with-reason unless BOTH packages are present.

Env: `DATABASE_URL` (postgres), `KAFKA_BROKERS` (default `localhost:9094`). Without them the
suites skip with a reason (same convention as the existing event-propagation job).

Run: `cd ts && npm install && npm test`; `cd py && pip install -r requirements.txt && pytest`.
