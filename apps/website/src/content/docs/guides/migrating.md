---
title: Migrate to SurgeMedia
description: Bring your existing images and videos into SurgeMedia from a directory, an S3 bucket or a list of URLs, rewrite the URLs stored in your database and redirect the old addresses.
---

You already have media: in an `uploads` directory on your server, in an S3 bucket, or behind URLs listed in your database. SurgeMedia only serves the media it has recorded, so these files are **imported once** with the `surge-media import` command. The import is free, resumable and safe to run again: it never creates the same media item twice.

The command is a client of the [API](../architecture/): every file goes through the same upload path as your application (type detection, limits, analysis, previews, video processing, audit log). Nothing is read in place: files are **copied** into the SurgeMedia storage, and the original location stays untouched until you remove it.

## The steps at a glance

1. **Prepare** a project, a key and, for a large import, higher rate limits.
2. **Plan**: list the files in a manifest, a CSV file you can enrich.
3. **Dry run**: check everything without uploading.
4. **Import**, and run the same command again after an interruption.
5. **Rewrite your URLs** from the mapping table the import writes.
6. **Redirect** the old addresses, if their domain is yours.
7. **Decommission** the old location once nothing uses it.

From step 1 on, new uploads already go to SurgeMedia (admin, API, upload components): the import only deals with what you have today.

## 1. Prepare

- **A project** to import into. The API reaches projects only: to put media in the shared library, import them into a project, then move them from the admin.
- **A secret key** of that project with the `media:upload` scope, plus `media:write` if the import creates folders and `tags:manage` if it creates tags. A personal token with the same scopes works too; it then needs `--project <slug>`.
- **The address of your instance**, such as `https://media.example.com`, and the command itself: `npx surge-media` from the npm package, or the same command in the Docker container.

The key is read from the `SURGE_MEDIA_API_KEY` environment variable or from a file (`--key-file`), never from the command line, where it would stay in your shell history.

### Rate limits for a large import

By default the API accepts **60 uploads per minute** per key, and each file costs up to three requests (a lookup by reference, a lookup by contents, the upload). For more than a few hundred files, raise both limits on the server for the time of the import, restart it, then set them back:

```bash
NUXT_API_RATE_LIMIT_UPLOADS="100000"
NUXT_API_RATE_LIMIT_SECRET="100000"     # NUXT_API_RATE_LIMIT_PERSONAL with a personal token
```

As an order of magnitude, measured on a laptop with SQLite and local storage: 5,000 images (5.9 GB) take about **84 minutes** at the default limits, about **12 minutes** with only the upload limit raised, and about **7 minutes** with both. The command says which limit slowed it down and which variable to raise.

## 2. Plan

`import plan` lists the files of a directory or of a bucket and writes a **manifest**, one line per file, with the type detected from the contents. It needs no SurgeMedia server.

```bash
npx surge-media import plan --from /var/www/uploads --folders-from-path --out uploads.csv
```

From an S3 bucket (AWS S3, Cloudflare R2, MinIO, Scaleway, OVHcloud…), with credentials of **that** bucket, which only need to list and read:

```bash
export SURGE_MEDIA_IMPORT_S3_ACCESS_KEY_ID=…
export SURGE_MEDIA_IMPORT_S3_SECRET_ACCESS_KEY=…
npx surge-media import plan --from s3://old-media/uploads/ --s3-region eu-west-3 --folders-from-path --out uploads.csv
```

For an S3-compatible service, add `--s3-endpoint https://…` and, where the service needs it (MinIO, Garage), `--s3-path-style`.

`plan` reports the total volume, the estimated duration and the files it leaves out (in `uploads.rejected.csv`): SVG, HEIC and TIFF are not accepted, and MKV, AVI and similar videos only when video processing is enabled. `--folders-from-path` turns the directory tree into project folders.

### Write or enrich the manifest

The manifest is a plain CSV file (UTF-8, comma-separated, a header line); only `source` is required. Edit it before importing, or **export it from your own database**, which is the best way to carry titles, alternative texts and references:

| Column | Content |
| --- | --- |
| `source` | Path relative to `--root`, an `http(s)://` URL or an `s3://bucket/key` address |
| `ref` | Reference of the file in your system, 191 characters at most (default: `source`) |
| `title`, `alt` | Title and alternative text |
| `visibility` | `public` (default) or `private` |
| `folder` | Project folder, such as `blog/2024` |
| `tags` | Tag slugs separated by `\|` |
| `filename` | File name to record (default: the last segment of `source`) |

```sql
-- PostgreSQL: one line per image of your CMS, its primary key as reference
\copy (SELECT url AS source, 'img:' || id AS ref, title, alt_text AS alt FROM images) TO 'uploads.csv' WITH (FORMAT csv, HEADER true)
```

Choose `ref` well: it is how the import recognizes a file it has already imported, and how you find your rows again in step 5. Your own primary key (`img:4812`) is the most reliable choice.

## 3. Dry run

```bash
export SURGE_MEDIA_API_KEY=sm_sk_…
npx surge-media import run uploads.csv --root /var/www/uploads --url https://media.example.com --create-folders --dry-run
```

The dry run does everything but upload: it reads every file, applies the rules of your server (accepted types, maximum sizes), finds files already imported and duplicates, and counts the folders and tags to create. Nothing is written on the server.

## 4. Import

Run the same command without `--dry-run`:

```bash
npx surge-media import run uploads.csv --root /var/www/uploads --url https://media.example.com --create-folders
```

For each line the command reads the file (a URL or an `s3://` object is downloaded to a temporary directory first), skips it when its reference is already on the server, attaches it to the existing media item when the project already holds the same contents (`--no-dedupe` to upload anyway), and otherwise uploads it.

- **Interrupt and resume.** Press Ctrl+C once: the uploads in progress finish, the mapping table is written, and the command exits with code `2`. Run the same command again to continue where it stopped. Even if the progress file is lost, nothing is duplicated: the server refuses a reference it already holds.
- **Exit codes.** `0`: every line is settled, permanent refusals included. `2`: some lines failed or remain, run the command again. `1`: the command could not run (address, key, manifest).
- **Videos** are processed in the background at a lower priority than your regular uploads, so a long import never delays the work of your editors.
- **Options.** `--concurrency` (2 by default, 8 at most), `--visibility`, `--create-tags`, `--public-url` (see below), `--retry-rejected` after a server setting changed, `--json` for a script.

## 5. Rewrite your URLs

Next to the manifest, the import writes **`uploads.mapping.csv`**, one line per manifest line:

| Column | Content |
| --- | --- |
| `source` | The `source` of the manifest |
| `sourceRef` | The reference recorded on the server (the `ref` column, or `source`) |
| `status` | `created`, `exists` (imported earlier), `deduplicated` (same contents as another media item), `rejected`, `failed` or `pending` |
| `mediaId` | ID of the SurgeMedia media item |
| `version` | Version of the file |
| `url` | Delivery URL of the original, such as `https://media.example.com/m/<id>/v1/photo.jpg` |
| `code` | Error code of a rejected or failed line |

Load it in your database and update your rows. **Store the media ID** rather than only the URL: with the ID, your application always shows the current version after a file is replaced, builds resized and converted images, and reads private media through signed URLs. The URL of a private media item is given without its temporary signature, and does not work on its own.

### PostgreSQL

```sql
CREATE TEMP TABLE surge_media_mapping (
  source     text,
  source_ref text,
  status     text,
  media_id   text,
  version    integer,
  url        text,
  code       text
);
\copy surge_media_mapping FROM 'uploads.mapping.csv' WITH (FORMAT csv, HEADER true)

ALTER TABLE images ADD COLUMN surge_media_id text;

UPDATE images AS i
SET    surge_media_id = m.media_id,
       url            = m.url
FROM   surge_media_mapping AS m
WHERE  m.status IN ('created', 'exists', 'deduplicated')
AND    m.source_ref = 'img:' || i.id;   -- or: m.source = i.url
```

### MySQL and MariaDB

```sql
CREATE TEMPORARY TABLE surge_media_mapping (
  source     VARCHAR(2048) NOT NULL,
  source_ref VARCHAR(191)  NOT NULL,
  status     VARCHAR(16)   NOT NULL,
  media_id   VARCHAR(32),
  version    INT,
  url        VARCHAR(2048),
  code       VARCHAR(64),
  KEY (source_ref)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

LOAD DATA LOCAL INFILE 'uploads.mapping.csv'
INTO TABLE surge_media_mapping
CHARACTER SET utf8mb4
FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' ESCAPED BY ''
LINES TERMINATED BY '\n'
IGNORE 1 LINES
(source, source_ref, status, @media_id, @version, @url, @code)
SET media_id = NULLIF(@media_id, ''), version = NULLIF(@version, ''),
    url = NULLIF(@url, ''), code = NULLIF(@code, '');

ALTER TABLE images ADD COLUMN surge_media_id VARCHAR(32) NULL;

UPDATE images AS i
JOIN   surge_media_mapping AS m
       ON m.source_ref = CONCAT('img:', i.id)   -- or: ON m.source = i.url COLLATE utf8mb4_bin
SET    i.surge_media_id = m.media_id,
       i.url            = m.url
WHERE  m.status IN ('created', 'exists', 'deduplicated');
```

`LOAD DATA LOCAL` needs `local_infile` on the server and the client (`mysql --local-infile=1`). The binary collation compares references exactly, as SurgeMedia does: the default collations of MySQL ignore case and accents.

Then display media by ID, for example with the [JavaScript client and the Vue components](../../reference/sdks/): `client.media.get(id)` returns the media item that `SmImage` renders with its `srcset`.

:::tip[Public domain in the mapping table]
The URLs of the table use the public address of your instance (`NUXT_MEDIA_PUBLIC_URL`, else `NUXT_SITE_URL`). If neither is set, for example when you run the import on the server itself, pass `--public-url https://media.example.com`.
:::

## 6. Redirect the old addresses

When the old URLs are served by a domain you control, turn the mapping table into permanent (301) redirects, so that links in emails, search engines and other sites keep working:

```bash
npx surge-media import redirects uploads.mapping.csv --format nginx --prefix /uploads --out surge-media-redirects.conf
```

| `--format` | Output |
| --- | --- |
| `nginx` | A `map` table to include in the `http` block, plus one `if … return 301` line in the old `server` block |
| `caddy` | A `map {path}` table followed by `redir`, to import in the old site block |
| `apache` | One `RedirectMatch 301` line per address, for the VirtualHost or `.htaccess` |
| `cloudflare` | The CSV of Bulk Redirects (needs `--origin https://www.example.com`) |
| `json` | The raw list, for any other tool |

The old address of a file is the path of its URL when `source` is a URL; for a path or an `s3://` key, it is `--prefix` followed by the path, or by the whole key (`s3://old-media/uploads/a.jpg` gives `uploads/a.jpg`: leave `--prefix` out if the bucket was served from its root). Rules match the exact path, case included, and ignore the query string (Apache passes it on to the new URL, which ignores it). Addresses holding characters that the configuration syntax interprets are left out and listed. Always test the file before loading it (`nginx -t`, `caddy validate`, `apachectl configtest`).

If the old URLs belong to a service you are leaving (a CDN or a SaaS media platform), you cannot redirect them: keep the old service running read-only until your database and your pages only hold the new URLs.

## 7. Decommission

1. Check that no page, email template or application still calls the old addresses: watch the logs of the old server, or the hits of the redirects.
2. Keep the redirects as long as external links may point to the old URLs; they cost nothing.
3. Remove the old files, or the bucket, and revoke the credentials used for the import: the bucket's read key, and the SurgeMedia key if it was created for this purpose only. Set the rate limits back to their defaults.

## Good to know

- **Dates**: the creation date of an imported media item is the date of the import.
- **Derivatives** produced by your former system (thumbnails, crops) are not imported: SurgeMedia generates them on demand from the original.
- **Same file twice in your source**: it is uploaded once; every line points to the same media item in the mapping table.
- **With Docker**, run the command from the host with Node.js, or in the container when the files are mounted in it: `docker compose exec -e SURGE_MEDIA_API_KEY surge-media node node_modules/@surge-media/core/dist/cli/index.mjs import run /import/uploads.csv`. The command writes its progress file and the mapping table next to the manifest: mount that folder writable, or keep the manifest in a writable folder and pass `--root` to the read-only one.

The [installation guide](https://github.com/mahmoud-nb/surge-media/blob/main/setup.md#91-importing-existing-media) lists every option of the `import` commands.
