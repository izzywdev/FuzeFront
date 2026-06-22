/**
 * Minimal fetch helper used by the identity API clients.
 *
 * - Base URL defaults to same-origin (`''`) so the host shell's nginx proxy
 *   handles `/api`. Never hard-code `http://…` (mixed-content under TLS).
 * - Auth token is read lazily via `getToken` so the host controls storage.
 */
export interface HttpClientOptions {
    /** Base URL prefix, e.g. '' (same-origin) or 'https://api.example.com'. Default ''. */
    baseUrl?: string;
    /** Returns the bearer token to attach, or null/undefined to omit. */
    getToken?: () => string | null | undefined;
    /** Injectable fetch (for tests). Defaults to global fetch. */
    fetchImpl?: typeof fetch;
}
export declare class HttpError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, message: string, body: unknown);
}
export declare class HttpClient {
    private baseUrl;
    private getToken?;
    private fetchImpl;
    constructor(opts?: HttpClientOptions);
    request<T>(method: string, path: string, body?: unknown): Promise<T>;
    get<T>(path: string): Promise<T>;
    post<T>(path: string, body?: unknown): Promise<T>;
    put<T>(path: string, body?: unknown): Promise<T>;
    delete<T>(path: string): Promise<T>;
}
