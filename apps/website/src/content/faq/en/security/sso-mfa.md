---
question: "Are SSO and multi-factor authentication supported?"
order: 3
status: planned
keywords: ["sso","saml","oidc","openid connect","mfa","2fa","totp","passkey","directory","ldap","scim"]
---
Not yet: they are our next security priorities.

Meanwhile, you can put the administration behind your identity provider, with an authenticating proxy (oauth2-proxy, Pomerium, Cloudflare Access…) or a VPN, while leaving the API and delivery open to your apps.
