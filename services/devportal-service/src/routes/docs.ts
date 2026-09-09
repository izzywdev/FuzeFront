// docs.ts — serves swagger-ui-express on GET /docs (unauthenticated, public)
// for devportal-service's OWN API contract. NOT the family catalog — that's
// GET /v1/catalog (routes/catalog.ts).

import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { load } from 'js-yaml';
import { readFileSync } from 'fs';
import { join } from 'path';

const router = Router();

const specPath = join(__dirname, '../../openapi.yaml');
const spec = load(readFileSync(specPath, 'utf8')) as object;

router.use('/', swaggerUi.serve);
router.get('/', swaggerUi.setup(spec));

export default router;
