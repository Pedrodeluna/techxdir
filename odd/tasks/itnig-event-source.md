# Itnig event source
Objective: support the official Itnig agenda in the existing importer. Branch: `feat/itnig-event-source`.
Delivery: single-pr, one coherent provider adapter (no push or PR authorized); forecast ~700 authored lines including migration and regression tests. Runners: Deno, disposable PostgreSQL, npm lint/build.

## Specs
- S1: "ok pues adapta el importador para que admita itnig tambien". Accept the Itnig agenda as an additional source, read its official iCalendar feed, and integrate with the current scheduled source sync and admin controls without regressing Luma/Meetup.
  - Assumptions: follow the agenda without inventing category filtering; preserve current publication rules; no production activation/deployment. Existing manual Itnig records must not be duplicated or unrelated same-day records overwritten. Invalid/incomplete reads must not cancel catalog events.
  - Checks: deterministic parser/source regressions, disposable SQL migration/identity checks, existing Deno suite, lint/build, independent verifier. Native review follows the user-owned mode and candidate consent.

## Tasks
- T1 — S1 — inline — complete — commit: `f3bfeb7`. Functional verification passed; high-risk native review granted, all four lenses without findings, exact acknowledgement completed. Mapping and independent verification were delegated; no writer trigger.

## Log
- L1: User request: "ok pues adapta el importador para que admita itnig tambien".
- L2: Baseline `171bb33821332ac39f0e746417289381deb2cfd2`, clean main. Official public agenda advertises `webcal://itnig.net/api/events/calendar/?locale=es`; use HTTPS, fixed host, stable full UID. Feed contains Madrid and Barcelona events. Do not change Luma-only discovery/guest ingestion.
- L3: Risk items 1 and 3: new provider enum plus identity adoption within shared ingest. Strict Itnig-only validation and URL-scoped adoption preserve existing provider behavior. The migration must carry a full replacement function; the forecast exceeds the advisory 400-line heuristic because code, migration and their regression proofs form one provider capability.
- L4: RED observed: Deno rejected missing `itnig.ts`/provider types; disposable PostgreSQL rejected `itnig_ical` through the existing CHECK. GREEN: four initial parser/sync tests and SQL create/update/idempotence/adoption/legacy-provider assertions passed. Added official feed adapter, new migration, admission/help and provider labels. No persistent database or remote state touched.
- L5: Independent verification in isolated scratch: S1 passed, zero candidate-caused blockers. Full Deno suite 22 passed; Edge type checks, disposable SQL, lint and build passed. Six lint warnings reproduce on baseline. Four additional independent HTTP/partial-feed/Luma/admission probes passed. Parent reran the disposable SQL suite successfully. Official live read parsed 13 records, 6 upcoming; no database writes. Visual acceptance and production deployment/execution are not verified.
- L6: Native assessment initially returned high/unassessable because new files were untracked; all intended feature files will be staged and committed as one work unit before committed-range assessment. No review transaction has started. Existing add-url provider errors may escape as unstructured failures; verifier confirmed comparable baseline behavior, so no unrelated error-handling refactor was added.
- L7: User continuation: "revisa este cambio". Commit `f3bfeb7` contains 621 authored changed lines. Native risk, resilience, readability and reliability reviews ran concurrently against the immutable candidate and returned no findings. Exact acknowledgement confirmed `authority: burned` for lineage `review-62403c2066a412ed`; no correction was needed. Review boundary advanced to `f3bfeb7`. No push, deployment or production activation; visual acceptance and operational production checks remain separate.
