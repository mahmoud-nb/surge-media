---
question: "Does surgeMedia send notifications (webhooks)?"
order: 8
status: planned
keywords: ["webhook","event","notification","callback","bus"]
---
Not yet. To follow a video conversion, your app reads the media item again with `If-None-Match`, at most every 5 seconds: the response is a `304` until something changes.

Processing notifications are on the roadmap.
