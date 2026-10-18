import type { FlowMessages } from './en'

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

/**
 * Hebrew (RTL) copy for the password / MFA flows. Deliberately a deep-partial:
 * the highest-traffic strings are translated, and the provider falls back to
 * English for the rest (see AccountSecurityI18nProvider.withFallback).
 */
export const flowsHe: DeepPartial<FlowMessages> = {
  password: {
    page: { title: 'סיסמה', subtitle: 'עדכן/י את הסיסמה שבה את/ה מתחבר/ת.' },
    change: {
      heading: 'שינוי סיסמה',
      hint: 'הזן/י את הסיסמה הנוכחית ואז בחר/י סיסמה חדשה.',
      current: 'סיסמה נוכחית',
      forgot: 'שכחת את הסיסמה הנוכחית?',
      newPassword: 'סיסמה חדשה',
      confirm: 'אימות סיסמה חדשה',
      submit: 'שמירת הסיסמה החדשה',
      submitting: 'שומר…',
      cancel: 'ביטול',
    },
    set: {
      heading: 'הגדרת סיסמה',
      newPassword: 'סיסמה חדשה',
      confirm: 'אימות סיסמה חדשה',
      submit: 'הגדרת סיסמה',
      submitting: 'מגדיר…',
      cancel: 'ביטול',
    },
    errors: {
      mismatch: 'הסיסמאות אינן תואמות.',
      wrongCurrent: 'זו אינה הסיסמה הנוכחית שלך. בדוק/י אותה או אפס/י את הסיסמה.',
      genericTitle: 'לא הצלחנו לעדכן את הסיסמה',
      retry: 'נסה/י שוב',
    },
    exists: {
      title: 'כבר יש לך סיסמה',
      goChange: 'שינוי סיסמה',
      goReset: 'איפוס במקום זאת',
    },
    strength: { label: 'חוזק הסיסמה', weak: 'חלשה', fair: 'בינונית', good: 'טובה', strong: 'חזקה' },
  },
  reset: {
    request: {
      title: 'איפוס הסיסמה',
      email: 'אימייל',
      submit: 'שלח/י קישור לאיפוס',
      sending: 'שולח…',
      back: 'חזרה להתחברות',
    },
    sent: { title: 'בדוק/י את האימייל', resend: 'שלח/י שוב את הקישור', back: 'חזרה להתחברות' },
    confirm: { title: 'בחר/י סיסמה חדשה', submit: 'עדכון סיסמה' },
    invalid: { title: 'קישור האיפוס פג תוקף', requestAgain: 'בקשת קישור חדש' },
    done: { title: 'הסיסמה עודכנה', signIn: 'התחברות' },
  },
  mfa: {
    page: { title: 'אימות דו-שלבי' },
    factorName: {
      totp: 'אפליקציית אימות',
      sms: 'הודעת טקסט',
      email: 'אימייל',
      webauthn: 'מפתח אבטחה',
      recovery: 'קוד שחזור',
    },
    overview: {
      heading: 'השיטות שלך',
      retry: 'נסה/י שוב',
      remove: 'הסרה',
      setUp: 'הגדרה',
      enrollFirst: 'הגדרת אפליקציית אימות',
    },
    remove: {
      confirm: 'הסרה',
      cancel: 'ביטול',
      addAnother: 'הוספת שיטה נוספת',
      keep: 'להשאיר',
    },
  },
  stepUp: {
    chooseTitle: 'אימות זהות',
    codeTitle: 'הזן/י את הקוד',
    verify: 'אימות והתחברות',
    verifyShort: 'אימות והמשך',
    useDifferent: 'שימוש בשיטה אחרת',
    retry: 'נסה/י שוב',
  },
  contact: { title: 'אימות הטלפון', skip: 'דלג/י לעת עתה', sendCode: 'שלח/י קוד', confirm: 'אישור' },
  securityStatus: { title: 'אבטחה', active: 'פעיל', verified: 'מאומת', unverified: 'לא מאומת' },
}
