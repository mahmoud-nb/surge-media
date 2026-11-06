---
question: "Comment signaler une vulnérabilité, et comment sont-elles corrigées ?"
order: 7
keywords: ["vulnérabilité","faille","signalement","cve","divulgation","dependabot","correctif","security.md","sbom","trivy","chaîne d’approvisionnement"]
---
Par le formulaire de signalement privé de GitHub, jamais dans une issue publique : la [politique de sécurité](https://github.com/mahmoud-nb/surge-media/blob/main/SECURITY.md) détaille la marche à suivre.

Nos objectifs : un accusé de réception sous 3 jours ouvrés, un correctif sous 14 jours pour une faille critique et sous 30 jours pour une faille élevée, puis un avis de sécurité public. Les dépendances sont mises à jour chaque semaine par Dependabot et auditées à chaque modification, chaque lundi et avant chaque version ; l’image Docker est analysée avant d’être publiée. Une faille élevée ou critique dans ce que nous livrons bloque la publication, sauf exception écrite et limitée dans le temps qui explique pourquoi elle ne s’applique pas. Chaque version est accompagnée de SBOM et d’empreintes.
