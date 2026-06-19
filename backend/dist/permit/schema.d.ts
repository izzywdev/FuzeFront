export interface PermitResourceDef {
    key: string;
    name: string;
    actions: Record<string, {
        name: string;
    }>;
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