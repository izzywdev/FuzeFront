export interface PermitActionDef {
    name: string;
}
export interface PermitResourceRoleDef {
    name: string;
    permissions: string[];
    granted_to?: {
        users_with_role: Array<{
            role: string;
            on_resource: string;
            linked_by_relation: string;
        }>;
    };
}
export interface PermitResourceDef {
    key: string;
    name: string;
    actions: Record<string, PermitActionDef>;
    relations?: Record<string, string>;
    roles?: Record<string, PermitResourceRoleDef>;
}
export interface PermitRoleDef {
    key: string;
    name: string;
    permissions: string[];
}
export interface PermitSchema {
    resources: PermitResourceDef[];
    roles: PermitRoleDef[];
}
export declare const permitSchema: PermitSchema;
//# sourceMappingURL=schema.d.ts.map