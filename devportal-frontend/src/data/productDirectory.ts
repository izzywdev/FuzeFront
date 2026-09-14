/**
 * The "participating product directory" (frame 01 acceptanceNotes): one card per
 * .fuze/manifest.json `providesTo` entry that has at least one published spec,
 * PLUS FuzeFront itself (the platform host — it harvests its own services'
 * openapi.yaml files into the same catalog, e.g. app-registry-service).
 *
 * This is a static, build-time list rather than a runtime fetch: the anonymous
 * home page renders it with NO catalog call (home.red.spec.ts's signed-out
 * tests mock only GET /v1/me — see DevPortalHomeFlow's module comment), and
 * there is no product-registry endpoint a standalone portal SPA could call
 * for this today. Sourced from the repo's own `.fuze/manifest.json`
 * `providesTo` array (2026-09-14 snapshot) — a governance nightly / release
 * process can regenerate this file if that list drifts; it isn't hand-guessed.
 */
export interface DirectoryProduct {
  id: string
  label: string
}

export const PRODUCT_DIRECTORY: DirectoryProduct[] = [
  { id: 'fuzefront', label: 'FuzeFront' },
  { id: 'fuzeagent', label: 'FuzeAgent' },
  { id: 'fuzebi', label: 'FuzeBI' },
  { id: 'fuzecall', label: 'FuzeCall' },
  { id: 'fuzecontact', label: 'FuzeContact' },
  { id: 'fuzedeploy', label: 'FuzeDeploy' },
  { id: 'fuzeexecutive', label: 'FuzeExecutive' },
  { id: 'fuzehub', label: 'FuzeHub' },
  { id: 'fuzekeys', label: 'FuzeKeys' },
  { id: 'fuzemarket', label: 'FuzeMarket' },
  { id: 'fuzemerchandize', label: 'FuzeMerchandize' },
  { id: 'fuzepicker', label: 'FuzePicker' },
  { id: 'fuzeplan', label: 'FuzePlan' },
  { id: 'fuzesales', label: 'FuzeSales' },
  { id: 'fuzeservice', label: 'FuzeService' },
  { id: 'fuzesocial', label: 'FuzeSocial' },
  { id: 'fuzex', label: 'FuzeX' },
]
