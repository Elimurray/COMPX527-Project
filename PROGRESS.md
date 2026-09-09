# PROGRESS — Disaster & Emergency Resource Finder

Living checklist for the COMPX527 group project. Tick items as they land, and update
**Status** at the top of each milestone. Architecture and scope live in [CLAUDE.md](CLAUDE.md);
this file only tracks *what is done and what is next*.

**Last updated:** 2026-09-09 · **Current milestone:** M0 — Foundations

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
| M1 | AWS account guardrails & IAM | 1 | Eli + Alexander | ⬜ Not started |
| M2 | CDK bootstrap + core infra deployed | 2 | Eli | ⬜ Not started |
| M3 | Auth → API → Lambda walking skeleton | 2–3 | Eli | ⬜ Not started |
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

- [x] `CLAUDE.md` written and moved to repo root (shared with the whole team)
- [x] `.gitignore` covering secrets, `node_modules/`, `cdk.out/`, and local editor state
- [x] Language decision: TypeScript everywhere
- [x] IaC decision: AWS CDK
- [ ] Initial commit + push to GitHub, `main` as default branch
- [ ] Branch protection on `main` (require PR + 1 review) — cheap insurance for a 4-person team
- [ ] Monorepo skeleton created: `infra/` `services/` `web/` `shared/`
- [ ] Root `package.json` with npm workspaces, shared `tsconfig.base.json`, ESLint + Prettier
- [ ] `.env.example` documenting every env var (never a real `.env`)
- [ ] All four members can clone, `npm install`, and run `npm run build` locally

**Exit criteria:** every member has the repo building locally and the toolchain is not up for debate again.

---

## M1 — AWS account guardrails & IAM
**Owner:** Eli (IAM) + Alexander (billing/monitoring) · **Target:** Week 1 · **Status:** ⬜

Do this **before** any resource exists. It is the one part that must be done by hand in the
console, because it is what lets everything afterwards be done in code.

### Billing tripwires (do first — protects the whole project)
- [ ] Confirm which account the team is using (student credits vs personal card) and record it here
- [ ] Enable billing alerts in the account's billing preferences
- [ ] AWS Budgets: monthly budget with alerts at 50% / 80% / 100% → team email
- [ ] CloudWatch billing alarm at a fixed USD threshold as a second, independent tripwire
- [ ] Record the agreed budget ceiling and the "pause optional services" trigger point

### Root account
- [ ] MFA on the root user; root credentials stored securely and not used day to day
- [ ] No access keys on the root user (delete any that exist)

### Team IAM
- [ ] One IAM user per member — no shared logins
- [ ] MFA enforced on every IAM user
- [ ] IAM groups with least-privilege policies scoped per area:
  - [ ] `dev-backend` (Eli) — Lambda, API Gateway, IAM read
  - [ ] `dev-frontend` (Prasamsha) — CloudFront, frontend S3 bucket
  - [ ] `dev-data` (Sunita) — data S3 buckets, DynamoDB
  - [ ] `dev-ops` (Alexander) — CloudWatch, SQS, SNS, CI/CD tooling
- [ ] Separate **service** roles (Lambda execution) — never reuse a human's role
- [ ] Deployment role for CDK/CI, assumable by the pipeline only
- [ ] Region chosen and written down (recommend `ap-southeast-2`, Sydney — lowest latency from NZ)
- [ ] Everyone has AWS CLI configured with their own credentials and can run `aws sts get-caller-identity`

**Exit criteria:** nobody is using root, every action is attributable to a person or a service role,
and the budget will page someone before it becomes a problem.

---

## M2 — CDK bootstrap + core infra
**Owner:** Eli · **Target:** Week 2 · **Status:** ⬜

From here on, **every AWS resource is created by CDK, not by clicking**. Anything clicked in the
console now becomes an undocumented dependency that breaks the Week 8 automation milestone.

- [ ] `cdk bootstrap` run against the account/region
- [ ] `infra/` CDK app with per-stack separation: `StorageStack`, `AuthStack`, `ApiStack`, `PipelineStack`
- [ ] S3 buckets, all with encryption at rest and public access blocked:
  - [ ] static datasets / map tiles
  - [ ] report images
  - [ ] frontend hosting (CloudFront origin, OAC-restricted)
- [ ] DynamoDB reports table — key schema settled (see open decisions), encryption at rest on,
      on-demand billing (cheaper and safer than provisioned for spiky student workloads)
- [ ] Cognito user pool + app client
- [ ] `cdk deploy` succeeds from a clean checkout on someone else's machine

**Exit criteria:** the whole environment can be destroyed and recreated from the repo alone.

---

## M3 — Walking skeleton (auth → API → Lambda)
**Owner:** Eli · **Target:** Weeks 2–3 · **Status:** ⬜

Prove the path end to end with trivial logic *before* building real features on top of it.

- [ ] API Gateway with a Cognito authorizer
- [ ] One `GET /health` Lambda (no auth) and one `GET /me` Lambda (auth required)
- [ ] Confirmed: unauthenticated call to `/me` returns 401; authenticated call returns the user's claims
- [ ] Shared TypeScript types for API request/response in `shared/`
- [ ] `POST /reports` and `GET /reports?bbox=...` stubs returning fixture data, so Prasamsha can
      build the map against a real contract before the backend is finished
- [ ] Structured JSON logging in every Lambda from the first commit (Alexander needs it for M7)

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

- [ ] Full IAM review — every wildcard added during the build is tightened or justified in writing
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
