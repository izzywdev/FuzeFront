import { PermitSchema } from './schema';
import { ProductPolicy } from './product-policy';
export { permitSchema } from './schema';
export type { PermitSchema, PermitResourceDef, PermitRoleDef } from './schema';
export { mergeProductPolicy, namespaceProductPolicy, buildEnvSchema, namespaceKey, validateProductPolicy, ProductPolicyError, PRODUCT_NS_SEP, } from './product-policy';
export type { ProductPolicy, ProductResourceDecl, ProductRoleDecl } from './product-policy';
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
export declare function syncPermitSchemaWithProducts(permit: PermitSchemaClient, products: ProductPolicy[], log?: (m: string) => void): Promise<void>;
//# sourceMappingURL=sync-permit-schema.d.ts.map