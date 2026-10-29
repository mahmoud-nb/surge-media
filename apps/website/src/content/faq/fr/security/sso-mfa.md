---
question: "Le SSO et l’authentification à plusieurs facteurs sont-ils pris en charge ?"
order: 3
status: partial
keywords: ["sso","saml","oidc","openid connect","mfa","2fa","totp","passkey","annuaire","ldap","scim","double authentification","codes de secours"]
---
La double authentification, oui ; le SSO, pas encore.

- **Double authentification (TOTP)** : chaque compte l’active depuis « Mon compte » avec n’importe quelle application d’authentification, et reçoit dix codes de secours à usage unique. Un administrateur peut l’exiger pour les administrateurs ou pour tous ; les comptes concernés la configurent à leur prochaine connexion. Les secrets sont chiffrés en base, chaque changement est inscrit au journal d’audit et signalé au titulaire par e-mail.
- **SSO (OpenID Connect, SAML)** : prévu. D’ici là, vous pouvez placer l’administration derrière votre fournisseur d’identité, grâce à un mandataire d’authentification (oauth2-proxy, Pomerium, Cloudflare Access…) ou à un VPN, tout en laissant l’API et la diffusion accessibles à vos applications.
