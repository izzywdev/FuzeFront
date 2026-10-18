/** Public origin of the FuzeFront shell, used to build links in emails. */
export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL || 'https://app.fuzefront.com').replace(/\/+$/, '');
}
