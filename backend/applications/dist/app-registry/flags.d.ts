export interface FlagContext {
    environment: string;
    organizationId?: string | null;
    userId?: string;
    app: string;
}
export interface FlagClientLike {
    getBooleanValue(key: string, defaultValue: boolean, context?: Record<string, unknown>): Promise<boolean>;
}
export declare const FLAGS: {
    readonly V1_REGISTRY_WRITE: "fuzefront.app-registry.v1-registry-write";
    readonly KAFKA_EVENTS_KILL_SWITCH: "fuzefront.app-registry.kafka-events-kill-switch";
};
/** Test/DI seam — pin flag values with an in-memory client. */
export declare function setFlagClient(c: FlagClientLike | null): void;
/**
 * release flag (default OFF): is the new /api/v1/app-registry WRITE surface
 * released for this caller/org? Pass the request context so rollout can target
 * by org/user.
 */
export declare function isV1WriteEnabled(ctx?: Partial<FlagContext>): Promise<boolean>;
/**
 * ops-kill-switch (default ON): may we emit Kafka events on the write path?
 * Returns true (emit) unless explicitly killed.
 */
export declare function isKafkaEmitEnabled(ctx?: Partial<FlagContext>): Promise<boolean>;
//# sourceMappingURL=flags.d.ts.map