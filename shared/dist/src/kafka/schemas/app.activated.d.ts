import { z } from 'zod';
/**
 * Emitted when an app transitions to `activated` (becomes visible in the menu).
 */
export declare const appActivatedSchemaV1: any;
export type AppActivatedPayloadV1 = z.infer<typeof appActivatedSchemaV1>;
