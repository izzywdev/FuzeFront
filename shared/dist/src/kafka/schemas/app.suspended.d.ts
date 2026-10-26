import { z } from 'zod';
/**
 * Emitted when an app transitions to `suspended` (hidden from the menu, retained).
 */
export declare const appSuspendedSchemaV1: any;
export type AppSuspendedPayloadV1 = z.infer<typeof appSuspendedSchemaV1>;
