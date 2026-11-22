---
question: "Can I put a CDN in front of delivery?"
order: 6
status: available
keywords: ["cdn","cache","cloudflare","fastly","purge","domain"]
---
Yes, and we recommend it. Delivery URLs are versioned, immutable and cookie-free, and public media are cached for one year.

Replacing a file creates a new URL, so you never need to purge anything. A dedicated media domain, such as `media.example.com`, takes a single variable.
