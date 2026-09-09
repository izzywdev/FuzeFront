/**
 * Every route the site serves (mirrors the <Routes> in src/App.tsx), used by
 * both the navigation smoke spec and the contrast spec so a new page gets
 * covered by both just by being added here.
 */
export const ROUTES = [
  '/',
  '/products',
  '/products/fuzefront',
  '/pricing',
  '/industries',
  '/solutions',
  '/about',
  '/blog',
  '/contact',
  '/privacy',
  '/terms',
  '/fuzehub',
  '/careers',
  '/press',
  '/this-page-does-not-exist', // NotFoundPage (`*` route)
] as const
