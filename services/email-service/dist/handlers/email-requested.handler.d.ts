import { FuzeEvent, NotifyEmailRequestedPayloadV1, TypedProducer } from '@fuzefront/shared';
import { EmailProvider } from '../providers';
export interface HandlerDeps {
    provider: EmailProvider;
    statusProducer: Pick<TypedProducer, 'send'>;
    from: string;
}
export declare function handleEmailRequested(event: FuzeEvent<NotifyEmailRequestedPayloadV1>, deps: HandlerDeps): Promise<void>;
//# sourceMappingURL=email-requested.handler.d.ts.map