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
