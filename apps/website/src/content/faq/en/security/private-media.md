---
question: "How do I protect private media?"
order: 5
status: available
keywords: ["private","signed url","signature","expiry","restricted access","bearer"]
---
Mark them **private**: they are then served only with a time-limited signed URL (from 60 seconds to 7 days) or a `Bearer` token.

Your server requests signed links one at a time or in batches of 100. A link only grants access to the file or transformation it names, and stops working when it expires or when the file is replaced.
