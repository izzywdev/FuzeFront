/**
 * Idempotently provisions the built-in apps as `builtin:true`, `status:activated`
 * (upsert by slug — existing rows are left untouched). Safe to call on every boot.
 * Best-effort: a failure here logs and does NOT abort startup.
 */
export declare function ensureBuiltins(): Promise<void>;
//# sourceMappingURL=builtins.d.ts.map