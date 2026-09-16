# Disaster & Emergency Resource Finder

Cloud-based tool for coordinating access to emergency resources — shelter capacity,
drinking water, supplies — during a disaster. Community members report resource status
from authenticated accounts, and those reports appear on a live map within seconds,
layered over authoritative NOAA weather-station data.

COMPX527 group project, University of Waikato.

| Area | Owner |
|---|---|
| Backend / API (Lambda, IAM) | Eli Murray |
| Frontend / map UI (CloudFront) | Prasamsha Gurung |
| Data pipeline (S3, DynamoDB, NOAA) | Sunita Rana |
| Security, monitoring, CI/CD (CloudWatch, SQS/SNS) | Alexander Trotter |

## Live endpoints

| What | URL |
|---|---|
| Web application | https://d2sh21ebxk4i32.cloudfront.net |
| API (HTTPS, API Gateway) | https://a32044zzhl.execute-api.us-east-1.amazonaws.com |
| API (HTTP, load balancer) | http://derf-dev-alb-1725394939.us-east-1.elb.amazonaws.com |

Deployed to AWS account `339254022271`, region `us-east-1`.

> The load balancer is HTTP only. Terminating TLS on an ALB requires an ACM
> certificate, which is out of scope for this assignment — so the API Gateway path is
> the secure one, and the ALB exists as a second ingress for comparison.

---

## Architecture

Seven CloudFormation stacks, separated by lifecycle so that redeploying the API can
never endanger stored data, and so the one hourly-billed component can be destroyed
on its own.

| Stack | Contents |
|---|---|
| `Derf-dev-Storage` | 3 S3 buckets, 2 DynamoDB tables (reports + stations), 1 GSI |
| `Derf-dev-Auth` | Cognito user pool and web client |
| `Derf-dev-Api` | HTTP API, JWT authorizer, 5 Lambda handlers |
| `Derf-dev-Pipeline` | SQS + dead-letter queue, processor Lambda, 2 SNS topics, DLQ alarm |
| `Derf-dev-Ingestion` | Weekly NOAA ingestion Lambda, EventBridge schedule, failure alarm |
| `Derf-dev-Web` | CloudFront distribution + private frontend bucket (Origin Access Control) |
| `Derf-dev-Alb` | VPC (no NAT), Application Load Balancer, Lambda target group |

**How a report flows:** the browser authenticates with Cognito over SRP → `POST /reports`
is gated by an API Gateway JWT authorizer → the handler validates and enqueues to SQS,
returning **202 Accepted** → a processing Lambda writes to DynamoDB idempotently and
publishes to SNS if the report is significant → the map reads it back through a
geohash-bucketed query.

Reading is public by design; submitting requires an account.

### API

| Route | Auth | Purpose |
|---|---|---|
| `GET /health` | none | Liveness |
| `GET /reports?bbox=minLon,minLat,maxLon,maxLat` | none | Reports in a viewport |
| `GET /stations?bbox=...` | none | NOAA weather stations in a viewport |
| `GET /me` | JWT | Caller's identity claims |
| `POST /reports` | JWT | Submit a report (returns 202) |

```bash
curl "https://a32044zzhl.execute-api.us-east-1.amazonaws.com/reports?bbox=174.70,-36.90,174.82,-36.80"
```

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22 LTS | `.nvmrc` pins the major. `nvm use` if you have nvm. |
| npm | 10+ | Ships with Node 22. The repo uses npm workspaces — don't swap in yarn/pnpm. |
| AWS CLI | v2 | Only needed to deploy or inspect AWS; not to build locally. |
| Git | any recent | |

## Build it locally

```bash
git clone <repo-url>
cd COMPX527-Project

# Installs every workspace and links them together. Run from the repo root.
npm install

# Copy the env template. Never commit the result — .env is git-ignored.
cp .env.example .env      # PowerShell: Copy-Item .env.example .env

npm run build
```

If `npm run build` passes you have a working checkout. Nothing below is needed unless
you intend to deploy.

To run the frontend against the **already-deployed** API, fill these into `.env` and
start the dev server:

```
VITE_API_BASE_URL=https://a32044zzhl.execute-api.us-east-1.amazonaws.com
VITE_COGNITO_USER_POOL_ID=us-east-1_Zx0PZsBBF
VITE_COGNITO_CLIENT_ID=4turmnsmh7fiu5oum9a3qe5td6
VITE_AWS_REGION=us-east-1
```

```bash
npm run dev -w @derf/web     # http://localhost:5173
```

These are not secrets: a Cognito pool id and public client id are compiled into any
browser bundle by design. Security comes from the pool's configuration — SRP-only
auth, no client secret, user-existence errors suppressed — not from hiding them.

## Repo layout

```
shared/     Types, constants, geohash encoding (@derf/shared)
services/   Lambda handlers — API, processing, ingestion (@derf/services)
infra/      AWS CDK app. Every AWS resource is defined here (@derf/infra)
web/        React + Vite map frontend (@derf/web)
scripts/    Deployment automation
docs/       Account setup runbook
```

`shared/` is the contract between backend and frontend. Change an API response shape
there first and both sides fail to compile until they agree — which is the point.

## Everyday commands

Run from the repo root.

| Command | What it does |
|---|---|
| `npm run build` | Builds all workspaces in dependency order |
| `npm run verify` | Format check + lint + build — run before pushing |
| `npm run lint` / `lint:fix` | ESLint |
| `npm run format` | Prettier write |
| `npm run clean` | Removes build output and `cdk.out/` |
| `npm run deploy:web` | Builds the frontend, syncs to S3, invalidates CloudFront |

> After editing anything in `shared/`, rebuild it (`npm run build -w @derf/shared`) or
> the other workspaces keep seeing the old type definitions.

---

## Deploying from scratch

Account-level setup that CDK cannot do — root MFA, billing guardrails, IAM users — is
documented in **[docs/m1-aws-setup.md](docs/m1-aws-setup.md)**. Do that first.

```bash
aws configure --profile derf-dev
aws sts get-caller-identity --profile derf-dev    # confirm the right account
```

Account and region are pinned in [infra/lib/config.ts](infra/lib/config.ts); deploying
while authenticated as a different account **fails at synth** rather than creating
resources somewhere unexpected.

```bash
cd infra
npx cdk bootstrap                  # once per account+region, ever

npm run diff                       # always read this before deploying
npx cdk deploy --all               # or deploy stacks individually
```

Stack order matters when deploying individually, because later stacks import values
from earlier ones:

```
Storage → Auth → Pipeline → Api → Ingestion → Web → Alb
```

Then publish the frontend and seed the contextual data:

```bash
cd ..
npm run deploy:web                                             # build + sync + invalidate
aws lambda invoke --function-name derf-dev-ingestnoaa out.json # NOAA data (else waits for Sunday)
```

`npm run deploy:web` reads the bucket name and distribution id from CloudFormation
outputs rather than hardcoding them. Fingerprinted assets get a one-year immutable
cache; `index.html` gets `no-cache`, because it is the only file whose name never
changes and caching it would strand clients on stale assets.

### Scheduled ingestion

NOAA GHCN-Daily station data is pulled weekly (Sunday 15:00 UTC) from the
`noaa-ghcn-pds` bucket on the AWS Registry of Open Data, archived raw to S3, then
transformed into the stations table. Invoke it manually any time with the command
above. Failures raise a CloudWatch alarm to the ops topic — a silent failure would
leave the map showing stale data with nothing to indicate it.

### Alarms

Two CloudWatch alarms publish to `derf-dev-ops-alerts`. Subscribe an address or they
fire into nothing:

```bash
aws sns subscribe --topic-arn arn:aws:sns:us-east-1:339254022271:derf-dev-ops-alerts \
  --protocol email --notification-endpoint you@example.com
```

---

## Cost

Everything except the load balancer bills per request or per stored byte, so an idle
system costs effectively nothing. There is no NAT Gateway (~US$32/month), no
provisioned DynamoDB capacity, and no always-on compute.

**The ALB is the exception** — roughly US$0.0225/hour whether or not anyone uses it.
It lives in its own stack so it can be removed independently:

```bash
npx cdk destroy Derf-dev-Alb
```

Budget guardrails: an AWS Budget at US$30/month alerting at 40/60/80% actual plus a
forecast alert, and Cost Anomaly Detection at US$5. Everything is tagged
`Project=derf` and `Stage=<stage>` for per-stage attribution.

### Tearing down completely

**Empty the buckets first.** S3 refuses to delete a non-empty bucket and `cdk destroy`
will fail partway through:

```bash
aws s3 rm s3://derf-dev-data-339254022271 --recursive
aws s3 rm s3://derf-dev-images-339254022271 --recursive
aws s3 rm s3://derf-dev-web-339254022271 --recursive

cd infra && npx cdk destroy --all
```

This is manual by choice. CDK's `autoDeleteObjects` would do it, but only by
provisioning a Lambda and an IAM role holding `s3:DeleteObject*` and
`s3:PutBucketPolicy` over every bucket — IAM surface this project would rather not
carry. Check the console afterwards rather than assuming: an orphaned bucket bills
quietly for as long as it exists.

---

## Security summary

Full detail is in the report; the short version:

- **Cognito SRP only** — `USER_PASSWORD_AUTH` is disabled, so no plaintext-password
  flow exists. TOTP MFA available, SMS deliberately off.
- **Fail-closed API** — the JWT authorizer is the API-wide default; public routes opt
  out explicitly, so a route added later is protected by default.
- **Least-privilege IAM** — every Lambda role grants exactly the actions its code
  performs. Nothing in the system holds `dynamodb:Scan`, `UpdateItem` or `DeleteItem`
  on reports, so the application cannot modify or delete a stored report at all.
- **Encryption at rest** — DynamoDB with an AWS-managed KMS key, S3 with SSE-S3, both
  verified against the deployed resources rather than assumed.
- **TLS enforced** — every bucket and queue denies requests where
  `aws:SecureTransport` is false; CloudFront redirects HTTP to HTTPS.
- **Private origin** — the frontend bucket blocks all public access; only CloudFront
  can read it, via Origin Access Control scoped to that distribution.
- **Retention** — reports expire after 7 days by DynamoDB TTL; log groups retain 14
  days rather than forever.

## Contributing

- Branch, open a PR, and run `npm run verify` before pushing.
- Keep IAM grants to the single action the code performs. Don't add a wildcard
  "temporarily".
- Never commit credentials, `.env`, or `.pem` files. If you commit a secret, rotate it
  — deleting the commit is not enough.

Progress tracking and milestone history: **[PROGRESS.md](PROGRESS.md)**
