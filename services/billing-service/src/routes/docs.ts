import { Router, Request, Response } from 'express';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Public, read-only API documentation for the billing-service.
 *
 *   GET /api/v1/billing/docs         -> Swagger UI (renders the contract)
 *   GET /api/v1/billing/openapi.yaml -> the raw OpenAPI 3.1 contract
 *
 * This is the "launch in Swagger" surface: wherever the service runs it exposes
 * an interactive view of the SAME `openapi.yaml` that generates
 * `@fuzefront/billing-client`. No auth — the contract is not a secret and holds
 * no data. In deploy it is reachable behind the ingress at
 * `<origin>/api/v1/billing/docs`; locally at `http://localhost:3006/api/v1/billing/docs`.
 *
 * Swagger UI assets load from the jsDelivr CDN (available in a browser / behind
 * ingress). The spec is read from disk at request time from the first candidate
 * path that exists, so it works both from `dist/` (production image copies the
 * yaml next to the compiled JS) and from source in dev/test.
 */
const SPEC_CANDIDATES = [
  join(__dirname, '..', 'openapi.yaml'), // dist/openapi.yaml (prod) or src/../openapi.yaml
  join(__dirname, '..', '..', 'openapi.yaml'), // service root from dist/routes
  join(process.cwd(), 'openapi.yaml'), // service root when cwd is the service dir
];

function resolveSpecPath(): string | null {
  for (const p of SPEC_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  return null;
}

const SWAGGER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FuzeFront Billing API — Swagger UI</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <style>body { margin: 0; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: 'openapi.yaml',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis],
    });
  </script>
</body>
</html>`;

/** Builds the public docs router (Swagger UI + raw spec). */
export function createDocsRouter(): Router {
  const router = Router();

  router.get('/docs', (_req: Request, res: Response) => {
    res.type('html').send(SWAGGER_HTML);
  });

  router.get('/openapi.yaml', (_req: Request, res: Response) => {
    const specPath = resolveSpecPath();
    if (!specPath) {
      return res.status(404).json({ error: 'openapi spec not found' });
    }
    res.type('text/yaml').send(readFileSync(specPath, 'utf8'));
  });

  return router;
}
