# surgeMedia — Installation and operations guide

This guide is for the teams who install and run surgeMedia on their own infrastructure: requirements, installation
with Docker or npm, configuration, reverse proxy, production checklist, backups, updates and troubleshooting.

surgeMedia is a self-hosted media platform: an administration interface, a REST API for your applications,
on-the-fly image transformations and video delivery. It stores nothing outside your infrastructure and never
contacts its publisher.

- Product overview, API usage and front-end components: [`apps/core/README.md`](apps/core/README.md) and the
  [documentation website](https://mahmoud-nb.github.io/surge-media/).
- Security policy and vulnerability reporting: [`SECURITY.md`](SECURITY.md).
- License: [`LICENSE`](LICENSE) (Business Source License 1.1, summarised in § 19).

> surgeMedia is in pre-release (0.x). Until 1.0, a minor version may contain breaking changes, always listed in
> the [changelog](apps/core/CHANGELOG.md). Start with a pilot project and read the changelog before each update.

---

## 1. Overview

An installation has up to four parts:

| Part | Role | Required |
| --- | --- | --- |
| Web server | Administration interface (`/admin`), REST API (`/api/v1`), media delivery (`/m/…`), health probe (`/api/health`) | Yes |
| Database | Users, projects, media metadata, settings, audit log, video job queue | Yes: SQLite (built in), PostgreSQL, or MySQL/MariaDB |
| Media storage | Original files and generated derivatives | Yes: local disk or any S3-compatible bucket |
| Video worker | Runs ffmpeg jobs outside the web server | Optional (`external` video processing mode) |

The same build serves all three databases: switching provider needs no rebuild. Every setting comes from
environment variables, read once at startup.

## 2. Requirements

| Component | Version | Notes |
| --- | --- | --- |
| Operating system | Linux (amd64 or arm64) recommended for production | Windows and macOS work for evaluation; ffmpeg memory limits (`prlimit`) exist on Linux only |
| Docker (Docker method) | A recent Docker Engine with Compose v2 | Images for `linux/amd64` and `linux/arm64` |
| Node.js (npm method) | 24 or later | npm 11 or 12 |
| Database | SQLite (bundled), PostgreSQL, MySQL or MariaDB | Verified with PostgreSQL 17 and MariaDB 11; MySQL 8 is supported but not yet verified |
| Object storage | Optional: AWS S3 or an S3-compatible service (Cloudflare R2, MinIO, Scaleway, OVHcloud, Backblaze B2…) | Verified so far against an S3 emulator; please report any provider issue |
| ffmpeg and ffprobe | 6 or later, with the `libx264` and `aac` encoders | Only for video processing; included in the full Docker image (ffmpeg 7.1) |
| Reverse proxy | nginx, Caddy, Traefik, or a load balancer | Required in production for HTTPS (§ 11) |

**Sizing — starting points, to measure on your own hardware.** In load tests, one busy server process used
about 570 MB of memory. A 1080p H.264 encode costs about 1.7 CPU-seconds per second of video and 0.4 to
0.75 GiB of memory.

| Profile | CPU | Memory | Disk |
| --- | --- | --- | --- |
| Evaluation, pilot | 1 vCPU | 1 GB | Media + database + temporary space for uploads |
| Production, images only | 2 vCPU | 2 GB | Same, plus derivatives (several small files per image) |
| Production with video processing | 4 vCPU or more | 4 GB + 1 GB per concurrent video job | Plus one rendition per processed video and temporary space per job (§ 10) |

Uploads are written to the system temporary directory (`TMPDIR`) before they reach the storage: plan for
*simultaneous uploads × maximum upload size* of free space there.

## 3. Choosing an installation method

| Method | Best for | Database | Video processing |
| --- | --- | --- | --- |
| Docker Compose, SQLite (`docker/compose.sqlite.yaml`) | One server, moderate traffic, simplest operations | SQLite in the data volume | `off` or `embedded` |
| Docker Compose, PostgreSQL (`docker/compose.postgres.yaml`) | Production with videos, room to grow | PostgreSQL 17 container | `external`, with a worker container |
| npm package (`@surge-media/core`) | Servers without Docker, managed by systemd or pm2 | Any | Any (ffmpeg installed on the host) |

## 4. Installing with Docker

### 4.1 Images

Each release publishes multi-architecture images (amd64, arm64) on GitHub Container Registry:

| Image | Content |
| --- | --- |
| `ghcr.io/mahmoud-nb/surge-media:<version>` (such as `0.1.0`), `:<major>.<minor>`, `:latest` | Full image, with ffmpeg 7.1 (H.264, AAC, SVT-AV1, Opus): video processing available |
| The same tags with `-slim` (`0.1.0-slim`, `latest-slim`) | Without ffmpeg: `NUXT_VIDEO_PROCESSING` must stay `off` |

Both run Debian 13 and Node.js 24 as the non-root user `node` (uid 1000), with `tini` as PID 1 and a built-in
`HEALTHCHECK` on `/api/health`. Pin a version in production rather than `latest`.

You can also build the image from the repository: `docker build -t surge-media .` (full) or
`docker build --target slim -t surge-media:slim .`.

### 4.2 Quick start

```bash
docker run -d --name surge-media \
  -p 127.0.0.1:3000:3000 \
  -v surge-media-data:/app/data \
  -e NUXT_SITE_URL=https://media.example.com \
  -e NUXT_BOOTSTRAP_ADMIN_EMAIL=you@example.com \
  -e NUXT_BOOTSTRAP_ADMIN_PASSWORD='a-long-unique-password' \
  --stop-timeout 30 \
  ghcr.io/mahmoud-nb/surge-media:latest
```

Then put a reverse proxy with HTTPS in front of `127.0.0.1:3000` (§ 11) and sign in at
`https://media.example.com/login` (§ 6). On first start, the container applies the database migrations and
generates the session and signing secrets in the volume.

For a quick local trial without HTTPS, use `NUXT_SITE_URL=http://localhost:3000` and open
`http://localhost:3000/login` (the secure session cookie is accepted on `localhost` only).

### 4.3 Docker Compose

Two ready-made files are in [`docker/`](docker):

```bash
# One container, SQLite, data in a named volume
NUXT_SITE_URL=https://media.example.com docker compose -f docker/compose.sqlite.yaml up -d

# Web server + video worker + PostgreSQL 17
POSTGRES_PASSWORD='change-me' NUXT_SITE_URL=https://media.example.com \
  docker compose -f docker/compose.postgres.yaml up -d
```

Variables can also live in a `docker/.env` file next to the Compose files. Useful ones:

| Variable | Default | Role |
| --- | --- | --- |
| `NUXT_SITE_URL` | `http://localhost:<port>` | Public URL of the installation |
| `NUXT_BOOTSTRAP_ADMIN_EMAIL`, `NUXT_BOOTSTRAP_ADMIN_PASSWORD` | — | First administrator (§ 6), to remove afterwards |
| `POSTGRES_PASSWORD` | — (required) | PostgreSQL password (PostgreSQL file only) |
| `SURGE_MEDIA_PORT` | `3000` | Port published on the host, always on `127.0.0.1`; the container listens on 3000 |
| `SURGE_MEDIA_IMAGE` | `ghcr.io/mahmoud-nb/surge-media:latest` | Image to run, for instance a pinned version or a local build |
| `NUXT_VIDEO_PROCESSING` | `off` (SQLite file), `external` (PostgreSQL file) | Video processing mode (§ 10) |

Add any other variable of § 7 to the `environment` section of the services. In the PostgreSQL file, the web
server and the worker share the same variables and the same data volume.

**MySQL or MariaDB:** replace the `postgres` service with, for instance, `mariadb:11`, and set
`DATABASE_URL=mysql://user:password@mariadb:3306/surge_media`.

### 4.4 Image commands

The last argument of `docker run`, or `command:` in Compose, selects what the container does:

| Command | Effect |
| --- | --- |
| `server` (default) | Applies pending migrations, then starts the web server on port 3000 |
| `worker` | Video processing worker (`NUXT_VIDEO_PROCESSING=external`): serves `/api/health` only, never migrates |
| `migrate` | Applies pending migrations, then exits |
| anything else | Executed as is (`sh`, `node -v`…) |

When the database is not reachable yet (database container still starting), migrations are retried 20 times,
3 seconds apart; after that the container stops with exit code 1 and Prisma's output.

### 4.5 Data volume and secrets

`/app/data` holds the SQLite database (`surge-media.db` with its `-wal` and `-shm` files), locally stored media
(`media/`) and generated secrets (`secrets/`). Keep it on a volume and back it up as a whole (§ 15).

- A host directory mounted on `/app/data` must belong to uid 1000: `chown -R 1000:1000 <directory>`.
- The image reads no `.env` file: pass variables with `-e`, `--env-file` or Compose.
- `NUXT_SESSION_PASSWORD` and `NUXT_MEDIA_SIGNING_SECRET`, when not provided, are generated on first start and
  stored in `secrets/` (mode `0600`), then never replaced. Containers on different volumes or hosts must receive
  the same values explicitly.
- Sensitive variables can be read from files (Docker or Kubernetes secrets) with the `_FILE` suffix:
  `DATABASE_URL`, `NUXT_SESSION_PASSWORD`, `NUXT_MEDIA_SIGNING_SECRET`, `NUXT_MEDIA_PREVIOUS_SIGNING_SECRET`,
  `NUXT_MEDIA_STORAGE_S3_ACCESS_KEY_ID`, `NUXT_MEDIA_STORAGE_S3_SECRET_ACCESS_KEY`, `NUXT_SMTP_PASSWORD`,
  `NUXT_BOOTSTRAP_ADMIN_PASSWORD`. Example: `NUXT_SMTP_PASSWORD_FILE=/run/secrets/smtp_password`.
- Allow 30 seconds for shutdown (`--stop-timeout 30`, `stop_grace_period: 30s`) so a running video job is
  handed back to the queue cleanly.

## 5. Installing with the npm package

### 5.1 Install and initialise

Create the directory that will hold the configuration (`.env`) and the data (`data/`), then install the package
there:

```bash
mkdir -p /opt/surge-media && cd /opt/surge-media
npm install @surge-media/core
```

With **npm 12 or later**, dependency install scripts only run once approved. SQLite needs the native module of
`better-sqlite3` (PostgreSQL and MySQL do not):

```bash
npm install-scripts approve better-sqlite3 @prisma/engines prisma
npm rebuild better-sqlite3 @prisma/engines
```

Initialise the installation:

```bash
npx surge-media init
```

`init` asks for the database (SQLite by default), the web server port (3000, or the next free port) and the
public URL, writes `.env`, applies the migrations and generates the session and signing secrets. Non-interactive
form:

```bash
npx surge-media init --yes --provider postgresql \
  --url 'postgresql://surge:password@db.internal:5432/surge_media' \
  --port 3000 --site-url https://media.example.com
```

Add the first administrator to `.env` (§ 6), then start the server:

```bash
npx surge-media start        # listens on PORT (3000 by default)
```

### 5.2 Run as a service

Run the server under a process manager that restarts it on failure. Example systemd unit
(`/etc/systemd/system/surge-media.service`):

```ini
[Unit]
Description=surgeMedia
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=surge-media
WorkingDirectory=/opt/surge-media
ExecStart=/opt/surge-media/node_modules/.bin/surge-media start
Restart=on-failure
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now surge-media
journalctl -u surge-media -f
```

`surge-media start` reads `.env` from its working directory, forwards SIGTERM and SIGINT to the server for a
clean shutdown, and exits with code 1 when its port is already taken. Variables set in the service environment
take precedence over `.env`.

For video processing in `external` mode, add a second unit running `surge-media worker` (port 3001 by default,
`WORKER_PORT`), in the same directory.

### 5.3 Command-line interface

| Command | Purpose |
| --- | --- |
| `init` | Choose the database (`--provider sqlite\|postgresql\|mysql`, `--url`), the port (`--port`) and the public URL (`--site-url`); apply migrations; generate missing secrets. `--yes` for non-interactive use, `--skip-migrate` to only write `.env` |
| `start` | Start the web server (`--port`, else `PORT`, else 3000) |
| `worker` | Start a video processing worker (`--port`, else `WORKER_PORT`, else 3001) |
| `db migrate` | Apply pending migrations (after each update) |
| `db reset` | Recreate the database schema, **deleting its data** (confirmation required; `--yes` to skip it) |

Every command accepts `--cwd <directory>` (installation directory, default: the current one) and `--lang en`
(or `SURGE_MEDIA_LANG=en`; French is the default). `npx surge-media --help` lists the options. The CLI refuses an
installation directory inside `node_modules`.

## 6. First sign-in

There is no public sign-up: accounts are created by administrators. The first one comes from two variables:

1. Set `NUXT_BOOTSTRAP_ADMIN_EMAIL` and `NUXT_BOOTSTRAP_ADMIN_PASSWORD` (12 characters minimum).
2. Start the server and sign in at `/login` with these credentials: the administrator account is created in the
   database, with a hashed password.
3. **Remove both variables and restart.** They only work while no user exists; afterwards they are ignored, but
   the server and the dashboard keep warning until they are removed.

Then invite your colleagues from **Users** (`/admin/users`). Invitation and password reset links can be copied,
or emailed when SMTP is configured (§ 7.8).

## 7. Configuration reference

All settings are environment variables, read **once at startup**: restart after any change. With the npm
package they are usually in `.env` (template: [`apps/core/.env.example`](apps/core/.env.example), commented in
French); with Docker, in the container environment. Variables set in the process environment take precedence
over `.env`.

### 7.1 Installation and URLs

| Variable | Default | Role |
| --- | --- | --- |
| `PORT` | `3000` | Web server port (npm package; the container always uses 3000) |
| `WORKER_PORT` | `3001` | Port of a worker started with `surge-media worker` (health probe only) |
| `NUXT_SITE_URL` | — | **Public URL of the installation** (`https://media.example.com`). Required in production: absolute links, API and OpenAPI URLs are built from it. Without a reverse proxy, include the port |
| `NUXT_MEDIA_PUBLIC_URL` | `NUXT_SITE_URL` | Base URL of delivered media (`/m/…`) when it differs: CDN or dedicated media domain (§ 11.3) |
| `NUXT_TRUST_PROXY` | `true` | Trusted reverse proxies for `X-Forwarded-For`: `true` = loopback and private networks (including Docker networks), `false` = header ignored, or a list of addresses and CIDR ranges with `loopback` and `private` (`"private,203.0.113.10"`) |
| `SURGE_MEDIA_LANG` | system locale, else `fr` | Language of the CLI and of the container's startup messages (`en`, `fr`) |

### 7.2 Database

| Variable | Default | Role |
| --- | --- | --- |
| `DATABASE_PROVIDER` | `sqlite` | `sqlite`, `postgresql` or `mysql` (MySQL and MariaDB). In the Docker image, inferred from `DATABASE_URL` when missing |
| `DATABASE_URL` | `file:./data/surge-media.db` | Connection URL; a relative SQLite path is resolved from the installation directory. Special characters of a password must be URL-encoded (`@` → `%40`) |

### 7.3 Sessions and secrets

| Variable | Default | Role |
| --- | --- | --- |
| `NUXT_SESSION_PASSWORD` | generated | Session cookie secret, 32 characters minimum. Changing it signs everyone out |
| `NUXT_SESSION_MAX_AGE` | `43200` (12 h) | Session lifetime, in seconds |
| `NUXT_SESSION_COOKIE_SECURE` | `true` | Session cookie restricted to HTTPS (`localhost` excepted). Set `false` only for a test over plain HTTP |
| `NUXT_PUBLIC_TRUSTED_DEVICE_DAYS` | `15` | Days during which a browser marked "Trust this device" is not asked again for the password before sensitive actions (365 maximum, `0` disables the option) |
| `NUXT_MEDIA_SIGNING_SECRET` | generated | Secret of signed media URLs and delegated tokens. Changing it invalidates links already shared |
| `NUXT_MEDIA_PREVIOUS_SIGNING_SECRET` | — | Previous signing secret, still accepted during a rotation (keep it 7 days) |
| `NUXT_BOOTSTRAP_ADMIN_EMAIL`, `NUXT_BOOTSTRAP_ADMIN_PASSWORD` | — | First administrator (§ 6); remove after the first sign-in |

"Generated" means: by `surge-media init` (npm) or on the container's first start (Docker), and never replaced
afterwards.

### 7.4 Media storage

| Variable | Default | Role |
| --- | --- | --- |
| `NUXT_MEDIA_STORAGE_DRIVER` | `local` | `local` (server disk) or `s3` |
| `NUXT_MEDIA_STORAGE_ROOT` | `./data/media` | Directory of the `local` driver (relative to the installation directory, or absolute) |
| `NUXT_MEDIA_STORAGE_PREFIX` | — | Prefix of every key, to share a bucket between installations (`prod/`) |
| `NUXT_MEDIA_STORAGE_S3_BUCKET` | — | Bucket name |
| `NUXT_MEDIA_STORAGE_S3_REGION` | — | Region (`eu-west-3`; `auto` for Cloudflare R2) |
| `NUXT_MEDIA_STORAGE_S3_ENDPOINT` | — | Empty for AWS; endpoint of a compatible service (`https://<account>.r2.cloudflarestorage.com`) |
| `NUXT_MEDIA_STORAGE_S3_ACCESS_KEY_ID`, `NUXT_MEDIA_STORAGE_S3_SECRET_ACCESS_KEY` | — | Credentials |
| `NUXT_MEDIA_STORAGE_S3_FORCE_PATH_STYLE` | `false` | `true` for MinIO and other path-style services |

### 7.5 Uploads and images

| Variable | Default | Role |
| --- | --- | --- |
| `NUXT_MEDIA_MAX_UPLOAD_SIZE` | `26214400` (25 MiB) | Maximum size of an uploaded image, in bytes |
| `NUXT_MEDIA_MAX_VIDEO_UPLOAD_SIZE` | `536870912` (512 MiB) | Maximum size of an uploaded video, in bytes (`2147483647` at most) |
| `NUXT_MEDIA_UPLOAD_TIMEOUT` | `3600` | Seconds allowed to receive a whole upload. An upload with no data for 60 s is stopped in any case |
| `NUXT_MEDIA_VIDEO_PREPARE` | `faststart,metadata` | MP4/MOV preparation at upload, without re-encoding: `faststart` (index at the start, faster playback), `metadata` (location and device data removed), both, or `none` |
| `NUXT_MEDIA_PROCESSING_CONCURRENCY` | `0` (= CPU cores) | Simultaneous image operations (upload analysis, previews) |
| `NUXT_MEDIA_PROCESSING_QUEUE` | `100` | Waiting image operations beyond that; a full queue answers 503 `SERVER_BUSY` with `Retry-After` |
| `NUXT_MEDIA_TRANSFORM_MAX_DIMENSION` | `4096` | Maximum width and height of a transformed image |
| `NUXT_MEDIA_TRANSFORM_FORMATS` | `jpg,png,webp,avif` | Enabled output formats |
| `NUXT_MEDIA_TRANSFORM_MAX_VARIANTS` | `50` | Derivatives per media version; beyond, new free parameters are refused (429 `TRANSFORM_QUOTA`) |
| `NUXT_MEDIA_TRANSFORM_RATE_LIMIT` | `60` | New unsigned free transformations per client IP and per minute; `0` = no limit (raise it behind a CDN) |
| `NUXT_MEDIA_TRANSFORM_PRESET_MAX_AGE` | `604800` (7 days) | Cache lifetime of URLs using a global or project preset |

### 7.6 Video processing

| Variable | Default | Role |
| --- | --- | --- |
| `NUXT_VIDEO_PROCESSING` | `off` | `off`, `embedded` (the web server runs the jobs) or `external` (separate workers) — § 10 |
| `NUXT_SERVER_ROLE` | `web` | `worker` for a worker process (set by `surge-media worker` and the image's `worker` command) |
| `NUXT_FFMPEG_PATH`, `NUXT_FFPROBE_PATH` | `ffmpeg`, `ffprobe` | Binaries, from the `PATH` or as full paths |
| `NUXT_VIDEO_CONCURRENCY` | `1` | Simultaneous jobs per process (1 to 16) |
| `NUXT_VIDEO_THREADS` | `0` (= half the cores) | Threads per ffmpeg run (16 at most) |
| `NUXT_VIDEO_RENDITION` | `auto` | H.264 rendition: `auto` (only when useful: HEVC, 4K, HDR…), `always`, `never` (except converted formats) |
| `NUXT_VIDEO_PRESET`, `NUXT_VIDEO_CRF` | `veryfast`, `23` | x264 preset (`ultrafast` … `veryslow`) and quality (0 to 51, lower = better and heavier) |
| `NUXT_VIDEO_AV1` | `off` | Also produce an AV1/Opus rendition (`on`; needs `libsvtav1` and `libopus`) |
| `NUXT_VIDEO_MAX_DURATION` | `10800` (3 h) | Longest video re-encoded, in seconds |
| `NUXT_VIDEO_MEMORY_LIMIT` | `4096` | MiB of address space per ffmpeg run (Linux, `prlimit`); `0` = no limit |

An invalid `NUXT_VIDEO_*` value falls back to its default, with a warning at startup. Each process applies its
own variables: give workers the same values as the web server.

### 7.7 API rate limits

Requests per minute on `/api/v1`, counted in each process's memory:

| Variable | Default | Counted per |
| --- | --- | --- |
| `NUXT_API_RATE_LIMIT_PUBLISHABLE` | `300` | Publishable key and client IP |
| `NUXT_API_RATE_LIMIT_SECRET` | `1200` | Secret key |
| `NUXT_API_RATE_LIMIT_PERSONAL` | `1200` | Personal token |
| `NUXT_API_RATE_LIMIT_DELEGATED` | `300` | Delegated token issuer and client IP |
| `NUXT_API_RATE_LIMIT_UPLOADS` | `60` | Uploaded files per credential (on top of the limits above) |
| `NUXT_API_RATE_LIMIT_AUTH_FAILURES` | `30` | Refused credentials per client IP |

### 7.8 Email (SMTP)

Optional. With a host and a sender, invitation and password reset links can be emailed from the administration
("Send by email"); without them, links are copied and passed on by hand.

| Variable | Default | Role |
| --- | --- | --- |
| `NUXT_SMTP_HOST` | — | SMTP server (required to send email) |
| `NUXT_SMTP_FROM` | — | Sender, such as `surgeMedia <no-reply@example.com>` (required to send email) |
| `NUXT_SMTP_PORT` | `587` | 587 with STARTTLS, or 465 with `NUXT_SMTP_SECURE=true` |
| `NUXT_SMTP_SECURE` | `false` | TLS from the start of the connection (port 465) |
| `NUXT_SMTP_USER`, `NUXT_SMTP_PASSWORD` | — | Credentials, optional for relays without authentication |

Configure SPF, DKIM and DMARC for the sender's domain, or messages may land in spam.

### 7.9 Docker image only

| Variable | Default | Role |
| --- | --- | --- |
| `SURGE_MEDIA_MIGRATE` | `true` | `false`: the `server` command starts without migrating (extra instances; run `migrate` once instead) |
| `SURGE_MEDIA_SECRETS_DIR` | `/app/data/secrets` | Directory of the generated secrets |
| `<VARIABLE>_FILE` | — | Read a sensitive variable from a file (§ 4.5) |

## 8. Database

| Provider | `DATABASE_URL` example | Use it for |
| --- | --- | --- |
| SQLite (default) | `file:./data/surge-media.db` | One server, moderate traffic, simplest backups |
| PostgreSQL | `postgresql://user:password@host:5432/surge_media` | Production, several processes or servers |
| MySQL / MariaDB | `mysql://user:password@host:3306/surge_media` | Same, when MySQL is your standard |

- Create an empty database and a dedicated user with rights to create tables; surgeMedia creates its schema
  through migrations.
- **SQLite** switches the database to WAL mode at startup and warns if it cannot (network share, read-only file).
  Keep the file on a local disk, never on a network share. One process writes at a time: see § 13 before adding
  processes.
- **Migrations** run automatically when the Docker `server` command starts. With npm, run
  `npx surge-media db migrate` after each update. With SQLite, migrate while the server is stopped ("database
  is locked" otherwise).
- **Changing provider** (`init` or `db reset` with the new URL, then restart) creates an empty schema: data is
  not transferred, and there is no migration tool between providers yet. Choose PostgreSQL or MySQL from the
  start if you expect to grow.

## 9. Media storage

```dotenv
# Local disk (default)
NUXT_MEDIA_STORAGE_DRIVER="local"
NUXT_MEDIA_STORAGE_ROOT="/var/lib/surge-media/media"

# S3 or compatible (example: Cloudflare R2; MinIO: add NUXT_MEDIA_STORAGE_S3_FORCE_PATH_STYLE="true")
NUXT_MEDIA_STORAGE_DRIVER="s3"
NUXT_MEDIA_STORAGE_S3_BUCKET="surge-media"
NUXT_MEDIA_STORAGE_S3_REGION="auto"
NUXT_MEDIA_STORAGE_S3_ENDPOINT="https://<account>.r2.cloudflarestorage.com"
NUXT_MEDIA_STORAGE_S3_ACCESS_KEY_ID="…"
NUXT_MEDIA_STORAGE_S3_SECRET_ACCESS_KEY="…"
```

- Bucket objects stay **private**: every download goes through surgeMedia, which applies visibility, signed URLs
  and transformations. Do not make the bucket public.
- The credentials need to read, write, list and delete objects in the bucket (or under the prefix).
- Switching storage changes neither the API nor the database: copy the existing files (same keys, same prefix)
  to the new location, then restart.
- With several processes or a worker on another machine, every process must see the same files: the same bucket
  and prefix, or the same disk mounted at the same path.
- `GET /api/health` checks that the storage answers.

## 10. Video processing

Without video processing (default `off`), MP4, WebM and QuickTime files are stored and delivered as uploaded;
MP4 and MOV files are only prepared for streaming (index at the start, location and device data removed),
without re-encoding.

With processing enabled, surgeMedia uses the system's ffmpeg, outside the request path, to remove GPS data
tracks, repair browser-recorded WebM files, extract a poster, produce an H.264 rendition when the original is
not widely playable (HEVC, 4K, HDR…), optionally an AV1 rendition, and accept more formats (MKV, AVI, 3GP,
MPEG-TS, OGV, WMV), converted on upload.

| Mode | Who runs the jobs | Use it when |
| --- | --- | --- |
| `off` (default) | Nobody | Images only, or videos delivered as uploaded |
| `embedded` | The web server, with ffmpeg at the lowest priority | One machine, few videos |
| `external` | One or more workers (`surge-media worker`, or the image's `worker` command) | Production with regular video uploads; workers can run on other machines |

**Install ffmpeg** (npm method): `apt install ffmpeg` on Debian 13 or Ubuntu 24.04, `winget install Gyan.FFmpeg` on
Windows. Version 6 or later with `libx264` and `aac` is required (Debian 12 and Ubuntu 22.04 ship older
versions). Check with `ffmpeg -version`, then in the administration: **Settings › Video processing** lists the
version, the available encoders and any problem detected. If ffmpeg is missing or unusable, the server starts
normally and logs that video processing is disabled.

**Workers** (`external` mode) need the same database and the same storage as the web server, hence PostgreSQL or
MySQL and shared storage when they run on another machine. Give them the same `NUXT_VIDEO_*` variables, run them
under the same supervision as the web server, and do not expose their port: it only serves `/api/health`.
`GET /api/health` on the web server reports `videoProcessing.workers` (workers seen in the last 5 minutes) and
`videoProcessing.queued` (waiting jobs): alert when workers stay at 0 while the queue grows.

**Resources**, per simultaneous job: about 1.7 CPU-seconds per second of 1080p video (one minute of phone video
takes about 30 seconds on 4 cores; AV1 about 1.5 times more), 0.4 to 0.75 GiB of memory (more in 4K), temporary
space in `TMPDIR` for the outputs plus a copy of the original when the storage is S3, and one more file per
rendition in the storage.

**Hardening** — recommended when third parties can upload videos (API, delegated tokens): run workers as a
non-root user, with a read-only root file system except `TMPDIR` (on a disk volume large enough for the videos,
not an in-memory `tmpfs`) and, with local storage, the media directory; drop all capabilities
(`--cap-drop=ALL --security-opt no-new-privileges`); publish no port; limit their network to the database and
the storage; set container CPU and memory limits on top of `NUXT_VIDEO_CONCURRENCY`, `NUXT_VIDEO_THREADS` and
`NUXT_VIDEO_MEMORY_LIMIT`. Keep ffmpeg up to date: its version is shown in **Settings**.

## 11. Reverse proxy, HTTPS and media domain

Serve surgeMedia over **HTTPS** behind a reverse proxy, and never expose the application port to the Internet:
the examples publish it on `127.0.0.1` only. The proxy must forward the original `Host` header (used by the
cross-site request protection) and **append** the client address to `X-Forwarded-For`.

### 11.1 nginx

```nginx
server {
    listen 443 ssl;
    server_name media.example.com;

    ssl_certificate     /etc/letsencrypt/live/media.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/media.example.com/privkey.pem;

    client_max_body_size 520m;     # at least NUXT_MEDIA_MAX_VIDEO_UPLOAD_SIZE (nginx default: 1 MB)
    client_body_timeout 120s;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_request_buffering off;   # stream uploads instead of buffering them on disk first
        proxy_read_timeout 3600s;      # long uploads
        proxy_send_timeout 3600s;
    }
}
```

Let 503 responses from the application through unchanged: no `proxy_intercept_errors` with an `error_page 503`,
no retry on another server for `http_503` (`proxy_next_upstream`). They carry a `Retry-After` header
(`SERVER_BUSY`, `PROCESSING_PENDING`).

### 11.2 Caddy and Traefik

Caddy obtains certificates, forwards `Host` and appends `X-Forwarded-For` on its own:

```caddyfile
media.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Traefik also appends `X-Forwarded-For` by default; raise its timeouts and body size limits for video uploads.

### 11.3 Client addresses, CDN and media domain

- The real client address is used by rate limits, the audit log, sessions and trusted devices. With the default
  `NUXT_TRUST_PROXY=true`, proxies on loopback and private networks are trusted. A proxy or CDN on a public
  address must be listed: `NUXT_TRUST_PROXY="private,203.0.113.0/24"`. Without any proxy, set `false`.
- A **CDN or cache in front of `/m/`** is recommended in production, especially for video: public media URLs are
  immutable (a replaced file gets a new version) and set no cookie. Making a public media private, or deleting
  it, does not purge copies already cached by browsers or the CDN.
- Behind a CDN, all requests come from a few addresses: list them in `NUXT_TRUST_PROXY`, and raise
  `NUXT_MEDIA_TRANSFORM_RATE_LIMIT` and `NUXT_API_RATE_LIMIT_PUBLISHABLE`, or the CDN's addresses hit the limits.
- A **dedicated media domain** (`NUXT_MEDIA_PUBLIC_URL=https://cdn.example.com`), pointing to the same application
  or to a CDN whose origin is the application, isolates media delivery from the administration session. It is
  the recommended setup in production.

## 12. Production checklist

- [ ] HTTPS reverse proxy in place; application port not reachable from the Internet.
- [ ] `NUXT_SITE_URL` set to the public URL; `NUXT_MEDIA_PUBLIC_URL` set if media use a CDN or their own domain.
- [ ] `NUXT_TRUST_PROXY` matches your proxies and CDN (§ 11.3).
- [ ] Bootstrap variables removed after the first sign-in (§ 6).
- [ ] `NUXT_SESSION_PASSWORD` and `NUXT_MEDIA_SIGNING_SECRET` stored safely, identical on every process, and
      included in backups.
- [ ] Upload size and timeouts aligned between surgeMedia and the proxy (§ 11.1); enough space in `TMPDIR`.
- [ ] Database: PostgreSQL or MySQL if more than one process or sustained traffic (§ 13).
- [ ] Backups of the database, the media storage and the secrets, with a restore test (§ 15).
- [ ] `/api/health` monitored; logs collected (§ 14).
- [ ] Video processing: ffmpeg up to date, workers supervised and hardened (§ 10).
- [ ] A retention policy for the audit log: there is no automatic purge yet.
- [ ] Users invited with the least role they need; API secret keys only on your servers.

Not available yet, to take into account in your security assessment: multi-factor authentication and single
sign-on (SSO) for the administration, an account recovery command when every administrator is locked out, and
shared rate limits across instances (each process counts its own).

## 13. Scaling

**Measured** on a laptop (8 cores, 32 GB, SQLite, local storage, one Node.js process): with a mix of previews,
transformations, original files and API calls, about **1,650 requests per second and 1.5 Gbit/s per process**,
from 16 to 512 simultaneous connections, with no errors and stable memory (about 570 MB); only latency grows.
Measure on your own hardware before sizing.

- **SQLite** blocks the process during each query and while another process holds the write lock. Stay on SQLite
  with **one web server process** and moderate traffic (an `external` video worker on the same machine is fine:
  it writes rarely). The dashboard warns administrators when the SQLite database is under pressure (waits,
  slow operations, time spent in the database): that is the signal to move to PostgreSQL or MySQL.
- **Beyond one process**: PostgreSQL or MySQL, shared storage (S3, or the same disk on every machine), then
  several web server instances behind a load balancer. Run migrations once (`migrate` command, or
  `SURGE_MEDIA_MIGRATE=false` on the extra instances) and give every instance the same secrets.
- Rate limits and in-memory caches are **per process**: with *n* instances, each limit is effectively
  multiplied by *n*.
- The largest gain usually comes from a **CDN in front of `/m/`** (§ 11.3): revalidated and cached media cost the
  server almost nothing.
- `NUXT_MEDIA_PROCESSING_CONCURRENCY` bounds image work per process: lower it on machines with little memory (a
  decoded 100-megapixel image takes several hundred MB).

## 14. Health checks and monitoring

`GET /api/health` answers **200** when the database, the storage and the image engine respond, **503** otherwise:

```json
{
  "status": "ok",
  "checks": { "database": "ok", "storage": "ok", "imageProcessing": "ok" },
  "videoProcessing": { "mode": "external", "workers": 1, "queued": 0 }
}
```

- It reveals neither host nor version and can serve as the probe of Docker (built in), Kubernetes or a load
  balancer. `videoProcessing` never changes the status (`null` values in `off` mode).
- Logs go to the standard output: `docker logs`, `journalctl`, or your log collector. Some server messages are
  in French only.
- The administration dashboard shows warnings to administrators: bootstrap variables still set, SQLite under
  pressure, video processing problems (**Settings › Video processing**).
- The audit log (`/admin/audit`) records changes to users, projects and members, API keys, tokens and origins,
  presets and settings, and sensitive media actions (visibility, move, deletion), with the real client address
  when `NUXT_TRUST_PROXY` is right. Sign-ins are not recorded there yet.

## 15. Backup and restore

Back up together:

| What | Where |
| --- | --- |
| Database | SQLite file with its `-wal` and `-shm` files, or your PostgreSQL / MySQL database |
| Media | `NUXT_MEDIA_STORAGE_ROOT` (local storage), or the bucket (versioning or replication on your side) |
| Secrets | `NUXT_SESSION_PASSWORD` and `NUXT_MEDIA_SIGNING_SECRET`: `.env`, your secret store, or `/app/data/secrets` in Docker |
| Configuration | `.env`, Compose files, proxy configuration |

```bash
# SQLite, server running (sqlite3 command-line tool)
sqlite3 data/surge-media.db ".backup 'surge-media-backup.db'"

# PostgreSQL
pg_dump -Fc -d surge_media -f surge-media.dump

# MySQL / MariaDB
mysqldump --single-transaction surge_media > surge-media.sql

# Docker volume (SQLite + local media + secrets), container stopped
docker stop surge-media
docker run --rm -v surge-media-data:/data -v "$PWD":/backup debian:13-slim \
  tar czf /backup/surge-media-data.tgz -C /data .
docker start surge-media
```

Back up the database first, then the media: files added in between are only unreferenced. For a strictly
consistent copy, stop the server or snapshot the volume. To restore, install the **same surgeMedia version** as
the backup, restore the database, the media and the secrets, then start it. Test a restore regularly.

## 16. Updating

Read the [changelog](apps/core/CHANGELOG.md) and the release notes first (breaking changes are possible before
1.0), and back up (§ 15).

```bash
# npm package
npm install @surge-media/core@<version>
npx surge-media db migrate          # SQLite: with the server stopped
sudo systemctl restart surge-media  # and the workers

# Docker Compose (pin the new version in SURGE_MEDIA_IMAGE or the Compose file)
docker compose -f docker/compose.postgres.yaml pull
docker compose -f docker/compose.postgres.yaml up -d   # the server applies migrations at startup
```

Update the web server and the workers to the same version. Downgrading is not supported once new migrations
have run: restore the backup instead.

## 17. Troubleshooting

| Symptom | Cause and solution |
| --- | --- |
| Sign-in accepted, then back to `/login` | Session cookie refused over plain HTTP: serve over HTTPS (or `localhost`); `NUXT_SESSION_COOKIE_SECURE=false` for a test only |
| First sign-in refused | A user already exists, the bootstrap variables are missing, or the password has fewer than 12 characters (the server logs the reason at startup) |
| `403 Cross-origin request blocked` | The proxy rewrites the `Host` header, or a modifying request comes from another origin |
| `NUXT_SESSION_PASSWORD … was not set` | Run `surge-media init`, or set a secret of 32 characters or more |
| `start` stops at once with exit code 1 | Port already used: another `--port`/`PORT`, or stop the other application; update `NUXT_SITE_URL` if it contains the port |
| `start` refuses to run with SQLite (npm 12) | Install scripts not approved: `npm install-scripts approve better-sqlite3 @prisma/engines prisma`, then `npm rebuild better-sqlite3 @prisma/engines` |
| "database is locked" during a migration | SQLite held by the running server: stop it while migrating (the Docker `server` command migrates on its own) |
| Docker: "cannot write /app/data/secrets" | Host directory not owned by uid 1000: `chown -R 1000:1000 <directory>`, or provide both secrets |
| Docker: container stops after "database unreachable (20/20)" | `DATABASE_URL` wrong (service name, port, password not URL-encoded) or network not shared |
| Links to media built with `http://localhost` | `NUXT_SITE_URL` (or `NUXT_MEDIA_PUBLIC_URL`) missing or wrong |
| Audit log or rate limits see the proxy address (`172.x`, `10.x`) | Proxy on a public address not listed in `NUXT_TRUST_PROXY`, or proxy not appending `X-Forwarded-For` |
| 413 on uploads | Proxy body limit below the upload limit (`client_max_body_size`) |
| 408 `UPLOAD_TIMEOUT` | No data for 60 s: connection lost, or proxy buffering the whole body (`proxy_request_buffering off`) |
| Video upload cut after exactly 5 minutes | `NUXT_MEDIA_UPLOAD_TIMEOUT` or the proxy timeouts too low |
| 503 `SERVER_BUSY` | Image queue full: retry after `Retry-After`; adjust `NUXT_MEDIA_PROCESSING_*` |
| 429 `TRANSFORM_QUOTA` on `/m/` | 50 derivatives for this media version (reuse sizes or presets), or too many new transformations from one address (CDN: raise `NUXT_MEDIA_TRANSFORM_RATE_LIMIT`, list it in `NUXT_TRUST_PROXY`) |
| Private image broken on an external page after a secret change | Old links were signed with the previous secret: set it in `NUXT_MEDIA_PREVIOUS_SIGNING_SECRET` for 7 days |
| Upload refused with 415 | Format not accepted (HEIC, TIFF, SVG…), or MKV/AVI/… while video processing is inactive |
| "Video processing disabled: ffmpeg not found or unusable" at startup | Install ffmpeg 6+ with `libx264` and `aac`, or set `NUXT_FFMPEG_PATH`/`NUXT_FFPROBE_PATH`, then restart |
| Settings: "no worker able to process has reported in 5 minutes" | No worker running, a worker on another database, or a worker stopped (see its log); allow 30 s after a worker starts |
| Worker log: "media files not found in the configured storage" | Storage not shared with the web server: same bucket and prefix, or same disk at the same path |
| Video returns 503 `PROCESSING_PENDING` for a few seconds | Normal while a GPS data track is removed; if it lasts, no worker processes the queue |
| "Cannot allocate memory" in a video job | `NUXT_VIDEO_MEMORY_LIMIT` reached (4K, 8K, HDR): raise it or lower `NUXT_VIDEO_THREADS` |
| "No space left on device" in a job | `TMPDIR` full: plan space per simultaneous job (§ 10) |
| Dashboard: "The SQLite database is under pressure" | Move to PostgreSQL or MySQL if the traffic lasts; never let several processes write to the same SQLite file (§ 13) |
| No "Send by email" button | `NUXT_SMTP_HOST` or `NUXT_SMTP_FROM` missing; restart after setting them |
| "The email could not be sent" (502 `MAIL_FAILED`) | SMTP unreachable, credentials refused, wrong port or TLS: details in the server log |
| API: 403 `SECRET_IN_BROWSER` | Secret key or personal token used from a browser: call through your server, or use a publishable key |
| API: 403 `ORIGIN_NOT_ALLOWED` | Add the site's exact origin (scheme, host, port) to the project's allowed origins |
| API: 429 for every request from one machine | More than 30 refused credentials in a minute from that address: fix the credential and wait |

Other questions: the [FAQ](https://mahmoud-nb.github.io/surge-media/faq/) or the
[issues](https://github.com/mahmoud-nb/surge-media/issues). Report security issues privately, as described in
[`SECURITY.md`](SECURITY.md), never in a public issue.

## 18. Developing surgeMedia

To work on surgeMedia itself rather than install it: Node.js 24, pnpm 12 (`corepack enable`) and Git.

```bash
git clone https://github.com/mahmoud-nb/surge-media.git && cd surge-media
pnpm install          # pnpm 12 runs only approved install scripts (allowBuilds in pnpm-workspace.yaml)
pnpm db:init          # database (SQLite by default), migrations, secrets in apps/core/.env
pnpm dev              # http://localhost:3000 (add the bootstrap variables to apps/core/.env first)
```

Before proposing a change: `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm i18n:check` (every text exists in
French and English). Commit messages follow [Conventional Commits](https://www.conventionalcommits.org).

## 19. License and support

surgeMedia is source-available under the **Business Source License 1.1** (`BUSL-1.1`), not an open source
license:

- development, testing and evaluation are free for everyone;
- production use is free, except when the organization using it (with its affiliates) had more than
  **USD 500,000** of gross revenue in its last completed fiscal year, or when surgeMedia is offered to third
  parties as a competing hosted service — both cases require a commercial license;
- each version becomes available under the Apache License 2.0 three years after its first release.

The [LICENSE](LICENSE) file is the only binding text. Commercial licenses, support with service levels and
installation assistance: see the [pricing page](https://mahmoud-nb.github.io/surge-media/pricing/) or write to
the contact given in the LICENSE file.
