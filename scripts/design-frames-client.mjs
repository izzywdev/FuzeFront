#!/usr/bin/env node
/**
 * design-frames-client.mjs — thin client for izzywdev/FuzeX's design-frames-service,
 * the external home for navigable-frames authorship as of the 2026-08-10 extraction
 * (see docs/planning/design-first-ui-pipeline.md's extraction addendum). Node stdlib
 * `fetch` only, no dependency — mirrors the style of scripts/stamp-frames.mjs and
 * scripts/build-frames-site.mjs.
 *
 * Config (env):
 *   DESIGN_FRAMES_SERVICE_URL   base URL of the deployed service (required)
 *   DESIGN_FRAMES_API_TOKEN     bearer token for write operations (only needed for --approve etc.)
 *
 * CLI:
 *   node scripts/design-frames-client.mjs list
 *   node scripts/design-frames-client.mjs get <slug>
 *   node scripts/design-frames-client.mjs stamp <slug>
 *   node scripts/design-frames-client.mjs approve <slug> <flowId> <approvedBy>
 *
 * Also usable as a module (e.g. from a workflow step or an agent's tool call):
 *   import { listFeatures, getFeature, approveFlow } from './design-frames-client.mjs';
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
    throw new Error(`design-frames-service ${options.method || 'GET'} ${path} -> ${res.status}: ${body.error || res.statusText}`);
  }
  return body;
}

export async function listFeatures() {
  return call('/api/v1/features');
}

export async function getFeature(slug) {
  return call(`/api/v1/features/${encodeURIComponent(slug)}`);
}

export async function getStamp(slug) {
  return call(`/api/v1/features/${encodeURIComponent(slug)}/stamp`);
}

export async function approveFlow(slug, flowId, approvedBy) {
  return call(`/api/v1/features/${encodeURIComponent(slug)}/flows/${encodeURIComponent(flowId)}/approve`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ approvedBy }),
  });
}

export function siteUrl(slug, file) {
  return file ? `${baseUrl()}/site/${encodeURIComponent(slug)}/${encodeURIComponent(file)}` : `${baseUrl()}/site/${encodeURIComponent(slug)}`;
}

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
      case 'approve': {
        const [slug, flowId, approvedBy] = args;
        if (!slug || !flowId || !approvedBy) throw new Error('usage: approve <slug> <flowId> <approvedBy>');
        console.log(JSON.stringify(await approveFlow(slug, flowId, approvedBy), null, 2));
        break;
      }
      default:
        console.error('usage: design-frames-client.mjs (list | get <slug> | stamp <slug> | approve <slug> <flowId> <approvedBy>)');
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
