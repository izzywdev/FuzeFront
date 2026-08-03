/**
 * Encodes 16 bytes as the 26-character base32 suffix.
 *
 * Bit-packing note: `acc` never holds more than 20 bits (at most 12 carried
 * over, plus 8 shifted in), so it stays well inside the 32-bit range that
 * JavaScript bitwise operators coerce to. Starting `bits` at 2 supplies the
 * two zero bits that pad 128 up to 130.
 */
export declare function encodeSuffix(bytes: Uint8Array): string;
/** Decodes a 26-character base32 suffix back to 16 bytes. */
export declare function decodeSuffix(suffix: string): Uint8Array;
export declare function isValidSuffix(suffix: string): boolean;
/** Canonical hyphenated UUID string for 16 bytes. */
export declare function bytesToUuid(bytes: Uint8Array): string;
export declare function uuidToBytes(uuid: string): Uint8Array;
export declare function isUuid(value: string): boolean;
/**
 * Generates UUIDv7 bytes: 48-bit big-endian Unix-ms timestamp, 4-bit version,
 * 12 bits of randomness, 2-bit variant, then 62 more random bits (RFC 9562 §5.7).
 *
 * The leading timestamp is the point — ids minted near each other in time sort
 * near each other, so B-tree inserts stay clustered instead of scattering the
 * way v4 does.
 */
export declare function uuidv7Bytes(now?: number): Uint8Array;
