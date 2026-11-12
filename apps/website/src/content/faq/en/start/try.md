---
question: "How can I try SurgeMedia?"
order: 6
keywords: ["install","trial","getting started","docker","npm","free","evaluation","demo"]
related:
  - label: "Getting started"
    href: "/guides/getting-started/"
---
Without installing anything, on the [public demo](https://demo.usesurgemedia.com): its sign-in page gives two shared accounts (administrator and editor), and everything is reset every two hours, so upload nothing personal.

On your own servers, in a few minutes, with Docker or npm. It is free for development, testing and evaluation, with no license key and no time limit:

```bash
docker run -d -p 3000:3000 -v surge-media-data:/app/data ghcr.io/mahmoud-nb/surge-media
```

The [getting started guide](../guides/getting-started/) walks through the installation, the first account and the first upload.
