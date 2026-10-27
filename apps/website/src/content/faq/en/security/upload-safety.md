---
question: "How are uploaded files checked?"
order: 6
status: available
keywords: ["file","upload","malicious","svg","mime type","antivirus","ffmpeg","csp"]
---
The real type is detected from the file's first bytes against a closed list of formats; active formats (SVG, HTML, PDF) are rejected. Size and resolution are checked while the file is received, and delivery applies a strict security policy (`nosniff`, `Content-Security-Policy`).

Videos are processed by FFmpeg in an isolated process: no shell, no network, low priority and resource limits.
