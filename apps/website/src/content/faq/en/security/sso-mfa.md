---
question: "Are SSO and multi-factor authentication supported?"
order: 3
status: partial
keywords: ["sso","saml","oidc","openid connect","mfa","2fa","totp","passkey","directory","ldap","scim","two-factor","recovery codes"]
---
Two-factor authentication, yes; SSO, not yet.

- **Two-factor authentication (TOTP)**: each account turns it on from “My account” with any authenticator app and receives ten single-use recovery codes. An administrator can require it for administrators or for everyone; the accounts concerned set it up at their next sign-in. Secrets are encrypted in the database, and every change is recorded in the audit log and reported to the account holder by email.
- **SSO (OpenID Connect, SAML)**: planned. Meanwhile, you can put the administration behind your identity provider, with an authenticating proxy (oauth2-proxy, Pomerium, Cloudflare Access…) or a VPN, while leaving the API and delivery open to your apps.
