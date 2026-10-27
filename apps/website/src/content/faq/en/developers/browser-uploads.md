---
question: "How do I upload from the browser without exposing a secret?"
order: 5
status: available
keywords: ["upload","browser","delegated token","front end","security","uploader"]
related:
  - label: "Security & access control"
    href: "/guides/security/"
---
With a **delegated token**. Your back end authenticates its user, then asks surgeMedia for a token valid a few minutes and limited to one task, for example "5 JPEG images of 10 MB at most, into this folder".

The browser then uploads its files straight to surgeMedia, which checks the number, size, real type and origin, and links each media item to the end user. The `SmUploader` component handles the queue, the progress and the retries.
