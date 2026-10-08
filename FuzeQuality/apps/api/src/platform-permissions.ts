/**
 * Permit resource keys are produced by FuzeFront's ProductPolicy registry as
 * `<product>_<resource>`.  Keep the consumer's requests aligned with the
 * `product: "fuzequality"` declaration in registration/policy.json. Registry
 * slugs and Permit namespaces must agree or the platform rejects the policy.
 */
const PRODUCT_NAMESPACE = 'fuzequality'

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
