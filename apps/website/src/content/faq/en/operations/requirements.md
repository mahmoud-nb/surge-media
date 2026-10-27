---
question: "What are the technical requirements?"
order: 1
keywords: ["requirements","system requirements","server","node","docker","linux","windows","ffmpeg"]
related:
  - label: "Getting started"
    href: "/guides/getting-started/"
---
A Linux container (amd64 or arm64), or Node.js 24 on Linux, macOS or Windows. Add a persistent disk or S3 storage, an HTTPS reverse proxy and, for a multi-instance production setup, PostgreSQL or MySQL.

FFmpeg 6 or later is only needed for video processing: the full Docker image includes it.
