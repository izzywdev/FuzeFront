/** Relative/absolute date helpers shared across identity views. */
/** Days from now until `iso`. Negative if in the past. null if no date. */
export declare function daysUntil(iso: string | null | undefined, now?: number): number | null;
/** True when `iso` is within `thresholdDays` in the future (and not already past). */
export declare function expiresSoon(iso: string | null | undefined, thresholdDays?: number, now?: number): boolean;
/** True when `iso` is strictly in the past. */
export declare function isExpired(iso: string | null | undefined, now?: number): boolean;
/** Short locale date string, or null when no date. */
export declare function formatDate(iso: string | null | undefined, locale?: string): string | null;
