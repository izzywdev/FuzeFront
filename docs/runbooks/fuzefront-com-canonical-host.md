# Runbook — `fuzefront.com` is ONE domain with ONE brand

**Status:** FuzeFront's half is landed. **The FuzeInfra DNS half is OPEN** and is the
only thing still keeping the split live. See [What FuzeInfra must do](#what-fuzeinfra-must-do).

## The defect

| Host | Resolved to | Served |
|---|---|---|
| `fuzefront.com` (apex) | Cloudflare-proxied → CF tunnel → cluster Traefik → `website-frontend` | the **FuzeOne** family marketing site (`fuzefront-website/`, this repo) |
| `www.fuzefront.com` | **unproxied CNAME → `d27hi5funhy3o7.cloudfront.net`** (AWS CloudFront over S3) | a static **FuzeHub** landing page, `last-modified: 2026-07-02` |

One domain presenting two brands, with no redirect between them and no shared
owner. A visitor typing the company domain got a different company depending on
whether they typed three letters first.

### Why nothing caught it

`www` never reached the cluster at all, so every check this repo has was looking
somewhere else:

- `helm lint` / `kubeconform` validate rendered manifests — and no manifest
  mentioned `www`, so there was nothing to be wrong about.
- `fuzefront-website-post-prod-e2e.yml` targets `https://fuzefront.com`. The apex
  was correct the whole time.
- `prod-federation-probe` / `portal-federation-health` probe `app.fuzefront.com`.

This is the same shape as the `/applications` Authentik exposure recorded in
`helm-validate.yml`: a live-edge fact that no rendered-manifest check can see.
The lesson is the same — **only a black-box request to the host in question
proves anything about that host.**

## The rule

**The apex is canonical. Aliases redirect to it; they never serve.**

- `websiteFrontend.host` (`deploy/helm/fuzefront/values-prod.yaml`) is the one
  canonical host.
- `websiteFrontend.aliasHosts` lists extra **exact** hosts the Ingress claims.
  They route to the same Service, and the site's nginx 301s them to the canonical
  host. Never a wildcard here — Traefik orders routers by rule *length*, not host
  specificity, so a wildcard shadows every single-label host in the cluster
  (the `ingress.wildcardHost` comment in the same file has the incident).
- A product never lives on a subdomain of the family domain that looks like the
  family site's own. FuzeHub is a product in the registry; its home is its own
  host, not `www` of the company domain.

## What landed here (FuzeFront's half)

| Change | File |
|---|---|
| `www.fuzefront.com` → `301 https://fuzefront.com$request_uri` | `fuzefront-website/frontend/nginx.conf` |
| same rule at the compose/local edge (which rewrites `Host`, so the pod can't see `www` through it) | `fuzefront-website/nginx/nginx.conf` |
| Ingress claims `host` + every `aliasHosts` entry | `deploy/helm/fuzefront/templates/website.yaml` |
| `aliasHosts: [www.fuzefront.com]` | `deploy/helm/fuzefront/values-prod.yaml` |
| pre-merge gate: boots the real nginx config, proves every alias 301s (self-tested) | `scripts/check-website-canonical-host.sh`, `ci.yml` job `gate-website-canonical-host` |
| post-deploy live-edge probe | `prod-post-deploy.yml` job `www-canonical-host` |

**Claim-then-flip is the deliberate ordering.** Claiming `www` in the cluster
while DNS still points at CloudFront changes nothing for visitors — CloudFront
keeps answering. Flipping DNS *first* would land traffic on a routed-but-unclaimed
host and Traefik would answer 404. Same rule as `ingress.tenantIdentityHosts`.

## What FuzeInfra must do

This repo holds **no** Cloudflare credential — DNS is FuzeInfra's Terraform plane
(`.github/workflows/infra-dispatch.yml` header; this repo's only power there is
firing a `repository_dispatch`, and `deploy/terraform/node-requests.json` declares
compute nodes, not DNS). So the second half cannot be done from here. It is two
changes, both in FuzeInfra, mirroring exactly how `app.fuzefront.com` is already
wired (izzywdev/FuzeInfra#43):

1. **Replace the `www.fuzefront.com` DNS record.** It is currently an unproxied
   CNAME to `d27hi5funhy3o7.cloudfront.net`. It becomes a **proxied** CNAME to the
   `FuzeInfra` tunnel, identical in shape to the `app.fuzefront.com` record.
2. **Add the tunnel ingress rule** `www.fuzefront.com → http://traefik.kube-system:80`,
   alongside the existing `app.fuzefront.com` rule.

Nothing else is needed: the Ingress already claims the host and the site already
redirects it, so the first request through the tunnel gets a `301` to the apex.

### Verifying the flip

```bash
# Expect: 301, and Location on the apex.
curl -sS -o /dev/null -w 'status=%{http_code} -> %{redirect_url}\n' https://www.fuzefront.com/
# Expect: path and query survive.
curl -sS -o /dev/null -w '%{redirect_url}\n' 'https://www.fuzefront.com/pricing?plan=team'
```

The `www-canonical-host` job in `prod-post-deploy.yml` asserts exactly this and is
**RED until the flip lands** — on purpose. A red light on every deploy is the
honest representation of a live brand split; it goes green by itself the moment
the record moves, and it must not be softened to a warning
(`governance/vacuous-check-policy.json`).

### The FuzeHub side

The CloudFront distribution is not defined in this repo (`grep -rn cloudfront`
over `**/*.tf` finds nothing; `fuzefront-website/infrastructure/` is an ECS/ALB
stack with Route53 disabled). Whoever owns that distribution should either point
it at FuzeHub's own hostname or retire it — but that is not a prerequisite for
the two changes above. Once the DNS record moves, `www.fuzefront.com` stops
reaching CloudFront regardless of what the distribution still serves.
