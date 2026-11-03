/**
 * Org invitations v2 message catalogue (FFRNT-309 / design/frames/org-invitations-v2).
 * Wired into `IdentityMessages.invitationsV2`; en + he must both implement it.
 * Copy follows the approved frames. `{placeholder}` tokens are interpolated by
 * `useIdentityI18n().t`.
 */
export interface InvitationsV2Messages {
  invite: {
    button: string
    title: string
    subtitle: string
    close: string
    kindLabel: string
    kindExisting: string
    kindExternal: string
    kindHint: string
    kindExistingUnavailable: string
    channelLabel: string
    channelEmail: string
    channelWhatsapp: string
    emailLabel: string
    emailPlaceholder: string
    emailInvalid: string
    phoneLabel: string
    phoneHint: string
    phoneCountry: string
    phoneInvalid: string
    accountLabel: string
    accountPlaceholder: string
    accountSearching: string
    accountNone: string
    accountPicked: string
    accountClear: string
    roleLabel: string
    roleAdminDesc: string
    roleMemberDesc: string
    roleViewerDesc: string
    roleOwnerHint: string
    memberTypeLabel: string
    memberEmployee: string
    memberCustomer: string
    memberTypeHint: string
    reviewInvite: string
    reviewAs: string
    reviewIncomplete: string
    send: string
    sending: string
    sent: string
    duplicate: string
    forbidden: string
    deliveryFailed: string
    genericError: string
  }
  pending: {
    title: string
    count: string
    emptyTitle: string
    emptyBody: string
    errorTitle: string
    errorBody: string
    forbiddenTitle: string
    forbiddenBody: string
    loadingLabel: string
    loadMore: string
    byYou: string
    invitedBy: string
    expiresIn: string
    expiredAgo: string
    statusSent: string
    statusAccepted: string
    statusRevoked: string
    statusExpired: string
    resend: string
    resendCooldown: string
    resent: string
    revoke: string
    revokeTitle: string
    revokeBody: string
    revokeConfirm: string
    revoked: string
    channelEmail: string
    channelWhatsapp: string
    existingAccount: string
  }
  accept: {
    lead: string
    invitedBy: string
    summaryOrg: string
    summaryRole: string
    summaryMemberType: string
    summaryExpires: string
    summaryInvitedTo: string
    createAndAccept: string
    signInToAccept: string
    acceptCta: string
    accepting: string
    divider: string
    terms: string
    resolving: string
    signupLead: string
    signupTitle: string
    signupEmailHint: string
    signupWhatsappHint: string
    boundTitle: string
    boundText: string
    boundSignedInAs: string
    goToOrg: string
    googleCta: string
    facebookCta: string
  }
  states: {
    expiredTitle: string
    expiredBody: string
    mismatchTitle: string
    mismatchBody: string
    switchAccount: string
    alreadyTitle: string
    alreadyBody: string
    notFoundTitle: string
    notFoundBody: string
    lastOwnerTitle: string
    lastOwnerBody: string
    transferOwnership: string
    forbiddenTitle: string
    forbiddenBody: string
    genericTitle: string
    genericBody: string
    retry: string
  }
  root: {
    title: string
    subtitle: string
    panelTitle: string
    emailLabel: string
    emailHint: string
    emailPlaceholder: string
    memberTypeHint: string
    send: string
    forbiddenTitle: string
    forbiddenBody: string
    roleMemberDesc: string
    roleViewerDesc: string
  }
}

export const invitationsV2En: InvitationsV2Messages = {
  invite: {
    button: 'Invite people',
    title: 'Invite to {orgName}',
    subtitle: 'They get a link by email or WhatsApp. It expires in 7 days.',
    close: 'Close',
    kindLabel: 'Who are you inviting?',
    kindExisting: 'Existing account-holder',
    kindExternal: 'External person',
    kindHint: 'External sends a sign-up link. Existing finds someone who already has a FuzeFront account.',
    kindExistingUnavailable: 'Searching existing accounts is not available here yet.',
    channelLabel: 'Send via',
    channelEmail: 'Email',
    channelWhatsapp: 'WhatsApp',
    emailLabel: 'Email address',
    emailPlaceholder: 'jordan@acme.com',
    emailInvalid: 'Enter a valid email address.',
    phoneLabel: 'WhatsApp number (E.164)',
    phoneHint: 'Full international format, e.g. +15550104477.',
    phoneCountry: 'Country code',
    phoneInvalid: "That's not a valid WhatsApp number. Use digits only in full international format.",
    accountLabel: 'Find an account',
    accountPlaceholder: 'Search by name or email',
    accountSearching: 'Searching…',
    accountNone: 'No matching accounts',
    accountPicked: 'Selected account',
    accountClear: 'Choose a different account',
    roleLabel: 'Role',
    roleAdminDesc: 'Manage members, roles and settings. Cannot delete the organization.',
    roleMemberDesc: "Use the organization's apps. No access to admin settings.",
    roleViewerDesc: 'Read-only access. Cannot change anything.',
    roleOwnerHint: 'Owner is held by the organization creator and is not assignable from here.',
    memberTypeLabel: 'Member type',
    memberEmployee: 'Employee',
    memberCustomer: 'Customer',
    memberTypeHint:
      'Employee = staff of this organization. Customer = an external relationship (tracked separately for billing & access).',
    reviewInvite: 'Invite',
    reviewAs: 'As',
    reviewIncomplete: 'Add a valid address to preview the invitation.',
    send: 'Send invitation',
    sending: 'Sending…',
    sent: 'Invitation sent to {address}.',
    duplicate: 'A pending invitation to this person already exists. Resend or revoke it from the pending list.',
    forbidden: "You don't have permission to invite people",
    deliveryFailed: "The invite was saved as a draft but delivery failed. Check the address and resend.",
    genericError: "We couldn't send the invitation. Try again.",
  },
  pending: {
    title: 'Pending invitations',
    count: '{count} pending',
    emptyTitle: 'No invitations pending',
    emptyBody: 'Everyone you invited has joined. Use “Invite people” to add someone.',
    errorTitle: "Couldn't load invitations",
    errorBody: 'Something went wrong on our end.',
    forbiddenTitle: "You don't have permission to see invitations",
    forbiddenBody: 'Only admins and owners can manage invitations.',
    loadingLabel: 'Loading invitations',
    loadMore: 'Load more',
    byYou: 'invited by you',
    invitedBy: 'invited by {name}',
    expiresIn: 'expires {when}',
    expiredAgo: 'expired {when}',
    statusSent: 'Sent',
    statusAccepted: 'Accepted',
    statusRevoked: 'Revoked',
    statusExpired: 'Expired',
    resend: 'Resend',
    resendCooldown: 'Resend available in {time}',
    resent: 'Invitation resent.',
    revoke: 'Revoke',
    revokeTitle: 'Revoke this invitation?',
    revokeBody: '{address} will no longer be able to join with this link.',
    revokeConfirm: 'Revoke invitation',
    revoked: 'Invitation revoked.',
    channelEmail: 'email',
    channelWhatsapp: 'WhatsApp',
    existingAccount: 'Existing account',
  },
  accept: {
    lead: "You've been invited to join",
    invitedBy: 'Create your account to accept — it takes a minute.',
    summaryOrg: 'Organization',
    summaryRole: 'Role',
    summaryMemberType: 'Member type',
    summaryExpires: 'Expires',
    summaryInvitedTo: 'Invited to',
    createAndAccept: 'Create account & accept',
    signInToAccept: 'I already have an account — sign in to accept',
    acceptCta: 'Accept invitation',
    accepting: 'Accepting…',
    divider: 'or',
    terms: 'By continuing you agree to the Terms and Privacy Policy. This invitation is tied to {contact} — you’ll need to confirm that identity.',
    resolving: 'Loading invitation…',
    signupLead: 'Join {orgName} as {role}',
    signupTitle: 'Create your account',
    signupEmailHint: 'Use the address this invitation was sent to ({contact}). It’s how we bind you to {orgName}.',
    signupWhatsappHint: 'Use the email you want for your account. This invitation was sent to {contact}.',
    boundTitle: "You're in. Welcome to {orgName}.",
    boundText: 'Your account was set up and the invitation was accepted and bound — no extra step.',
    boundSignedInAs: 'Signed in as',
    goToOrg: 'Go to {orgName} →',
    googleCta: 'Continue with Google',
    facebookCta: 'Continue with Facebook',
  },
  states: {
    expiredTitle: 'This invitation link is no longer valid',
    expiredBody: 'It expired or was revoked. Ask the organization owner to send a new one.',
    mismatchTitle: 'This invite was sent to a different address',
    mismatchBody:
      "You're signed in as {current}, but the invite is for {invited}. Sign in as the invited identity to accept.",
    switchAccount: 'Switch account',
    alreadyTitle: "You've already joined {orgName}",
    alreadyBody: 'This invitation was already accepted. Nothing more to do.',
    notFoundTitle: 'We couldn’t find this invitation',
    notFoundBody: 'Check the link, or ask the organization owner to send a new one.',
    lastOwnerTitle: '{orgName} must keep an owner',
    lastOwnerBody:
      "You're the only owner, so this change would leave the organization with none. Transfer ownership first, then try again.",
    transferOwnership: 'Transfer ownership',
    forbiddenTitle: "You don't have permission to invite people",
    forbiddenBody: 'Only admins and owners can invite. This is shown in place — you have not been signed out.',
    genericTitle: 'Something went wrong',
    genericBody: "We couldn't complete that. Try again in a moment.",
    retry: 'Try again',
  },
  root: {
    title: 'Invite a customer',
    subtitle:
      'As the root owner you invite an external person as a customer — by personal email or WhatsApp. Member type is fixed to Customer here; role defaults to Viewer and is adjustable.',
    panelTitle: 'New customer invitation',
    emailLabel: 'Personal email',
    emailHint: "Any email works — this person doesn't need an existing FuzeFront account.",
    emailPlaceholder: 'pat.rivera@gmail.com',
    memberTypeHint: 'Fixed to Customer on the root customer surface.',
    send: 'Send customer invitation',
    forbiddenTitle: 'Only the root owner can invite customers',
    forbiddenBody: 'Ask a root organization owner to send this invitation.',
    roleMemberDesc: 'Can use the apps you share with them.',
    roleViewerDesc: 'Read-only. The usual starting point for a customer.',
  },
}

export const invitationsV2He: InvitationsV2Messages = {
  invite: {
    button: 'הזמנת אנשים',
    title: 'הזמנה אל {orgName}',
    subtitle: 'הם יקבלו קישור באימייל או בוואטסאפ. תוקפו 7 ימים.',
    close: 'סגירה',
    kindLabel: 'את מי מזמינים?',
    kindExisting: 'בעל חשבון קיים',
    kindExternal: 'אדם חיצוני',
    kindHint: 'חיצוני: נשלח קישור הרשמה. קיים: מוצאים מי שכבר יש לו חשבון FuzeFront.',
    kindExistingUnavailable: 'חיפוש חשבונות קיימים עדיין אינו זמין כאן.',
    channelLabel: 'שליחה באמצעות',
    channelEmail: 'אימייל',
    channelWhatsapp: 'וואטסאפ',
    emailLabel: 'כתובת אימייל',
    emailPlaceholder: 'jordan@acme.com',
    emailInvalid: 'הזינו כתובת אימייל תקינה.',
    phoneLabel: 'מספר וואטסאפ (E.164)',
    phoneHint: 'פורמט בינלאומי מלא, למשל +15550104477.',
    phoneCountry: 'קידומת מדינה',
    phoneInvalid: 'זה אינו מספר וואטסאפ תקין. השתמשו בספרות בלבד בפורמט בינלאומי מלא.',
    accountLabel: 'מציאת חשבון',
    accountPlaceholder: 'חיפוש לפי שם או אימייל',
    accountSearching: 'מחפש…',
    accountNone: 'לא נמצאו חשבונות תואמים',
    accountPicked: 'החשבון שנבחר',
    accountClear: 'בחירת חשבון אחר',
    roleLabel: 'תפקיד',
    roleAdminDesc: 'ניהול חברים, תפקידים והגדרות. לא ניתן למחוק את הארגון.',
    roleMemberDesc: 'שימוש באפליקציות הארגון. ללא גישה להגדרות ניהול.',
    roleViewerDesc: 'גישת קריאה בלבד. לא ניתן לשנות דבר.',
    roleOwnerHint: 'הבעלות שמורה ליוצר הארגון ואינה ניתנת להקצאה מכאן.',
    memberTypeLabel: 'סוג חבר',
    memberEmployee: 'עובד',
    memberCustomer: 'לקוח',
    memberTypeHint: 'עובד = צוות הארגון. לקוח = קשר חיצוני (נמדד בנפרד לחיוב וגישה).',
    reviewInvite: 'הזמנה',
    reviewAs: 'בתור',
    reviewIncomplete: 'הוסיפו כתובת תקינה כדי לראות תצוגה מקדימה.',
    send: 'שליחת הזמנה',
    sending: 'שולח…',
    sent: 'ההזמנה נשלחה אל {address}.',
    duplicate: 'כבר קיימת הזמנה ממתינה לאדם זה. שלחו שוב או בטלו אותה מרשימת ההמתנה.',
    forbidden: 'אין לך הרשאה להזמין אנשים',
    deliveryFailed: 'ההזמנה נשמרה כטיוטה אך המשלוח נכשל. בדקו את הכתובת ושלחו שוב.',
    genericError: 'לא הצלחנו לשלוח את ההזמנה. נסו שוב.',
  },
  pending: {
    title: 'הזמנות ממתינות',
    count: '{count} ממתינות',
    emptyTitle: 'אין הזמנות ממתינות',
    emptyBody: 'כל מי שהוזמן הצטרף. השתמשו ב״הזמנת אנשים״ כדי להוסיף מישהו.',
    errorTitle: 'לא ניתן לטעון הזמנות',
    errorBody: 'משהו השתבש בצד שלנו.',
    forbiddenTitle: 'אין לך הרשאה לראות הזמנות',
    forbiddenBody: 'רק מנהלים ובעלים יכולים לנהל הזמנות.',
    loadingLabel: 'טוען הזמנות',
    loadMore: 'טעינת עוד',
    byYou: 'הוזמן/ה על ידך',
    invitedBy: 'הוזמן/ה על ידי {name}',
    expiresIn: 'פג תוקף {when}',
    expiredAgo: 'פג תוקף {when}',
    statusSent: 'נשלחה',
    statusAccepted: 'התקבלה',
    statusRevoked: 'בוטלה',
    statusExpired: 'פגה',
    resend: 'שליחה חוזרת',
    resendCooldown: 'שליחה חוזרת תתאפשר בעוד {time}',
    resent: 'ההזמנה נשלחה שוב.',
    revoke: 'ביטול',
    revokeTitle: 'לבטל את ההזמנה?',
    revokeBody: '{address} לא יוכל/תוכל עוד להצטרף עם קישור זה.',
    revokeConfirm: 'ביטול ההזמנה',
    revoked: 'ההזמנה בוטלה.',
    channelEmail: 'אימייל',
    channelWhatsapp: 'וואטסאפ',
    existingAccount: 'חשבון קיים',
  },
  accept: {
    lead: 'הוזמנת להצטרף אל',
    invitedBy: 'צרו חשבון כדי לקבל — זה לוקח דקה.',
    summaryOrg: 'ארגון',
    summaryRole: 'תפקיד',
    summaryMemberType: 'סוג חבר',
    summaryExpires: 'תוקף',
    summaryInvitedTo: 'הוזמן אל',
    createAndAccept: 'יצירת חשבון וקבלה',
    signInToAccept: 'כבר יש לי חשבון — התחברות לקבלה',
    acceptCta: 'קבלת ההזמנה',
    accepting: 'מקבל…',
    divider: 'או',
    terms: 'בהמשך אתם מסכימים לתנאי השימוש ולמדיניות הפרטיות. הזמנה זו קשורה אל {contact} — יהיה עליכם לאשר זהות זו.',
    resolving: 'טוען הזמנה…',
    signupLead: 'הצטרפות אל {orgName} בתור {role}',
    signupTitle: 'יצירת החשבון שלך',
    signupEmailHint: 'השתמשו בכתובת שאליה נשלחה ההזמנה ({contact}). כך אנו מקשרים אתכם אל {orgName}.',
    signupWhatsappHint: 'השתמשו באימייל הרצוי לחשבון. ההזמנה נשלחה אל {contact}.',
    boundTitle: 'את/ה בפנים. ברוכים הבאים אל {orgName}.',
    boundText: 'החשבון נוצר וההזמנה התקבלה ונקשרה — ללא שלב נוסף.',
    boundSignedInAs: 'מחובר/ת בתור',
    goToOrg: 'מעבר אל {orgName} ←',
    googleCta: 'המשך עם Google',
    facebookCta: 'המשך עם Facebook',
  },
  states: {
    expiredTitle: 'קישור ההזמנה אינו תקף עוד',
    expiredBody: 'הוא פג או בוטל. בקשו מבעל הארגון לשלוח קישור חדש.',
    mismatchTitle: 'ההזמנה נשלחה לכתובת אחרת',
    mismatchBody: 'אתם מחוברים בתור {current}, אך ההזמנה מיועדת אל {invited}. התחברו עם הזהות המוזמנת כדי לקבל.',
    switchAccount: 'החלפת חשבון',
    alreadyTitle: 'כבר הצטרפת אל {orgName}',
    alreadyBody: 'ההזמנה כבר התקבלה. אין צורך בדבר נוסף.',
    notFoundTitle: 'לא מצאנו את ההזמנה',
    notFoundBody: 'בדקו את הקישור או בקשו מבעל הארגון לשלוח חדש.',
    lastOwnerTitle: '{orgName} חייב לשמור על בעלים',
    lastOwnerBody: 'אתם הבעלים היחיד, ולכן שינוי זה היה משאיר את הארגון ללא בעלים. העבירו קודם את הבעלות ונסו שוב.',
    transferOwnership: 'העברת בעלות',
    forbiddenTitle: 'אין לך הרשאה להזמין אנשים',
    forbiddenBody: 'רק מנהלים ובעלים יכולים להזמין. זה מוצג במקום — לא נותקת.',
    genericTitle: 'משהו השתבש',
    genericBody: 'לא הצלחנו להשלים. נסו שוב בעוד רגע.',
    retry: 'נסו שוב',
  },
  root: {
    title: 'הזמנת לקוח',
    subtitle:
      'כבעלי השורש אתם מזמינים אדם חיצוני כלקוח — באימייל אישי או בוואטסאפ. סוג החבר קבוע ללקוח; התפקיד ברירת מחדל צופה וניתן לשינוי.',
    panelTitle: 'הזמנת לקוח חדשה',
    emailLabel: 'אימייל אישי',
    emailHint: 'כל אימייל מתאים — אין צורך בחשבון FuzeFront קיים.',
    emailPlaceholder: 'pat.rivera@gmail.com',
    memberTypeHint: 'קבוע ללקוח במסך הלקוחות של השורש.',
    send: 'שליחת הזמנת לקוח',
    forbiddenTitle: 'רק בעלי השורש יכולים להזמין לקוחות',
    forbiddenBody: 'בקשו מבעל ארגון שורש לשלוח הזמנה זו.',
    roleMemberDesc: 'יכול להשתמש באפליקציות ששיתפתם.',
    roleViewerDesc: 'קריאה בלבד. נקודת ההתחלה הרגילה ללקוח.',
  },
}
