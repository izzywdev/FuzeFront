/** Message contract for the account-security hub. `en` is the complete base. */
export interface AccountSecurityMessages {
  page: {
    title: string
    subtitle: string
  }
  posture: {
    good: string
    attention: string
    /** summary line, interpolates {password} {twoFactor} {devices} {connected} */
    summary: string
    passwordSet: string
    passwordMissing: string
    twoFactorOn: string
    twoFactorOff: string
    devicesUnknown: string
    connectedNone: string
  }
  cards: {
    password: { title: string; desc: string }
    twoFactor: { title: string; desc: string }
    sessions: { title: string; desc: string }
    tokens: { title: string; desc: string }
    connected: { title: string; desc: string }
  }
  badges: {
    set: string
    on: string
    factors: string // interpolates {count}
    activeDevices: string // interpolates {count}
    activeTokens: string // interpolates {count}
    unknown: string
    linked: string
    passwordEnabled: string
  }
  loading: {
    label: string
  }
  error: {
    title: string
    text: string
    retry: string
  }
  setPassword: {
    title: string
    text: string
    action: string
  }
  lastMethod: {
    title: string
    text: string
    setPassword: string
    linkProvider: string
  }
  methods: {
    heading: string
    passwordName: string
    /** interpolates {provider} */
    socialName: string
    remove: string
    manage: string
  }
}
