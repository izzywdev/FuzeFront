import { AppCaller } from './service';
interface SessionUser {
    id: string;
    roles?: string[];
}
/** Active org ids the caller belongs to. */
export declare function getMemberOrgIds(userId: string): Promise<string[]>;
/** Roles (owner/admin/member/…) the caller holds in a specific org. */
export declare function getRolesInOrg(userId: string, organizationId: string): Promise<string[]>;
export declare function resolveCaller(user: SessionUser): Promise<AppCaller>;
export {};
//# sourceMappingURL=caller.d.ts.map