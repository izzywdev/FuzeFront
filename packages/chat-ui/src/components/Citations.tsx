import type { RagSource } from '@fuzefront/chat-client';
import { useChatI18n } from '../i18n';

export interface CitationsProps {
  sources: RagSource[];
}

/** RAG `rag_sources` citation list rendered under an assistant message. */
export function Citations({ sources }: CitationsProps) {
  const { strings } = useChatI18n();
  if (sources.length === 0) return null;

  return (
    <section className="ffc-sources" aria-label={strings.sourcesHeading}>
      <h4 className="ffc-sources__heading">{strings.sourcesHeading}</h4>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'contents' }}>
        {sources.map((s, i) => (
          <li key={`${s.url}-${i}`} style={{ display: 'contents' }}>
            <a
              className="ffc-citation"
              href={s.url}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={`${strings.sourceOpenLabel}: ${s.title}`}
            >
              <span className="ffc-citation__title">{s.title}</span>
              {s.excerpt ? <span className="ffc-citation__excerpt">{s.excerpt}</span> : null}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
