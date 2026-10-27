---
question: "Quelles performances attendre ?"
order: 2
keywords: ["performance","débit","latence","benchmark","charge","requêtes par seconde"]
---
Sur un seul processus Node.js, mesuré sur un ordinateur portable à 8 cœurs, surgeMedia sert environ :

- 15 000 revalidations par seconde (réponses `304`) ;
- plus de 6 000 images transformées, déjà générées, par seconde ;
- 1 650 requêtes par seconde en trafic mixte, sans erreur jusqu’à 512 connexions simultanées.

Sous forte charge, la latence augmente mais les requêtes aboutissent. Ces chiffres sont à confirmer sur votre propre infrastructure.
