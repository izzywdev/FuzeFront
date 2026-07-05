import { PermitSchema, PermitResourceRoleDef } from './schema';
export declare const PRODUCT_NS_SEP = ".";
export interface ProductPolicy {
    product: string;
    name?: string;
    resources: ProductResourceDecl[];
    roles: ProductRoleDecl[];
}
export interface ProductResourceDecl {
    key: string;
    name: string;
    actions: Record<string, {
        name: string;
    }>;
}
export interface ProductRoleDecl {
    key: string;
    name: string;
    permissions: string[];
}
export declare class ProductPolicyError extends Error {
}
/** Namespaced Permit key for a product's bare resource/role key. */
export declare function namespaceKey(product: string, bareKey: string): string;
export declare function validateProductPolicy(policy: ProductPolicy): void;
export declare function namespaceProductPolicy(policy: ProductPolicy): PermitSchema;
export declare function mergeProductPolicy(base: PermitSchema, ...policies: ProductPolicy[]): PermitSchema;
export declare function buildEnvSchema(...policies: ProductPolicy[]): PermitSchema;
export type { PermitResourceRoleDef };
//# sourceMappingURL=product-policy.d.ts.map