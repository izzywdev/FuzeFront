# Mobile APK target contract

## First rollout wave

`fuzeone/mobile-products.json` is the canonical inventory for the first Android
rollout wave: the eleven products already declaring mobile support, plus
FuzeFront and MendysRobotics. FuzeQuality will be added as a separate product
APK in a later wave.

## Runtime architecture

The current APKs are PWA-based Trusted Web Activities. They do not embed a
compiled copy of the React application. Each APK opens its product's dedicated
HTTPS origin, and that origin must serve the product's standalone UI at `/`:

```text
signed APK/TWA -> standalone product frontend at / -> same-origin /api
```

For example, the FuzeAgent APK opens `https://fuzeagent.fuzefront.com/`.
That URL must render FuzeAgent without FuzeFront portal chrome. The loaded UI
then calls relative `/api/...` routes on the same origin. An API response at the
hostname is not a substitute for the standalone frontend.

MendysRobotics follows the same architecture at
`https://live.mendysrobotics.com/`, with its backend below `/api`.

This contract can be replaced per product when that product ships a genuinely
native Flutter frontend. Until then, the standalone web application is a
runtime dependency of every APK.

## Production acceptance

A product is ready only when all of the following are true:

1. Its default-branch build publishes a non-empty, signed APK in GitHub Releases.
2. Installing the APK launches the product-specific standalone UI without
   browser chrome or FuzeFront portal navigation.
3. The root URL returns the product SPA over HTTPS and works at a 375 px viewport.
4. `/.well-known/assetlinks.json` is public and matches the APK package and
   signing-certificate fingerprint.
5. The PWA manifest and icons are public from the same origin.
6. `/api/health` reaches the product backend and returns JSON, not the SPA HTML.
7. Authenticated UI traffic uses relative `/api/...` requests successfully.

Cloudflare Access must not intercept the PWA manifest, icons, Digital Asset
Links, or the initial standalone shell load. User authentication belongs in the
application's standalone login flow. API endpoints may require authentication,
but authentication failures must still be API responses rather than redirects
to an unrelated HTML access portal.

## Repeatable post-production check

Run `node scripts/check-mobile-postprod.mjs --report=mobile-postprod-report.json`
locally (set `GH_TOKEN` for private GitHub repositories), or manually dispatch
`Mobile Android post-production acceptance` on the default branch. The command
uses FuzeFront's existing `GH_RELEASE_PAT` secret in Actions to inspect the
private MendysRobotics repository without exposing the token in the report. It
exits unsuccessfully while any of the 13 products lacks an active Android
workflow, a non-empty APK release targeting its default branch, an HTML
standalone root, a JSON `/api/health`, public Android Digital Asset Links, or
an installable standalone PWA manifest. The workflow uploads a structured
per-product report even when checks fail; it is not a required PR gate while
the fleet is still being provisioned.

This HTTP check cannot prove that the HTML belongs to the intended product,
that an APK's signing certificate matches Digital Asset Links, or that the
authenticated app works on a device. Complete the device and authenticated
flow checks above before marking a product ready.
