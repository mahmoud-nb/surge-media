---
question: "How do I report a vulnerability, and how are they fixed?"
order: 7
keywords: ["vulnerability","security issue","report","cve","disclosure","dependabot","fix","security.md","sbom","trivy","supply chain"]
---
Through GitHub's private reporting form, never in a public issue: the [security policy](https://github.com/mahmoud-nb/surge-media/blob/main/SECURITY.md) explains how.

Our targets: an acknowledgement within 3 business days, a fix within 14 days for a critical issue and 30 days for a high one, then a public security advisory. Dependencies are updated weekly by Dependabot and audited on every change, every Monday and before every release; the Docker image is scanned for known vulnerabilities before it is published. A high or critical issue in what we ship blocks the release unless a written, time-limited exception explains why it does not apply. Each release comes with SBOMs and checksums.
