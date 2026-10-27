---
question: "Is sensitive metadata (location, device) removed?"
order: 3
status: partial
keywords: ["exif","gps","geolocation","metadata","privacy","camera"]
---
For **videos**, yes: location and device data are stripped on upload, and the GPS tracks of action cameras are removed before any delivery when FFmpeg is enabled.

For **images**, transformed versions carry no metadata, but the original is served as uploaded, EXIF data included: deliver your public images through transformations. Stripping originals on upload is planned.
