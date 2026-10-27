---
question: "What performance can I expect?"
order: 2
keywords: ["performance","throughput","latency","benchmark","load","requests per second"]
---
From a single Node.js process, measured on an 8-core laptop, surgeMedia serves about:

- 15,000 revalidations per second (`304` responses);
- more than 6,000 already-generated transformed images per second;
- 1,650 requests per second of mixed traffic, without errors up to 512 concurrent connections.

Under heavy load, latency grows but requests still succeed. Confirm these figures on your own infrastructure.
