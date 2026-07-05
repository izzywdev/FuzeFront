# Service Discovery on Kubernetes

> **Superseded:** This document originally described a Docker Compose problem —
> container IPs changing on restart and a shared nginx (`fuzeinfra-nginx`) caching
> stale upstreams, worked around with a DNS-resolver nginx config and a Python
> `nginx-updater.py` service-discovery tool. **On Kubernetes none of that applies:**
> Services provide stable virtual IPs and DNS names, and CoreDNS handles resolution
> automatically. The legacy approach below is retained only for historical context
> at the end.

## How it works now

FuzeFront and FuzeInfra both run in the same cluster (local **kind** `fuzeinfra`,
prod Contabo **k3s**), in separate namespaces:

- `fuzefront` — `fuzefront-frontend` (svc :8080) and `fuzefront-backend` (svc :3001)
- `fuzeinfra` — `postgres` (svc :5432) and `redis` (svc :6379)

Each Kubernetes **Service** has a stable ClusterIP and a stable DNS name. Pods can
restart and get new pod IPs as often as they like — the Service IP/name never
changes, so there is nothing to "re-resolve" or cache-bust.

### Cross-namespace DNS (CoreDNS)

Services are addressable by fully-qualified name across namespaces:

```
<service>.<namespace>.svc.cluster.local
```

So the backend reaches the shared infra at:

```
postgres.fuzeinfra.svc.cluster.local:5432
redis.fuzeinfra.svc.cluster.local:6379
```

These are set in the Helm values (`fuzeinfra.postgres.host` / `fuzeinfra.redis.host`)
and injected into the backend's environment. Within the `fuzefront` namespace,
short names work too (e.g. `fuzefront-backend:3001`).

### Browser → app routing (Ingress)

External traffic enters through the **ingress-nginx** controller (host ports
80/443), provided by FuzeInfra. The `fuzefront` Ingress routes the host to the
frontend Service:

- Local: `fuzefront.dev.local` → `fuzefront-frontend:8080`
- Prod: `app.fuzefront.com` → `fuzefront-frontend:8080` (TLS via cert-manager)

The frontend pod's **in-pod nginx** serves the SPA and proxies `/api` and
`/socket.io` to `fuzefront-backend:3001`. Because it proxies to a Service name, the
backend can be scaled or restarted freely — kube-proxy load-balances across the
healthy backend pods.

```
browser
  └─▶ ingress-nginx (:80/:443)
        └─▶ fuzefront-frontend (svc :8080, in-pod nginx)
              ├─ serves the React host shell (Module Federation container)
              └─ proxies /api + /socket.io ─▶ fuzefront-backend (svc :3001)
                                                └─▶ postgres.fuzeinfra.svc / redis.fuzeinfra.svc
```

## Verifying

```bash
# Services and endpoints
kubectl -n fuzefront get svc,endpoints
kubectl -n fuzeinfra  get svc

# Cross-namespace DNS resolution from a fuzefront pod
kubectl -n fuzefront run dns-test --rm -it --image=busybox --restart=Never -- \
  nslookup postgres.fuzeinfra.svc.cluster.local

# End-to-end through the ingress (after hosts entry for local)
curl http://fuzefront.dev.local/api/health      # local
curl -fsS https://app.fuzefront.com/api/health   # prod
```

When a backend pod is replaced, no manual action is needed — the Service tracks the
new pod automatically:

```bash
kubectl -n fuzefront rollout restart deployment/fuzefront-backend
curl http://fuzefront.dev.local/api/health        # still works
```

## Why the old workarounds are gone

| Legacy concern (Docker Compose)              | Kubernetes resolution                         |
| -------------------------------------------- | --------------------------------------------- |
| Container IP changes on restart → 502s       | Service ClusterIP/name is stable              |
| nginx caching stale upstream IPs             | nginx proxies to a Service name; kube-proxy LBs |
| `resolver 127.0.0.11 valid=10s` hack         | CoreDNS resolves Service names cluster-wide   |
| `nginx-updater.py` / service-discovery watcher | Not needed — Services are the discovery layer |
| Manual `docker restart fuzeinfra-nginx`      | `kubectl rollout restart` / self-healing pods |

---

## Legacy (historical, Docker Compose)

The previous design relied on Docker DNS, a shared `fuzeinfra-nginx` container, and
the following workarounds, all now obsolete:

- Enhanced nginx config in `FuzeInfra/infrastructure/shared-nginx/conf.d/fuzefront.conf`
  using `resolver 127.0.0.11 valid=10s ipv6=off;` and per-request DNS resolution.
- A Python service-discovery tool `FuzeInfra/tools/service-discovery/nginx-updater.py`
  plus `docker-compose.service-discovery.yml` and `scripts/nginx-service-manager.ps1`.
- Container startup hooks (`frontend/docker-entrypoint-hooks.sh`,
  `backend/docker-entrypoint-hooks.sh`).

These are no longer part of the deployment path and should not be reintroduced.
