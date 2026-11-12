<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/website/public/brand/surgemedia-logo-dark.svg">
    <img src="apps/website/public/brand/surgemedia-logo-light.svg" alt="SurgeMedia" height="48">
  </picture>
</h1>

[![CI](https://github.com/mahmoud-nb/surge-media/actions/workflows/ci.yml/badge.svg)](https://github.com/mahmoud-nb/surge-media/actions/workflows/ci.yml)
[![License: BUSL-1.1](https://img.shields.io/badge/license-BUSL--1.1-blue)](LICENSE)

**Self-hosted media platform**: store, transform and deliver your images and videos from your own servers, under
your own domain, through one secure headless API — an administration interface for your teams, a REST API for your
applications, on-the-fly image transformations and video processing, with no per-transformation bill and no media
leaving your infrastructure.

[Website and documentation](https://mahmoud-nb.github.io/surge-media/) ·
[Live demo](https://demo.usesurgemedia.com) ·
[Installation and operations guide](setup.md) ·
[Changelog](apps/core/CHANGELOG.md) ·
[Documentation en français](https://mahmoud-nb.github.io/surge-media/fr/)

## Features

- **Administration** — one Media page across the shared library and your projects, folders and tags, projects, users
  with platform and project roles, two-factor
  authentication (TOTP), audit log; English and French, light and dark themes, designed for WCAG 2.2 AA.
- **REST API v1** — publishable and secret project keys, personal and delegated tokens, scopes, expiry and rotation,
  per-project CORS origins, rate limiting, OpenAPI 3.1 specification and interactive documentation.
- **Images** — resize, crop, focal point, rotate and convert (JPEG, PNG, WebP, AVIF) by changing the delivery URL,
  presets, signed URLs for private media, metadata (EXIF, GPS) always removed.
- **Videos** — direct delivery, posters and subtitles; optional ffmpeg processing (H.264 and AV1 renditions) in
  workers, outside the request path.
- **Your infrastructure** — SQLite, PostgreSQL or MySQL/MariaDB; local disk or any S3-compatible storage; npm
  package or Docker image (amd64, arm64); nothing is ever sent to the publisher.
- **Operations** — a `surge-media` command line to set up, migrate and diagnose an installation (`surge-media
  diagnose` prints a support report without secrets).

## Packages

| Package | Content | License |
| --- | --- | --- |
| [`@surge-media/core`](apps/core) | The platform: administration, API, image and video processing (npm package and Docker image `ghcr.io/mahmoud-nb/surge-media`) | BUSL-1.1 |
| [`@surge-media/client`](packages/client) | Framework-free TypeScript client: API, responsive image and video URLs, uploads, shared component logic and theme | MIT |
| [`@surge-media/vue`](packages/vue) | Vue 3 components: images, `<picture>`, videos, uploads, processing status | MIT |
| [`apps/website`](apps/website) | Public website and documentation (Astro Starlight, English and French) | — |
| [`apps/playground`](apps/playground) | Example application built with the libraries | — |

Components for React and Svelte are planned, on the same `@surge-media/client` base.

## Quick start

With Docker:

```bash
docker run -d --name surge-media -p 127.0.0.1:3000:3000 -v surge-media-data:/app/data \
  -e NUXT_SITE_URL=http://localhost:3000 \
  -e NUXT_BOOTSTRAP_ADMIN_EMAIL=you@example.com -e NUXT_BOOTSTRAP_ADMIN_PASSWORD='a-long-unique-password' \
  ghcr.io/mahmoud-nb/surge-media:latest
```

Or with the npm package (Node.js 24 or later), in the directory that will hold the configuration and the data:

```bash
npm install @surge-media/core
npx surge-media init     # database, port, public URL, migrations, secrets
npx surge-media start
```

Then sign in at `http://localhost:3000/login`. With npm 12 or later, approve the native modules' install scripts
first, and see the [installation guide](setup.md) for production: HTTPS reverse proxy, storage, video processing,
backups, updates and troubleshooting. Compose examples are in [`docker/`](docker).

## Developing

```bash
pnpm install
pnpm db:init     # SQLite by default, or PostgreSQL / MySQL / MariaDB
pnpm dev
```

Requirements and conventions: [setup.md § 18](setup.md#18-developing-surgemedia). Contributions are welcome: read
[CONTRIBUTING.md](CONTRIBUTING.md) first.

## Security

Do not report vulnerabilities in public issues: follow the [security policy](SECURITY.md) (private reporting
through GitHub, supported versions, response times, and how to verify a release).

## License

SurgeMedia is source-available under the **Business Source License 1.1** (SPDX `BUSL-1.1`): see [LICENSE](LICENSE).
It is not an open source license. In short:

- development, testing and evaluation are **free for everyone**;
- production use is **free**, except in three cases that require a commercial license:
  - the organization using it, or on whose behalf it is used, together with its affiliates, had a gross revenue
    above **USD 500,000** in its last completed fiscal year;
  - SurgeMedia is offered to third parties as a **competing hosted service**;
  - a feature that requires a **license key** is used in production without a valid key (no feature requires one
    yet);
- each version becomes available under the **Apache License 2.0** three years after its first public release.

This summary has no legal value: the [LICENSE](LICENSE) file is the only binding text. Commercial licenses and
support: Surge Up, [licensing@surgeup.org](mailto:licensing@surgeup.org).

The front-end libraries `@surge-media/client` and `@surge-media/vue` are under the **MIT license** (the `LICENSE`
file of each package): they are not part of the work covered by the Business Source License.
