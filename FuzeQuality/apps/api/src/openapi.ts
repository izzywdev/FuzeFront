/**
 * Serve the OpenAPI document over HTTP, and report whether it was found.
 *
 * FuzeQuality's whole purpose is measuring whether a repository's OpenAPI
 * contract is covered by its tests and surfaces. Until now it did not publish
 * one of its own, and a spec that exists only in git cannot be discovered by
 * anything at runtime — a consumer has to be told where the repo is and which
 * ref to read, which is documentation, not discovery. Serving the document from
 * the running process makes the answer come from the thing that actually
 * implements it, so "what does this deployment serve" and "what does the
 * contract say" can be compared instead of assumed.
 *
 * Two representations of ONE document:
 *   GET /openapi.yaml  the committed bytes, verbatim
 *   GET /openapi.json  the same document parsed and re-serialised as JSON
 *
 * Both are unauthenticated, deliberately — the document describes the SHAPE of
 * the API, never any data held in it. `isPublicRequest` in ./authentication.ts
 * is what lets them past the API-token guard.
 *
 * Resolution order for the document:
 *   1. `OPENAPI_SPEC_PATH` — what the container sets, so prod is explicit.
 *   2. Well-known locations relative to this module and the working directory,
 *      so `npm run dev:api` and `vitest` work with no configuration.
 *
 * A missing document is NOT fatal to the process: the API is still correct and
 * serving it is more useful than crash-looping. It is, however, loudly visible —
 * the routes answer 503 rather than 404 (the endpoint exists; its content is
 * missing) and `/health` reports `openapi: "unavailable"`, so a broken build
 * shows up on the health check instead of being discovered by the first consumer
 * that needed the spec.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type Response, type Router } from 'express'
import { parse as parseYaml } from 'yaml'

/** The contract version this build implements — mirrors contracts/openapi.yaml `info.version`. */
export const CONTRACT_VERSION = '0.1.0'
export const SERVICE_NAME = 'fuzequality'

/**
 * Where the contract sits inside the container image.
 *
 * docker/Dockerfile's `source` stage does `COPY FuzeQuality ./` into
 * /workspace/FuzeQuality, so the contract arrives with the source rather than
 * being mounted separately. That is the property that matters: the spec a
 * deployment serves is the spec that deployment was built from. A
 * ConfigMap-mounted copy can drift from the running code; a copy in the image
 * cannot.
 */
export const CONTAINER_SPEC_PATH = '/workspace/FuzeQuality/contracts/openapi.yaml'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * Candidate locations, in order. The relative entries walk up from this module
 * (`apps/api/src`) to the FuzeQuality root, so a source checkout and a vitest
 * run both find the committed contract with no env configuration.
 */
export function candidatePaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env.OPENAPI_SPEC_PATH?.trim()
  if (configured) return [configured]
  return [
    CONTAINER_SPEC_PATH,
    resolve(HERE, '../../../contracts/openapi.yaml'),
    resolve(process.cwd(), 'contracts/openapi.yaml'),
    resolve(process.cwd(), 'FuzeQuality/contracts/openapi.yaml'),
  ]
}

export interface LoadedSpec {
  /** The document exactly as committed. */
  readonly yaml: string
  /** The same document as JSON text. */
  readonly json: string
  /** Absolute path it was read from — reported so a wrong build is diagnosable. */
  readonly path: string
}

export type SpecLoad = { ok: true; spec: LoadedSpec } | { ok: false; error: string }

/**
 * Read and parse the document once, at load time rather than lazily on the
 * first request. That is the point: a spec that is present but malformed is a
 * broken deployment, and it should be visible at boot rather than at the moment
 * a consumer first depends on it.
 */
export function loadSpec(env: NodeJS.ProcessEnv = process.env): SpecLoad {
  const tried = candidatePaths(env)
  for (const path of tried) {
    let raw: string
    try {
      raw = readFileSync(path, 'utf8')
    } catch {
      continue // not at this location; try the next
    }
    let parsed: unknown
    try {
      parsed = parseYaml(raw)
    } catch (error) {
      return { ok: false, error: `${path} is not parseable YAML: ${String(error)}` }
    }
    if (!parsed || typeof parsed !== 'object' || !('paths' in (parsed as object))) {
      return { ok: false, error: `${path} does not look like an OpenAPI document (no "paths")` }
    }
    return { ok: true, spec: { yaml: raw, json: JSON.stringify(parsed), path } }
  }
  return { ok: false, error: `no OpenAPI document found; tried: ${tried.join(', ')}` }
}

/** Mountable router plus the health signal, so `/health` can report the truth. */
export interface OpenApiSurface {
  router: Router
  available: boolean
  /** Populated only when `available` is false. */
  error?: string
}

/**
 * Builds the router for `/health`, `/openapi.yaml` and `/openapi.json`.
 *
 * `/health` is DISTINCT from the pre-existing `/health/live` and
 * `/health/ready`, which the chart's kubelet probes use and which are left
 * untouched. `/health` is the platform-wide convention every Fuze service
 * answers, and is what the same-origin nginx proxy and the frontend call.
 */
export function createOpenApiSurface(env: NodeJS.ProcessEnv = process.env): OpenApiSurface {
  const loaded = loadSpec(env)
  const router = express.Router()

  // `status` stays "ok" when the spec is missing: the process is serving and
  // restarting it would not produce the file. The missing contract is reported
  // in its own field so it is visible without being conflated with liveness.
  router.get('/health', (_request, response) => {
    response.status(200).json({
      status: 'ok',
      service: SERVICE_NAME,
      version: CONTRACT_VERSION,
      openapi: loaded.ok ? 'available' : 'unavailable',
    })
  })

  if (!loaded.ok) {
    const { error } = loaded
    // 503, not 404: the endpoint exists and is part of the contract; what is
    // missing is the document it serves. A 404 would read as "this service does
    // not publish a spec", which is a different and wrong diagnosis.
    const unavailable = (_request: unknown, response: Response): void => {
      response.status(503).json({ code: 'openapi_unavailable', message: error })
    }
    router.get('/openapi.yaml', unavailable)
    router.get('/openapi.json', unavailable)
    return { router, available: false, error }
  }

  const { spec } = loaded
  router.get('/openapi.yaml', (_request, response) => {
    response.type('application/yaml').send(spec.yaml)
  })
  router.get('/openapi.json', (_request, response) => {
    response.type('application/json').send(spec.json)
  })
  return { router, available: true }
}
