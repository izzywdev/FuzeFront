/**
 * Per-portal Authentik brand provisioning (FF-EPIC-11-S4 AC2).
 *
 * Authentik resolves which `authentik_brands.brand` to render for a login /
 * enrollment / recovery page by matching the REQUEST HOST against
 * `brand.domain` — the same "soft multi-tenancy" mechanism
 * `brand-fuseseam.yaml` already relies on for `*.fuzefront.com` (see
 * `deploy/helm/fuzefront/authentik/blueprints-mendys/README.md`'s "Why a
 * separate instance instead of a brand" section for the authoritative
 * description of this mechanism). Every FuzeFront-hosted portal shares the
 * SAME Authentik directory/pool (per FF-EPIC-11's account-namespacing note),
 * so a per-portal brand is exactly the soft-tenancy primitive Authentik
 * offers for "same pool, different login look".
 *
 * A brand is created ON DEMAND, at portal-provisioning time, for a domain
 * that did not exist until an admin called the portal-create API — i.e. it is
 * runtime data, not deploy-time data. That is the identical reasoning
 * `../custom-domains/authentikRedirect.ts` already documents for why the
 * per-domain OIDC redirect URI is mutated through the Admin API rather than a
 * blueprint: "blueprints are a static ConfigMap rendered at deploy time and
 * these URIs are runtime data". A brand is provisioned the same way here, via
 * `POST`/`PATCH /api/v3/core/brands/`.
 *
 * A STATIC blueprint TEMPLATE is still provided at
 * `deploy/helm/fuzefront/authentik/blueprints/brand-portal-template.yaml`,
 * following the `brand-mendys.yaml` precedent exactly, for the case a portal
 * ever needs a hand-applied/GitOps-rendered brand (e.g. a dedicated-instance
 * tenant analogous to MendysRobotics). It documents the intended shape; it is
 * NOT applied automatically by anything in this repo (applying a blueprint is
 * a cluster operation — FuzeInfra/GitOps territory). The automatic per-portal
 * path every ordinary portal goes through is this module, invoked from
 * `services/portalProvisioning.ts`.
 *
 * Idempotent: `ensure()` upserts by `domain` (mirrors the blueprints' own
 * `identifiers: { domain }` idempotency key), so calling it again for the
 * same domain (a resumed provisioning attempt, or a later branding edit)
 * updates the existing brand instead of creating a duplicate.
 *
 * Never sets `default: true` — that flag is reserved for the platform brand
 * (`brand-fuseseam.yaml`'s `fuzefront.com` entry); a per-portal brand is
 * selected purely by its own `domain` match, never as the directory-wide
 * fallback.
 */

import axios from 'axios'
import {
  AUTHENTIK_TIMEOUT_MS,
  buildHeaders,
  findAcrossPages,
  getAuthentikAdminToken,
  getAuthentikBaseUrl,
} from './authentik-admin'

export interface PortalBrandInput {
  /** The domain Authentik matches the login request's Host header against. */
  domain: string
  name: string
  accent?: string | null
  logo?: string | null
  favicon?: string | null
}

export interface PortalBrandRegistrar {
  ensure(input: PortalBrandInput): Promise<void>
}

interface AuthentikBrand {
  brand_uuid: string
  domain: string
}

/**
 * A minimal accent-color override, layered on top of whatever the platform
 * brand already ships (Authentik applies exactly one brand's CSS per
 * request, so this re-declares the handful of selectors the platform brand
 * themes rather than assuming inheritance). Undefined when no accent was
 * supplied, so a portal with no branding gets no custom CSS at all — the
 * Authentik-default look, not a broken half-themed one.
 */
function customCss(accent: string | null | undefined): string | undefined {
  if (!accent) return undefined
  const safeAccent = /^#[0-9a-fA-F]{3,8}$/.test(accent) ? accent : undefined
  if (!safeAccent) return undefined
  return [
    ':root { --fuse-accent: ' + safeAccent + '; }',
    '.pf-v5-c-login__main::before { background: ' + safeAccent + ' !important; }',
    '.pf-v5-c-button.pf-m-primary, button[type="submit"] { background: ' +
      safeAccent +
      ' !important; }',
    '.pf-v5-c-form-control:focus, input:focus { border-color: ' +
      safeAccent +
      ' !important; }',
    'a, .pf-v5-c-button.pf-m-link { color: ' + safeAccent + ' !important; }',
  ].join('\n')
}

/**
 * Admin-API-backed registrar. Returns `null` when Authentik is not configured
 * (no admin token) — mirrors `createAuthentikRedirectRegistrar`'s degrade
 * contract exactly, so a deployment without Authentik wired up gets "no
 * per-portal brand" rather than a crash.
 */
export function createAuthentikBrandRegistrar(): PortalBrandRegistrar | null {
  const token = getAuthentikAdminToken()
  if (!token) return null

  const baseUrl = getAuthentikBaseUrl()
  const headers = buildHeaders(token)

  return {
    async ensure(input: PortalBrandInput): Promise<void> {
      const domain = input.domain.trim().toLowerCase()
      const attrs: Record<string, unknown> = {
        domain,
        branding_title: input.name,
        default: false,
      }
      const css = customCss(input.accent)
      if (css) attrs.branding_custom_css = css
      if (input.logo) attrs.branding_logo = input.logo
      if (input.favicon) attrs.branding_favicon = input.favicon

      const existing = await findAcrossPages<AuthentikBrand>(
        `${baseUrl}/api/v3/core/brands/`,
        { domain },
        headers,
        b => b.domain === domain
      )

      if (existing) {
        await axios.patch(`${baseUrl}/api/v3/core/brands/${existing.brand_uuid}/`, attrs, {
          headers,
          timeout: AUTHENTIK_TIMEOUT_MS,
        })
        return
      }

      await axios.post(`${baseUrl}/api/v3/core/brands/`, attrs, {
        headers,
        timeout: AUTHENTIK_TIMEOUT_MS,
      })
    },
  }
}
