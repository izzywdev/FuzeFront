import React from 'react';
import type { IdentityMessages } from './messages';
export type IdentityLocale = 'en' | 'he';
export interface IdentityI18nContextValue {
    locale: IdentityLocale;
    dir: 'ltr' | 'rtl';
    /** Resolved messages for the active locale, with English fallback per key. */
    messages: IdentityMessages;
    /** Interpolate `{count}`-style placeholders in a string. */
    t: (value: string, vars?: Record<string, string | number>) => string;
}
export interface IdentityI18nProviderProps {
    locale?: IdentityLocale;
    children: React.ReactNode;
}
export declare function IdentityI18nProvider({ locale, children }: IdentityI18nProviderProps): import("react/jsx-runtime").JSX.Element;
export declare function useIdentityI18n(): IdentityI18nContextValue;
