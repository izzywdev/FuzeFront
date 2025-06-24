import { Permit } from 'permitio';
interface PermitConfig {
    token: string;
    pdp: string;
    debug?: boolean;
    syncInterval?: number;
}
declare const config: PermitConfig;
declare const permit: Permit;
export default permit;
export { config as permitConfig };
//# sourceMappingURL=permit.d.ts.map