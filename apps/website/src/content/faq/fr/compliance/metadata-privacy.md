---
question: "Les métadonnées sensibles (lieu, appareil) sont-elles retirées ?"
order: 3
status: partial
keywords: ["exif","gps","géolocalisation","métadonnées","vie privée","appareil photo"]
---
Pour les **vidéos**, oui : le lieu et l’appareil sont retirés à l’envoi, et les pistes GPS des caméras d’action sont supprimées avant toute diffusion quand FFmpeg est activé.

Pour les **images**, les versions transformées ne contiennent aucune métadonnée, mais l’original est diffusé tel qu’il a été envoyé, données EXIF comprises : diffusez vos images publiques par des transformations. Le nettoyage des originaux à l’envoi est prévu.
