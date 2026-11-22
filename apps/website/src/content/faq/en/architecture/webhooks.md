---
question: "Does SurgeMedia send notifications (webhooks)?"
order: 8
status: planned
keywords: ["webhook","event","notification","callback","bus"]
---
Not yet. To follow a video conversion, your app polls the media item with `If-None-Match`, no more than once every 5 seconds: the response is a `304` until something changes.

Notifications when processing finishes are on the roadmap.
