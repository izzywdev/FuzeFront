// docs.ts — serves swagger-ui-express on GET /docs (unauthenticated, public).
//
// The OpenAPI spec lives at services/selection-list-service/openapi.yaml.

import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { load } from 'js-yaml';
import { readFileSync } from 'fs';
import { join } from 'path';

const router = Router();

// __dirname at runtime: dist/routes/ (compiled) or src/routes/ (ts-node dev).
// openapi.yaml is at the service root (two levels up from src/routes/).
const specPath = join(__dirname, '../../openapi.yaml');
const spec = load(readFileSync(specPath, 'utf8')) as object;

router.use('/', swaggerUi.serve);
router.get('/', swaggerUi.setup(spec));

export default router;
