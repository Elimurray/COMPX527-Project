# PROGRESS — Disaster & Emergency Resource Finder

Living checklist for the COMPX527 group project. Tick items as they land, and update
**Status** at the top of each milestone. Architecture and scope live in [CLAUDE.md](CLAUDE.md);
this file only tracks *what is done and what is next*.

**Last updated:** 2026-09-11 · **Current milestone:** M3 — walking skeleton

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
| How "nearby" is computed | M2 | Eli | Geohash bucketing (query neighbouring cells) vs radius filter in Lambda. Geohash is the cheaper read pattern. |
| SNS fan-out targeting | M4 | Alexander | Topic-per-region vs one topic with subscription filter policies. |
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
| M5 | Reporting & alerting pipeline (SQS/SNS) | 4–5 | Eli + Alexander | ⬜ Not started |
| M6 | Frontend map on CloudFront | 4–5 | Prasamsha | ⬜ Not started |
| M7 | Security hardening & load testing | 6–7 | Alexander | ⬜ Not started |
| M8 | Deployment automation, demo, report | 8 + final | All | ⬜ Not started |

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
**Owner:** Eli (pipeline) + Alexander (SQS/SNS) · **Target:** Weeks 4–5 · **Status:** ⬜

- [ ] SQS queue in front of report processing, **with a dead-letter queue** (a DLQ is not optional —
      without it, failed reports vanish silently during exactly the surge you built this for)
- [ ] `POST /reports` validates input, writes to SQS, returns 202 fast
- [ ] Processing Lambda consumes SQS → writes to DynamoDB, idempotent on report ID
- [ ] Geo bucketing applied on write so "nearby" reads are cheap
- [ ] SNS topic(s) for notifications; subscription/filter model implemented
- [ ] Conditional publish rules defined (e.g. shelter at capacity, new supply point)
- [ ] Report image upload via pre-signed S3 URLs (never proxy file bytes through Lambda)

**Exit criteria:** a report submitted through the API appears on the map and triggers the right alert.

---

## M6 — Frontend map on CloudFront
**Owner:** Prasamsha · **Target:** Weeks 4–5 · **Status:** ⬜

- [ ] Map UI rendering live reports from `GET /reports`
- [ ] NOAA/FEMA layers overlaid beneath live reports
- [ ] Cognito hosted UI (or custom form) wired for sign-up / sign-in
- [ ] Authenticated report submission form, including image upload
- [ ] CloudFront distribution in front of the frontend bucket, origin locked to OAC
- [ ] HTTPS enforced; sensible cache policy (long-cache hashed assets, no-cache `index.html`)
- [ ] Usable on a phone screen — this is a disaster tool, most users are on mobile

**Exit criteria:** a non-team-member can open the URL, sign up, file a report, and see it on the map.

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
