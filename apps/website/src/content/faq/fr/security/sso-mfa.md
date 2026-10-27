---
question: "Le SSO et l’authentification à plusieurs facteurs sont-ils pris en charge ?"
order: 3
status: planned
keywords: ["sso","saml","oidc","openid connect","mfa","2fa","totp","passkey","annuaire","ldap","scim"]
---
Pas encore : ce sont nos prochaines priorités de sécurité.

D’ici là, vous pouvez placer l’administration derrière votre fournisseur d’identité, grâce à un mandataire d’authentification (oauth2-proxy, Pomerium, Cloudflare Access…) ou à un VPN, tout en laissant l’API et la diffusion accessibles à vos applications.
