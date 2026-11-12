---
title: Une source de vérité pour tous les environnements
description: Utilisez la même médiathèque en développement, en préproduction et en production, avec des clés et des origines par environnement — et arrêtez de copier les fichiers d’un environnement à l’autre.
---

La plupart des équipes finissent avec un bucket de médias par environnement : les éditeurs envoient en production, les développeurs copient les fichiers à la main vers la préproduction, et les environnements locaux affichent des images cassées. SurgeMedia règle le problème à la racine : **chaque environnement lit les mêmes médias**, chacun avec ses propres identifiants.

## Avant et après

| <span class="sr-only">Aspect</span> | Un bucket par environnement | SurgeMedia |
| --- | --- | --- |
| Où vivent les médias | Copiés dans chaque environnement | Un projet, une médiathèque |
| La préproduction montre les vrais contenus | Seulement après une synchronisation manuelle | Toujours — mêmes identifiants, mêmes URL |
| Développement local | Images manquantes ou factices | Les vrais médias, en lecture seule si vous le souhaitez |
| Clé compromise en préproduction | Souvent partagée avec la production | Révoquez uniquement la clé de préproduction |
| Arrivée d’un nouveau développeur | Des accès pour chaque bucket | Une clé publique pour son poste |

## Mise en place

1. **Un projet par application** (ou par client, pour les agences). Le projet regroupe les médias, les membres et les politiques.
2. **Une clé par environnement**, étiquetée `development`, `staging` ou `production` (toute étiquette convient : `preview`, `qa`…). L’administration regroupe les clés par environnement.
3. **Des origines autorisées** pour chaque front-end : `http://localhost:5173`, `https://staging.acme.app`, `https://www.acme.fr` — ou `https://*.acme.app` pour les déploiements de prévisualisation.
4. **Configurez chaque environnement** avec le même identifiant de projet et ses propres clés :

```bash
# .env.development
SURGE_MEDIA_API_URL=https://media.acme.fr/api/v1
SURGE_MEDIA_PROJECT_ID=cm3k…
SURGE_MEDIA_PUBLISHABLE_KEY=sm_pk_…   # clé de développement
SURGE_MEDIA_SECRET_KEY=sm_sk_…        # clé de développement, en lecture seule

# .env.production — même URL et même projet, clés de production
```

## Bonnes pratiques

- **Ne donnez aux clés hors production que ce dont elles ont besoin.** Une clé secrète de développement limitée à `media:read` ne peut pas modifier les contenus de production.
- **Isolez les tests destructifs** dans un projet « bac à sable » séparé, ou dans un dossier dédié où arrivent les envois de test (un jeton délégué peut imposer le dossier).
- **Faites tourner les clés environnement par environnement.** La rotation de la clé de préproduction n’affecte jamais la production ; la période de chevauchement permet de redéployer sans interruption.
- **Des URL sûres d’une version à l’autre.** Remplacer un fichier crée une nouvelle version du média et de nouvelles URL : les environnements qui référencent encore l’ancienne version continuent de fonctionner jusqu’à leur actualisation.

## Voir aussi

- [Sécurité et contrôle d’accès](../security/)
- [Architecture et API](../architecture/)
