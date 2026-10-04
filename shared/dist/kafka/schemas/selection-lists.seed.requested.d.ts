import { z } from 'zod';
/**
 * `selection-lists.seed.requested` — INBOUND. Another service asks the
 * selection-list-service to seed a versioned pack of lists for its app into an
 * organization. This is the ONE selection-lists topic the service consumes
 * rather than produces; every other `selection-lists.*` topic is produced only
 * by selection-list-service.
 *
 * The request is a create-shaped body, so it follows the identifier standard:
 * no `id` anywhere (lists and items are minted by the service) and every
 * object is `.strict()` so an unknown field — including a smuggled `id` — is a
 * validation failure, not a silently-dropped key.
 *
 * Trust: the topic itself is not authenticated today (FuzeInfra Kafka has no
 * SASL/ACLs), so the request carries an `attestation` — a short-lived service
 * token with scope `selection-lists:seed`, introspected by the consumer and
 * matched against the `seed_sources` allowlist for `source.app`. See
 * docs/planning/selection-lists-events.md §"Trust model".
 *
 * Outcome: exactly one `selection-lists.seed.completed` or
 * `selection-lists.seed.failed` per processed request, echoing `requestId`.
 */
export declare const selectionListsSeedRequestedSchemaV1: z.ZodEffects<z.ZodObject<{
    /**
     * Caller-chosen idempotency key, echoed on the outcome event. Prefer a
     * deterministic value (e.g. `<app>:<org>:<packKey>:v<version>`) so a
     * re-send after a crash is recognisably the same request.
     */
    requestId: z.ZodString;
    organizationId: z.ZodString;
    /** 'user' is accepted by the schema but answered with seed.failed SCOPE_UNSUPPORTED until user-scoped lists exist. */
    scope: z.ZodEnum<["org", "user"]>;
    /** Required for scope 'user'; forbidden for scope 'org'. */
    userId: z.ZodOptional<z.ZodString>;
    source: z.ZodObject<{
        /** The requesting app's registry slug — the allowlist key and the default list-key namespace. */
        app: z.ZodEffects<z.ZodString, string, string>;
        /** The producing service's name, for audit/observability. Authenticated via `attestation`, not trusted from here. */
        service: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        app: string;
        service: string;
    }, {
        app: string;
        service: string;
    }>;
    pack: z.ZodObject<{
        /** Stable pack identifier within the source app. */
        key: z.ZodString;
        /** Monotonic content version. A version's content is immutable once applied. */
        version: z.ZodNumber;
    }, "strict", z.ZodTypeAny, {
        key: string;
        version: number;
    }, {
        key: string;
        version: number;
    }>;
    trigger: z.ZodEnum<["org-created", "app-installed", "app-upgraded", "backfill", "manual"]>;
    attestation: z.ZodObject<{
        kind: z.ZodLiteral<"service-token">;
        token: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        kind: "service-token";
        token: string;
    }, {
        kind: "service-token";
        token: string;
    }>;
    lists: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        sourceLocale: z.ZodEnum<["en", "es", "fr", "de", "pt", "ru", "zh", "ja", "hi", "ar", "he"]>;
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        translations: z.ZodOptional<z.ZodArray<z.ZodObject<{
            locale: z.ZodEnum<["en", "es", "fr", "de", "pt", "ru", "zh", "ja", "hi", "ar", "he"]>;
            name: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
        }, "strict", z.ZodTypeAny, {
            name: string;
            locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
            description?: string | undefined;
        }, {
            name: string;
            locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
            description?: string | undefined;
        }>, "many">>;
        items: z.ZodArray<z.ZodObject<{
            code: z.ZodString;
            label: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
            translations: z.ZodOptional<z.ZodArray<z.ZodObject<{
                locale: z.ZodEnum<["en", "es", "fr", "de", "pt", "ru", "zh", "ja", "hi", "ar", "he"]>;
                label: z.ZodString;
                description: z.ZodOptional<z.ZodString>;
            }, "strict", z.ZodTypeAny, {
                label: string;
                locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
                description?: string | undefined;
            }, {
                label: string;
                locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
                description?: string | undefined;
            }>, "many">>;
        }, "strict", z.ZodTypeAny, {
            code: string;
            label: string;
            description?: string | undefined;
            translations?: {
                label: string;
                locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
                description?: string | undefined;
            }[] | undefined;
        }, {
            code: string;
            label: string;
            description?: string | undefined;
            translations?: {
                label: string;
                locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
                description?: string | undefined;
            }[] | undefined;
        }>, "many">;
    }, "strict", z.ZodTypeAny, {
        name: string;
        key: string;
        sourceLocale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
        items: {
            code: string;
            label: string;
            description?: string | undefined;
            translations?: {
                label: string;
                locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
                description?: string | undefined;
            }[] | undefined;
        }[];
        description?: string | undefined;
        translations?: {
            name: string;
            locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
            description?: string | undefined;
        }[] | undefined;
    }, {
        name: string;
        key: string;
        sourceLocale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
        items: {
            code: string;
            label: string;
            description?: string | undefined;
            translations?: {
                label: string;
                locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
                description?: string | undefined;
            }[] | undefined;
        }[];
        description?: string | undefined;
        translations?: {
            name: string;
            locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
            description?: string | undefined;
        }[] | undefined;
    }>, "many">;
}, "strict", z.ZodTypeAny, {
    organizationId: string;
    source: {
        app: string;
        service: string;
    };
    lists: {
        name: string;
        key: string;
        sourceLocale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
        items: {
            code: string;
            label: string;
            description?: string | undefined;
            translations?: {
                label: string;
                locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
                description?: string | undefined;
            }[] | undefined;
        }[];
        description?: string | undefined;
        translations?: {
            name: string;
            locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
            description?: string | undefined;
        }[] | undefined;
    }[];
    requestId: string;
    scope: "user" | "org";
    pack: {
        key: string;
        version: number;
    };
    trigger: "org-created" | "app-installed" | "app-upgraded" | "backfill" | "manual";
    attestation: {
        kind: "service-token";
        token: string;
    };
    userId?: string | undefined;
}, {
    organizationId: string;
    source: {
        app: string;
        service: string;
    };
    lists: {
        name: string;
        key: string;
        sourceLocale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
        items: {
            code: string;
            label: string;
            description?: string | undefined;
            translations?: {
                label: string;
                locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
                description?: string | undefined;
            }[] | undefined;
        }[];
        description?: string | undefined;
        translations?: {
            name: string;
            locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
            description?: string | undefined;
        }[] | undefined;
    }[];
    requestId: string;
    scope: "user" | "org";
    pack: {
        key: string;
        version: number;
    };
    trigger: "org-created" | "app-installed" | "app-upgraded" | "backfill" | "manual";
    attestation: {
        kind: "service-token";
        token: string;
    };
    userId?: string | undefined;
}>, {
    organizationId: string;
    source: {
        app: string;
        service: string;
    };
    lists: {
        name: string;
        key: string;
        sourceLocale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
        items: {
            code: string;
            label: string;
            description?: string | undefined;
            translations?: {
                label: string;
                locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
                description?: string | undefined;
            }[] | undefined;
        }[];
        description?: string | undefined;
        translations?: {
            name: string;
            locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
            description?: string | undefined;
        }[] | undefined;
    }[];
    requestId: string;
    scope: "user" | "org";
    pack: {
        key: string;
        version: number;
    };
    trigger: "org-created" | "app-installed" | "app-upgraded" | "backfill" | "manual";
    attestation: {
        kind: "service-token";
        token: string;
    };
    userId?: string | undefined;
}, {
    organizationId: string;
    source: {
        app: string;
        service: string;
    };
    lists: {
        name: string;
        key: string;
        sourceLocale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
        items: {
            code: string;
            label: string;
            description?: string | undefined;
            translations?: {
                label: string;
                locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
                description?: string | undefined;
            }[] | undefined;
        }[];
        description?: string | undefined;
        translations?: {
            name: string;
            locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
            description?: string | undefined;
        }[] | undefined;
    }[];
    requestId: string;
    scope: "user" | "org";
    pack: {
        key: string;
        version: number;
    };
    trigger: "org-created" | "app-installed" | "app-upgraded" | "backfill" | "manual";
    attestation: {
        kind: "service-token";
        token: string;
    };
    userId?: string | undefined;
}>;
export type SelectionListsSeedRequestedPayloadV1 = z.infer<typeof selectionListsSeedRequestedSchemaV1>;
