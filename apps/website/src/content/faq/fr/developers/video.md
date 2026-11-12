---
question: "Que fait SurgeMedia avec les vidéos ?"
order: 6
status: partial
keywords: ["vidéo","video","ffmpeg","h264","av1","hls","streaming","sous-titres","affiche"]
---
À l’envoi, il prépare les MP4 et MOV pour une lecture immédiate et retire les données de lieu et d’appareil. Il gère l’image d’affiche et les sous-titres (WebVTT ou SRT).

Avec FFmpeg activé, il convertit les formats non lisibles (MKV, AVI…), produit des rendus H.264 et AV1 et retire les pistes GPS des caméras d’action, dans des processus séparés. Le streaming adaptatif (HLS) n’est pas encore disponible : il est prévu.
