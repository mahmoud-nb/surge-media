---
question: "Comment protéger des médias privés ?"
order: 5
status: available
keywords: ["privé","url signée","signature","expiration","accès restreint","bearer"]
---
Marquez-les **privés** : ils ne sont alors servis qu’avec une URL signée à durée limitée (de 60 secondes à 7 jours) ou un jeton `Bearer`.

Votre serveur demande les liens signés un par un ou par lots de 100. Un lien ne donne accès qu’au fichier ou à la transformation qu’il nomme, et cesse de fonctionner à son échéance ou au remplacement du fichier.
