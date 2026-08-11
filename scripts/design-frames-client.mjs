#!/usr/bin/env node
/**
 * design-frames-client.mjs — installed copy of izzywdev/FuzeX's design-frames-service
 * client package (canonical source: services/design-frames-service/client/ in that
 * repo). See the `design-frames-lifecycle` skill (.claude/skills/design-frames-lifecycle/)
 * for the procedure this supports.
 *
 * Frames are authored and version-controlled in THIS repo (design/frames/<feature>/),
 * exactly like a `.fig` file lives with the project that uses it — design-frames-service
 * never becomes their storage. What it owns is their LIFECYCLE: per-flow approval/reject
 * and a navigable review site. Author frames locally as always (see the
 * `ui-frame-contract` skill), then SYNC the current content there. Re-run `sync` after
 * any local edit — this is not a one-time migration, it's a publish step, the same way
 * you'd re-push a `.fig` file after editing it locally.
 *
 * Node stdlib `fetch` only, no dependency — mirrors this repo's other design/frames/**
 * scripts (stamp-frames.mjs, build-frames-site.mjs).
 *
 * Config (env):
 *   DESIGN_FRAMES_SERVICE_URL   base URL of the deployed service (required)
 *   DESIGN_FRAMES_API_TOKEN     bearer token for write operations (sync/approve/reject)
 *
 * CLI:
 *   node design-frames-client.mjs list
 *   node design-frames-client.mjs get <slug>
 *   node design-frames-client.mjs stamp <slug>
 *   node design-frames-client.mjs sync <slug> <localFeatureDir> [sourceRepo]
 *   node design-frames-client.mjs approve <slug> <flowId> <approvedBy>
 *   node design-frames-client.mjs reject <slug> <flowId> <notes>
 *
 * Also usable as a module:
 *   import { listFeatures, getFeature, syncFeature, approveFlow } from './design-frames-client.mjs';
 */

function baseUrl() {
  const url = process.env.DESIGN_FRAMES_SERVICE_URL;
  if (!url) throw new Error('DESIGN_FRAMES_SERVICE_URL is not set — point it at the deployed design-frames-service.');
  return url.replace(/\/$/, '');
}

function authHeaders(extra) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
  const token = process.env.DESIGN_FRAMES_API_TOKEN;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function call(path, options = {}) {
  const res = await fetch(`${baseUrl()}${path}`, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`design-frames-service ${options.method || 'GET'} ${path} -> ${res.status}: ${body.error || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

// ---- reads -----------------------------------------------------------------

export async function listFeatures() {
  return call('/api/v1/features');
}

export async function getFeature(slug) {
  return call(`/api/v1/features/${encodeURIComponent(slug)}`);
}

export async function getStamp(slug) {
  return call(`/api/v1/features/${encodeURIComponent(slug)}/stamp`);
}

export function siteUrl(slug, file) {
  return file
    ? `${baseUrl()}/site/${encodeURIComponent(slug)}/${encodeURIComponent(file)}`
    : `${baseUrl()}/site/${encodeURIComponent(slug)}`;
}

// ---- writes (require DESIGN_FRAMES_API_TOKEN) -------------------------------

export async function createFeature(slug, opts = {}) {
  return call('/api/v1/features', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ slug, ...opts }),
  });
}

export async function putManifest(slug, manifest) {
  return call(`/api/v1/features/${encodeURIComponent(slug)}/manifest`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(manifest),
  });
}

export async function putFrame(slug, file, html) {
  return call(`/api/v1/features/${encodeURIComponent(slug)}/frames/${encodeURIComponent(file)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ html }),
  });
}

export async function commitStamp(slug) {
  return call(`/api/v1/features/${encodeURIComponent(slug)}/stamp`, {
    method: 'POST',
    headers: authHeaders(),
  });
}

export async function approveFlow(slug, flowId, approvedBy) {
  return call(`/api/v1/features/${encodeURIComponent(slug)}/flows/${encodeURIComponent(flowId)}/approve`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ approvedBy }),
  });
}

export async function rejectFlow(slug, flowId, notes) {
  return call(`/api/v1/features/${encodeURIComponent(slug)}/flows/${encodeURIComponent(flowId)}/reject`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ notes }),
  });
}

/**
 * syncFeature — publish a locally-authored `design/frames/<slug>/` directory into
 * design-frames-service: create the feature shell if it doesn't exist yet, push every
 * frame file the manifest references (plus its entry file), push the manifest itself,
 * then commit a fresh content stamp. Safe to re-run after every local edit — the local
 * files stay the source of truth for CONTENT; this only republishes what they say.
 */
export async function syncFeature(slug, localDir, { sourceRepo } = {}) {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  const manifest = JSON.parse(await fs.readFile(path.join(localDir, 'manifest.json'), 'utf8'));
  const resolvedSourceRepo = sourceRepo || manifest.sourceRepo || null;

  try {
    await createFeature(slug, {
      name: manifest.name || slug,
      description: manifest.description || '',
      designSystem: manifest.designSystem,
      entry: manifest.entry,
      sourceRepo: resolvedSourceRepo,
    });
  } catch (err) {
    if (err.status !== 409) throw err; // 409 = feature already exists, fine — we're re-syncing.
  }

  const files = new Set((manifest.frames || []).map((f) => f.file));
  if (manifest.entry) files.add(manifest.entry);
  for (const file of files) {
    const html = await fs.readFile(path.join(localDir, file), 'utf8');
    await putFrame(slug, file, html);
  }

  await putManifest(slug, { ...manifest, sourceRepo: resolvedSourceRepo });
  const { stamp } = await commitStamp(slug);
  return { slug, stamp, framesSynced: files.size, siteUrl: siteUrl(slug) };
}

// ---- CLI ---------------------------------------------------------------------

async function main() {
  const [, , cmd, ...args] = process.argv;
  try {
    switch (cmd) {
      case 'list': {
        const { features } = await listFeatures();
        console.log(JSON.stringify(features, null, 2));
        break;
      }
      case 'get': {
        if (!args[0]) throw new Error('usage: get <slug>');
        console.log(JSON.stringify(await getFeature(args[0]), null, 2));
        break;
      }
      case 'stamp': {
        if (!args[0]) throw new Error('usage: stamp <slug>');
        console.log(JSON.stringify(await getStamp(args[0]), null, 2));
        break;
      }
      case 'sync': {
        const [slug, localDir, sourceRepo] = args;
        if (!slug || !localDir) throw new Error('usage: sync <slug> <localFeatureDir> [sourceRepo]');
        console.log(JSON.stringify(await syncFeature(slug, localDir, { sourceRepo }), null, 2));
        break;
      }
      case 'approve': {
        const [slug, flowId, approvedBy] = args;
        if (!slug || !flowId || !approvedBy) throw new Error('usage: approve <slug> <flowId> <approvedBy>');
        console.log(JSON.stringify(await approveFlow(slug, flowId, approvedBy), null, 2));
        break;
      }
      case 'reject': {
        const [slug, flowId, notes] = args;
        if (!slug || !flowId) throw new Error('usage: reject <slug> <flowId> <notes>');
        console.log(JSON.stringify(await rejectFlow(slug, flowId, notes || ''), null, 2));
        break;
      }
      default:
        console.error('usage: design-frames-client.mjs (list | get <slug> | stamp <slug> | sync <slug> <localFeatureDir> [sourceRepo] | approve <slug> <flowId> <approvedBy> | reject <slug> <flowId> <notes>)');
        process.exit(2);
    }
  } catch (err) {
    console.error(err.message ?? err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
