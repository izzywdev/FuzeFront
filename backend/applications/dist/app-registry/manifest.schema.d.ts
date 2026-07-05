import { z } from 'zod';
export declare const slugSchema: any;
export declare const appModeSchema: any;
export declare const appStatusSchema: any;
export declare const integrationTypeSchema: any;
export declare const visibilitySchema: any;
export declare const iconSchema: any;
export declare const integrationSchema: any;
export declare const menuItemSchema: any;
export declare const chromeSchema: any;
export declare const routingSchema: any;
export declare const infraSchema: any;
export declare const appManifestSchema: any;
export type AppManifest = z.infer<typeof appManifestSchema>;
export type AppMode = z.infer<typeof appModeSchema>;
export type AppStatus = z.infer<typeof appStatusSchema>;
export type Visibility = z.infer<typeof visibilitySchema>;
export declare const registerAppRequestSchema: any;
export declare const heartbeatRequestSchema: any;
export interface ValidationFieldError {
    path: string;
    message: string;
}
export interface ValidationErrorBody {
    error: 'validation_error';
    message: string;
    fields: ValidationFieldError[];
}
/** Turns a ZodError into the contract's ValidationErrorBody shape. */
export declare function toValidationErrorBody(err: z.ZodError): ValidationErrorBody;
//# sourceMappingURL=manifest.schema.d.ts.map