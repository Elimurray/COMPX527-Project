# PROGRESS — Disaster & Emergency Resource Finder

Living checklist for the COMPX527 group project. Tick items as they land, and update
**Status** at the top of each milestone. Architecture and scope live in [CLAUDE.md](CLAUDE.md);
this file only tracks *what is done and what is next*.

**Last updated:** 2026-09-16 · **Current milestone:** M6 — frontend map

---

## Decisions locked

| Decision | Choice | Locked |
|---|---|---|
| Language | **TypeScript everywhere** — Lambdas, frontend, and IaC | 2026-09-09 |
| IaC tool | **AWS CDK (TypeScript)** | 2026-09-09 |
| Repo layout | Single monorepo: `infra/`, `services/`, `web/`, `shared/` | 2026-09-09 |

## Decisions still open

| Decision | Needed by | Owner | Notes |
|---|---|---|---|
| DynamoDB key schema for reports | M2 | Sunita + Eli | Likely PK = geohash prefix, SK = ISO timestamp. Drives every query later — do not defer past M2. |
| ~~How "nearby" is computed~~ | — | Eli | **Settled M5:** geohash cells covering the requested bbox, one bounded Query each. |
| ~~SNS fan-out targeting~~ | — | Eli | **Settled M5:** one topic, subscription filter policies on the `geohash` message attribute. |
| CI/CD host | M6 | Alexander | GitHub Actions vs CodePipeline. Actions is likely simpler given the repo is on GitHub. |

---

## Milestone overview

| # | Milestone | Target week | Owner | Status |
|---|---|---|---|---|
| M0 | Foundations — repo, decisions, tooling | 1 | Eli | 🟡 In progress |
| M1 | AWS account guardrails & IAM | 1 | Eli | ✅ Done (deviations) |
| M2 | CDK app + core infra | 2 | Eli | 🟡 Storage + Auth live |
| M3 | Auth → API → Lambda walking skeleton | 2–3 | Eli | ✅ Deployed + verified |
| M4 | Data ingestion pipeline (NOAA/FEMA) | 3 | Sunita | ⬜ Not started |
| M5 | Reporting & alerting pipeline (SQS/SNS) | 4–5 | Eli | ✅ Deployed + verified |
| M6 | Frontend map on CloudFront | 4–5 | Eli | 🟡 Written, not deployed |
| M7 | Security hardening & load testing | 6–7 | Alexander | ⬜ Not started |
| M8 | Deployment automation, demo, report | 8 + final | All | ⬜ Not started |

| M6b | Elastic Load Balancing (required) | — | Eli | 🟡 Written, not deployed |

Legend: ⬜ not started · 🟡 in progress · ✅ done · 🔴 blocked

---

## M0 — Foundations
**Owner:** Eli · **Target:** Week 1 · **Status:** 🟡 In progress

Nothing else can start cleanly until the repo shape and toolchain are agreed.

- [x] `CLAUDE.md` written (kept local — gitignored, not shared with the team)
- [x] `.gitignore` covering secrets, `node_modules/`, `cdk.out/`, and local editor state
- [x] Language decision: TypeScript everywhere
- [x] IaC decision: AWS CDK
- [ ] Initial commit + push to GitHub, `main` as default branch
- [ ] Branch protection on `main` (require PR + 1 review) — cheap insurance for a 4-person team
- [x] Monorepo skeleton created: `infra/` `services/` `web/` `shared/`
- [x] Root `package.json` with npm workspaces, shared `tsconfig.base.json`, ESLint + Prettier
- [x] `.env.example` documenting every env var (never a real `.env`)
- [x] `README.md` with setup, everyday commands, AWS/CDK usage, and cost discipline
- [x] `npm run verify` (format + lint + build) passes clean on a fresh install
- [ ] All four members can clone, `npm install`, and run `npm run build` locally

**Exit criteria:** every member has the repo building locally and the toolchain is not up for debate again.

---

## M1 — AWS account guardrails & IAM
**Owner:** Eli · **Completed:** 2026-09-11 · **Status:** ✅ Done (with deviations)

Full record, including what was skipped and why:
**[docs/m1-aws-setup.md](docs/m1-aws-setup.md)**.

**Account `339254022271`**, region **us-east-1**, ceiling **NZ$60/month** (US$30 budget).

- [x] Org reality check — `sts get-caller-identity` works, account ID recorded, no SCP blocks
- [x] Region settled: **us-east-1** (mandated by a separate individual assignment, carried
      over). Pinned in `infra/lib/config.ts`; a mismatched account now fails at synth.
- [x] AWS Budgets live: US$30/month, 40 / 60 / 80% actual + 100% forecasted
- [x] Cost Anomaly Detection live: US$5 threshold
- [x] CloudWatch billing alarm confirmed **unavailable** (`AWS/Billing` empty — member
      account, as predicted). Budgets + Anomaly Detection are the two tripwires. Worth a
      paragraph in the report.
- [x] Root hardened: MFA on, access keys removed, password in the team manager
- [x] CLI configured against the IAM user, with `get-session-token` for MFA'd sessions
- [x] Service roles left to CDK, as planned — none hand-made
- [x] `cdk bootstrap aws://339254022271/us-east-1` succeeded
- [~] **Deviation:** the four-group / `derf-baseline` / per-area policy structure was
      skipped. Work narrowed to solo, so the account runs on a single IAM user with
      `AdministratorAccess` attached directly (MFA enabled). Consequence for M7 is recorded
      in the runbook — short version: the least-privilege story now rests entirely on
      CDK-generated service roles, which is the stronger half anyway, and the group
      policies remain available to add later if the review needs human-IAM evidence.

**Exit criteria met:** root unused, spend is fenced by two independent tripwires, and the
account is bootstrapped for CDK.

---

## M2 — CDK app + core infra
**Owner:** Eli · **Target:** Week 2 · **Status:** 🟡 Storage + Auth deployed and verified; Api/Pipeline still shells

From here on, **every AWS resource is created by CDK, not by clicking**.

### Done
- [x] `cdk bootstrap` run against `339254022271` / `us-east-1`
- [x] `infra/lib/config.ts` — account and region pinned, stage resolution, resource naming
- [x] Four stacks wired in `infra/bin/app.ts`, all tagged for cost allocation:
      `Derf-dev-Storage`, `Derf-dev-Auth`, `Derf-dev-Api`, `Derf-dev-Pipeline`
- [x] `StorageStack` filled out and verified in the synthesised template:
  - [x] Three S3 buckets — `derf-dev-data-*`, `derf-dev-images-*`, `derf-dev-web-*`
  - [x] SSE-S3 encryption at rest on all three (KMS skipped deliberately: ~US$1/month/key
        plus request charges is real money against this budget)
  - [x] Public access fully blocked, and TLS enforced by bucket policy
  - [x] Lifecycle rules: abort incomplete multipart uploads after 7 days; `raw/` prefix to
        Infrequent Access after 30 days (bounds the NOAA/FEMA storage footprint)
  - [x] CORS on the images bucket for pre-signed browser uploads
  - [x] No `autoDeleteObjects` — dropped deliberately to avoid the Lambda + IAM role it
        adds (`s3:DeleteObject*`, `s3:PutBucketPolicy` over every bucket). StorageStack
        synthesises to **8 resources, zero IAM roles, zero Lambdas**. Teardown requires
        emptying buckets manually first — see README, "Tearing down".
  - [x] DynamoDB `derf-dev-reports`: PK `geohash`, SK `reportedAtId`, on-demand billing,
        AWS-managed encryption, TTL on `expiresAt`, PITR in prod only
- [x] `reportSortKey()` / `parseReportSortKey()` / `ReportItem` added to `@derf/shared`
- [x] `cdk synth` clean, no warnings; `npm run verify` green

### Remaining
- [x] **`Derf-dev-Storage` deployed 2026-09-11** — 9/9 resources created, no rollback.
      Confirmed absent from the live event log: zero `AWS::IAM::Role`, zero
      `AWS::Lambda::Function`. Outputs: `derf-dev-data-339254022271`,
      `derf-dev-images-339254022271`, `derf-dev-web-339254022271`, `derf-dev-reports`.
- [x] **Live resources verified 2026-09-11** (not just the template — this is the M7 evidence):
  - [x] `derf-dev-data-*`: `SSEAlgorithm: AES256`; all four public-access blocks `true`;
        bucket policy is exactly one statement, `Deny s3:*` when `aws:SecureTransport=false`
  - [x] `derf-dev-reports`: PK `geohash` / SK `reportedAtId`, `PAY_PER_REQUEST`, `ACTIVE`,
        TTL `ENABLED` on `expiresAt`
  - [x] Table encryption is **explicitly configured, not the AWS default** —
        `SSEType: KMS` with a real `KMSMasterKeyArn`. An AWS-owned-key table returns no
        `SSEDescription` at all, so this is the distinction the report should draw.
- [ ] Record the four stack outputs in local `.env`
- [x] **`Derf-dev-Auth` deployed and verified 2026-09-11** — pool `us-east-1_Zx0PZsBBF`,
      client `4turmnsmh7fiu5oum9a3qe5td6`. Live checks: `UserPoolTier: LITE`,
      `MfaConfiguration: OPTIONAL`, `SoftwareTokenMfaConfiguration.Enabled: true`, and
      **no `SmsMfaConfiguration`** — confirming no per-message SNS spend is possible.
      (`describe-user-pool` does not return `EnabledMfas`; `get-user-pool-mfa-config` is
      the call that actually proves this.)
- [x] `AuthStack` written — Cognito user pool + web client:
  - [x] Self sign-up, email as sign-in alias, email auto-verified
  - [x] Password policy: 12 chars, upper/lower/digits, symbols optional (length over
        composition, per current NIST guidance)
  - [x] MFA optional, **TOTP only — SMS deliberately disabled** so no per-message SNS spend
  - [x] `FeaturePlan.LITE` pinned; new pools otherwise default to Essentials, which is
        priced higher per monthly active user
  - [x] Client: no secret, SRP-only auth flows (no plaintext-password flow even by
        accident), `preventUserExistenceErrors` on
  - [ ] No OAuth/hosted-UI config — callback URLs need the CloudFront domain, so that is an
        M6 decision
  - [ ] `WebAuthnConfiguration: SINGLE_FACTOR` appeared by Cognito default. Inert without a
        relying-party ID, and free — note it in the M7 review rather than acting on it now.
- [ ] Deploy the remaining stacks once they have real content (empty shells are not worth
      deploying — they create CloudFormation stacks you then have to clean up)
- [ ] `cdk deploy` succeeds from a clean checkout on another machine

> **Sort key deviation, recorded deliberately.** The plan said SK = ISO timestamp. It is
> implemented as `<ISO timestamp>#<reportId>`. ISO-8601 still sorts lexicographically so
> time-range queries are unchanged, but a bare timestamp would let two reports filed in the
> same geohash cell in the same millisecond overwrite each other — realistic during exactly
> the surge this system exists for, and silent when it happens.

**Exit criteria:** the whole environment can be destroyed and recreated from the repo alone.

---

## M3 — Walking skeleton (auth → API → Lambda)
**Owner:** Eli · **Target:** Weeks 2–3 · **Status:** ⬜

Prove the path end to end with trivial logic *before* building real features on top of it.

- [x] HTTP API with a Cognito JWT authorizer as the **API-wide default**, so routes fail
      closed — a route added later is authenticated unless it explicitly opts out
- [x] Four handlers written and bundling cleanly with esbuild (1.4–4.1 kB each, no Docker):
      `health.ts`, `me.ts`, `reports-list.ts`, `reports-create.ts`
- [x] Route auth verified in the synthesised template:
      `GET /health` NONE · `GET /me` JWT · `GET /reports` NONE · `POST /reports` JWT
- [x] Reading reports is public by design — during a disaster, finding a shelter must not
      require an account. Submitting one is authenticated, so reports stay attributable.
- [x] Shared TypeScript types for API request/response in `shared/` (done early in M0)
- [x] `POST /reports` validates input and returns 202; `GET /reports?bbox=...` returns
      fixture data, so the frontend has a real contract before the backend exists
- [x] Structured JSON logging in every handler, plus a shared `ok()`/`fail()` response
      helper so every error carries a `requestId` traceable to CloudWatch
- [x] Least privilege confirmed in the template: each Lambda role holds **only**
      `AWSLambdaBasicExecutionRole`, zero inline policies, and no `dynamodb:` or `s3:`
      actions anywhere — grants come in M4/M5 when the code actually reads or writes
- [x] Explicit log groups at 14-day retention (the `logRetention` prop was avoided: it
      provisions a custom-resource Lambda and IAM role to do the same job)
- [x] ARM64/Graviton, 256 MB, 10s timeout, source maps enabled for real stack traces
- [x] **`Derf-dev-Api` deployed 2026-09-11** — `https://a32044zzhl.execute-api.us-east-1.amazonaws.com`
- [x] **Verified against the live API** (no credentials used — these are public endpoints):
  - [x] `GET /health` → 200 `{"status":"ok","stage":"dev"}`
  - [x] `GET /me` → **401** unauthenticated
  - [x] `GET /reports?bbox=174,-37,175,-36` → 200, two fixture reports centred on the bbox
  - [x] `POST /reports` with no token and an invalid `{}` body → **401, not 400**. The
        authorizer runs before handler code, so unauthenticated requests never reach
        application logic. This is the milestone's real proof.
  - [x] `GET /reports?bbox=nonsense` → 400 with a structured error carrying
        `requestId`, traceable to the matching CloudWatch log line
- [ ] Authenticated `/me` → 200 with claims (needs a test Cognito user + token)

**Exit criteria:** the auth boundary is proven, and the frontend has a stable API contract to code against.

---

## M4 — Data ingestion (NOAA / FEMA)
**Owner:** Sunita · **Target:** Week 3 · **Status:** ⬜

- [ ] Exact dataset endpoints identified and recorded here (NOAA GHCN, NOAA storm events,
      FEMA disaster declarations, FEMA National Risk Index)
- [ ] Raw pulls landed in the datasets S3 bucket, partitioned by dataset and date
- [ ] Transform step producing map-ready records (trimmed fields, normalised geo)
- [ ] Ingestion Lambda on an EventBridge schedule — cadence agreed and documented
      (these are historical/event datasets; daily or weekly batch is almost certainly enough)
- [ ] Failure alarm on the ingestion Lambda so a silent breakage is noticed
- [ ] Cost check: confirm the S3 storage footprint is bounded, with lifecycle rules if not

**Exit criteria:** authoritative disaster context is queryable without a manual step.

---

## M5 — Reporting & alerting pipeline
**Owner:** Eli · **Target:** Weeks 4–5 · **Status:** ✅ Core deployed and verified end to end (3 follow-ups open)

- [x] SQS queue with a **dead-letter queue** — `derf-dev-reports` (visibility 180s = 6x the
      30s processing timeout, 4-day retention) redriving to `derf-dev-reports-dlq` after
      3 attempts, 14-day retention. Both queues `enforceSSL`.
- [x] `POST /reports` validates input, enqueues, and returns 202. The id is minted before
      the queue so the downstream write can be made idempotent.
- [x] Processing Lambda consumes the queue and writes to DynamoDB, **idempotent** via
      `ConditionExpression: attribute_not_exists(...)` — SQS is at-least-once, so duplicate
      delivery is normal and must not double-write.
- [x] **Partial batch failure reporting** (`ReportBatchItemFailures`). Without it, one bad
      message fails the whole batch of ten and drags nine already-written reports to the DLQ.
- [x] Geohash bucketing on write; `GET /reports` now runs one bounded Query per covering
      cell. **No Scan anywhere in the read path.**
- [x] `shared/src/geo.ts` — geohash encoder verified against the canonical reference value
      (`57.64911,10.40744` → `u4pruydqqvj`); bbox coverage capped at 64 cells so a
      zoomed-out viewport cannot fan out unboundedly
- [x] SNS: **one topic + subscription filter policies** (settles the open decision). The
      processor publishes `geohash`, `resourceType` and `status` as *message attributes*,
      because filter policies can only match attributes — that is what lets a subscriber get
      alerts for their own area instead of every report nationwide.
- [x] Notification is deliberately narrow: status `unavailable`, or capacity ≥ 90%. An alert
      that fires for every report trains people to ignore alerts.
- [x] **CloudWatch alarm on DLQ depth > 0**, wired to a separate ops topic. Threshold is
      zero, not a tolerance band — any dead-lettered message is a report a user submitted
      and the system lost.
- [x] IAM narrowed to match the code exactly, verified in the template:
      processor = `dynamodb:PutItem` + `sns:Publish`; reader = `dynamodb:Query`;
      submitter = `sqs:SendMessage`. Notably **nothing in the system may update or delete a
      stored report** — `grantWriteData` would have permitted that, so an explicit
      single-action grant was used instead.
- [x] **`Derf-dev-Pipeline` deployed 2026-09-11** — 14/14 resources, no rollback.
      Queue `https://sqs.us-east-1.amazonaws.com/339254022271/derf-dev-reports`,
      DLQ `derf-dev-reports-dlq`, topics `derf-dev-alerts` and `derf-dev-ops-alerts`.
- [x] Caught before deploying: dropping `IMAGES_BUCKET` from the CreateReport handler would
      have deleted a Storage export that the live Api stack still imports, failing the
      update mid-flight. `cdk diff` surfaced it because it shows dependency-stack changes
      before anything is applied — worth citing in the report as an IaC-over-console win.
- [x] **`Derf-dev-Api` deployed 2026-09-11** — two new IAM policies, exactly
      `sqs:SendMessage` (CreateReport) and `dynamodb:Query` (ListReports)
- [x] **Read path verified live**: `GET /reports?bbox=174.70,-36.90,174.82,-36.80` returns
      `{"reports":[]}` — no longer fixture data, so the geohash→Query path really runs.
      An empty array rather than a 500 also confirms the `dynamodb:Query` grant is correct.
- [x] Auth still holds after the rewrite: `/me` 401, `POST /reports` 401 with a **valid** body
- [ ] Subscribe an email to the ops topic so the DLQ alarm reaches someone
- [ ] End-to-end test: authenticated POST → 202 → row in DynamoDB → alert published
- [ ] Report image upload via pre-signed S3 URLs (still to do)

**Exit criteria:** a report submitted through the API appears on the map and triggers the right alert.

---

## M6 — Frontend map on CloudFront
**Owner:** Eli · **Target:** Weeks 4–5 · **Status:** 🟡 Written and synthesising, **not yet deployed**

- [x] `WebStack` — CloudFront + private S3 origin via **Origin Access Control**. Bucket
      policy verified in the template: TLS-deny plus `s3:GetObject` for
      `cloudfront.amazonaws.com` only. The bucket is never public.
- [x] **Frontend bucket moved from StorageStack into WebStack.** OAC attaches a bucket
      policy naming the distribution, so a bucket in one stack and a distribution in
      another is a genuine dependency cycle — CDK refused to synth. Bucket and
      distribution must share a stack.
- [x] SPA fallbacks: 403/404 → `/index.html` with status 200, so client routing works
- [x] `PRICE_CLASS_ALL` (includes Oceania — the actual audience); HTTP/2 + HTTP/3
- [x] No `BucketDeployment` construct — it would provision a custom-resource Lambda and
      IAM role. `npm run deploy:web` uses `aws s3 sync` instead, which is also what the
      M8 pipeline will run, so the deploy path is identical by hand and in CI.
- [x] Deploy script reads bucket and distribution id from stack outputs (nothing
      hardcoded), uploads hashed assets with a one-year immutable cache, uploads
      `index.html` with `no-cache`, then invalidates only `/index.html`
- [x] Map UI on **MapLibre GL + OpenStreetMap raster tiles** — no API key or account,
      unlike Mapbox. OSM's usage policy suits a coursework demo but would need a hosted
      tile provider for real deployment.
- [x] Markers coloured by status; popups escape user-submitted text before injecting it
- [x] Viewport drives the query — `moveend`, not `move`, so panning issues one request
      when it stops rather than one per frame
- [x] Cognito sign-up → email code → confirm → sign-in, all **SRP** via
      `amazon-cognito-identity-js`. No plaintext-password flow is enabled anywhere.
- [x] Authenticated report form: type, status, capacity (shelters), note, pick-on-map
- [x] Submission UX matches the 202 contract — tells the user the report is *accepted*,
      then refreshes after the pipeline has had a moment, rather than pretending the
      write is synchronous
- [x] Sends the **access** token, not the id token — the API Gateway JWT authorizer
      validates the access token, and sending the wrong one is the usual cause of a
      mystery 401
- [x] Mobile layout at ≤760px: most users of a disaster tool are on a phone
- [ ] **Deploy** `Derf-dev-Storage` (releases the old bucket) then `Derf-dev-Web`
- [ ] `npm run deploy:web` to publish the built site
- [ ] Verify: sign up, sign in, submit a report, watch it appear on the map
- [ ] Tighten CORS from `*` to the CloudFront domain, on both the API and the images bucket
- [x] **Fixed: zoomed-out viewports silently returned zero reports.** `cellsForBoundingBox`
      caps coverage at 64 cells; a view of upper NZ needs ~7,107, so iteration stopped in
      the corner and never reached the area holding reports. The `truncated` flag existed
      but was only logged, never returned. It is now part of `ListReportsResponse`, and the
      UI says "this area is too large to search completely — zoom in" instead of "no
      reports in this area yet". Telling someone there is nothing near them when the server
      did not look is the most harmful way this screen could be wrong.
- [ ] Known: the JS bundle is ~356 kB gzipped, nearly all MapLibre. Acceptable for a demo;
      code-splitting the map behind `React.lazy` would cut first load if it matters.
- [ ] Known limitation: coverage is single-resolution. Proper fix is storing coarser
      geohash prefixes (`geohash4`, `geohash3`) with GSIs and choosing resolution by
      viewport — real multi-resolution querying, at the cost of extra write capacity.

**Exit criteria:** a non-team-member can open the URL, sign up, file a report, and see it on the map.

---

## M6b — Elastic Load Balancing (assignment requirement)
**Owner:** Eli · **Status:** 🟡 Written and synthesising, **not yet deployed**

The brief requires ELB, CloudWatch **and** IAM. ELB was previously cut on cost grounds;
that was wrong against this rubric and is now corrected.

- [x] `AlbStack` — its own stack so it can be destroyed independently after the demo
- [x] VPC with **public subnets only across 2 AZs, `natGateways: 0`** — verified in the
      template: **0 NAT Gateways, 0 Elastic IPs**. CDK's default VPC would have created a
      NAT per AZ at ~US$32/month each.
- [x] ALB → **Lambda target group** (`targetType: lambda`), health check on `/health`
      every 300s (each check is a billable invocation)
- [x] `alb-reports.ts` handler — ALB event/response shape differs from API Gateway v2, and
      ALB does **not** URL-decode query values, so bbox is decoded explicitly
- [x] Query logic extracted to `lib/reports-query.ts` and shared by both ingresses, so the
      two cannot drift
- [x] Same narrow grant as the API path: `dynamodb:Query` only
- [ ] Deploy `Derf-dev-Alb`
- [ ] Compare both ingresses in the report (latency, TLS, cost)
- [ ] **Destroy after the demo** — this is the only stack that bills while idle

> **HTTP only.** Terminating TLS on an ALB needs an ACM certificate, which the brief
> prohibits. API Gateway provides HTTPS with no certificate management, so on transport
> security the API Gateway path is strictly better — a genuine finding for the report
> rather than an excuse.

**Exit criteria:** ELB is used for real traffic, and its cost is bounded and documented.

---

## M7 — Security hardening & load testing
**Owner:** Alexander · **Target:** Weeks 6–7 · **Status:** ⬜

- [ ] Full IAM review — tighten the service-level wildcards in the M1 group policies
      ([docs/m1-aws-setup.md](docs/m1-aws-setup.md) §4c) against actual CloudTrail usage, or
      justify each in writing
- [ ] Encryption at rest **verified** on every DynamoDB table and S3 bucket (checked, not assumed)
- [ ] S3 public access block confirmed on all buckets
- [ ] API input validation and rate limiting / throttling on API Gateway
- [ ] Load test the SQS submission path against a simulated surge; record the numbers here
- [ ] CloudWatch dashboard: API latency, Lambda errors/throttles, DynamoDB capacity, SQS depth, DLQ depth
- [ ] Alarms wired to SNS/email — including a **DLQ-not-empty** alarm
- [ ] CloudTrail enabled for an audit trail
- [ ] Cost review against budget; pause anything non-essential

**Exit criteria:** measured evidence of both security posture and surge behaviour — this is what the report is written from.

---

## M8 — Deployment automation, demo, report
**Owner:** All · **Target:** Week 8 + final week · **Status:** ⬜

- [ ] CI: lint + typecheck + test on every PR
- [ ] CD: `cdk deploy` on merge to `main` via the deployment role
- [ ] Frontend build → S3 sync → CloudFront invalidation, automated
- [ ] Teardown/redeploy rehearsed once, from scratch, to prove the automation
- [ ] Demo script written and rehearsed, with seeded demo data ready
- [ ] Architecture diagram matching what was actually built (not the proposal)
- [ ] Report drafted; peer evaluations submitted
- [ ] Post-demo: destroy or scale down billable resources

**Exit criteria:** submitted, and nothing is quietly accruing cost afterwards.

---

## Risks being watched

| Risk | Mitigation | Owner |
|---|---|---|
| AWS spend creeping past credits | Budgets + CloudWatch billing alarm (M1), on-demand DynamoDB, teardown after demo | Alexander |
| Console-clicked resources breaking Week 8 automation | Everything through CDK from M2 onward | Eli |
| DynamoDB key schema reworked late | Settle it in M2 before any real writes exist | Sunita + Eli |
| Frontend blocked waiting on backend | Stubbed endpoints with a fixed contract in M3 | Eli |
| Silent data loss under surge | DLQ + alarm from the moment SQS exists | Alexander |
