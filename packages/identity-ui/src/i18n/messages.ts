/**
 * Identity-UI message catalogue shape. Every user-facing string in the package
 * is keyed here so components never hard-code English. Locales (en, he) must
 * implement this exact shape.
 */
export interface IdentityMessages {
  common: {
    cancel: string
    close: string
    save: string
    create: string
    loading: string
    retry: string
    actions: string
    confirm: string
  }
  roles: {
    owner: string
    admin: string
    member: string
    viewer: string
  }
  members: {
    title: string
    email: string
    role: string
    status: string
    joined: string
    invite: string
    remove: string
    removeConfirm: string
    statusActive: string
    statusPending: string
    statusSuspended: string
    emptyTitle: string
    emptyBody: string
    errorTitle: string
    errorBody: string
  }
  invitations: {
    title: string
    pending: string
    email: string
    role: string
    invited: string
    expires: string
    resend: string
    revoke: string
    revokeConfirm: string
    never: string
    expired: string
    emptyTitle: string
    emptyBody: string
    inviteTitle: string
    tabSingle: string
    tabBulk: string
    emailPlaceholder: string
    send: string
    sendBulk: string
    bulkTextareaLabel: string
    bulkTextareaPlaceholder: string
    csvHint: string
    csvDropLabel: string
    previewTitle: string
    invalidEmail: string
    noValidEmails: string
    invitedCount: string
    skipped: string
    errors: string
  }
  tokens: {
    title: string
    name: string
    type: string
    scopes: string
    expires: string
    lastUsed: string
    never: string
    typePat: string
    typeService: string
    newToken: string
    create: string
    revoke: string
    revokeConfirm: string
    revokeTitle: string
    emptyTitle: string
    emptyBody: string
    namePlaceholder: string
    nameLabel: string
    ownerLabel: string
    ownerUser: string
    ownerOrg: string
    expiryLabel: string
    noExpiry: string
    scopesLabel: string
    revealTitle: string
    revealWarning: string
    copy: string
    copied: string
    done: string
    createError: string
    expiresSoon: string
  }
  scopeGroups: {
    apps: string
    organization: string
    userManagement: string
  }
  scopeLabels: Record<string, string>
}
