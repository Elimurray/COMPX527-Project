# M1 Runbook — AWS account guardrails & IAM

Console-and-CLI setup, done once, before any project resource exists. Everything after
M1 is created by CDK (see [PROGRESS.md](../PROGRESS.md)).

> **Status: completed 2026-09-11.** See [Record of what was actually done](#record-of-what-was-actually-done)
> at the bottom — the IAM section was deliberately simplified, and the region settled as `us-east-1`.

**Account context:** a normal AWS account (`339254022271`) joined to the class's AWS Organization.
**Hard spend ceiling: NZ$60/month.** Two consequences run through this whole document:

1. Being a member account in an Organization means the management account is the payer,
   and may restrict what you can do via Service Control Policies. Verify before assuming.
2. NZ$60 is small. A single always-on resource can eat the entire budget doing nothing.
   See [Step 2](#step-2--the-never-create-list).

Work top to bottom. Steps 1 and 2 protect the budget and come before anything else.

---

## Step 0 — Organization reality check (15 minutes, do first)

Being in someone else's Organization can silently block later steps. Find out now, not in
Week 6.

```bash
# Who am I, and which account?
aws sts get-caller-identity

# Is the project region actually permitted? Some class orgs restrict regions by SCP.
aws dynamodb list-tables --region us-east-1
aws s3api list-buckets --region us-east-1
```

An `AccessDenied` mentioning an **explicit deny** or `with an explicit deny in a service
control policy` means the Organization is blocking it — not your IAM permissions. You
cannot fix that yourself; ask the course administrator.

Check these three things and record the answers in the table at the bottom of this file:

| Question | How to check | If blocked |
|---|---|---|
| Is the target region allowed? | Commands above | **Settled: `us-east-1`**, confirmed working and bootstrapped. Pinned in `infra/lib/config.ts`. |
| Can you create IAM users? | Step 4 will fail immediately if not | Ask the admin whether IAM Identity Center (SSO) is provided instead. |
| Can you see billing data? | Billing console → Budgets | Step 1 changes — see the note there. |

> **Region matters more than it looks.** It is baked into `infra/lib/config.ts`, and
> changing it after resources exist means destroying and recreating them. Settle it here.

---

## Step 1 — Billing guardrails

### 1a. The CloudWatch billing alarm probably won't work — and that's expected

PROGRESS.md lists a CloudWatch billing alarm as a second tripwire. In an Organization,
**it usually isn't available to you.** The `AWS/Billing` `EstimatedCharges` metric is
published only in `us-east-1`, and under consolidated billing only the *management*
(payer) account receives it. As a member account, you will most likely find no metric to
alarm on.

Check once, then move on:

```bash
aws cloudwatch list-metrics --namespace AWS/Billing --region us-east-1
```

Empty output → skip the CloudWatch alarm and use **AWS Budgets + Cost Anomaly Detection**
as your two independent tripwires instead. This is a finding worth writing up in the
report, not a failure.

### 1b. Enable billing data access

Console → account menu (top right) → **Account** → **IAM user and role access to Billing
information** → **Edit** → tick **Activate IAM Access** → Update.

Without this, only the root user can see Budgets and Cost Explorer, which makes the
guardrails useless day to day.

Then: Billing and Cost Management → **Cost Explorer** → Enable. It takes up to 24 hours to
populate, so turn it on now even though you can't use it yet.

### 1c. Convert the ceiling to USD, with FX headroom

AWS bills in USD unless the account's billing currency is set otherwise. Your ceiling is in
NZD, so the budget number needs a buffer — the exchange rate moves, and you do not want a
budget that technically passes while the actual charge exceeds NZ$60.

At roughly 0.60 USD per NZD, NZ$60 ≈ US$36. **Set the budget to US$30**, which leaves
headroom for the rate moving against you.

> Check the current rate before committing the number. If NZD has weakened, drop the USD
> figure accordingly.

### 1d. Create the budget

Console: Billing and Cost Management → **Budgets** → Create budget → **Customize (advanced)**
→ Cost budget.

| Setting | Value |
|---|---|
| Name | `derf-monthly-ceiling` |
| Period | Monthly, recurring |
| Budget amount | **30 USD** (fixed) |
| Scope | All AWS services (do not filter — you want to catch anything unexpected) |

Add **four** alert thresholds, all emailing every team member:

| Threshold | Type | ≈ USD | ≈ NZD | Meaning |
|---|---|---|---|---|
| 40% | Actual | $12 | ~$20 | Early warning — something is running you didn't expect |
| 60% | Actual | $18 | ~$30 | Investigate today |
| 80% | Actual | $24 | ~$40 | Pause non-essential services (the team's stated policy) |
| 100% | **Forecasted** | $30 | ~$50 | You are projected to blow the ceiling this month |

The **forecasted** alert is the one that actually saves you. Actual-spend alerts tell you
money is already gone; the forecast warns while there's still time to act.

Equivalent via CLI, if you prefer it reproducible — note the budget JSON files are written
to a temp path, not into the repo:

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

printf '%s' '{
  "BudgetName": "derf-monthly-ceiling",
  "BudgetLimit": { "Amount": "30", "Unit": "USD" },
  "TimeUnit": "MONTHLY",
  "BudgetType": "COST"
}' > /tmp/budget.json

printf '%s' '[
  {
    "Notification": {
      "NotificationType": "ACTUAL",
      "ComparisonOperator": "GREATER_THAN",
      "Threshold": 80,
      "ThresholdType": "PERCENTAGE"
    },
    "Subscribers": [
      { "SubscriptionType": "EMAIL", "Address": "your-team-email@example.com" }
    ]
  },
  {
    "Notification": {
      "NotificationType": "FORECASTED",
      "ComparisonOperator": "GREATER_THAN",
      "Threshold": 100,
      "ThresholdType": "PERCENTAGE"
    },
    "Subscribers": [
      { "SubscriptionType": "EMAIL", "Address": "your-team-email@example.com" }
    ]
  }
]' > /tmp/notifications.json

aws budgets create-budget \
  --account-id "$ACCOUNT_ID" \
  --budget file:///tmp/budget.json \
  --notifications-with-subscribers file:///tmp/notifications.json
```

### 1e. Cost Anomaly Detection (free, and genuinely useful)

Billing → **Cost Anomaly Detection** → Create monitor → **AWS services** monitor → alert
subscription with a threshold of **US$5**, emailed to the team.

This catches the specific failure mode budgets miss: a resource that starts costing money
suddenly, mid-month, well below the monthly ceiling. At NZ$60 total, US$5 of unexplained
daily spend is already an emergency.

---

## Step 2 — The "never create" list

At this budget, the danger isn't traffic — demo-scale Lambda, DynamoDB, S3, and Cognito
cost cents. The danger is **always-on infrastructure billed by the hour**, which charges
you whether or not anyone uses it.

| Do not create | Cost if you do | Why you don't need it |
|---|---|---|
| **NAT Gateway** | ~US$32/mo + data | Eats your entire budget. Only needed for Lambdas in a private VPC subnet — this project's Lambdas need no VPC at all. |
| **Application/Network Load Balancer** | ~US$16–22/mo | The proposal lists ELB, but API Gateway + Lambda is serverless and needs no load balancer. Mention ELB in the report as *considered and rejected on cost grounds with no functional loss* — that's a stronger answer than having one idle. |
| **VPC with private subnets** (CDK's `new Vpc()` default) | Creates NAT Gateways automatically | Never call the default `Vpc` constructor. If you ever truly need a VPC, pass `natGateways: 0`. |
| **RDS / Aurora / OpenSearch** | US$15–70+/mo | DynamoDB covers the data model. |
| **Provisioned DynamoDB capacity** | Billed 24/7 | Use **on-demand** — near-zero when idle. |
| **ElastiCache, MSK, Fargate/ECS services** | Hourly, always-on | Nothing here needs them. |

Two sneaky ones that *are* cheap but are worth configuring correctly from the start:

- **CloudWatch Logs retention.** Log groups default to *never expire*, and storage accrues
  forever. Set retention to 1–2 weeks on every log group. In CDK, set `retention` on an
  explicit `logs.LogGroup` per function.
- **S3 and the NOAA datasets.** NOAA GHCN in full is enormous. Sunita should ingest a
  filtered subset (relevant regions and date ranges), never a full mirror, and set a
  lifecycle rule on raw data.

And for M7: **cap the load test.** A surge test against on-demand DynamoDB and Lambda can
genuinely generate real spend. Agree a request budget beforehand and run it once.

---

## Step 3 — Root account hardening

The root user can do anything, including things IAM policies can't stop. Lock it and walk
away from it.

1. Sign in as root → **IAM** → **My security credentials**.
2. **Enable MFA** — an authenticator app on a phone is fine. Record who holds it.
3. **Delete any root access keys.** Root should have none, ever. If one exists, it is the
   single biggest risk in the account.
4. Set a strong unique password, stored in the team's password manager (not in chat, not
   in the repo).
5. Sign out. From here on, everything uses IAM users.

> One person holds the root MFA device. Write down who in the record table below, so the
> team isn't locked out if they're unavailable.

---

## Step 4 — IAM groups and least-privilege policies

Policies attach to **groups**, users go **in** groups. Never attach a policy directly to a
user — it's how permissions quietly sprawl, and the Week 6–7 review will find it.

### 4a. Create the groups

IAM → User groups → Create group, four times:

| Group | Member | Scope |
|---|---|---|
| `derf-backend` | Eli | Lambda, API Gateway, IAM read |
| `derf-frontend` | Prasamsha | CloudFront, frontend S3 bucket |
| `derf-data` | Sunita | Data S3 buckets, DynamoDB |
| `derf-ops` | Alexander | CloudWatch, SQS, SNS, CI/CD |

### 4b. Baseline policy — applies to everyone

Create a customer-managed policy named `derf-baseline` and attach it to **all four**
groups. It lets people manage their own credentials and MFA, and denies everything else
unless they have signed in with MFA.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowViewAccountInfo",
      "Effect": "Allow",
      "Action": ["iam:GetAccountPasswordPolicy", "iam:ListVirtualMFADevices"],
      "Resource": "*"
    },
    {
      "Sid": "AllowManageOwnPasswordAndKeys",
      "Effect": "Allow",
      "Action": [
        "iam:ChangePassword",
        "iam:GetUser",
        "iam:CreateAccessKey",
        "iam:DeleteAccessKey",
        "iam:ListAccessKeys",
        "iam:UpdateAccessKey"
      ],
      "Resource": "arn:aws:iam::*:user/${aws:username}"
    },
    {
      "Sid": "AllowManageOwnMFA",
      "Effect": "Allow",
      "Action": [
        "iam:CreateVirtualMFADevice",
        "iam:EnableMFADevice",
        "iam:ListMFADevices",
        "iam:ResyncMFADevice",
        "iam:DeleteVirtualMFADevice"
      ],
      "Resource": [
        "arn:aws:iam::*:mfa/${aws:username}",
        "arn:aws:iam::*:user/${aws:username}"
      ]
    },
    {
      "Sid": "AllowReadBilling",
      "Effect": "Allow",
      "Action": ["ce:GetCostAndUsage", "budgets:ViewBudget", "budgets:DescribeBudget"],
      "Resource": "*"
    },
    {
      "Sid": "DenyEverythingElseWithoutMFA",
      "Effect": "Deny",
      "NotAction": [
        "iam:CreateVirtualMFADevice",
        "iam:EnableMFADevice",
        "iam:GetUser",
        "iam:ListMFADevices",
        "iam:ListVirtualMFADevices",
        "iam:ResyncMFADevice",
        "sts:GetSessionToken",
        "iam:ChangePassword"
      ],
      "Resource": "*",
      "Condition": {
        "BoolIfExists": { "aws:MultiFactorAuthPresent": "false" }
      }
    }
  ]
}
```

That last statement is the important one: it makes MFA effectively mandatory rather than a
thing people mean to get around to. A user without MFA can set up MFA and nothing else.

### 4c. Per-area policies

Attach one of these to each group, alongside `derf-baseline`. Where possible they are
scoped to resources named `derf-*`, so nobody can touch unrelated resources in a shared
Organization account.

**`derf-backend`** (Eli):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["lambda:*", "apigateway:*", "logs:*"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["iam:Get*", "iam:List*", "iam:SimulatePrincipalPolicy"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["cloudformation:*", "ssm:GetParameter*"],
      "Resource": "*"
    }
  ]
}
```

**`derf-frontend`** (Prasamsha):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["cloudfront:*"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListAllMyBuckets", "s3:GetBucketLocation"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:*"],
      "Resource": ["arn:aws:s3:::derf-*-web", "arn:aws:s3:::derf-*-web/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["cloudformation:Describe*", "cloudformation:List*"],
      "Resource": "*"
    }
  ]
}
```

**`derf-data`** (Sunita):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:*"],
      "Resource": "arn:aws:dynamodb:*:*:table/derf-*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListAllMyBuckets", "s3:GetBucketLocation"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:*"],
      "Resource": [
        "arn:aws:s3:::derf-*-data",
        "arn:aws:s3:::derf-*-data/*",
        "arn:aws:s3:::derf-*-images",
        "arn:aws:s3:::derf-*-images/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "lambda:InvokeFunction",
        "lambda:Get*",
        "lambda:List*",
        "events:*",
        "logs:*"
      ],
      "Resource": "*"
    }
  ]
}
```

**`derf-ops`** (Alexander):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["cloudwatch:*", "logs:*", "sns:*", "sqs:*", "xray:*"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["codepipeline:*", "codebuild:*", "codestar-connections:*"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["budgets:*", "ce:*"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["cloudtrail:LookupEvents", "cloudtrail:Describe*", "cloudtrail:Get*"],
      "Resource": "*"
    }
  ]
}
```

> **These are a starting point, not the final answer.** The service-level wildcards
> (`lambda:*`, `cloudwatch:*`) are scoped to a service but not to an action. Tightening
> them against what people actually used — readable from CloudTrail, or via IAM Access
> Analyzer's policy generation — *is* the Week 6–7 review deliverable. M7 in PROGRESS.md
> points back here.

### 4d. Create the users

IAM → Users → Create user, four times. For each one:

- **Provide console access**, auto-generated password, require password reset on first sign-in.
- Add to the matching group. **No directly attached policies.**
- Do **not** create access keys yet — each person creates their own in Step 6.

Send each person their sign-in URL and one-time password **individually**, not to a group
chat. Everyone enables MFA at first sign-in (the baseline policy leaves them unable to do
anything else until they do).

---

## Step 5 — Service roles

Human roles and machine roles must stay separate. A Lambda should never run with Eli's
permissions, and Eli should never be able to act as the deployment role.

- **Lambda execution roles** — created by CDK per function in M2/M3. Nothing to do by hand
  here; just don't hand-make a shared `derf-lambda-role` "for now", because it will end up
  holding the union of every function's permissions.
- **CDK deployment roles** — `cdk bootstrap` (M2) creates these automatically
  (`cdk-hnb659fds-*`). Don't pre-make them.
- **CI/CD role** — M8. Prefer a GitHub OIDC role over long-lived access keys in Actions
  secrets; note it now, build it later.

So Step 5 is mostly *deliberately doing nothing*. Record the decision and move on.

---

## Step 6 — Per-person CLI setup

Each member, on their own machine:

```bash
# IAM → Users → your user → Security credentials → Create access key → CLI
aws configure --profile derf-dev
# Access key, secret, region us-east-1, output json

# Confirm it's you, and that you are in the right account
aws sts get-caller-identity --profile derf-dev
```

Because the baseline policy denies non-MFA access, CLI calls need an MFA session:

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --profile derf-dev --query Account --output text)
aws sts get-session-token \
  --serial-number "arn:aws:iam::${ACCOUNT_ID}:mfa/YOUR_USERNAME" \
  --token-code 123456 \
  --duration-seconds 43200 \
  --profile derf-dev
```

That returns a temporary key/secret/session-token trio — put them in a second profile
(`derf-mfa`) and use that for day-to-day work. Twelve hours covers a working day.

Finally, set `AWS_PROFILE=derf-mfa` in your local `.env` (copied from `.env.example`).

---

## Exit criteria

M1 is done when all of these are true:

- [ ] Nobody uses the root account; root has MFA and no access keys
- [ ] Four IAM users, four groups, MFA enforced by policy, zero directly attached policies
- [ ] Budget live with actual + **forecasted** alerts reaching the whole team
- [ ] Cost Anomaly Detection monitor active
- [ ] Everyone can run `aws sts get-caller-identity` as themselves
- [ ] The region question is answered and written into `infra/lib/config.ts` and `.env.example`
- [ ] The team has read [Step 2](#step-2--the-never-create-list) and knows not to create a
      NAT Gateway or an ELB

---

## Record of what was actually done

M1 completed **2026-09-11**, with deviations from the plan above. Recorded here so the
security write-up reflects reality rather than intent.

| Item | Value |
|---|---|
| AWS account ID | `339254022271` |
| Organization member? | Yes — class org, confirmed |
| Region | **us-east-1** — mandated by a separate individual assignment and carried over. Not the latency-optimal choice for NZ; noted as a constraint, not a decision. |
| Monthly ceiling | NZ$60 → **US$30** budget, FX buffer included |
| AWS Budgets | Live: US$30/month, 40 / 60 / 80% actual + 100% forecasted |
| Cost Anomaly Detection | Live: US$5 threshold |
| CloudWatch billing metric | **Confirmed empty**, as predicted for a member account — Budgets + Anomaly Detection are the two tripwires |
| Root hardening | MFA enabled, access keys removed, password in the team manager |
| CDK bootstrap | `cdk bootstrap aws://339254022271/us-east-1` succeeded |
| Date completed | 2026-09-11 |

### Deviation: IAM simplified to a single admin user

The four-group / `derf-baseline` / per-area policy structure in [Step 4](#step-4--iam-groups-and-least-privilege-policies)
was **not** implemented. With the work having narrowed to one person in practice, the
account has a single IAM user with `AdministratorAccess` attached directly, MFA enabled,
and `get-session-token` used for MFA'd CLI sessions.

What this costs, and what to do about it:

- **The human-IAM half of the M7 review no longer has anything to show.** `AdministratorAccess`
  attached directly to a user is the exact anti-pattern the Week 6–7 review is looking for.
- **The service-role half is unaffected, and is the stronger half anyway.** Every Lambda
  execution role, queue policy, and bucket policy is generated by CDK `grant*` calls,
  scoped to one action set on one resource. That is real, demonstrable least privilege,
  and it is where most of the system's actual authorisation lives.
- **If the review needs human-IAM evidence**, the group policies in Step 4c can be created
  later without disruption — they are additive, and the admin user can stay as a break-glass
  account. Roughly an hour of console work.

Worth stating plainly in the report: the least-privilege claim rests on the CDK-generated
service roles, and the single admin user is a known, deliberate trade-off made for a
solo build rather than an oversight.
