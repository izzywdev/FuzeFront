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
    appHub: 'AppHub',
    switchToLight: 'Switch to light mode',
    switchToDark: 'Switch to dark mode',

    // Navigation
    dashboard: 'Dashboard',
    help: 'Help',
    status: 'Status',
    adminPanel: 'Admin Panel',

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
    welcomeMessage: 'Welcome to AppHub',
    availableApps: 'Available Applications',
    quickActions: 'Quick Actions',
    viewDocumentation: 'View Documentation',
    appUnavailable:
      'is currently unavailable. Please try again later or contact support.',

    // Auth
    welcomeToAppHub: 'Welcome to AppHub',
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
  },
  he: {
    // Top bar
    appHub: 'AppHub',
    switchToLight: 'עבור למצב בהיר',
    switchToDark: 'עבור למצב כהה',

    // Navigation
    dashboard: 'לוח בקרה',
    help: 'עזרה',
    status: 'סטטוס',
    adminPanel: 'פאנל ניהול',

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
    welcomeMessage: 'ברוכים הבאים ל-AppHub',
    availableApps: 'אפליקציות זמינות',
    quickActions: 'פעולות מהירות',
    viewDocumentation: 'צפה בתיעוד',
    appUnavailable: 'אינה זמינה כרגע. נסה שוב מאוחר יותר או צור קשר עם התמיכה.',

    // Auth
    welcomeToAppHub: 'ברוכים הבאים ל-AppHub',
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
    // Apply language direction to document
    document.documentElement.dir = language === 'he' ? 'rtl' : 'ltr'
    document.documentElement.lang = language
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
