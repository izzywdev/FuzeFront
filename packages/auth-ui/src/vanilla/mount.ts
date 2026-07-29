/**
 * Zero-dependency vanilla mount for `AuthPanel` — no React, no React-DOM.
 * Reimplements the same behavior and the same `.fzf-auth-panel*` CSS classes
 * (see `../styles.css`) as plain DOM, for non-React hosts. Bundled as a
 * standalone IIFE (`dist/auth-ui.vanilla.js`) exposing
 * `window.FuzeFrontAuthUI.mount(container, opts)`.
 */
import type {
  AuthTransport,
  AuthMethods,
  AuthLabels,
  AuthPanelMode,
  AuthPanelVariant,
  AuthenticatedSession,
  MfaRequiredChallenge,
  PendingAction,
} from '../types'
import { DEFAULT_AUTH_LABELS } from '../types'

const FALLBACK_METHODS: AuthMethods = {
  password: true,
  social: [],
  mfa: { enabled: false, types: [] },
  verification: { email: false, sms: false },
}

export interface VanillaMountOptions {
  variant?: AuthPanelVariant
  mode?: AuthPanelMode
  transport: AuthTransport
  onAuthenticated: (session: AuthenticatedSession) => void
  onMfaRequired?: (challenge: MfaRequiredChallenge) => void
  /** Unlike the React `AuthPanel`, defaults OFF here — an explicit opt-in for
   * non-React hosts that may not want the Google button rendered at all. */
  social?: boolean
  labels?: Partial<AuthLabels>
}

export interface VanillaMountHandle {
  unmount(): void
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function field(
  id: string,
  labelText: string,
  type: string,
  autoComplete: string,
): { wrap: HTMLDivElement; input: HTMLInputElement } {
  const wrap = el('div')
  wrap.style.display = 'flex'
  wrap.style.flexDirection = 'column'
  wrap.style.gap = 'var(--space-2)'
  wrap.style.width = '100%'
  const label = el('label', undefined, labelText)
  label.htmlFor = id
  label.style.fontFamily = 'var(--font-sans)'
  label.style.fontSize = 'var(--text-sm)'
  label.style.fontWeight = 'var(--weight-medium)'
  label.style.color = 'var(--text-secondary)'
  const input = el('input')
  input.id = id
  input.type = type
  // Set via the attribute rather than the `.autocomplete` property: the DOM
  // lib types that property as the strict `AutoFill` token union, which a
  // plain `string` parameter can't satisfy (TS2322). The attribute accepts
  // any token string and the property getter reflects it either way.
  input.setAttribute('autocomplete', autoComplete)
  input.style.width = '100%'
  input.style.boxSizing = 'border-box'
  input.style.padding = 'var(--space-3)'
  input.style.fontFamily = 'var(--font-sans)'
  input.style.fontSize = 'var(--text-sm)'
  input.style.color = 'var(--text-primary)'
  input.style.background = 'var(--bg-secondary)'
  input.style.border = '1px solid var(--border-color)'
  input.style.borderRadius = 'var(--radius-md)'
  wrap.appendChild(label)
  wrap.appendChild(input)
  return { wrap, input }
}

/**
 * Mount an AuthPanel into `container`, plain-DOM. Returns a handle whose
 * `unmount()` removes all rendered markup and listeners.
 */
export function mount(container: HTMLElement, opts: VanillaMountOptions): VanillaMountHandle {
  const labels: AuthLabels = { ...DEFAULT_AUTH_LABELS, ...opts.labels }
  const social = opts.social === true
  let mode: AuthPanelMode = opts.mode ?? 'signin'
  let pending: PendingAction = null
  let authMethods: AuthMethods = FALLBACK_METHODS
  let destroyed = false

  const root = el('div', 'fzf-auth-panel')

  const heading = el('h2', 'fzf-auth-panel__heading', labels.heading)
  const subtitle = el('p', 'fzf-auth-panel__subtitle')
  const alertHost = el('div')
  const form = el('form', 'fzf-auth-panel__form')
  const nameRow = el('div', 'fzf-auth-panel__name-row')
  const firstNameField = field('fzf-auth-vanilla-firstName', labels.firstNameLabel, 'text', 'given-name')
  const lastNameField = field('fzf-auth-vanilla-lastName', labels.lastNameLabel, 'text', 'family-name')
  const emailField = field('fzf-auth-vanilla-email', labels.emailLabel, 'email', 'email')
  const passwordField = field('fzf-auth-vanilla-password', labels.passwordLabel, 'password', 'current-password')
  const submitBtn = el('button')
  submitBtn.type = 'submit'
  const socialWrap = el('div', 'fzf-auth-panel__social')
  const toggleWrap = el('div', 'fzf-auth-panel__toggle')
  const togglePrompt = el('p', 'fzf-auth-panel__toggle-prompt')
  const toggleBtn = el('button')
  toggleBtn.type = 'button'

  firstNameField.wrap.style.flex = '1'
  lastNameField.wrap.style.flex = '1'
  nameRow.appendChild(firstNameField.wrap)
  nameRow.appendChild(lastNameField.wrap)

  applyButtonStyle(submitBtn, 'primary')
  applyButtonStyle(toggleBtn, 'secondary')

  form.appendChild(nameRow)
  form.appendChild(emailField.wrap)
  form.appendChild(passwordField.wrap)
  form.appendChild(submitBtn)

  toggleWrap.appendChild(togglePrompt)
  toggleWrap.appendChild(toggleBtn)

  root.appendChild(heading)
  root.appendChild(subtitle)
  root.appendChild(alertHost)
  root.appendChild(form)
  root.appendChild(socialWrap)
  root.appendChild(toggleWrap)

  function applyButtonStyle(btn: HTMLButtonElement, variant: 'primary' | 'secondary') {
    btn.style.display = 'flex'
    btn.style.width = '100%'
    btn.style.alignItems = 'center'
    btn.style.justifyContent = 'center'
    btn.style.gap = '8px'
    btn.style.padding = '12px 24px'
    btn.style.fontFamily = 'var(--font-sans)'
    btn.style.fontSize = 'var(--text-sm)'
    btn.style.fontWeight = 'var(--weight-semibold)'
    btn.style.borderRadius = 'var(--radius-md)'
    btn.style.cursor = 'pointer'
    if (variant === 'primary') {
      btn.style.background = 'var(--accent-color)'
      btn.style.color = '#fff'
      btn.style.border = '1px solid transparent'
    } else {
      btn.style.background = 'var(--bg-quaternary)'
      btn.style.color = 'var(--text-primary)'
      btn.style.border = '1px solid var(--border-color)'
    }
  }

  function setAlert(kind: 'error' | 'info' | null, message: string) {
    alertHost.innerHTML = ''
    if (!kind) return
    const box = el('div', 'fzf-auth-panel__alert')
    box.setAttribute('role', 'alert')
    box.style.padding = 'var(--space-3) var(--space-4)'
    box.style.borderRadius = 'var(--radius-md)'
    box.style.fontFamily = 'var(--font-sans)'
    box.style.fontSize = 'var(--text-sm)'
    if (kind === 'error') {
      box.style.color = 'var(--error-color)'
      box.style.border = '1px solid var(--error-color)'
      box.style.background = 'rgba(231, 76, 60, 0.08)'
    } else {
      box.style.color = 'var(--accent-2)'
      box.style.border = '1px solid var(--accent-2)'
      box.style.background = 'rgba(41, 211, 230, 0.08)'
    }
    box.textContent = message
    alertHost.appendChild(box)
  }

  function render() {
    subtitle.textContent = mode === 'signin' ? labels.signInSubtitle : labels.signUpSubtitle
    nameRow.style.display = mode === 'signup' ? 'flex' : 'none'
    nameRow.style.gap = 'var(--space-3)'
    const disabled = pending !== null
    submitBtn.disabled = disabled
    submitBtn.style.opacity = disabled ? '0.5' : '1'
    submitBtn.textContent =
      pending === 'credentials'
        ? mode === 'signup'
          ? labels.signUpPending
          : labels.signInPending
        : mode === 'signup'
          ? labels.signUpCta
          : labels.signInCta

    toggleBtn.disabled = disabled
    toggleBtn.style.opacity = disabled ? '0.5' : '1'
    togglePrompt.textContent = mode === 'signin' ? labels.toggleToSignUpPrompt : labels.toggleToSignInPrompt
    toggleBtn.textContent = mode === 'signin' ? labels.toggleToSignUpCta : labels.toggleToSignInCta

    const socialEnabled = social && Boolean(opts.transport.startSocial) && authMethods.social.includes('google')
    socialWrap.style.display = socialEnabled ? 'block' : 'none'
  }

  async function handleSubmit(e: Event) {
    e.preventDefault()
    pending = 'credentials'
    setAlert(null, '')
    render()
    try {
      if (mode === 'signup') {
        const session = await opts.transport.signup({
          email: emailField.input.value,
          password: passwordField.input.value,
          firstName: firstNameField.input.value || undefined,
          lastName: lastNameField.input.value || undefined,
        })
        opts.onAuthenticated(session)
        return
      }
      const result = await opts.transport.login({
        email: emailField.input.value,
        password: passwordField.input.value,
      })
      if (result.status === 'mfa_required') {
        setAlert('info', labels.mfaNotice)
        opts.onMfaRequired?.(result)
        return
      }
      opts.onAuthenticated(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : undefined
      setAlert('error', message || labels.genericError)
    } finally {
      if (!destroyed) {
        pending = null
        render()
      }
    }
  }

  function handleToggle() {
    mode = mode === 'signin' ? 'signup' : 'signin'
    setAlert(null, '')
    render()
  }

  form.addEventListener('submit', handleSubmit)
  toggleBtn.addEventListener('click', handleToggle)

  render()
  container.appendChild(root)

  opts.transport
    .getAuthMethods()
    .then((methods) => {
      if (destroyed) return
      authMethods = methods
      render()
    })
    .catch(() => {
      if (destroyed) return
      authMethods = FALLBACK_METHODS
      render()
    })

  return {
    unmount() {
      destroyed = true
      form.removeEventListener('submit', handleSubmit)
      toggleBtn.removeEventListener('click', handleToggle)
      container.removeChild(root)
    },
  }
}
