import { type HttpClientOptions } from './http';
import type { IdentityApiClient } from '../types';
/**
 * Default implementation of {@link IdentityApiClient}, wrapping the existing
 * backend organization member / invitation routes and the api-token routes.
 * Members `GET` returns an array; invitations `GET` returns `{ invitations }`;
 * bulk invite returns `{ results }` which we summarize into `{ created, skipped, errors }`.
 */
export declare function createIdentityClient(opts?: HttpClientOptions): IdentityApiClient;
