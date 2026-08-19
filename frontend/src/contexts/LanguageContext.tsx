import React, { createContext, useContext, useState, useEffect } from 'react'

type Language = 'en' | 'he'

interface LanguageContextType {
  language: Language
  setLanguage: (language: Language) => void
  t: (key: string) => string
}

const translations = {
  en: {
    // Top bar
    appHub: 'FuzeFront',
    switchToLight: 'Switch to light mode',
    switchToDark: 'Switch to dark mode',

    // Navigation
    dashboard: 'Dashboard',
    admin: 'Admin',
    adminPanel: 'Admin Panel',
    status: 'Status',
    help: 'Help',
    portal: 'Portal',
    appMenu: 'App Menu',
    logout: 'Logout',
    frontFuse: 'FuzeFront',

    // User menu
    profile: 'Profile',
    settings: 'Settings',
    signOut: 'Sign Out',
    signIn: 'Sign In',
    notifications: 'Notifications',
    administrator: 'Administrator',
    user: 'User',
    noNotifications: 'No new notifications',

    // App selector
    applications: 'Applications',
    offline: 'Offline',
    noAppsAvailable: 'No applications available',

    // Dashboard
    welcome: 'Welcome',
    welcomeMessage: 'Welcome to FuzeFront',
    myApps: 'My Applications',
    recentActivity: 'Recent Activity',

    // Auth
    welcomeToAppHub: 'Welcome to FuzeFront',
    signInMessage: 'Sign in to access your microfrontend platform',
    email: 'Email',
    password: 'Password',
    signingIn: 'Signing in...',

    // Help
    helpDocumentation: 'Help & Documentation',
    gettingStarted: 'Getting Started',
    forDevelopers: 'For Developers',
    support: 'Support',

    // Status
    systemStatus: 'System Status',
    allSystemsOperational: 'All Systems Operational',
    servicesRunning: 'All services are running normally',

    // Admin
    appManagement: 'App Management',
    registerNewApp: 'Register New App',
    appName: 'App Name',
    appUrl: 'App URL',
    integrationType: 'Integration Type',
    description: 'Description',
    save: 'Save',
    cancel: 'Cancel',
    actions: 'Actions',
    active: 'Active',
    inactive: 'Inactive',

    // Common
    loading: 'Loading...',
    error: 'Error',
    success: 'Success',
    close: 'Close',

    // New additions
    addApp: 'Add Application',
    welcomeToFrontFuse: 'Welcome to FuzeFront',
    login: 'Login',
    loginButton: 'Login',

    // Provisioning gate
    provisioningTitle: 'Creating your workspace…',
    provisioningDescription: 'Setting up your personal organization. This takes a moment.',
    provisioningTimeout: 'Taking longer than expected',
    provisioningTimeoutDesc: 'Your workspace is still being created.',
    provisioningError: 'Something went wrong',
    provisioningErrorDesc: "We couldn't verify your workspace.",
    provisioningRetry: 'Try again',

    // Sign-up
    signUp: 'Create an account',
    signUpMessage: 'New to FuzeFront?',

    // Create organization
    createOrganization: 'Create Organization',
    organizationName: 'Organization name',
    createOrganizationDesc: 'Start collaborating with a new organization.',
  },
  he: {
    // Top bar
    appHub: 'FuzeFront',
    switchToLight: 'עבור למצב בהיר',
    switchToDark: 'עבור למצב כהה',

    // Navigation
    dashboard: 'לוח בקרה',
    admin: 'ניהול',
    adminPanel: 'ניהול ממשק',
    status: 'סטטוס',
    help: 'עזרה',
    portal: 'פורטל',
    appMenu: 'תפריט אפליקציות',
    logout: 'התנתק',
    frontFuse: 'FuzeFront',

    // User menu
    profile: 'פרופיל',
    settings: 'הגדרות',
    signOut: 'התנתק',
    signIn: 'היכנס',
    notifications: 'התראות',
    administrator: 'מנהל',
    user: 'משתמש',
    noNotifications: 'אין התראות חדשות',

    // App selector
    applications: 'אפליקציות',
    offline: 'לא מחובר',
    noAppsAvailable: 'אין אפליקציות זמינות',

    // Dashboard
    welcome: 'ברוך הבא',
    welcomeMessage: 'ברוך הבא ל-FuzeFront',
    myApps: 'האפליקציות שלי',
    recentActivity: 'פעילות אחרונה',

    // Auth
    welcomeToAppHub: 'ברוכים הבאים ל-FuzeFront',
    signInMessage: 'היכנס כדי לגשת לפלטפורמת המיקרו-פרונטאנד שלך',
    email: 'אימייל',
    password: 'סיסמה',
    signingIn: 'מתחבר...',

    // Help
    helpDocumentation: 'עזרה ותיעוד',
    gettingStarted: 'תחילת העבודה',
    forDevelopers: 'למפתחים',
    support: 'תמיכה',

    // Status
    systemStatus: 'סטטוס המערכת',
    allSystemsOperational: 'כל המערכות פועלות',
    servicesRunning: 'כל השירותים פועלים כרגיל',

    // Admin
    appManagement: 'ניהול אפליקציות',
    registerNewApp: 'רשום אפליקציה חדשה',
    appName: 'שם האפליקציה',
    appUrl: 'כתובת האפליקציה',
    integrationType: 'סוג השילוב',
    description: 'תיאור',
    save: 'שמור',
    cancel: 'ביטול',
    actions: 'פעולות',
    active: 'פעיל',
    inactive: 'לא פעיל',

    // Common
    loading: 'טוען...',
    error: 'שגיאה',
    success: 'הצלחה',
    close: 'סגור',

    // New additions
    addApp: 'הוסף אפליקציה',
    welcomeToFrontFuse: 'ברוך הבא ל-FuzeFront',
    login: 'התחבר',
    loginButton: 'התחבר',

    // Provisioning gate
    provisioningTitle: 'יוצר את סביבת העבודה שלך…',
    provisioningDescription: 'מגדיר את הארגון האישי שלך. זה אורך רגע.',
    provisioningTimeout: 'לוקח יותר זמן ממצופה',
    provisioningTimeoutDesc: 'סביבת העבודה שלך עדיין נוצרת.',
    provisioningError: 'משהו השתבש',
    provisioningErrorDesc: 'לא הצלחנו לאמת את סביבת העבודה שלך.',
    provisioningRetry: 'נסה שוב',

    // Sign-up
    signUp: 'צור חשבון',
    signUpMessage: 'חדש ב-FuzeFront?',

    // Create organization
    createOrganization: 'צור ארגון',
    organizationName: 'שם הארגון',
    createOrganizationDesc: 'התחל לשתף פעולה עם ארגון חדש.',
  },
}

const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined
)

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    // Get language from localStorage or default to English
    const savedLanguage = localStorage.getItem('language') as Language
    return savedLanguage || 'en'
  })

  useEffect(() => {
    // NOTE: `<html dir>`/`<html lang>` are now owned by the centralized direction
    // manager in @fuzefront/i18n (driven by the active i18next language), so this
    // legacy provider no longer writes them — doing so would race the manager.
    // We still persist the legacy key for not-yet-migrated useLanguage() consumers.
    localStorage.setItem('language', language)
  }, [language])

  const setLanguage = (newLanguage: Language) => {
    setLanguageState(newLanguage)
  }

  const t = (key: string): string => {
    return (
      translations[language][key as keyof (typeof translations)['en']] || key
    )
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider')
  }
  return context
}
