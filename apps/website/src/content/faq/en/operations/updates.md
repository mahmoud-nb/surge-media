---
question: "How do I update surgeMedia?"
order: 5
keywords: ["update","upgrade","migration","version","semver","changelog","rollback"]
---
Pull the new image and recreate the containers: database migrations are applied at startup, in a few seconds. With several instances, run the `migrate` command once before deploying.

Versions follow SemVer, and every change is described in the changelog. Migrations only go forward: take a backup before each update.
