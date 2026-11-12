---
question: "Comment envoyer des fichiers depuis le navigateur sans exposer de secret ?"
order: 5
status: available
keywords: ["upload","envoi","navigateur","jeton délégué","front-end","sécurité","uploader"]
related:
  - label: "Sécurité et contrôle d’accès"
    href: "/guides/security/"
---
Avec un **jeton délégué**. Votre back-end authentifie son utilisateur, puis demande à SurgeMedia un jeton de quelques minutes, limité à une tâche, par exemple « 5 images JPEG de 10 Mo au plus, dans ce dossier ».

Le navigateur envoie ensuite ses fichiers directement à SurgeMedia, qui vérifie le nombre, la taille, le type réel et l’origine, et rattache chaque média à l’utilisateur final. Le composant `SmUploader` gère la file, la progression et les nouveaux essais.
