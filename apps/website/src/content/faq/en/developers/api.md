---
question: "What does the API look like?"
order: 1
status: available
keywords: ["api","rest","openapi","swagger","documentation","errors","pagination"]
related:
  - label: "Architecture & APIs"
    href: "/guides/architecture/"
---
A versioned JSON REST API (`/api/v1`) to list, search, upload, update, organize and sign media:

- `Bearer` token authentication, never in the URL;
- cursor pagination, `ETag` and `304` responses, `RateLimit` headers;
- `application/problem+json` errors with a stable `code`;
- an **OpenAPI 3.1** document in English and French, plus an interactive reference in the administration.
