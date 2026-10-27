---
question: "How do I scale and make it highly available?"
order: 3
status: partial
keywords: ["scaling","scalability","high availability","load balancer","cluster","redis","workers"]
---
First put a CDN in front of delivery: it absorbs most of the traffic. Then add web instances behind a load balancer, with PostgreSQL or MySQL and S3 storage; instances are interchangeable. Video processing scales with extra workers that share a persistent queue.

Rate limits and caches are currently per instance; a shared cache (Redis) is planned.
