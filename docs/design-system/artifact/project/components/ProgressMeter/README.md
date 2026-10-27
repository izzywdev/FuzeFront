Horizontal progress / usage meter — labelled track + fill keyed to a
fraction of a limit. Used for usage-based billing (seats, metered units)
and quota displays.

**Props**

- `value?`
- `max?`
- `label?`
- `valueLabel?`
- `tone?`
- `role?` — ARIA role of the track. `progressbar` (default) for task progress; `meter` for a scalar gauge within a known range (quota used / limit).

See `components/index.d.ts` for the full prop contract.
