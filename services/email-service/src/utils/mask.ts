/**
 * Mask an email address so PII does not appear in production logs.
 * alice@example.com → a***@example.com
 */
export function maskEmail(email: string): string {
  const atIdx = email.indexOf('@');
  if (atIdx <= 0) return '***';
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx); // includes '@'
  const visible = local[0];
  return `${visible}***${domain}`;
}
