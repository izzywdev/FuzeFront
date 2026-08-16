import { EntityId } from './brand';
import { EntityType } from './registry';
export interface IdentityConfig {
    /**
     * Entity types whose stored rows still carry bare UUIDs, which `parseId`
     * therefore accepts alongside the prefixed form.
     *
     * This is the dual-accept window — GitHub ran the same play with the
     * `X-Github-Next-Global-ID` header when it changed node-id formats, because
     * a format migration without one breaks every stored reference at once.
     * Services populate this from the `fuzefront.identity.prefixed-ids` flag:
     * flag OFF (default) => the type is listed here and legacy ids pass;
     * flag ON => the type is removed and only prefixed ids are accepted.
     */
    legacyUuidTypes: ReadonlySet<EntityType>;
}
/** Replaces identity configuration. Call once at service bootstrap. */
export declare function configureIdentity(next: Partial<IdentityConfig>): void;
export declare function getIdentityConfig(): IdentityConfig;
/** Mints a fresh, server-owned id for `type`. The ONLY id constructor. */
export declare function mintId<T extends EntityType>(type: T): EntityId<T>;
/**
 * Validates that `raw` is an id of `type` and returns it branded.
 *
 * Throws `IdentityError` on any mismatch — notably when the caller passes an
 * id belonging to a different entity type, which is the attack this standard
 * exists to stop. The check is a string compare: no network, no cache, no
 * database, and correct even when the owning service is unreachable.
 */
export declare function parseId<T extends EntityType>(type: T, raw: unknown): EntityId<T>;
/**
 * Validates a REFERENCE to an entity of `type` — the L0 check in the layered
 * referential-integrity model. Answers "is this the right kind of thing",
 * which is the only question a local check can answer without the owning
 * service. Existence is L1 (`ref_index` projection) and above.
 */
export declare const assertRef: typeof parseId;
/** Non-throwing `parseId`; returns null instead. For optional references. */
export declare function tryParseId<T extends EntityType>(type: T, raw: unknown): EntityId<T> | null;
export declare function isId<T extends EntityType>(type: T, raw: unknown): raw is EntityId<T>;
/** Wire form -> storage form. Accepts a legacy bare UUID unchanged. */
export declare function toUuid<T extends EntityType>(id: EntityId<T>): string;
/** Storage form -> wire form. The inverse of `toUuid`. */
export declare function fromUuid<T extends EntityType>(type: T, uuid: string): EntityId<T>;
/**
 * The entity type `raw` declares itself to be, without knowing it in advance.
 * For generic plumbing (audit logs, tracing) — never for authorization, which
 * comes from the token and Permit policy, never from the shape of an id.
 */
export declare function entityTypeOf(raw: string): EntityType | null;
