# Changelog

All notable changes to SurgeMedia — the `@surge-media/core` npm package and the
`ghcr.io/mahmoud-nb/surge-media` Docker images — are documented in this file. Versions follow
[Semantic Versioning](https://semver.org); entries are generated from
[Conventional Commits](https://www.conventionalcommits.org) by `pnpm release`.

## 0.1.0 (2026-11-20)

### ⚠ BREAKING CHANGES

* **core:** Move sessions to NUXT_APP_SECRET with nuxt-auth-utils 0.6 ([#42](https://github.com/mahmoud-nb/surge-media/issues/42))

### Features

* Add admin dashboard components and API ([4b7ce77](https://github.com/mahmoud-nb/surge-media/commit/4b7ce77e6f608ebd0effa54d688bae14ee17d062))
* Add API endpoints and schema for text track and poster management ([68b2c83](https://github.com/mahmoud-nb/surge-media/commit/68b2c83c3eaf0af0a0b2237e5d05b58f491b350f))
* Add audit logging module, credential management updates, and UI enhancements ([ec60bb9](https://github.com/mahmoud-nb/surge-media/commit/ec60bb9ffdb6b6f08a6113d564dfa745eccc3b66))
* Add comprehensive project management module with CRUD APIs, member handling, and admin UI ([9e6d791](https://github.com/mahmoud-nb/surge-media/commit/9e6d791e3bf1a18813643302556736fafbf68682))
* Add core components, layouts, schemas, middleware, plugins, and utilities for application foundation ([a459eab](https://github.com/mahmoud-nb/surge-media/commit/a459eab4f92012b0243f41adf1043191a4271cf4))
* Add cropping and density features to address generator (Phase C4) ([26a4e9b](https://github.com/mahmoud-nb/surge-media/commit/26a4e9b38136b3bc756dd23427d640e887d47085))
* Add database pressure monitoring and assessment system for SQLite ([b6b9968](https://github.com/mahmoud-nb/surge-media/commit/b6b99684df41b6b925b4b928dbc0991eb8e8772b))
* Add delegated token support for media access and project APIs ([6be4432](https://github.com/mahmoud-nb/surge-media/commit/6be44320b4f5a5ecfc728af3d0ffa3d13ae7c22a))
* Add email support for password links ([8de5133](https://github.com/mahmoud-nb/surge-media/commit/8de5133a7713db10cd7c1c564a8860441243eb69))
* Add folder management APIs, admin UI components, and utilities ([d1c23d2](https://github.com/mahmoud-nb/surge-media/commit/d1c23d253510edd6a798ed89f85df9f02e9dcacc))
* Add interactive API console, OpenAPI integration, and session-linked credentials ([1e290e6](https://github.com/mahmoud-nb/surge-media/commit/1e290e606cbc5790aa677edd22cc5f4172b5b854))
* Add manager role, invitation system, role-based project management, and membership normalization ([d398943](https://github.com/mahmoud-nb/surge-media/commit/d398943fb84c729897c6c12919cc16608e50b0a3))
* Add media focal point support and API for signed URLs (Phase C3) ([ddcce5a](https://github.com/mahmoud-nb/surge-media/commit/ddcce5ad7190390547430eb86abda3bd2f556678))
* Add media management module with API endpoints, admin interfaces, and core utilities ([d85d2af](https://github.com/mahmoud-nb/surge-media/commit/d85d2af7d34cb9468cba975f6386ffe658f39c80))
* Add media transformation API endpoints, UI enhancements, and HTML snippet generation (Phase C4) ([4efbe83](https://github.com/mahmoud-nb/surge-media/commit/4efbe83327f88769a9273e9f57642608bc2bd188))
* Add missing B1 files (projects, access control, migration, tests) ([a1a5b09](https://github.com/mahmoud-nb/surge-media/commit/a1a5b09bb1f81e56694c452f733a242ace50ddca))
* Add Phase D architecture proposal for video management ([4210fda](https://github.com/mahmoud-nb/surge-media/commit/4210fdae01820cf825ae838d7ab8ce9fff2ec8e4))
* Add transformation presets and policies management (Phase C2) ([760bfe7](https://github.com/mahmoud-nb/surge-media/commit/760bfe77427c741e3d57b3fdac1150fac0cc168d))
* Add utilities for video codec parsing, WebM probing, ISO BMFF parsing, and HTTP timeouts ([4726975](https://github.com/mahmoud-nb/surge-media/commit/4726975b50325200db43f69f4d0590edf491fe8e))
* **brand:** Draw the SurgeMedia logo and write the name SurgeMedia ([#27](https://github.com/mahmoud-nb/surge-media/issues/27)) ([329d6a6](https://github.com/mahmoud-nb/surge-media/commit/329d6a6461c464326e7ec592f612e27c57a64137))
* **brand:** Use the owner's inline SurgeMedia logo ([#30](https://github.com/mahmoud-nb/surge-media/issues/30)) ([327d8c8](https://github.com/mahmoud-nb/surge-media/commit/327d8c81efea4e6fbf2dad7081494fab0d3f0af2)), references [#29](https://github.com/mahmoud-nb/surge-media/issues/29)
* **cli:** Add surge-media diagnose, a support report without secrets ([2387b6f](https://github.com/mahmoud-nb/surge-media/commit/2387b6f12fa0e150fb8ab6fe3fc62b47e8bdf966))
* **cli:** Choose the port at setup and stop clearly when it is taken ([55fb80c](https://github.com/mahmoud-nb/surge-media/commit/55fb80ced3eeba35b4af5dcebc318d0c4b807976))
* **client:** Add file upload system with rules, progress tracking, and error handling ([eba46e1](https://github.com/mahmoud-nb/surge-media/commit/eba46e1bc41c286aa51db87e5c775743aa53b221))
* **core:** Add the commercial license key and Settings > License ([e05bc85](https://github.com/mahmoud-nb/surge-media/commit/e05bc8587d87995db18603e51f933d1f4a136769))
* **core:** Add two-factor authentication (TOTP) to the administration ([0bd5a9b](https://github.com/mahmoud-nb/surge-media/commit/0bd5a9b5dd159a507d0b506812ce760c00d00a81))
* **core:** Import existing media with `surge-media import` ([#37](https://github.com/mahmoud-nb/surge-media/issues/37)) ([252a3b7](https://github.com/mahmoud-nb/surge-media/commit/252a3b7b08e6f4fd253bfccb0d5284123e39b112))
* **core:** Move sessions to NUXT_APP_SECRET with nuxt-auth-utils 0.6 ([#42](https://github.com/mahmoud-nb/surge-media/issues/42)) ([146e835](https://github.com/mahmoud-nb/surge-media/commit/146e835c819269a6571a31fcd59c2b15374a0dd2))
* **core:** Set esbuild target to Node.js 24 to support BigInt literals ([29da94e](https://github.com/mahmoud-nb/surge-media/commit/29da94edac9f0c57ca1b83cc7b756248291e6447))
* **d3:** Add shared labels for video processing states ([eff1e23](https://github.com/mahmoud-nb/surge-media/commit/eff1e23a5d1d26d5be102109dcf62fbeaf5edfb1))
* **d3:** Add shared video sources helper for the sources[] contract ([4e975f4](https://github.com/mahmoud-nb/surge-media/commit/4e975f48b4cb5cb140d5675ee18aa4d56b873816))
* **d3:** Add video processing foundation (schema, migration, shared constants, settings) ([14177dd](https://github.com/mahmoud-nb/surge-media/commit/14177dd31047861cd8b7be2d6de8fe1ef17cb524))
* **d3:** Expose video processing and sources in API v1 and admin (module E) ([730edb1](https://github.com/mahmoud-nb/surge-media/commit/730edb18ec40ff5a2dc089ba78a80ed11c9d0cc6))
* **d3:** ffmpeg layer, rendition delivery and converted-format detection (phase B) ([4d1c7b9](https://github.com/mahmoud-nb/surge-media/commit/4d1c7b9759f1b000ad1ca39d82523331d23636da))
* **d3:** Video processing admin UI (module F) ([65f914a](https://github.com/mahmoud-nb/surge-media/commit/65f914a4d2ce43ac0be5f62fa73cc94bfad3fab1))
* **demo:** Add end-to-end demo mode support with reset intervals and reference snapshots ([e04bf66](https://github.com/mahmoud-nb/surge-media/commit/e04bf6694cdeede147a7e3ae28baed5e891e4df0))
* **demo:** Add legal notice, privacy and demo terms pages filled from environment variables ([38f5f24](https://github.com/mahmoud-nb/surge-media/commit/38f5f24cca632b613918de88e483b916ad345d11))
* **front:** Add @surge-media/client and @surge-media/vue with display components (phase E1) ([8eba94d](https://github.com/mahmoud-nb/surge-media/commit/8eba94dda3f50324e8df4889390d84d453ab3cd9))
* Implement client IP extraction and trusted proxy configuration ([6a70908](https://github.com/mahmoud-nb/surge-media/commit/6a709086fb940b296d98daecd7b9ddbfaf0e6c8f))
* Implement on-demand image transformation pipeline (Phase C) ([9bf1f3f](https://github.com/mahmoud-nb/surge-media/commit/9bf1f3fdbc9857334116868fa6978c6521478c18))
* Implement user management module with admin interfaces, API endpoints, and authentication features ([4739300](https://github.com/mahmoud-nb/surge-media/commit/473930017ddcebf76f7268d09c641913fb3e5019))
* Introduce API v1 with media and project management, rate-limiting, and improved access control ([50fdbef](https://github.com/mahmoud-nb/surge-media/commit/50fdbef33b31571f64e000ddf5fe2c87382650fe))
* Introduce trusted devices for sensitive actions ([48bf41a](https://github.com/mahmoud-nb/surge-media/commit/48bf41a90de49a98cb77b756b6ad04eca89931ba))
* **license:** Add the declared use of the instance and an optional registration email ([95354c2](https://github.com/mahmoud-nb/surge-media/commit/95354c2c04dae3bc990abd53b6ee017e526c01fa))
* Provide Docker support with multi-database Prisma clients and production-ready images ([6068407](https://github.com/mahmoud-nb/surge-media/commit/60684077715565fe844714499e6a2f0c278bb3c9))
* update icon of logo ([#29](https://github.com/mahmoud-nb/surge-media/issues/29)) ([9103459](https://github.com/mahmoud-nb/surge-media/commit/9103459839d95b42669009388d42565740166071))

### Bug Fixes

* **admin:** Keep translated labels on Scalar code samples from version 1.75 ([78083c3](https://github.com/mahmoud-nb/surge-media/commit/78083c354c87357afb93ee5874c1d9592888a686))
* **admin:** Make the API reference's code blocks keyboard accessible ([06f58be](https://github.com/mahmoud-nb/surge-media/commit/06f58beaef36c316ff069d94bafb0314370909f2))
* **core:** Import fixes found on real servers, databases and AWS S3 ([#38](https://github.com/mahmoud-nb/surge-media/issues/38)) ([3e4701e](https://github.com/mahmoud-nb/surge-media/commit/3e4701e86cb36f9fa968b35dcfb8ff2882707e68)), references [#37](https://github.com/mahmoud-nb/surge-media/issues/37)
* **core:** Make page routes case-sensitive ([e9fd74c](https://github.com/mahmoud-nb/surge-media/commit/e9fd74c1cdec756722ccefb1f50265a5fdd74af4))
* **core:** Use the surgeMedia icon in the administration ([18b72db](https://github.com/mahmoud-nb/surge-media/commit/18b72db157ce4b22b1fb27e97e2e9a0f9159b4ba))
* **d3:** Address module E review findings ([5d1089f](https://github.com/mahmoud-nb/surge-media/commit/5d1089fa55cd2f22599fb041f12e300f201d231a))
* **d3:** Address module F review findings ([3fbeb52](https://github.com/mahmoud-nb/surge-media/commit/3fbeb52f9ce87399c4737bfcd46f5f75805c13e9))
* **d3:** Address phase C review findings and add handoff notes ([fb27e13](https://github.com/mahmoud-nb/surge-media/commit/fb27e13862c00597955e59682ac1c8fca9ad75c1))
* **d3:** Detect HDR filters with ffmpeg 8 and later ([3e96e6c](https://github.com/mahmoud-nb/surge-media/commit/3e96e6c8cc719dd4698f92447e45c2936984d3cd))
* **delivery:** Let browsers play a video opened directly from /m/ ([b7e3f3c](https://github.com/mahmoud-nb/surge-media/commit/b7e3f3ccce2bb08c66a7173a2f8b5d3820cc783d))
* **demo:** Make the registration optional in the demo legal notice ([#22](https://github.com/mahmoud-nb/surge-media/issues/22)) ([6766932](https://github.com/mahmoud-nb/surge-media/commit/676693243ebb358524a1b48e2dedb208d26f6f7d))
* **release:** Count core commits with a single commitsPath ([#44](https://github.com/mahmoud-nb/surge-media/issues/44)) ([2483daf](https://github.com/mahmoud-nb/surge-media/commit/2483daf5e5ed129f8782554d9475e81435e5aea2))
* update logo ([#41](https://github.com/mahmoud-nb/surge-media/issues/41)) ([8b48f7b](https://github.com/mahmoud-nb/surge-media/commit/8b48f7be5968deeba0c77d9a8f50f8103fe5c9d9))

### Build and Distribution

* **deps-dev:** bump the minor-updates group across 1 directory with 6 updates ([#19](https://github.com/mahmoud-nb/surge-media/issues/19)) ([660b08b](https://github.com/mahmoud-nb/surge-media/commit/660b08bbddf697f990eb25fbc36e008dd12d01d4))
* **deps-dev:** bump the minor-updates group across 4 directories with 6 updates ([#33](https://github.com/mahmoud-nb/surge-media/issues/33)) ([9d5839f](https://github.com/mahmoud-nb/surge-media/commit/9d5839fad71d5b1dbac022d605d1a6cac6b7c4a8))
* **deps:** bump the minor-updates group across 1 directory with 10 updates ([#10](https://github.com/mahmoud-nb/surge-media/issues/10)) ([fdc86b5](https://github.com/mahmoud-nb/surge-media/commit/fdc86b50fdcc66e645f4ce4a186daac1a71a48d2))
* **deps:** bump the patch-updates group across 1 directory with 14 updates ([#12](https://github.com/mahmoud-nb/surge-media/issues/12)) ([3778bc8](https://github.com/mahmoud-nb/surge-media/commit/3778bc86afab75669630467c022526599f40e4c1))
* **deps:** bump the patch-updates group across 1 directory with 5 updates ([#17](https://github.com/mahmoud-nb/surge-media/issues/17)) ([c9c11c1](https://github.com/mahmoud-nb/surge-media/commit/c9c11c104f12417312a3d69f48f038ba5e91d26f))
* **deps:** bump the patch-updates group across 1 directory with 6 updates ([#36](https://github.com/mahmoud-nb/surge-media/issues/36)) ([da40438](https://github.com/mahmoud-nb/surge-media/commit/da40438e527899a6cde32ada5cc80ebd26c52b66))
* **deps:** Migrate the core to Nuxt 4.6 ([9fef7ab](https://github.com/mahmoud-nb/surge-media/commit/9fef7ab2b6ba0b8d50eb114e7d06d6abb7d0a7d9))
* **deps:** Update sharp, zod, Prisma, source-map-js and nodemailer for security fixes ([0240fb9](https://github.com/mahmoud-nb/surge-media/commit/0240fb9cb44a1480694bfaf5c90e6861e0aa8d33))
* **docker:** Remove the package managers from the runtime image ([c0cf030](https://github.com/mahmoud-nb/surge-media/commit/c0cf030145fd20a250fdee315ae5973b52c6b15d))
* Publish @surge-media/core on npm and GHCR with automated releases and refactor: Move the core application to apps/core ([b5e6f7f](https://github.com/mahmoud-nb/surge-media/commit/b5e6f7f4a4abe661cf593a3ea1b9ef9306dae201))
* **release:** Summarize long release notes and keep the core changelog to core commits ([08cf9b5](https://github.com/mahmoud-nb/surge-media/commit/08cf9b5937d35ef1a03f6b431021fed9aeb5c40a))
