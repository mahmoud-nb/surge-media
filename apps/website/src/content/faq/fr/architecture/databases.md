---
question: "Quelles bases de données sont prises en charge ?"
order: 3
status: available
keywords: ["base de données","sqlite","postgresql","postgres","mysql","mariadb","migrations"]
---
SQLite, PostgreSQL et MySQL / MariaDB, avec la même image. Les migrations s’appliquent automatiquement au démarrage.

SQLite suffit pour un serveur unique et un trafic modéré. Passez à PostgreSQL ou à MySQL dès qu’il faut plusieurs instances ou des écritures soutenues : le tableau de bord vous prévient quand SQLite devient un goulet d’étranglement.
