import { z } from 'zod';
/**
 * Emitted when an app is registered in the app registry.
 * Durable, cross-service successor to the legacy Socket.io `app-registered` emit.
 */
export declare const appRegisteredSchemaV1: any;
export type AppRegisteredPayloadV1 = z.infer<typeof appRegisteredSchemaV1>;
