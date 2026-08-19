/**
 * @fuzefront/chat-client — public barrel export.
 *
 * Re-exports everything from the three modules so consumers can import from
 * the package root:
 *
 *   import { ChatServiceClient, ChatStreamEvent } from '@fuzefront/chat-client';
 */

export * from './client';
export * from './types';
export * from './streaming';
