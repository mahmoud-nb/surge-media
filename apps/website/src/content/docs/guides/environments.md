---
title: One source of truth for every environment
description: Use the same media library from development, staging and production, with per-environment keys and origins — and stop copying uploads between stages.
---

Most teams end up with one media bucket per environment: editors upload in production, developers copy files to staging by hand, and local environments show broken images. SurgeMedia removes the problem at the root: **every environment reads the same media**, each with its own credentials.

## Before and after

| <span class="sr-only">Aspect</span> | One bucket per environment | SurgeMedia |
| --- | --- | --- |
| Where media live | Copied into each environment | One project, one library |
| Staging shows real content | Only after a manual sync | Always — same IDs, same URLs |
| Local development | Missing or fake images | The real media, read-only if you want |
| Key compromised on staging | Often shared with production | Revoke the staging key only |
| Onboarding a new developer | Credentials for every bucket | One publishable key for their local setup |

## Set it up

1. **One project per application** (or per client, for agencies). The project holds the media, the members and the policies.
2. **One key per environment**, labeled `development`, `staging` or `production` (any label works: `preview`, `qa`…). The admin groups keys by environment.
3. **Allowed origins** for each front end: `http://localhost:5173`, `https://staging.acme.app`, `https://www.acme.com` — or `https://*.acme.app` for preview deployments.
4. **Configure each environment** with the same project ID and its own keys:

```bash
# .env.development
SURGE_MEDIA_API_URL=https://media.acme.com/api/v1
SURGE_MEDIA_PROJECT_ID=cm3k…
SURGE_MEDIA_PUBLISHABLE_KEY=sm_pk_…   # development key
SURGE_MEDIA_SECRET_KEY=sm_sk_…        # development key, read-only scopes

# .env.production — same URL and project, production keys
```

## Good practices

- **Give non-production keys only what they need.** A development secret key with `media:read` only cannot alter production content.
- **Isolate destructive tests** in a separate sandbox project, or in a dedicated folder that test uploads go to (delegated tokens can impose the folder).
- **Rotate keys per environment.** Rotating the staging key never affects production; the overlap period lets you redeploy without downtime.
- **Version-safe URLs.** Replacing a file creates a new media version and new URLs: environments that still reference the old version keep working until they refresh.

## Related

- [Security & access control](../security/)
- [Architecture & APIs](../architecture/)
