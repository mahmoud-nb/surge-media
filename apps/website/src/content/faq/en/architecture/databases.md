---
question: "Which databases are supported?"
order: 3
status: available
keywords: ["database","sqlite","postgresql","postgres","mysql","mariadb","migrations"]
---
SQLite, PostgreSQL and MySQL / MariaDB, with the same image. Migrations are applied automatically at startup.

SQLite is enough for a single server and moderate traffic. Move to PostgreSQL or MySQL as soon as you need several instances or sustained writes: the dashboard warns you when SQLite becomes a bottleneck.
