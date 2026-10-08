import { z } from 'zod';
export declare const SUPPORTED_TEMPLATES: readonly ["welcome", "org-invite", "membership-change"];
export declare const notifyEmailRequestedSchemaV1: any;
export type NotifyEmailRequestedPayloadV1 = z.infer<typeof notifyEmailRequestedSchemaV1>;
