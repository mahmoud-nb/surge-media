---
title: Architecture & APIs
description: How surgeMedia works — a headless media back end with a REST API and URL-based delivery, running on your own infrastructure — and how real applications use it.
---

surgeMedia separates **where your media lives** from **where your media is used**. It is a _headless_ media back end: it imposes no front end, no template and no CMS. Your websites, mobile apps, back-offices and partners consume media over HTTP — from one instance you host, under your own domain.

## The big picture

```text
  Your applications: websites (dev · staging · prod), mobile apps,
  back-offices, CI/CD pipelines, browsers and CDNs
        │                                      │
        │ REST API v1 (Bearer token)           │ GET /m/… (cookieless, cacheable)
        ▼                                      ▼
  ┌────────────────────────────────────────────────────────────┐
  │ surgeMedia — on your server, under your domain             │
  │   /api/v1   projects, media, folders, tokens, signed URLs  │
  │   /m/…      delivery and on-the-fly transformations        │
  │   /admin    teams, roles, settings, audit log              │
  │   workers   FFmpeg video jobs, off the request path        │
  └────────────────────────────────────────────────────────────┘
        │ SQL                                  │ files
        ▼                                      ▼
  SQLite · PostgreSQL · MySQL / MariaDB   Local disk or S3-compatible bucket
```

One process serves everything by default. When video traffic grows, video processing moves to dedicated **worker** processes (`docker run … worker`) without changing anything for your applications.

## Building blocks

| Concept | What it is | Why it matters |
| --- | --- | --- |
| **Library** | A shared media space managed by administrators. | Brand assets, logos, shared visuals — read by every team. |
| **Project** | A media space for one application, product or client, with its members, keys, allowed origins and transformation policy. | Clean separation between applications; the unit of access control. |
| **Media** | An image or a video, **versioned** (`v1`, `v2`…). Replacing the file creates a new version and new URLs. | Caches never serve a stale file, and you never need to purge a CDN. |
| **Folders** | A tree inside a project or the library. | Editors organize; the API filters by folder. |
| **Tags** | Global tags (shared by every space) and tags per project; confidential tags stay in the admin. | Cross-cutting classification; the admin and the API filter by tags (at least one, or all). |
| **Presets** | Named transformations (`card`, `og-image`…) at installation or project level. | Change a format everywhere by editing one preset. |
| **Credentials** | Project keys, personal tokens and delegated tokens, each with scopes. | Every request is attributable and limited to what it needs. |

A media item belongs to exactly one space: the library or a project. In the admin, the **Media** page still brings together the library and every project you can access: you search and filter across all of them at once, and each item shows its space. To file into folders, tag in bulk or see the trash, you open a space; an upload always goes to a specific space that you choose.

## Two planes: management and delivery

### The management API — `/api/v1`

A versioned JSON REST API to list, search, upload, update, organize and sign media.

- **Authentication** with a `Bearer` token in the `Authorization` header — never in the URL.
- **Scopes** per credential: `project:read`, `media:read`, `media:upload`, `media:write`, `media:delete`, `tags:manage`.
- **CORS per project**: only the origins you allow (`https://www.acme.com`, `https://*.acme.com`) can call the API from a browser.
- **Predictable**: cursor pagination (`limit`, `cursor` → `nextCursor`), `ETag` / `304 Not Modified`, `RateLimit` headers, and errors in `application/problem+json` with a stable `code` and an `X-Request-Id`.
- **Self-describing**: the OpenAPI 3.1 document is served at `/api/v1/openapi.json` (`?lang=en` or `fr`) and the error catalog at `/api/v1/errors`. The admin includes an interactive reference preloaded with your project's publishable key.

### The delivery plane — `/m/…`

Every media has stable, cookieless, CDN-friendly URLs:

```text
/m/<id>/v<version>/<name>.<ext>                       the original
/m/<id>/v<version>/preview/<name>.webp                a preset
/m/<id>/v<version>/w_800,h_450,fit_cover/<name>.avif  a free transformation
```

Public media are served with long-lived immutable cache headers, so a CDN in front of surgeMedia absorbs the traffic. Private media require a **signed URL** or a `Bearer` token. Videos support HTTP `Range` requests for seeking. See the [image transformations reference](../../reference/image-transformations/).

## Credentials at a glance

| Credential | Prefix | Where it lives | What it can do |
| --- | --- | --- | --- |
| **Publishable key** | `sm_pk_` | Browser, mobile app | Read public media of one project, from allowed origins only. |
| **Secret key** | `sm_sk_` | Your servers, CI/CD | The scopes you grant in one project; expiry, rotation with overlap. Refused if sent from a browser. |
| **Personal access token** | `sm_pat_` | Scripts, migrations | Acts as a user across the projects you select. |
| **Delegated token** | `sm_dt_` | Browser, for a few minutes | Issued by your server for one user and one task (e.g. "upload 5 JPEGs into this folder"). |

Details and best practices: [Security & access control](../security/).

## Real-world examples

The examples below use `https://media.example.com` as the surgeMedia instance and `$PROJECT` as a project ID.

### 1. Product pages that load fast everywhere

An e-commerce site lists the photos of a product and renders responsive images — the same code in development, staging and production.

```ts
// Server side (Node, Next.js, Nuxt…): the secret key never reaches the browser.
const res = await fetch(
  `https://media.example.com/api/v1/projects/${PROJECT}/media?q=sneaker-air&kind=image&limit=12`,
  { headers: { Authorization: `Bearer ${process.env.SURGE_MEDIA_SECRET_KEY}` } },
);
const { items } = await res.json();

// Each media carries a URL template: fill it in for every size and format.
const src = (media, transform, format) =>
  media.urlTemplate.replace('{transform}', transform).replace('{format}', format);

const srcset = [400, 800, 1200].map((w) => `${src(items[0], `w_${w}`, 'avif')} ${w}w`).join(', ');
```

**Business impact:** modern formats (AVIF, WebP) and right-sized images without a build step or a paid image CDN; marketers change visuals without a deployment.

### 2. Uploads straight from the browser, without proxying files

A marketplace lets sellers upload product photos. Your back end authenticates the seller, then asks surgeMedia for a **delegated token** limited to that seller and that task:

```bash
curl -X POST "https://media.example.com/api/v1/projects/$PROJECT/delegated-tokens" \
  -H "Authorization: Bearer $SURGE_MEDIA_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "scopes": ["media:upload"],
    "subject": "seller-42",
    "origin": "https://sell.acme.com",
    "expiresIn": 900,
    "upload": { "maxFiles": 5, "maxSize": 10485760, "types": ["image/jpeg", "image/png", "image/webp"] }
  }'
# → 201 { "token": "sm_dt_…", "expiresAt": "…", "scopes": ["media:upload"] }
```

The browser then uploads directly to `POST /api/v1/projects/$PROJECT/media` with that token. File type (detected from the content, not the extension), size and count are enforced by surgeMedia; the token expires on its own and dies immediately if the issuing key is revoked.

**Business impact:** no upload traffic through your application servers, no long-lived secret in the browser, and every file traceable to the seller who sent it.

### 3. Private media for members only

An HR portal or a premium content site stores media as **private**. When a member opens a page, your server requests short-lived signed links — up to 100 in one call:

```bash
curl -X POST "https://media.example.com/api/v1/projects/$PROJECT/signed-urls" \
  -H "Authorization: Bearer $SURGE_MEDIA_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "expiresIn": 600, "items": [
        { "mediaId": "k7d2m9qz", "preset": "card", "format": "webp" },
        { "mediaId": "p1x8w3rt", "target": "file" } ] }'
```

**Business impact:** links shared outside the portal stop working after ten minutes; access stays under your own authentication.

### 4. One library for dev, staging and production

Every environment of an application uses the **same project** with its own keys, tagged `development`, `staging` or `production`. Content uploaded by editors in production is immediately available to developers in staging, with the same IDs and the same URLs. Rotating a staging key never affects production. See [One source of truth for every environment](../environments/).

### 5. Video that just plays

Upload an MP4 or a MOV: surgeMedia moves the index to the front for instant playback, removes GPS location tracks, extracts a poster image and accepts WebVTT or SRT subtitles. With FFmpeg enabled, it also produces H.264 and AV1 renditions — returned in the `sources` array of the media, ready for a `<video>` element.

## Performance and scaling

- **Generated once, served forever**: a transformation runs on the first request, then the file is stored and served with immutable caching. Equivalent requests share the same file.
- **Bounded work**: image processing runs in a bounded queue; under pressure, surgeMedia answers `503` with `Retry-After` instead of collapsing.
- **Horizontal video processing**: FFmpeg jobs live in a persistent queue processed by one or more workers, out of the request path.
- **Database of your choice**: SQLite for a single server, PostgreSQL or MySQL / MariaDB for several instances behind a load balancer.

## Next steps

- [Install surgeMedia](../getting-started/) in a few minutes.
- [Secure your integration](../security/) with the right credential for each context.
- [Choose a plan](../../pricing/) — free under USD 500k annual revenue.
