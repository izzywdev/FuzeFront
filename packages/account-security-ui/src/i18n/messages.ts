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
  /** The connected-accounts page (`/account/security/connections`, FFRNT-296). */
  connections: {
    page: { title: string; subtitle: string }
    addHeading: string
    addHint: string
    addFootnote: string
    /** interpolates {provider} */
    continueWith: string
    /** interpolates {provider} */
    connectButton: string
  }
  connect: {
    /** interpolates {provider} */
    redirectingTitle: string
    redirectingText: string
    /** interpolates {provider} */
    continueButton: string
    cancel: string
    /** interpolates {provider} */
    linkedTitle: string
    linkedText: string
    viewConnected: string
    /** interpolates {provider} */
    linkFailedTitle: string
    linkFailedText: string
    tryAgain: string
    /** interpolates {provider} */
    alreadyLinkedTitle: string
    alreadyLinkedText: string
  }
}
