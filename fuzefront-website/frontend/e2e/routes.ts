/**
 * Every route the site serves (mirrors the <Routes> in src/App.tsx), used by
 * both the navigation smoke spec and the contrast spec so a new page gets
 * covered by both just by being added here.
 */
export const ROUTES = [
  '/',
  '/products',
  '/products/fuzefront',
  '/products/fuzesdlc',
  '/products/fuzeinfra',
  '/products/fuzeplan',
  '/products/fuzex',
  '/products/fuzeagent',
  '/products/fuzekeys',
  '/products/fuzepicker',
  '/products/fuzequality',
  '/products/fuzedeploy',
  '/pricing',
  '/industries',
  '/solutions',
  '/about',
  '/blog',
  '/contact',
  '/privacy',
  '/terms',
  '/careers',
  '/press',
  '/this-page-does-not-exist', // NotFoundPage (`*` route)
] as const
