/**
 * FFRNT-258 / FF-EPIC-17-S9 — Swagger UI + published spec.
 *
 * Exercises the exposure policy decided in the story: authenticated-developer
 * only, read-only try-it (`supportedSubmitMethods: ['get']`), and no drift
 * between the committed `openapi.yaml` and what is served as JSON/YAML.
 */

import express from 'express';
import request from 'supertest';
import { parse as parseYaml } from 'yaml';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createDocsRouter, loadRawSpecYaml, loadSpec } from '../../src/routes/docs.routes';
import { bearer, TEST_JWT_SECRET } from '../helpers/authToken';

const SOURCE_SPEC_PATH = join(__dirname, '../../openapi.yaml');

beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

function buildApp() {
  const app = express();
  app.use('/docs', createDocsRouter());
  return app;
}

describe('the committed contract parses', () => {
  it('does not throw loading services/config-service/openapi.yaml', () => {
    expect(() => loadSpec()).not.toThrow();
    const spec = loadSpec() as any;
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.title).toBe('FuzeFront Configuration Service API');
  });
});

describe('GET /docs (Swagger UI)', () => {
  it('401s with no credential — not a public route', async () => {
    const app = buildApp();
    const res = await request(app).get('/docs/');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('401s the asset subtree too, not just the index', async () => {
    const app = buildApp();
    const res = await request(app).get('/docs/swagger-ui-bundle.js');
    expect(res.status).toBe(401);
  });

  it('renders the Swagger UI for an authenticated developer', async () => {
    const app = buildApp();
    const res = await request(app).get('/docs/').set('Authorization', bearer({ userId: 'dev-1' }));
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain('swagger-ui');
  });

  it('configures try-it as READ-ONLY: supportedSubmitMethods is get-only', async () => {
    const app = buildApp();
    // swagger-ui-express embeds `swaggerOptions` into swagger-ui-init.js
    // (served by the SAME `swaggerUi.serve` middleware, under /docs), not
    // into the index HTML — this is the file the browser's SwaggerUIBundle
    // actually reads to build the Execute-button config.
    const res = await request(app)
      .get('/docs/swagger-ui-init.js')
      .set('Authorization', bearer({ userId: 'dev-1' }));
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/"supportedSubmitMethods":\s*\[\s*"get"\s*\]/);
    // Guard against a future edit accidentally widening this to writes.
    expect(res.text).not.toMatch(/"supportedSubmitMethods":\s*\[[^\]]*"(post|put|delete|patch)"/i);
  });
});

describe('GET /docs/openapi.json', () => {
  it('401s with no credential', async () => {
    const app = buildApp();
    const res = await request(app).get('/docs/openapi.json');
    expect(res.status).toBe(401);
  });

  it('200s for an authenticated developer with the parsed contract, JSON content-type', async () => {
    const app = buildApp();
    const res = await request(app).get('/docs/openapi.json').set('Authorization', bearer({ userId: 'dev-1' }));
    expect(res.status).toBe(200);
    expect(res.type).toBe('application/json');
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.info.title).toBe('FuzeFront Configuration Service API');
  });

  it('never drifts from the committed openapi.yaml', async () => {
    const app = buildApp();
    const res = await request(app).get('/docs/openapi.json').set('Authorization', bearer({ userId: 'dev-1' }));
    const sourceParsed = parseYaml(readFileSync(SOURCE_SPEC_PATH, 'utf8'));
    expect(res.body).toEqual(sourceParsed);
  });
});

describe('GET /docs/openapi.yaml', () => {
  it('401s with no credential', async () => {
    const app = buildApp();
    const res = await request(app).get('/docs/openapi.yaml');
    expect(res.status).toBe(401);
  });

  it('200s for an authenticated developer, byte-identical to the committed file', async () => {
    const app = buildApp();
    const res = await request(app).get('/docs/openapi.yaml').set('Authorization', bearer({ userId: 'dev-1' }));
    expect(res.status).toBe(200);
    expect(res.type).toBe('application/yaml');
    const sourceRaw = readFileSync(SOURCE_SPEC_PATH, 'utf8');
    expect(res.text).toBe(sourceRaw);
    expect(res.text).toBe(loadRawSpecYaml());
  });
});
