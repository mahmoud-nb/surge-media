# @surge-media/core

**surgeMedia** is a self-hosted, modular platform for managing, transforming and delivering media, on your own
infrastructure and under your own domain. This package is its core: the administration interface, the REST API for
your applications, on-the-fly image transformations and video handling.

[Website and documentation](https://mahmoud-nb.github.io/surge-media/) · [Live demo](https://demo.usesurgemedia.com) ·
[Installation and operations guide](https://github.com/mahmoud-nb/surge-media/blob/main/setup.md)

- **Admin interface** — media library, projects, folders, users and roles, two-factor authentication (TOTP) that
  administrators can require, audit log (English and French, light and dark themes, designed for WCAG 2.2 AA).
- **REST API v1** — scoped API keys and tokens, per-project CORS origins, rate limiting, OpenAPI 3.1
  specification and interactive documentation.
- **Images** — resize, crop, rotate and convert (JPEG, PNG, WebP, AVIF) through the delivery URL, with presets,
  focal points and signed URLs for private media.
- **Videos** — upload and direct delivery, posters, WebVTT subtitles and optional ffmpeg processing (H.264 and
  AV1 renditions, run outside the request path).
- **Your choice of infrastructure** — SQLite, PostgreSQL or MySQL/MariaDB; local disk or any S3-compatible
  storage (AWS S3, Cloudflare R2, MinIO…).

For your front ends: [`@surge-media/client`](https://www.npmjs.com/package/@surge-media/client) (framework-free
TypeScript client) and [`@surge-media/vue`](https://www.npmjs.com/package/@surge-media/vue) (Vue 3 components), both
MIT. React and Svelte components are planned.

## Requirements

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 24 or later | |
| Database | SQLite (default), PostgreSQL, MySQL or MariaDB | SQLite suits a single server with moderate traffic |
| ffmpeg and ffprobe | 6 or later (optional) | only for video processing, with the `libx264` and `aac` encoders |

## Getting started

Install the package in the directory that will hold your configuration (`.env`) and data (`data/`):

```bash
mkdir surge-media && cd surge-media
npm install @surge-media/core
npx surge-media init      # database, port and public URL, migrations, secrets, then the declared use of the instance
```

With npm 12 or later, dependency install scripts only run once approved. SQLite needs the one of
`better-sqlite3` (its native module):

```bash
npm install-scripts approve better-sqlite3 @prisma/engines prisma
npm rebuild better-sqlite3 @prisma/engines
```

Add the bootstrap administrator account to `.env` before the first sign-in, then start the server:

```dotenv
NUXT_BOOTSTRAP_ADMIN_EMAIL="you@example.com"
NUXT_BOOTSTRAP_ADMIN_PASSWORD="a-long-unique-password"   # 12 characters minimum
```

```bash
npx surge-media start     # http://localhost:3000 — sign in at /login
```

`init` proposes port 3000, or the next free port when another application already uses it, and writes the
choice to `.env` (`PORT`). If the port is taken when the server starts, `start` stops with a clear message and
exit code 1 instead of failing silently.

Remove the two bootstrap variables once your account exists, turn on two-factor authentication from **My account**,
and require it at least for administrators in **Settings › Security**. `GET /api/health` reports the state of the
database, the storage and the image engine. To update: `npm install @surge-media/core@latest`,
`npx surge-media db migrate`, then restart.

To work on surgeMedia itself, clone the repository and see
[Developing surgeMedia](https://github.com/mahmoud-nb/surge-media/blob/main/setup.md#18-developing-surgemedia) (pnpm 12, `pnpm dev`).

## Running with Docker

The repository's `Dockerfile` builds one image for SQLite, PostgreSQL and MySQL/MariaDB (Debian 13, Node.js 24,
non-root user). The default image includes ffmpeg for video processing; the `slim` target leaves it out.

```bash
docker build -t surge-media .                      # with ffmpeg
docker build --target slim -t surge-media:slim .   # without ffmpeg
```

Prebuilt images for amd64 and arm64 are published on GitHub Container Registry with each release:
`ghcr.io/mahmoud-nb/surge-media:<version>` and `:latest`, or `…-slim` without ffmpeg.

```bash
docker run -d --name surge-media -p 127.0.0.1:3000:3000 -v surge-media-data:/app/data \
  -e NUXT_SITE_URL=https://media.example.com \
  -e NUXT_BOOTSTRAP_ADMIN_EMAIL=you@example.com -e NUXT_BOOTSTRAP_ADMIN_PASSWORD=a-long-unique-password \
  surge-media
```

- `/app/data` holds the SQLite database, locally stored media and the generated secrets: keep it on a volume
  and back it up.
- Pending migrations are applied at startup, and the session, signing and two-factor encryption secrets are
  generated on first start when you do not provide them.
- Another database is a matter of `DATABASE_URL` (`postgresql://…` or `mysql://…`): the provider is inferred from it.
- The image command is `server` (default), `worker` (video processing worker) or `migrate`.
- Port 3000 already taken on the host? Publish another one, such as `-p 127.0.0.1:8080:3000`, or set
  `SURGE_MEDIA_PORT=8080` with the Compose files. The container itself always listens on 3000.
- Sensitive variables can be read from files (Docker secrets) with the `_FILE` suffix, such as
  `NUXT_SMTP_PASSWORD_FILE=/run/secrets/smtp_password`.

Compose examples: [`docker/compose.sqlite.yaml`](https://github.com/mahmoud-nb/surge-media/blob/main/docker/compose.sqlite.yaml)
(single container) and [`docker/compose.postgres.yaml`](https://github.com/mahmoud-nb/surge-media/blob/main/docker/compose.postgres.yaml)
(PostgreSQL and a video processing worker).

## Command-line interface

The package ships a `surge-media` command (`npx surge-media <command>`, or `pnpm cli <command>` from the
repository). It works in the current directory, or the one given by `--cwd`:

| Command | Purpose |
| --- | --- |
| `init` | choose the database (`--provider sqlite\|postgresql\|mysql`, `--url`), the web server port (`--port`, written to `.env` as `PORT`) and the public URL (`--site-url`), apply migrations, generate the missing secrets and declare the use of the instance (`--usage evaluation\|community\|commercial`); `--yes` for non-interactive use |
| `start` | start the server (`--port`, default `PORT` or 3000); stops with exit code 1 if the port is taken |
| `worker` | start a video processing worker (`--port`, default `WORKER_PORT` or 3001) |
| `db migrate` | apply pending migrations after an update |
| `db reset` | recreate the database (confirmation required) |
| `user mfa-reset <email>` | reset an account's two-factor authentication (`--all` when the encryption key is lost) |
| `license usage [value]` | show or declare the use of the instance: `evaluation`, `community` or `commercial` |
| `license clock-reset` | bring the license reference-time mark back to the system clock, after the clock ran ahead by mistake |
| `diagnose` | print a support report without secrets (`--out`, `--json`, `--anonymize`, `--log`) |
| `demo snapshot` / `demo restore` | capture and restore the reference content of a public demo instance |

The CLI speaks French and English: `--lang en`, or `SURGE_MEDIA_LANG=en`.

Every build contains a Prisma client for each database provider, so switching providers needs no rebuild:
configure and migrate the new database with `init` (or `db reset`), then restart. Data is not transferred between
providers.

## Configuration

Configuration is read from environment variables at startup (restart after any change). The essentials:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_PROVIDER` / `DATABASE_URL` | `sqlite` / `file:./data/surge-media.db` | database connection |
| `NUXT_SITE_URL` | — | public URL of your installation (required in production) |
| `NUXT_SESSION_PASSWORD` | generated by `init` | session secret, 32 characters minimum; keep it stable |
| `NUXT_MEDIA_SIGNING_SECRET` | generated by `init` | secret of signed media URLs and delegated tokens |
| `NUXT_MFA_ENCRYPTION_KEY` | generated by `init` | encrypts the two-factor secrets in the database; keep it stable and back it up |
| `NUXT_MEDIA_STORAGE_DRIVER` | `local` | `local` (`NUXT_MEDIA_STORAGE_ROOT`) or `s3` (`NUXT_MEDIA_STORAGE_S3_*`) |
| `NUXT_MEDIA_PUBLIC_URL` | `NUXT_SITE_URL` | base URL of delivered media, for a CDN or a dedicated domain |
| `NUXT_TRUST_PROXY` | `true` | trusted reverse proxies for `X-Forwarded-For` (`true` = loopback and private networks, `false`, or a list of addresses and CIDR ranges) |
| `NUXT_VIDEO_PROCESSING` | `off` | `off`, `embedded` (the web server runs ffmpeg jobs) or `external` (separate workers) |
| `NUXT_SMTP_HOST` / `NUXT_SMTP_FROM` | — | SMTP server and sender, to email invitations and password reset links |
| `NUXT_LICENSE_KEY` | — | commercial license, verified offline; it can also be installed in **Settings › License** |

Every variable is documented in [`.env.example`](https://github.com/mahmoud-nb/surge-media/blob/main/apps/core/.env.example)
(comments in French).

## Delivering and transforming images

Every media file has a stable, cacheable delivery URL. For an image, the transformation and the output format
are part of the URL:

```text
/m/<id>/v<version>/<name>.<ext>                    original file
/m/<id>/v<version>/preview/<name>.webp             built-in 480 px preview
/m/<id>/v<version>/w_800,h_450,q_70/<name>.avif    free parameters, output as AVIF
/m/<id>/v<version>/<preset>/<name>.webp            global or project preset
```

| Parameter | Values | Effect |
| --- | --- | --- |
| `w`, `h` | 1 to 4096 | target width and height (images are never enlarged) |
| `fit` | `cover`, `contain`, `fill`, `inside`, `outside` | how the image fits both dimensions |
| `g` | `focal`, `center`, `north` … `northwest`, `attention`, `entropy` | anchor of `cover` (default: the media's focal point) |
| `crop` | `x-y-width-height` | region to extract, in pixels |
| `r`, `flip` | `90`, `180`, `270` / `h`, `v`, `hv` | rotation and mirroring |
| `dpr` | 1 to 3 | pixel density multiplier |
| `q`, `bg` | 1 to 100 / `rrggbb` | quality and background colour |

Outputs never carry metadata (EXIF, GPS). Public URLs are immutable — a replaced file gets a new version —
and use no cookies, so a CDN can cache them. Private media are delivered through signed, expiring URLs or an
API credential. The library and each project can restrict transformations to presets only.

## REST API

Your applications use `/api/v1` with an `Authorization: Bearer` credential, created in the admin interface:

| Credential | Prefix | Use |
| --- | --- | --- |
| Publishable project key | `sm_pk_` | websites and mobile apps: read public media, from allowed origins |
| Secret project key | `sm_sk_` | your servers only: read, upload, update and delete media |
| Personal token | `sm_pat_` | scripts and CI, limited to its owner's current rights |
| Delegated token | `sm_dt_` | short-lived token your server issues to a browser (uploads, private media) |

```bash
curl -H "Authorization: Bearer sm_sk_…" https://media.example.com/api/v1/projects/<projectId>/media
```

The OpenAPI 3.1 specification is served at `/api/v1/openapi.json`, and the interactive documentation at
`/admin/api` (for signed-in administrators, managers and developers). Errors follow RFC 9457 (`application/problem+json`) with stable error codes.

## Videos

MP4, WebM and QuickTime files are delivered as uploaded; MP4 and MOV files are optimised for streaming and
stripped of location and device data at upload time, without re-encoding. With `NUXT_VIDEO_PROCESSING` enabled, surgeMedia
also uses the system's ffmpeg to produce H.264 (and optionally AV1) renditions, extract posters and accept more
formats (MKV, AVI, 3GP, MPEG-TS, OGV, WMV). Jobs are queued in the database and never run inside a request; the
`external` mode runs them in separate worker processes (`surge-media worker`).

## Production

```bash
npx surge-media db migrate    # after each update
npx surge-media start         # run it under a process manager (systemd, pm2…), or use the Docker image
```

- Serve the application over **HTTPS**, behind a reverse proxy that forwards the original `Host` header and
  appends the client address to `X-Forwarded-For`; do not expose the application port directly.
- Set `NUXT_SITE_URL`, and keep `NUXT_SESSION_PASSWORD`, `NUXT_MEDIA_SIGNING_SECRET` and
  `NUXT_MFA_ENCRYPTION_KEY` stable.
- Back up the database together with the media storage (`NUXT_MEDIA_STORAGE_ROOT` for local storage) and the
  secrets.
- Require two-factor authentication at least for administrators (**Settings › Security**).
- Use PostgreSQL or MySQL for sustained traffic or several processes; SQLite is meant for a single server.
- Raise the upload size limit of your reverse proxy (nginx accepts 1 MB bodies by default).

## Documentation

The installation and operations guide — requirements, Docker and npm installation, every environment variable,
reverse proxy, production checklist, scaling, backups, updates and troubleshooting — is
[`setup.md`](https://github.com/mahmoud-nb/surge-media/blob/main/setup.md). When asking for help, attach the report of
`npx surge-media diagnose`: it contains no secret and no personal data. Security issues: follow the
[security policy](https://github.com/mahmoud-nb/surge-media/blob/main/SECURITY.md), never a public issue.

## Releases

Versions follow [Semantic Versioning](https://semver.org). See the
[changelog](https://github.com/mahmoud-nb/surge-media/blob/main/apps/core/CHANGELOG.md) and the
[GitHub releases](https://github.com/mahmoud-nb/surge-media/releases).

## License

surgeMedia is source-available under the **Business Source License 1.1** (SPDX `BUSL-1.1`). It is not an
open source license. In short:

- development, testing and evaluation are **free for everyone**;
- production use is **free**, except in three cases that require a commercial license:
  - the organization using it, or on whose behalf it is used, together with its affiliates, had a gross revenue
    above **USD 500,000** in its last completed fiscal year;
  - surgeMedia is offered to third parties as a **competing hosted service** (media storage as a service,
    headless media CMS, media transformation or delivery service…);
  - a feature that requires a **license key** is used in production without a valid key (no feature requires
    one yet);
- each version becomes available under the **Apache License 2.0** three years after its first public release.

This summary has no legal value: the [LICENSE](https://github.com/mahmoud-nb/surge-media/blob/main/LICENSE) file
is the only binding text. **Settings › License** (or `surge-media license usage`) records how each instance is
used and installs a commercial license; nothing is checked or sent. Commercial licenses and support: Surge Up,
[licensing@surgeup.org](mailto:licensing@surgeup.org).
