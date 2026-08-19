import { BaseApiClient } from './base';
import { LoginRequest, LoginResponse, User, ApiResponse, ApiClientConfig } from '../types';
export declare class AuthClient extends BaseApiClient {
    constructor(config: ApiClientConfig);
    /**
     * Login with email and password
     * @param credentials - Email and password
     * @returns Login response with token and user info
     */
    login(credentials: LoginRequest): Promise<ApiResponse<LoginResponse>>;
    /**
     * Logout the current user
     * @returns Logout confirmation
     */
    logout(): Promise<ApiResponse<{
        message: string;
    }>>;
    /**
     * Get current authenticated user information
     * @returns Current user data
     */
    getCurrentUser(): Promise<ApiResponse<{
        user: User;
    }>>;
    /**
     * Check if user is authenticated (has valid token)
     * @returns True if token exists
     */
    isAuthenticated(): boolean;
    /**
     * Login and return just the user data for convenience
     * @param credentials - Email and password
     * @returns User data
     */
    loginAndGetUser(credentials: LoginRequest): Promise<User>;
    /**
     * Verify token validity by attempting to get user info
     * @returns True if token is valid
     */
    verifyToken(): Promise<boolean>;
}
//# sourceMappingURL=auth.d.ts.map