import { useEffect, useRef, useState } from 'react'
import { Badge, Button, Input, PhoneNumberInput } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../../i18n/IdentityI18nProvider'
import { isValidEmail } from '../../invites/parseEmails'

const SEARCH_DEBOUNCE_MS = 300

/** Email address for an email-channel invitation. `[data-input="invite-email"]`. */
export function EmailInviteField({
  value,
  onChange,
  label,
  placeholder,
  hint,
  invalid = false,
  dataInput = 'invite-email',
}: {
  value: string
  onChange: (value: string) => void
  label?: string
  placeholder?: string
  hint?: string
  /** `data-input` hook (`invite-email`; the root customer form uses `customer-email`). */
  dataInput?: string
  /** Show the invalid message (the form decides when — typically after a submit attempt or blur). */
  invalid?: boolean
}) {
  const { messages } = useIdentityI18n()
  const m = messages.invitationsV2.invite
  const [touched, setTouched] = useState(false)
  const showError = (invalid || (touched && value.trim() !== '')) && !isValidEmail(value)
  return (
    <div data-channel-field="email" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <Input
        label={label ?? m.emailLabel}
        type="email"
        inputMode="email"
        autoComplete="off"
        required
        placeholder={placeholder ?? m.emailPlaceholder}
        value={value}
        data-input={dataInput}
        error={showError ? m.emailInvalid : undefined}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
      />
      {hint ? (
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{hint}</span>
      ) : null}
    </div>
  )
}

/**
 * WhatsApp number as E.164 — the design-system `PhoneNumberInput` (country code
 * + digits) with the invitation copy. `[data-input="invite-phone"]`. Reports the
 * composed E.164 string and whether it passes the envelope check.
 */
export function PhoneE164Field({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (e164: string, valid: boolean) => void
  /** Server `INVALID_PHONE` (or any consumer error) — wins over the built-in message. */
  error?: string
}) {
  const { messages } = useIdentityI18n()
  const m = messages.invitationsV2.invite
  return (
    <div data-channel-field="whatsapp">
      <PhoneNumberInput
        data-input="invite-phone"
        label={m.phoneLabel}
        required
        value={value}
        hint={m.phoneHint}
        countryLabel={m.phoneCountry}
        invalidMessage={m.phoneInvalid}
        error={error}
        onChange={(e164: string, meta: { valid: boolean }) => onChange(e164, meta.valid)}
      />
    </div>
  )
}

export interface AccountOption {
  /** Server-minted, typed user id (e.g. `usr_…`) — the `AccountInvitee.userId` reference. */
  userId: string
  name?: string
  email?: string
}

/**
 * Pick an existing account-holder. Search is server-side and debounced (the host
 * supplies `search`; the picker never fetches or filters a full directory). The
 * chosen account is shown as a removable chip.
 */
export function InviteeAccountPicker({
  search,
  value,
  onChange,
}: {
  search: (query: string) => Promise<AccountOption[]>
  value: AccountOption | null
  onChange: (account: AccountOption | null) => void
}) {
  const { messages } = useIdentityI18n()
  const m = messages.invitationsV2.invite
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AccountOption[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    if (value || query.trim().length < 2) {
      setResults([])
      setSearched(false)
      return
    }
    const id = ++seq.current
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const found = await search(query.trim())
        if (id === seq.current) {
          setResults(found)
          setSearched(true)
        }
      } catch {
        if (id === seq.current) {
          setResults([])
          setSearched(true)
        }
      } finally {
        if (id === seq.current) setSearching(false)
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, value, search])

  if (value) {
    return (
      <div
        data-field="account-picked"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}
      >
        <Badge tone="accent" aria-label={m.accountPicked}>
          {value.name ?? value.email ?? value.userId}
          {value.name && value.email ? ` · ${value.email}` : ''}
        </Badge>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
          {m.accountClear}
        </Button>
      </div>
    )
  }

  return (
    <div data-field="account-picker" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <Input
        label={m.accountLabel}
        type="search"
        autoComplete="off"
        placeholder={m.accountPlaceholder}
        value={query}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
      />
      <div role="status" aria-live="polite" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
        {searching ? m.accountSearching : searched && results.length === 0 ? m.accountNone : ''}
      </div>
      {results.length > 0 && (
        <ul
          aria-label={m.accountLabel}
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)',
          }}
        >
          {results.map((a) => (
            <li key={a.userId}>
              <Button
                variant="ghost"
                fullWidth
                size="sm"
                data-account={a.userId}
                onClick={() => onChange(a)}
                style={{ justifyContent: 'flex-start' }}
              >
                {a.name ?? a.email ?? a.userId}
                {a.name && a.email ? ` · ${a.email}` : ''}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
