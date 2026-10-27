---
question: "surgeMedia envoie-t-il des notifications (webhooks) ?"
order: 8
status: planned
keywords: ["webhook","événement","notification","callback","bus"]
---
Pas encore. Pour suivre une conversion vidéo, votre application relit le média avec `If-None-Match`, au plus toutes les 5 secondes : la réponse est un `304` tant que rien n’a changé.

Les notifications de fin de traitement sont inscrites à la feuille de route.
