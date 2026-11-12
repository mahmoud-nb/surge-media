---
title: Roles and responsibilities
description: Platform roles (Admin, Manager, Developer, Editor) and project roles (Owner, Developer, Editor) — who can do what in SurgeMedia.
---

SurgeMedia has two levels of roles: a **platform role** for each user, and a **project role** for each project they belong to. Together they give everyone exactly the access they need — and nothing more.

## Platform roles

| <span class="sr-only">Permission</span> | Admin | Manager | Developer | Editor |
| --- | :---: | :---: | :---: | :---: |
| Read the shared library | ✓ | ✓ | ✓ | ✓ |
| Manage the shared library | ✓ | | | |
| Create projects | ✓ | ✓ | | |
| Access every project | ✓ | | | |
| Invite users | ✓ (any role) | ✓ (Developers, Editors) | | |
| Manage all user accounts | ✓ | | | |
| Personal access tokens | ✓ | ✓ | ✓ | |
| Interactive API documentation | ✓ | ✓ | ✓ | |
| Global tags (library and every project) | ✓ | | | |
| Confidential tags | ✓ | ✓ | | |
| Audit log | ✓ | | | |
| Installation settings (transformations, video) | ✓ | | | |

- **Admin** — runs the platform: users, library, settings, audit. Acts as owner of every project.
- **Manager** — runs their projects and their teams: creates projects, invites developers and editors, and is always owner of the projects they belong to.
- **Developer** — integrates: API keys, origins and media of the projects they are a member of.
- **Editor** — the default role, least privilege: uploads, organizes and describes media.

## Project roles

| <span class="sr-only">Permission</span> | Owner | Developer | Editor |
| --- | :---: | :---: | :---: |
| Read, upload, edit and delete media | ✓ | ✓ | ✓ |
| API keys and allowed origins | ✓ | ✓ | |
| Assign tags to media | ✓ | ✓ | ✓ |
| Project tags (create, rename, delete) | ✓ | | |
| Members | ✓ | | |
| Project settings, transformation policy and presets, archiving | ✓ | | |

A platform role sets the **ceiling** of a project role: an Editor is always an Editor in their projects, a Developer at most a Developer, while Admins and Managers act as Owners. A user who is not a member of a project does not see it at all.

## Typical organizations

- **In-house team** — one Admin from IT, a Manager per product line, Developers on each product's project, Editors from marketing.
- **Agency** — the agency's Admin, one project per client, the client's staff invited as Editors on their own project only.
- **Multi-brand group** — shared brand assets in the library (read by everyone), one project per brand or website.

## Related

- [Security & access control](../security/)
- [One source of truth for every environment](../environments/)
