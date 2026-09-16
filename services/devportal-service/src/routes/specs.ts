// specs.ts — internal, service-to-service spec-registry write endpoint.
//
// docs/planning/developers-portal.md §4.2 — the PUSH harvest mechanism: a
// family repo's CI (this repo today; any `providesTo` repo in Phase 5) POSTs
// its own openapi.yaml here on merge to its default branch. Never exposed on
// the public ingress — same shared-secret pattern as backend/security's
// /internal/* routes.
//
//   POST /internal/specs
//   Headers: x-internal-secret: <INTERNAL_PROVISION_SECRET>
//   Body:    { "repo": "fuzefront", "service": "app-registry-service",
//               "specPath": "services/app-registry-service/openapi.yaml",
//               "specYaml": "<raw file contents>" }
//   200 { ok: true, id, repo, service, version }
//   400 { error } missing field / spec did not parse as OpenAPI
//   401 { error } bad/missing secret

import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { upsertSpec } from '../services/registry';

const router = Router();

function isAuthorized(req: Request): boolean {
  const expected = process.env.INTERNAL_PROVISION_SECRET;
  const provided = req.header('x-internal-secret');
  const a = Buffer.from(provided || '');
  const b = Buffer.from(expected || '');
  return !(!expected || !provided || a.length !== b.length || !crypto.timingSafeEqual(a, b));
}

router.post('/specs', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { repo, service, specPath, specYaml } = req.body || {};
  if (!repo || !service || !specPath || !specYaml) {
    res.status(400).json({ error: 'repo, service, specPath and specYaml are all required' });
    return;
  }

  try {
    const record = await upsertSpec({ repo, service, specPath, specYaml });
    res.status(200).json({ ok: true, id: record.id, repo: record.repo, service: record.service, version: record.version });
  } catch (error: any) {
    res.status(400).json({ error: 'Spec rejected', detail: String(error?.message ?? error) });
  }
});

export default router;
