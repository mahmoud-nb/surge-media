---
question: "Comment les fichiers envoyés sont-ils contrôlés ?"
order: 6
status: available
keywords: ["fichier","upload","malveillant","svg","type mime","antivirus","ffmpeg","csp"]
---
Le type réel est détecté d’après les premiers octets du fichier, selon une liste fermée de formats ; les formats actifs (SVG, HTML, PDF) sont refusés. La taille et la définition sont vérifiées pendant la réception, et la diffusion applique une politique de sécurité stricte (`nosniff`, `Content-Security-Policy`).

Les vidéos sont traitées par FFmpeg dans un processus isolé : sans shell, sans réseau, en priorité basse et avec des limites de ressources.
