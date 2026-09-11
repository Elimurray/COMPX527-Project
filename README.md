# Disaster & Emergency Resource Finder

Cloud-based tool for coordinating access to emergency resources — shelter capacity,
drinking water, supplies — during a disaster. Community members report resource status
from authenticated accounts, and those reports appear on a live map for nearby users,
layered over authoritative NOAA and FEMA disaster data.

COMPX527 group project, University of Waikato.

| Area | Owner |
|---|---|
| Backend / API (Lambda, IAM) | Eli Murray |
| Frontend / map UI (CloudFront) | Prasamsha Gurung |
| Data pipeline (S3, DynamoDB, NOAA/FEMA) | Sunita Rana |
| Security, monitoring, CI/CD (CloudWatch, SQS/SNS) | Alexander Trotter |

Current milestones and progress: **[PROGRESS.md](PROGRESS.md)**

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22 LTS | `.nvmrc` pins the major. `nvm use` if you have nvm. |
| npm | 10+ | Ships with Node 22. We use npm workspaces, so don't swap in yarn/pnpm. |
| AWS CLI | v2 | Needed from M1 onward. Not required just to build locally. |
| Git | any recent | |

## First-time setup

```bash
git clone <repo-url>
cd COMPX527-Project

# Installs every workspace and links them together. Run this from the repo root,
# never from inside a subfolder.
npm install

# Copy the env template and fill in what you have. Never commit the result.
cp .env.example .env      # PowerShell: Copy-Item .env.example .env

# Should finish clean — this is the M0 exit criteria.
npm run build
```

If `npm run build` passes, you have a working checkout. Nothing below is required
until you start on a milestone that needs AWS.

## Repo layout

```
shared/     Types and constants used by everything else (@derf/shared)
services/   Lambda handlers — API, report processing, ingestion (@derf/services)
infra/      AWS CDK app. Every AWS resource is defined here (@derf/infra)
web/        React + Vite map frontend, served via CloudFront (@derf/web)
```

`shared/` is the contract between backend and frontend. When the API response shape
changes, change it there first — both sides then fail to compile until they agree,
which is the point.

## Everyday commands

Run these from the repo root.

| Command | What it does |
|---|---|
| `npm run build` | Builds all four workspaces in dependency order |
| `npm run typecheck` | Type-checks without emitting |
| `npm run lint` | ESLint across the repo |
| `npm run lint:fix` | ESLint with autofix |
| `npm run format` | Prettier write |
| `npm run verify` | Format check + lint + build — run this before opening a PR |
| `npm run clean` | Removes build output and `cdk.out/` |

Working on one workspace only:

```bash
npm run dev -w @derf/web        # Vite dev server on http://localhost:5173
npm run build -w @derf/shared   # Rebuild shared types after editing them
```

> After editing anything in `shared/`, rebuild it (`npm run build -w @derf/shared`)
> or the other workspaces will still see the old type definitions.

## AWS setup

Everything here depends on M1 being finished — see [PROGRESS.md](PROGRESS.md). In short:
your own IAM user with MFA, no shared logins, and no use of the root account.

```bash
# One-off, per person. Use the credentials for your own IAM user.
aws configure --profile derf-dev
aws sts get-caller-identity --profile derf-dev   # confirms who you are
```

Set `AWS_PROFILE=derf-dev` in your `.env`. Project region is **us-east-1**, account
**339254022271**. Both are pinned in `infra/lib/config.ts`, and deploying as a different
account fails at synth rather than creating resources somewhere unexpected.

### Deploying infrastructure

Every AWS resource is defined in `infra/` and created by CDK. **Do not create resources
by clicking in the console** — anything hand-made becomes an undocumented dependency
that breaks the Week 8 deployment-automation milestone. The only exceptions are the
account-level bootstrap items in M1 (root MFA, billing alarms, IAM users) and
`cdk bootstrap` itself.

```bash
cd infra

npx cdk bootstrap             # once per account+region, ever
npm run synth                 # renders CloudFormation locally, touches nothing
npm run diff                  # shows what a deploy would change — always read this
npm run deploy                # deploys all stacks
npm run destroy               # tears everything down
```

`synth` and `diff` are free and safe. Get in the habit of reading `diff` before every
deploy; it is the cheapest way to catch an accidental table replacement.

### Tearing down

**Empty the buckets before you destroy.** S3 refuses to delete a non-empty bucket, and
`cdk destroy` will fail partway through if you skip this:

```bash
aws s3 rm s3://derf-dev-data-339254022271 --recursive
aws s3 rm s3://derf-dev-images-339254022271 --recursive
aws s3 rm s3://derf-dev-web-339254022271 --recursive

npm run destroy
```

This is manual by choice. CDK's `autoDeleteObjects` would handle it, but only by adding a
Lambda and an IAM role holding `s3:DeleteObject*` and `s3:PutBucketPolicy` across every
bucket, which is IAM surface this project does not want. The cost of that choice is the
three commands above — and a bucket left behind bills quietly for as long as it exists, so
check the console afterwards rather than assuming.

## Cost discipline

The team is on a fixed budget, and an idle mistake can burn it quietly.

- Budget alarms are configured in M1. If one fires, say so in the group chat rather than muting it.
- Everything is tagged `Project=derf` and `Stage=<stage>`, so spend can be attributed per stage.
- Run `npm run destroy` on any personal experiment stack you spin up — after emptying its
  buckets (see "Tearing down" above).
- After the final demo, tear down billable resources.

## Contributing

- Branch off `main`, open a PR — no direct pushes to `main`.
- Run `npm run verify` before pushing.
- Keep IAM permissions least-privilege from the first commit. Don't grant a wildcard
  "temporarily"; the Week 6–7 security review is graded, and temporary wildcards are
  never temporary.
- Never commit credentials, `.env`, or `.pem` files. If you commit a secret by accident,
  rotate it immediately — deleting the commit is not enough.
