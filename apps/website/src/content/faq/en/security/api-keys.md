---
question: "How are API keys protected?"
order: 4
status: available
keywords: ["api key","token","secret","rotation","revocation","scope"]
related:
  - label: "Security & access control"
    href: "/guides/security/"
---
Each key belongs to a project, carries limited scopes, and can expire, rotate with an overlap period or be revoked instantly. SurgeMedia only keeps a hash and shows the value once.

A secret key sent from a browser is rejected, and each key carries a prefix and a checksum that make leaks easy to detect.
