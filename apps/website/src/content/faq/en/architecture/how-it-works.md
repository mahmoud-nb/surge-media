---
question: "How does SurgeMedia work?"
order: 1
keywords: ["architecture","how it works","components","admin","api","delivery","worker"]
related:
  - label: "Architecture & APIs"
    href: "/guides/architecture/"
---
A single Node.js application exposes three surfaces:

- `/admin`: the interface for your teams (media, projects, accounts, settings);
- `/api/v1`: the REST API for your apps, authenticated with tokens;
- `/m/…`: delivery of originals and transformations, cookie-free and CDN-ready.

Video conversions run in separate worker processes, started from the same image. All the state lives in your SQL database and your storage: instances are interchangeable.
