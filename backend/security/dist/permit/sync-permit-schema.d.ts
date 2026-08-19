import { PermitSchema } from './schema';
export { permitSchema } from './schema';
export type { PermitSchema, PermitResourceDef, PermitRoleDef } from './schema';
export interface PermitSchemaClient {
    api: {
        resources: {
            get(key: string): Promise<unknown>;
            create(def: unknown): Promise<unknown>;
            update(key: string, def: unknown): Promise<unknown>;
        };
        roles: {
            get(key: string): Promise<unknown>;
            create(def: unknown): Promise<unknown>;
            update(key: string, def: unknown): Promise<unknown>;
        };
    };
}
export declare function syncPermitSchema(permit: PermitSchemaClient, schema?: PermitSchema, log?: (m: string) => void): Promise<void>;
//# sourceMappingURL=sync-permit-schema.d.ts.map