---
question: "How do I handle development, staging and production?"
order: 7
status: available
keywords: ["environment","staging","development","production","keys"]
related:
  - label: "Environments"
    href: "/guides/environments/"
---
All your environments can read the **same project**, each with its own API keys, labeled by environment, and its own allowed origins.

Content uploaded in production is immediately visible in staging, without copying files, and rotating a staging key never affects production. A separate project remains an option for destructive tests.
