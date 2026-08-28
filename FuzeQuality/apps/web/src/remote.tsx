import './styles.css'
import { App } from './App'

/** Module-Federation entry point consumed by the FuzeFront portal. */
export default function FuzeQualityRemote({ getToken }: { getToken?: () => string | null }) {
  return <App getToken={getToken} />
}
