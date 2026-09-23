/**
 * Permit resource keys are produced by FuzeFront's ProductPolicy registry as
 * `<product>_<resource>`.  Keep the consumer's requests aligned with the
 * `product: "quality"` declaration in registration/policy.json; hand-written
 * `fuzequality.Resource` values are neither valid Permit keys nor registered
 * resources.
 */
const PRODUCT_NAMESPACE = 'quality'

function resource(name: string) {
  return `${PRODUCT_NAMESPACE}_${name}`
}

export const qualityResources = {
  repository: resource('Repository'),
  evidence: resource('Evidence'),
  suggestion: resource('Suggestion'),
  testImplementation: resource('TestImplementation'),
  organizationAccess: resource('OrganizationAccess'),
  repositoryAdministration: resource('RepositoryAdministration'),
  platformAdministration: resource('PlatformAdministration'),
} as const
