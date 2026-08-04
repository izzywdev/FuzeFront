/** Wire prefixes, keyed by entity type. Prefix must match `^[a-z][a-z_]{1,62}$`. */
export declare const ENTITY_PREFIXES: {
    readonly portal: "prt";
    readonly organization: "org";
    readonly user: "usr";
    readonly app: "app";
    readonly customer: "cus";
    readonly subscription: "sub";
    readonly payment: "pay";
    readonly invoice: "inv";
    readonly credit: "crd";
    readonly conversation: "cnv";
    readonly message: "msg";
    readonly notification: "ntf";
};
export type EntityType = keyof typeof ENTITY_PREFIXES;
export type EntityPrefix = (typeof ENTITY_PREFIXES)[EntityType];
export declare function prefixFor(type: EntityType): EntityPrefix;
/** The entity type owning `prefix`, or null when the prefix is unregistered. */
export declare function typeForPrefix(prefix: string): EntityType | null;
export declare function isEntityType(value: string): value is EntityType;
/** Every registered type, for gates and tests that need to enumerate. */
export declare const ENTITY_TYPES: readonly EntityType[];
