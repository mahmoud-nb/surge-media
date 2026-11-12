---
title: Security & access control
description: Credentials, scopes, allowed origins, signed URLs, transformation policies and audit log — how SurgeMedia keeps your media and your API under control.
---

SurgeMedia is designed so that **every request is attributable and limited to what it needs**. Project owners manage access themselves, from the admin, without touching the server configuration.

## Credentials

Each credential belongs to a project (or to a user, for personal tokens), carries **scopes**, and can be revoked at any time — the effect is immediate.

| Credential | Prefix | Use it for | Never use it for |
| --- | --- | --- | --- |
| **Publishable key** | `sm_pk_` | Browsers and mobile apps reading **public** media of a project. | Writing, private media, signed URLs. |
| **Secret key** | `sm_sk_` | Your servers, CI/CD, back-office integrations. | Browsers: SurgeMedia **rejects** a secret key sent from a web page (`SECRET_IN_BROWSER`). |
| **Personal access token** | `sm_pat_` | Scripts and migrations acting as a user, across selected projects. | Long-running production services (use a secret key). |
| **Delegated token** | `sm_dt_` | A browser task for a few minutes: upload, picker, media library. | Anything durable: it expires in 1 hour at most. |

Tokens are always sent in the `Authorization: Bearer …` header. A token in the query string is refused, so it never ends up in logs or browser history. Every token includes a checksum: a mistyped or truncated token is rejected without a database lookup.

### Scopes

| Scope | Allows |
| --- | --- |
| `project:read`, `media:read` | Reading the project and its media (always included). |
| `media:upload` | Uploading new media. |
| `media:write` | Updating metadata, focal point, folders and tags; replacing files. |
| `media:delete` | Moving media to the trash. |
| `tags:manage` | Creating, renaming and deleting the tags of the project (optional; a secret key only gets it when the person creating it holds it). |

Credentials never get other management scopes: members, keys and settings are only managed from the admin, by people. Global tags are managed from the admin only, and **confidential tags** never appear in the API, whatever the credential: they are visible only to administrators and managers, in the admin. A delegated token never gets `tags:manage`.

### Lifecycle

- **Expiry**: secret keys last 30, 90 or 365 days, or never expire — your policy.
- **Rotation**: a new key replaces the old one with the same name, environment and scopes; the old one can keep working during an **overlap** period while you deploy.
- **Revocation**: immediate, and it also invalidates every delegated token issued by the key.
- **Environments**: each key carries an environment label (`production`, `staging`, `development`…), shown and grouped in the admin.

## Allowed origins (CORS)

Each project lists the origins allowed to call its API from a browser: `https://www.acme.com`, or a wildcard such as `https://*.acme.com`. Requests from any other origin are refused (`ORIGIN_NOT_ALLOWED`). A delegated token can be pinned to one exact origin.

## Direct uploads with delegated tokens

Your server authenticates **its** user, then asks SurgeMedia for a delegated token:

- scopes that are a subset of the issuing key's **current** scopes;
- a lifetime of 1 to 60 minutes (15 by default), never beyond the issuing key's expiry;
- upload constraints enforced server-side: maximum number of files, maximum size, accepted types (detected from the file content), imposed visibility and folder;
- a `subject` (your user ID), recorded on every media it uploads.

The token is stateless and signed (HMAC-SHA256). Revoking the issuing key kills it instantly.

## Private media and signed URLs

Each media is **public** or **private**.

- Public media are served to anyone who has the URL, with immutable cache headers.
- Private media are served only with a valid **signed URL** (HMAC, with an expiry) or a `Bearer` token. Your server requests signed URLs one by one or in batches of 100, for an exact file, preset or transformation.
- Signing keys can be rotated: links signed with the previous key keep working during the transition.

## Transformation policies

To control what can be generated on your servers, each project (and the shared library) has a policy:

| Policy | Free transformations in URLs | Typical use |
| --- | --- | --- |
| `OPEN` (default) | Allowed, within the limits | Public sites building their `srcset` client-side. |
| `SIGNED` | Only with a signed URL or an API credential | High-traffic installations exposed to the internet. |
| `PRESETS` | Refused — only named presets | Exact control over generated files. |

In every case, outputs are capped (4,096 px by default), images are never upscaled, the number of variants per media version is limited, and unsigned generations are rate-limited per IP.

## Accounts and sessions

- Passwords hashed with **argon2id**; sessions stored server-side and revocable by an administrator.
- **Two-factor authentication (TOTP)**: each account turns it on from **My account** with any authenticator app and receives ten single-use recovery codes. Administrators can require it for administrators or for everyone (**Settings › Security**). Secrets are encrypted in the database; every change is recorded in the audit log and reported to the account holder by email. The server operator can reset it from the command line (`surge-media user mfa-reset`).
- **Sudo mode**: creating a secret key or a personal token, or changing project members, asks for the password again (valid 10 minutes). Users can mark a device as trusted.
- Login and password confirmation are rate-limited; repeated failures lock further attempts temporarily.
- Invitations and password resets use single-use, expiring links.

## Audit log

Administrators get a searchable **audit log** of sensitive actions — project and member changes, key and token creation, rotation and revocation, transformation settings, media visibility changes, moves and permanent deletions — with author, project, credential and context. Media uploaded through the API keep track of the credential and the end user (`subject`) that sent them.

## Rate limiting and resilience

- Per-credential request limits with standard `RateLimit` headers, and a dedicated limit for uploads.
- Failed authentications are counted per IP; beyond the threshold, the IP is temporarily blocked from the API.
- Request bodies are size- and time-limited; uploads stalled without data are cut.
- Behind a reverse proxy, `NUXT_TRUST_PROXY` makes limits and logs use the real client IP.

## Supply chain

- Dependencies are audited on every change, every Monday and before every release, and the Docker image is scanned for known vulnerabilities before it is published: a high or critical issue in what is shipped blocks the release, unless a written, time-limited exception explains why it does not apply.
- Third-party GitHub Actions are pinned to a commit hash, new commits are scanned for secrets, and the release workflows share no build cache with other workflows.
- Every release comes with SBOMs (images and npm package) and checksums. How to check them: the [security policy](https://github.com/mahmoud-nb/surge-media/blob/main/SECURITY.md#supply-chain).

## Related

- [Roles and responsibilities](../roles/)
- [Architecture & APIs](../architecture/)
