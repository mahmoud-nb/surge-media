---
question: "À quoi ressemble l’API ?"
order: 1
status: available
keywords: ["api","rest","openapi","swagger","documentation","erreurs","pagination"]
related:
  - label: "Architecture et API"
    href: "/guides/architecture/"
---
Une API REST JSON versionnée (`/api/v1`) pour lister, rechercher, envoyer, modifier, ranger et signer les médias :

- authentification par jeton `Bearer`, jamais dans l’URL ;
- pagination par curseur, `ETag` et réponses `304`, en-têtes `RateLimit` ;
- erreurs au format `application/problem+json` avec un `code` stable ;
- document **OpenAPI 3.1** en français et en anglais, et une référence interactive dans l’administration.
