---
question: "How do I bring my existing media over?"
order: 7
status: available
keywords: ["migration","import","existing media","s3","bucket","uploads","cloudinary","imgix","redirect","url rewrite"]
related:
  - label: "Migrate to SurgeMedia"
    href: "/guides/migrating/"
---
With the `surge-media import` command, included for free. It reads your files from a directory, an S3 bucket (AWS, R2, MinIO, Scaleway…) or a list of URLs exported from your database, and uploads them to a project through the API: same checks, same previews, same video processing as any upload.

The import is resumable and never creates the same media item twice. It writes a mapping table (old address → media ID → new URL) to rewrite the URLs stored in your database, and can generate the 301 redirects of the old addresses for nginx, Caddy, Apache or Cloudflare. Files are copied, never moved: your former storage stays untouched until you decide to remove it.
