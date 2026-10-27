---
question: "Can I put a CDN in front of delivery?"
order: 6
status: available
keywords: ["cdn","cache","cloudflare","fastly","purge","domain"]
---
Yes, and we recommend it. Delivery URLs are versioned and immutable, cookie-free, with a one-year cache for public media.

Replacing a file creates a new URL, so you never need to purge anything. A dedicated media domain, such as `media.example.com`, takes a single variable.
