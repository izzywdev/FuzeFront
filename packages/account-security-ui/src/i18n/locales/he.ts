import type { AccountSecurityMessages } from '../messages'

/** Hebrew (RTL) locale — exercises the RTL mirror path via logical properties. */
export const he: AccountSecurityMessages = {
  page: {
    title: 'אבטחה',
    subtitle: 'נהל/י כיצד את/ה מתחבר/ת ושמור/י על חשבונך מאובטח.',
  },
  posture: {
    good: 'החשבון שלך מוגן היטב',
    attention: 'החשבון שלך דורש תשומת לב',
    summary: '{password} · {twoFactor} · {devices} · {connected}.',
    passwordSet: 'סיסמה הוגדרה',
    passwordMissing: 'עדיין אין סיסמה',
    twoFactorOn: 'אימות דו-שלבי פעיל',
    twoFactorOff: 'אימות דו-שלבי כבוי',
    devicesUnknown: 'מכשירים אינם זמינים',
    connectedNone: 'אין חשבונות מקושרים',
  },
  cards: {
    password: {
      title: 'סיסמה',
      desc: 'שנה/י את הסיסמה שלך, או הוסף/י אחת אם את/ה מתחבר/ת רק דרך ספק.',
    },
    twoFactor: {
      title: 'אימות דו-שלבי',
      desc: 'הוסף/י שלב שני בהתחברות עם אפליקציית אימות או קוד ב-SMS.',
    },
    sessions: {
      title: 'מכשירים והתחברויות',
      desc: 'ראה/י היכן את/ה מחובר/ת והתנתק/י מכל מכשיר.',
    },
    tokens: {
      title: 'אסימוני API',
      desc: 'צור/י ובטל/י אסימוני מכונה עבור סקריפטים ושירותים.',
    },
    connected: {
      title: 'חשבונות מקושרים',
      desc: 'קשר/י או נתק/י ספקי התחברות. תמיד תישאר/י עם דרך אחת לפחות להתחבר.',
    },
  },
  badges: {
    set: 'הוגדרה',
    on: 'פעיל',
    factors: '{count} גורם',
    activeDevices: '{count} פעילים',
    activeTokens: '{count} פעילים',
    unknown: 'לא זמין',
    linked: 'מקושר',
    passwordEnabled: 'סיסמה · מופעלת',
  },
  loading: {
    label: 'טוען את הגדרות האבטחה שלך',
  },
  error: {
    title: 'לא ניתן היה לטעון את הגדרות האבטחה שלך',
    text: 'משהו השתבש אצלנו. החשבון שלך אינו מושפע — נסה/י שוב.',
    retry: 'נסה/י שוב',
  },
  setPassword: {
    title: 'הגדר/י סיסמה תחילה',
    text: 'את/ה מתחבר/ת דרך חשבון מקושר, ולכן לחשבון זה אין עדיין סיסמה. הוסף/י אחת כדי להפעיל התחברות עם סיסמה ולאפשר שינוי סיסמה.',
    action: 'הגדר/י סיסמה',
  },
  lastMethod: {
    title: 'שמור/י על דרך אחת לפחות להתחבר',
    text: 'זו דרך ההתחברות היחידה שלך כרגע, ולכן לא ניתן לנתק אותה. הגדר/י סיסמה או קשר/י ספק אחר תחילה, ואז נתק/י.',
    setPassword: 'הגדר/י סיסמה',
    linkProvider: 'קשר/י חשבון אחר',
  },
  methods: {
    heading: 'הדרכים שבהן את/ה מתחבר/ת',
    passwordName: 'סיסמה',
    socialName: '{provider}',
    remove: 'הסר/י',
    manage: 'נהל/י',
  },
}
