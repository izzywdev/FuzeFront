export interface ParsedEmail {
    email: string;
    valid: boolean;
}
export declare function isValidEmail(value: string): boolean;
/** Parse newline/comma/semicolon-separated emails from a textarea blob. */
export declare function parseEmailText(text: string): ParsedEmail[];
/**
 * Parse a CSV file/string into emails. Detects an `email` column (case-insensitive)
 * and otherwise falls back to the first column of each row. Handles quoted fields,
 * CRLF, and BOM via PapaParse.
 */
export declare function parseCsv(content: string): ParsedEmail[];
