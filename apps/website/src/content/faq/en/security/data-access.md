---
question: "Can the vendor access our media or data?"
order: 1
keywords: ["privacy","telemetry","vendor access","data","air gap","offline"]
---
No. surgeMedia runs entirely on your infrastructure and sends nothing to the vendor or to any third party: no telemetry, no online license check.

Its only outgoing connections go to the services you configure (database, S3 storage, SMTP server). It even works on a network isolated from the Internet. Registering an instance with us is optional: it is an email that you review and send yourself.
