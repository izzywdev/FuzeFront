"""Authentik ops helper — diagnose/apply FuzeFront blueprints via the admin API.

Two callers, same script:
  - .github/workflows/prod-authentik-ops.yml (from a runner, AK_URL=public host,
    AK_TOKEN=AUTHENTIK_PROD_TOKEN repo secret)
  - the in-cluster authentik-config-apply Job (templates/authentik-config-apply.yaml,
    AK_URL=http://authentik-server:9000, AK_TOKEN=AUTHENTIK_BOOTSTRAP_TOKEN from
    the fuzefront-secrets Secret, BLUEPRINT_DIR=/blueprints)
"""
import json, os, sys, urllib.request, urllib.error

AK = os.environ['AK_URL'].rstrip('/')
TOK = os.environ['AK_TOKEN']
PHASE = os.environ.get('PHASE', 'diagnose')
BLUEPRINT_DIR = os.environ.get(
    'BLUEPRINT_DIR', 'deploy/helm/fuzefront/authentik/blueprints'
).rstrip('/')


def api(path, method='GET', body=None):
    req = urllib.request.Request(
        f'{AK}/api/v3{path}', method=method,
        headers={'Authorization': f'Bearer {TOK}', 'Accept': 'application/json',
                 'Content-Type': 'application/json'},
        data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        return e.code, {'error': e.read().decode()[:400]}
    except Exception as e:  # noqa: BLE001 — report-and-continue tool
        return 0, {'error': str(e)[:400]}


report = [f'## Prod Authentik ops — phase: {PHASE}', '']
failed = False

st, ver = api('/admin/version/')
report.append(f'- version endpoint: HTTP {st} — {json.dumps(ver)[:150]}')
if st != 200:
    failed = True
    report.append('')
    report.append('**Authentik admin API unreachable or token rejected — aborting.**')
else:
    if PHASE == 'apply':
        wanted = [b.strip() for b in os.environ.get('BLUEPRINTS', '').split(',') if b.strip()]
        st_l, listing = api('/managed/blueprints/?page_size=100')
        existing = {i['name']: i for i in listing.get('results', [])} if st_l == 200 else {}
        report.append('')
        report.append(f'### Apply ({", ".join(wanted)})')
        for name in wanted:
            path = f'{BLUEPRINT_DIR}/{name}.yaml'
            try:
                content = open(path).read()
            except FileNotFoundError:
                failed = True
                report.append(f'- {name}: MISSING FILE {path}')
                continue
            inst_name = f'fuzefront-{name}'
            body = {'name': inst_name, 'content': content, 'enabled': True}
            if inst_name in existing:
                uuid = existing[inst_name]['pk']
                st_u, resp = api(f'/managed/blueprints/{uuid}/', 'PATCH', body)
            else:
                st_u, resp = api('/managed/blueprints/', 'POST', body)
                uuid = resp.get('pk')
            if st_u not in (200, 201) or not uuid:
                failed = True
                report.append(f'- {name}: UPSERT FAILED HTTP {st_u} — {json.dumps(resp)[:250]}')
                continue
            st_a, _ = api(f'/managed/blueprints/{uuid}/apply/', 'POST', {})
            st_g, after = api(f'/managed/blueprints/{uuid}/')
            status = after.get('status', '?')
            last = after.get('last_applied', '?')
            # apply/ may run async in some versions — 'unknown' right after the
            # call is not a failure; only definitive error states are.
            if st_a not in (200, 201, 204) or status in ('error', 'orphaned'):
                failed = True
            report.append(f'- {name}: upsert HTTP {st_u}, apply HTTP {st_a}, status **{status}**, last_applied {last}')

    report.append('')
    report.append('### State')
    st_b, brands = api('/core/brands/?page_size=50')
    if st_b == 200:
        for b in brands.get('results', []):
            has_css = 'yes' if b.get('branding_custom_css') else 'no'
            report.append(f"- brand: domain=`{b.get('domain')}` default={b.get('default')} title={b.get('branding_title')!r} css={has_css}")
    else:
        report.append(f'- brands: HTTP {st_b}')
    st_f, flows = api('/flows/instances/?page_size=100')
    if st_f == 200:
        slugs = sorted(f.get('slug') for f in flows.get('results', []))
        report.append(f'- flows: {", ".join(slugs)}')
    else:
        report.append(f'- flows: HTTP {st_f}')
    st_s, sources = api('/sources/all/?page_size=50')
    if st_s == 200:
        for s_ in sources.get('results', []):
            report.append(f"- source: `{s_.get('slug')}` ({s_.get('verbose_name')}) enabled={s_.get('enabled')}")
    else:
        report.append(f'- sources: HTTP {st_s}')
    st_m, insts = api('/managed/blueprints/?page_size=100')
    if st_m == 200:
        report.append('')
        report.append('### Blueprint instances')
        for i in insts.get('results', []):
            report.append(f"- `{i.get('name')}` path=`{i.get('path')}` status=**{i.get('status')}** enabled={i.get('enabled')} last_applied={i.get('last_applied')}")
    else:
        report.append(f'- blueprint instances: HTTP {st_m}')

open('report.md', 'w').write('\n'.join(report) + '\n')
print('\n'.join(report))
# Non-zero exit when anything went wrong so BOTH callers fail loudly (red
# workflow run / failed in-cluster Job visible in Argo) instead of green-lying.
sys.exit(1 if failed else 0)
