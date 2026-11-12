# Security policy

[Version française plus bas](#politique-de-sécurité).

## Reporting a vulnerability

**Please do not report security vulnerabilities through public issues, discussions or pull requests.**

Report them privately through GitHub:
[**Report a vulnerability**](https://github.com/mahmoud-nb/surge-media/security/advisories/new)
(repository › *Security* › *Report a vulnerability*). Only the maintainers can read the report, and the fix can be
prepared in a private fork before anything is published.

If you cannot use GitHub's private reporting, open a public issue that only asks for a private contact channel,
**without any detail** about the vulnerability.

A useful report contains:

- the affected component and version (`@surge-media/core` version or image tag, `@surge-media/client`,
  `@surge-media/vue`);
- the relevant configuration (database, storage driver, video processing mode, reverse proxy);
- the steps to reproduce, a proof of concept if you have one, and the impact you observed;
- whether you want to be credited, and under which name.

## Supported versions

| Component | Receives security fixes |
| --- | --- |
| `@surge-media/core` (npm) and `ghcr.io/mahmoud-nb/surge-media` images | the latest release line only, until 1.0.0 |
| `@surge-media/client`, `@surge-media/vue` | the latest release |
| Older release lines (`release-X.Y`) | only when a fix is explicitly announced for them |

Fixes are published as new patch releases on npm and GHCR. Always run the latest patch release of your line.

## What happens after you report

These are the maintainers' targets, not contractual commitments (commercial customers: see your contract).

| Step | Target |
| --- | --- |
| Acknowledgement of the report | 3 business days |
| Initial assessment (validity, severity, affected versions) | 10 business days |
| Fix released, critical severity | 14 days after confirmation |
| Fix released, high severity | 30 days after confirmation |
| Fix released, medium severity | 90 days after confirmation |
| Fix released, low severity | next scheduled release |

Severity is rated with CVSS. We keep you informed of progress, and we agree with you on a disclosure date: by
default when the fix is released, and no later than 90 days after the report unless we both agree otherwise.

When the fix is released, we publish a GitHub Security Advisory, request a CVE identifier through GitHub when the
issue warrants one, and credit you unless you prefer to stay anonymous. To be notified, *Watch* the repository
with *Custom › Security alerts*. There is no bug bounty program at this time.

## Scope

In scope:

- the SurgeMedia server (`@surge-media/core`): administration, authentication and sessions, public API
  (`/api/v1`), media delivery (`/m/`), image transformations, video processing, CLI;
- the official Docker image and the Compose examples of this repository;
- the front-end libraries `@surge-media/client` and `@surge-media/vue`.

Out of scope:

- vulnerabilities in third-party dependencies or system packages (ffmpeg, libvips, Debian) without a demonstrated
  impact on SurgeMedia: please report them upstream;
- installations that contradict the production guidance (for example HTTP without TLS, the application port
  exposed without a reverse proxy, or untrusted proxies allowed by `NUXT_TRUST_PROXY`);
- headers that the documentation leaves to the reverse proxy, such as `Strict-Transport-Security`;
- volumetric denial of service and the exhaustion of documented rate limits;
- attacks that require an administrator account, access to the server or to the database;
- documented missing features, such as single sign-on: they are feature requests, not vulnerabilities;
- social engineering and physical attacks.

## Testing guidelines

SurgeMedia is self-hosted. Test **only on an instance that you installed yourself** (the license allows any
non-production use), and never on someone else's installation without their written permission. The public demo
is shared with other visitors and reset every two hours: do not test there. Do not access, modify or delete data
that is not yours, and do not degrade a service used by others.

We will not take legal action against research that follows this policy in good faith, and we will treat your
report confidentially.

## Supply chain

What every change and every release goes through (`.github/workflows`):

- **Dependencies**: Dependabot every week, never for a version published less than 7 days ago. `pnpm audit` on every
  pull request, every push, every Monday and before each release: a high or critical advisory in what is shipped
  (the server and everything its build bundles, the runtime dependencies of the libraries) blocks, unless a written
  exception explains why it does not apply. Exceptions expire after 90 days at most
  ([`security/audit-exceptions.json`](security/audit-exceptions.json)).
- **Docker image**: scanned by Trivy (system packages, ffmpeg, Node packages) in continuous integration, every Monday
  and before every publication. A high or critical vulnerability with an upstream fix blocks, under the same rules
  ([`security/trivyignore.yaml`](security/trivyignore.yaml)).
- **Secrets**: new commits scanned by gitleaks.
- **Workflows**: third-party actions pinned to a commit hash, least-privilege permissions, checked by zizmor; the
  release workflows use no build cache that another workflow could have written.
- **Every release**: SBOMs (SPDX, attached to the images; CycloneDX for the npm package, attached to the GitHub
  release), `SHA256SUMS`, and the images' build provenance (BuildKit).

Once the repository is public, CodeQL and OpenSSF Scorecard run as well, and the npm package and the images carry
signed provenance (npm provenance, GitHub artifact attestations).

To check a release before installing it:

```bash
sha256sum --ignore-missing -c SHA256SUMS                    # files downloaded from the GitHub release
gh attestation verify surge-media-core-X.Y.Z.tgz --owner mahmoud-nb                  # once the repository is public
gh attestation verify oci://ghcr.io/mahmoud-nb/surge-media:X.Y.Z --owner mahmoud-nb  # once the repository is public
```

## Hardening your installation

Production guidance (HTTPS, reverse proxy, trusted proxies, secrets, dedicated media domain, worker container
hardening) is in [setup.md § 10 to § 12](setup.md#12-production-checklist) and in the security guide of the documentation website
(`apps/website/src/content/docs/guides/security.md`).

---

# Politique de sécurité

## Signaler une vulnérabilité

**Ne signalez pas de vulnérabilité dans une issue, une discussion ou une pull request publique.**

Utilisez le signalement privé de GitHub :
[**Report a vulnerability**](https://github.com/mahmoud-nb/surge-media/security/advisories/new)
(dépôt › *Security* › *Report a vulnerability*). Seuls les mainteneurs lisent le signalement, et le correctif peut
être préparé dans une copie privée du dépôt avant toute publication.

Si vous ne pouvez pas utiliser ce formulaire, ouvrez une issue publique qui demande seulement un canal de contact
privé, **sans aucun détail** sur la vulnérabilité.

Indiquez si possible : le composant et sa version, la configuration utile (base, stockage, mode de traitement des
vidéos, mandataire inverse), les étapes pour reproduire, une preuve de concept, l'impact constaté, et si vous
souhaitez être cité et sous quel nom.

## Versions maintenues

Avant la version 1.0.0, seule la dernière ligne de versions de `@surge-media/core` (paquet npm et images
`ghcr.io/mahmoud-nb/surge-media`) reçoit les correctifs de sécurité, ainsi que la dernière version de
`@surge-media/client` et de `@surge-media/vue`. Une ancienne ligne (`release-X.Y`) n'en reçoit que si un correctif
est annoncé pour elle. Les correctifs sont publiés en versions de correctif sur npm et GHCR.

## Traitement d'un signalement

Objectifs des mainteneurs, pas des engagements contractuels (clients sous licence commerciale : voir votre contrat) :

| Étape | Objectif |
| --- | --- |
| Accusé de réception | 3 jours ouvrés |
| Première analyse (validité, gravité, versions touchées) | 10 jours ouvrés |
| Correctif publié, gravité critique | 14 jours après confirmation |
| Correctif publié, gravité élevée | 30 jours après confirmation |
| Correctif publié, gravité moyenne | 90 jours après confirmation |
| Correctif publié, gravité faible | prochaine version prévue |

La gravité est évaluée avec CVSS. Nous vous tenons informé et convenons avec vous de la date de publication : par
défaut à la sortie du correctif, au plus tard 90 jours après le signalement sauf accord contraire. À la sortie du
correctif, nous publions un avis de sécurité GitHub, demandons un identifiant CVE par GitHub quand c'est justifié et
vous citons, sauf si vous préférez rester anonyme. Pour être prévenu : *Watch* › *Custom* › *Security alerts* sur le
dépôt. Il n'existe pas de programme de récompense.

## Périmètre

Dans le périmètre : le serveur `@surge-media/core` (administration, authentification et sessions, API `/api/v1`,
diffusion `/m/`, transformations d'images, traitement des vidéos, CLI), l'image Docker officielle et les exemples
Compose du dépôt, les bibliothèques `@surge-media/client` et `@surge-media/vue`.

Hors périmètre : les vulnérabilités des dépendances et paquets système (ffmpeg, libvips, Debian) sans impact
démontré sur SurgeMedia, à signaler en amont ; les installations contraires au guide de production (HTTP sans TLS,
port de l'application exposé sans mandataire, mandataires non fiables admis par `NUXT_TRUST_PROXY`) ; les en-têtes
que la documentation confie au mandataire (`Strict-Transport-Security`) ; le déni de service volumétrique et
l'épuisement des limites de débit documentées ; les attaques qui exigent un compte administrateur ou un accès au
serveur ou à la base ; les fonctionnalités absentes et documentées, comme l'authentification unique (des demandes
d'évolution, pas des vulnérabilités) ; l'ingénierie sociale et les
attaques physiques.

## Règles de test

SurgeMedia est auto-hébergé. Testez **uniquement sur une instance que vous avez installée vous-même** (la licence
autorise tout usage hors production), jamais sur l'installation d'un tiers sans son accord écrit. La démo publique
est partagée avec d'autres visiteurs et remise à zéro toutes les deux heures : n'y testez rien. N'accédez pas aux données d'autrui, ne les modifiez pas, ne les
supprimez pas, et ne dégradez pas un service utilisé par d'autres. Nous n'engagerons aucune poursuite contre une
recherche menée de bonne foi dans le respect de cette politique, et nous traitons votre signalement de manière
confidentielle.

## Chaîne d'approvisionnement

Ce que traverse chaque modification et chaque version (`.github/workflows`) :

- **Dépendances** : Dependabot chaque semaine, jamais pour une version publiée depuis moins de 7 jours. `pnpm audit` à
  chaque pull request, à chaque push, chaque lundi et avant chaque version : une alerte élevée ou critique dans ce
  qui est livré (le serveur et tout ce que sa build embarque, les dépendances d'exécution des bibliothèques) bloque,
  sauf exception écrite qui explique pourquoi elle ne s'applique pas. Une exception expire au bout de 90 jours au plus
  ([`security/audit-exceptions.json`](security/audit-exceptions.json)).
- **Image Docker** : analysée par Trivy (paquets du système, ffmpeg, paquets Node) en intégration continue, chaque lundi
  et avant chaque publication. Une vulnérabilité élevée ou critique corrigée en amont bloque, selon les mêmes règles
  ([`security/trivyignore.yaml`](security/trivyignore.yaml)).
- **Secrets** : nouveaux commits examinés par gitleaks.
- **Workflows** : actions tierces épinglées par empreinte de commit, permissions minimales, vérification par zizmor ;
  les workflows de publication n'utilisent aucun cache de build qu'un autre workflow aurait pu écrire.
- **Chaque version** : SBOM (SPDX, attachés aux images ; CycloneDX pour le paquet npm, joint à la release GitHub),
  `SHA256SUMS` et provenance de build des images (BuildKit).

Une fois le dépôt public, CodeQL et OpenSSF Scorecard s'y ajoutent, et le paquet npm comme les images portent une
provenance signée (provenance npm, attestations GitHub). Vérifier une version avant de l'installer : voir les
commandes de la version anglaise ci-dessus.

## Durcir votre installation

Recommandations de production (HTTPS, mandataire inverse, mandataires de confiance, secrets, domaine de diffusion
dédié, conteneur de travail durci) : [setup.md § 10 à § 12](setup.md#12-production-checklist) et le guide de sécurité du site de
documentation (`apps/website/src/content/docs/fr/guides/security.md`).
