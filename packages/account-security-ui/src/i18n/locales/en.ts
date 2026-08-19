import type { AccountSecurityMessages } from '../messages'

export const en: AccountSecurityMessages = {
  page: {
    title: 'Security',
    subtitle: 'Manage how you sign in and keep your account safe.',
  },
  posture: {
    good: 'Your account is well protected',
    attention: 'Your account needs attention',
    summary: '{password} · {twoFactor} · {devices} · {connected}.',
    passwordSet: 'Password set',
    passwordMissing: 'No password yet',
    twoFactorOn: 'two-factor on',
    twoFactorOff: 'two-factor off',
    devicesUnknown: 'devices unavailable',
    connectedNone: 'no connected accounts',
  },
  cards: {
    password: {
      title: 'Password',
      desc: 'Change your password or, if you sign in with a provider only, add one.',
    },
    twoFactor: {
      title: 'Two-factor auth',
      desc: 'Add a second step at sign-in with an authenticator app or a code by SMS.',
    },
    sessions: {
      title: 'Devices & sessions',
      desc: "See where you're signed in and sign out of any device.",
    },
    tokens: {
      title: 'API tokens',
      desc: 'Create and revoke machine tokens for scripts and services.',
    },
    connected: {
      title: 'Connected accounts',
      desc: "Link or unlink sign-in providers. You'll always keep at least one way to sign in.",
    },
  },
  badges: {
    set: 'Set',
    on: 'On',
    factors: '{count} factor',
    activeDevices: '{count} active',
    activeTokens: '{count} active',
    unknown: 'Unavailable',
    linked: 'linked',
    passwordEnabled: 'Password · enabled',
  },
  loading: {
    label: 'Loading your security settings',
  },
  error: {
    title: "Couldn't load your security settings",
    text: 'Something went wrong on our side. Your account is unaffected — try again.',
    retry: 'Try again',
  },
  setPassword: {
    title: 'Set a password first',
    text: 'You sign in with a connected account, so this account has no password yet. Add one to turn on password sign-in and unlock password change.',
    action: 'Set a password',
  },
  lastMethod: {
    title: 'Keep at least one way to sign in',
    text: "This is your only sign-in method right now, so it can't be unlinked. Set a password or link another provider first, then unlink it.",
    setPassword: 'Set a password',
    linkProvider: 'Link another account',
  },
  methods: {
    heading: 'Ways you sign in',
    passwordName: 'Password',
    socialName: '{provider}',
    remove: 'Remove',
    manage: 'Manage',
  },
  connections: {
    page: {
      title: 'Connected accounts',
      subtitle: "Link or unlink the ways you sign in. You'll always keep at least one.",
    },
    addHeading: 'Add a way to sign in',
    addHint: 'Optional',
    addFootnote:
      "Connecting a provider lets you sign in with it. It never shares your FuzeFront password, and you can disconnect it any time — as long as one sign-in method remains.",
    continueWith: 'Continue with {provider}',
    connectButton: 'Connect {provider}',
  },
  connect: {
    redirectingTitle: "You'll continue on {provider}",
    redirectingText:
      "We'll take you to {provider} to confirm it's you, then bring you straight back here. Nothing links until you approve.",
    continueButton: 'Continue with {provider}',
    cancel: 'Cancel',
    linkedTitle: '{provider} connected',
    linkedText: "You can now sign in with {provider}. It's been added to your ways to sign in.",
    viewConnected: 'View connected accounts',
    linkFailedTitle: "{provider} wasn't connected",
    linkFailedText:
      "The connection was cancelled or didn't complete. Nothing changed — you can try connecting again.",
    tryAgain: 'Try again',
    alreadyLinkedTitle: '{provider} is already connected',
    alreadyLinkedText: 'This provider is already one of your ways to sign in.',
  },
}
