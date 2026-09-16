# Disaster & Emergency Resource Finder: A Serverless Cloud Application for Coordinating Emergency Resources

**COMPX527 Group Project — Final Report (draft)**
University of Waikato

> **Format note.** The submitted report must use the IEEE two-column conference
> template and must not exceed 10 pages excluding references. This file is the
> content draft — move it into the IEEE template before submission.
>
> **Sections marked `[TO COMPLETE]` need information only the team has.** They are
> deliberately left blank rather than filled with plausible-looking text.

---

## Abstract

During a disaster, the scarcest resource is often accurate information about where
other resources are. Shelters fill, water points run dry, and supply drops move
faster than official channels can publish. This paper presents the Disaster &
Emergency Resource Finder (DERF), a serverless cloud application that lets
community members report the live status of emergency resources and see nearby
reports on a map within seconds.

The system is built entirely on AWS managed services and deployed as
infrastructure-as-code. Authenticated submissions are absorbed by an Amazon SQS
queue before being written to Amazon DynamoDB, so a surge of reports queues rather
than overwhelming the datastore; significant changes trigger Amazon SNS
notifications filtered by geographic area. Reads are served through a geohash
partitioning scheme that turns "what is near me" into a bounded DynamoDB Query
rather than a table scan, holding read cost proportional to the viewport rather
than to the size of the dataset.

Security was treated as a design constraint rather than a later hardening pass.
Every IAM policy in the system grants exactly the actions its code performs —
verified against the synthesised CloudFormation templates — with the result that
no component is permitted to modify or delete a stored report. The application
runs within a NZ$60 monthly budget, and idles at effectively zero cost because no
always-on compute exists anywhere in the architecture.

---

## 1. Introduction

### 1.1 Problem statement

Emergency response suffers from an information asymmetry. Authoritative sources —
civil defence, meteorological agencies — publish accurate but coarse and slow
information: a region is under a warning, a declaration has been made. What people
actually need during the event is granular and perishable: *is this shelter still
accepting people, right now?*

That information exists, but it is distributed across the people standing in front
of the shelter. Social media captures some of it, unstructured and unverifiable,
with no geographic index. The gap is not a lack of data; it is a lack of a
structured, attributable, geographically queryable channel for it.

### 1.2 Objectives

DERF addresses this gap with four objectives:

1. **Low-friction reporting.** Submitting a report must take seconds on a phone,
   because users are reporting during an emergency, not after it.
2. **Attributable submissions.** Reports must be tied to an authenticated identity,
   so that abuse can be traced without requiring pre-registration of trusted users.
3. **Unauthenticated reading.** Finding a shelter must never require completing a
   sign-up flow. Reading is public; writing is not.
4. **Survivable under surge.** The system must degrade gracefully when many people
   report simultaneously — precisely the moment it matters most.

### 1.3 Contributions

This report describes: a serverless architecture that meets the above under a
fixed and small budget; a geohash-based partitioning scheme for geographic
queries on DynamoDB; a queue-backed write path with explicit failure handling; and
a least-privilege IAM posture that is verifiable from the deployed templates
rather than asserted.

---

## 2. Proposed Solution

### 2.1 Architecture overview

The application is decomposed into five CloudFormation stacks, separated by
lifecycle so that frequently-redeployed components cannot endanger durable state:

| Stack | Contents | Rationale |
|---|---|---|
| `Derf-dev-Storage` | S3 buckets, DynamoDB table | Outlives everything else |
| `Derf-dev-Auth` | Cognito user pool, app client | Replacement would delete all accounts |
| `Derf-dev-Api` | HTTP API, four Lambda handlers | Redeployed constantly |
| `Derf-dev-Pipeline` | SQS, DLQ, processor Lambda, SNS topics | Data pipeline |
| `Derf-dev-Web` | CloudFront distribution, frontend bucket | Must co-locate (§2.6) |

All resources are defined in AWS CDK (TypeScript) and created by CloudFormation.
No resource was created through the console except the account-level bootstrap
items — root MFA, billing guardrails, IAM users, and `cdk bootstrap` itself.

### 2.2 Write path

The write path is deliberately asymmetric with the read path.

1. The client obtains a JWT from Amazon Cognito via the Secure Remote Password
   (SRP) protocol.
2. `POST /reports` is authorised by an API Gateway JWT authorizer, validated
   against the user pool's public keys.
3. The handler validates the payload, mints a UUID, and places an envelope on an
   SQS queue. It returns **HTTP 202 Accepted** — the contract states the report
   was accepted, not that it was stored.
4. A processing Lambda consumes the queue in batches of up to ten, computes the
   geohash, and writes to DynamoDB.
5. Reports meeting a significance threshold are published to SNS.

Returning 202 rather than 201 is the design decision that makes surge tolerance
possible. The API does almost no work per request, so the queue absorbs
variability in arrival rate while DynamoDB writes proceed at whatever rate the
processor sustains.

Three properties of the processing stage deserve specific mention:

**Idempotency.** SQS provides at-least-once delivery, so duplicate delivery is a
normal operating condition rather than an exceptional one. The write uses a
condition expression (`attribute_not_exists`) on the composite key, and treats the
resulting `ConditionalCheckFailedException` as success. The report id is minted
before the queue specifically so this is possible.

**Partial batch failure reporting.** The handler returns
`batchItemFailures` rather than throwing. Without this, a single malformed message
in a batch of ten would fail the entire batch, causing nine already-written reports
to be redelivered and eventually dead-lettered despite having succeeded.

**Dead-letter queue.** Messages failing three attempts move to a DLQ with the
maximum 14-day retention. Without a DLQ, a report that fails processing is retried
until SQS silently discards it — during exactly the surge the queue exists to
absorb. A CloudWatch alarm fires on any DLQ depth greater than zero; there is no
acceptable steady-state value, because every message there represents a report a
user submitted and the system lost.

### 2.3 Read path and geographic partitioning

The central data-modelling problem is answering "what resources are near this map
viewport" without scanning the table.

The solution partitions on a **geohash** prefix. A geohash interleaves latitude and
longitude into a single string through binary subdivision, so points sharing a
prefix are geographically close. At precision 5, each cell is approximately
5 km × 5 km.

The DynamoDB key schema is:

- **Partition key** `geohash` — the report location at precision 5
- **Sort key** `reportedAtId` — `<ISO-8601 timestamp>#<reportId>`

The sort key is composite rather than a bare timestamp. ISO-8601 sorts
lexicographically, so range queries on time behave identically, but appending the
id guarantees uniqueness. Two reports filed in the same cell in the same
millisecond would otherwise overwrite one another — realistic during a surge, and
silent when it happens.

A read converts the viewport bounding box into the set of covering cells and issues
one bounded Query per cell in parallel. No Scan operation exists anywhere in the
read path, and the read path's IAM policy does not permit one.

**Known limitation.** Coverage is capped at 64 cells per request. A viewport
covering the upper North Island would require approximately 7,100 cells at
precision 5. When the cap is reached, the response carries a `truncated` flag and
the interface states that the area is too large to search completely, rather than
displaying a partial result as though it were complete. Telling a user there is
nothing near them when the server did not look is the most harmful failure mode
this interface has. The complete solution is multi-resolution indexing — storing
coarser prefixes (`geohash4`, `geohash3`) with global secondary indexes and
selecting resolution by viewport — at the cost of additional write capacity per
index. This is identified as future work.

### 2.4 Notification model

A single SNS topic carries community alerts, with per-subscription filter policies
on a `geohash` message attribute. The alternative — one topic per region — would
require creating and discovering topics dynamically as the map is panned.

Crucially, the geohash, resource type, and status are published as **message
attributes** rather than body fields, because SNS filter policies can only match on
attributes. Matching occurs server-side, so a subscriber is never woken for an area
they did not subscribe to.

Notification is deliberately narrow: only a status of `unavailable` or an occupancy
at or above 90% of capacity triggers a publish. An alert that fires for every
report trains recipients to ignore alerts, which is worse than sending none.

### 2.5 Public dataset integration

`[TO COMPLETE]` — NOAA and FEMA ingestion. Planned design: a scheduled Lambda
pulls NOAA Global Historical Climatology Network data (`noaa-ghcn-pds`, AWS
Registry of Open Data) and FEMA disaster declarations from OpenFEMA into the
datasets S3 bucket, partitioned by dataset and date, with a transform step
producing map-ready records overlaid beneath live community reports. A lifecycle
rule transitions raw pulls to Infrequent Access after 30 days to bound storage
cost.

### 2.6 Content delivery

The frontend is a React single-page application served by CloudFront from a
**private** S3 bucket via Origin Access Control. The bucket was never configured
for S3 static website hosting, which would have required making it public; OAC
grants the distribution `s3:GetObject` conditioned on the specific distribution
ARN, and nothing else can read it.

The bucket and distribution must reside in the same CloudFormation stack. OAC
attaches a bucket policy naming the distribution, so a bucket in one stack with a
distribution in another produces a circular stack dependency — CDK refuses to
synthesise this, and discovering it during development rather than deployment is a
concrete benefit of infrastructure-as-code.

### 2.7 Service selection rationale

| Service | Role | Why this service |
|---|---|---|
| Lambda | All compute | No idle cost; scales from zero |
| API Gateway (HTTP API) | Ingress, auth enforcement | Native JWT authorizer; cheaper than REST API |
| DynamoDB | Report storage | On-demand billing; predictable single-digit-ms reads |
| S3 | Datasets, images, frontend | Durable object storage at negligible cost |
| Cognito | Identity | Managed SRP, MFA, and account recovery |
| SQS | Surge absorption | Decouples ingest rate from write rate |
| SNS | Notifications | Server-side filtering by message attribute |
| CloudFront | Global delivery | Private origin via OAC; free tier covers demo traffic |
| CloudWatch | Logs, alarms | Structured JSON logs queryable via Logs Insights |
| IAM | Authorisation | Per-function roles generated from code |

**Deliberately excluded:** NAT Gateway (~US$32/month, and unnecessary because the
Lambdas reach only AWS APIs), and provisioned DynamoDB capacity (billed
continuously regardless of load).

### 2.8 Load balancing and a comparison of ingress paths

An Application Load Balancer provides a second, independent ingress to the public
read path. It fronts a Lambda target group running the same query logic as the API
Gateway route — the logic is shared in a single module, so the two cannot diverge —
which makes the two paths directly comparable.

The comparison is instructive, and not flattering to the load balancer for this
workload:

| Property | API Gateway (HTTP API) | ALB + Lambda target |
|---|---|---|
| Idle cost | $0 | ~US$16–22/month |
| Billing model | Per request | Per hour + capacity units |
| TLS | Built in | Requires an ACM certificate |
| Native JWT authorisation | Yes | No; would need custom logic |
| Event shape | Normalised v2 payload | Distinct ALB payload |
| Query decoding | Automatic | Caller must URL-decode |

Two findings are worth recording. First, an ALB bills hourly whether or not it is
used, which is a poor fit for a system whose every other component costs nothing at
idle; the load balancer is therefore isolated in its own CloudFormation stack and
destroyed after demonstration. Second, terminating TLS on an ALB requires a
certificate from AWS Certificate Manager, which is out of scope for this project,
so the ALB listener is **HTTP only** — meaning that on transport security the API
Gateway path is strictly superior.

The VPC supporting the load balancer uses public subnets across two availability
zones with **no NAT Gateway**. This is deliberate and verified in the synthesised
template: CDK's default VPC configuration provisions one NAT Gateway per
availability zone at roughly US$32/month each, which alone would exceed the
project's entire budget. The Lambda target is not VPC-attached; the load balancer
invokes it through the Lambda service rather than reaching it over the network.

---

## 3. Security Considerations

### 3.1 Identity and authentication

The Cognito user pool is configured for **SRP only**. The `USER_PASSWORD_AUTH`
flow is disabled on the application client, so no plaintext-password path exists
even as a fallback — the password never crosses the network.

Additional pool configuration:

- **Password policy:** 12-character minimum with upper, lower, and digit required;
  symbols optional. This follows current NIST guidance favouring length over
  composition rules, which tend to produce short passwords with predictable
  mangling.
- **MFA:** optional, TOTP only. SMS is explicitly disabled. Beyond cost (every SMS
  is billable and a sign-up loop could exhaust the budget), mandatory second
  factors are the wrong trade-off for a tool someone reaches for mid-emergency.
- **User enumeration:** `preventUserExistenceErrors` is enabled, so sign-in
  failures are indistinguishable whether or not the account exists.
- **Client secret:** none. The client is a browser application and cannot keep a
  secret; pretending otherwise would be security theatre.

### 3.2 API authorisation

The JWT authorizer is configured as the API-wide **default**, with public routes
opting out explicitly. This makes the system fail closed: a route added later is
authenticated unless someone deliberately unprotects it, rather than being silently
public until noticed.

| Route | Authorisation | Rationale |
|---|---|---|
| `GET /health` | None | Liveness probe |
| `GET /reports` | None | Finding a shelter must not require an account |
| `GET /me` | JWT | — |
| `POST /reports` | JWT | Submissions must be attributable |

This was verified against the running system. An unauthenticated `POST /reports`
carrying a deliberately invalid body returns **401, not 400** — demonstrating that
the authorizer rejects the request before any application code executes.

### 3.3 Least-privilege IAM

Every Lambda execution role was generated by CDK grant methods and then narrowed
further. The deployed policies are:

| Function | Permissions beyond CloudWatch Logs |
|---|---|
| `derf-dev-health` | None |
| `derf-dev-me` | None |
| `derf-dev-listreports` | `dynamodb:Query` |
| `derf-dev-createreport` | `sqs:SendMessage` |
| `derf-dev-processreport` | `dynamodb:PutItem`, `sns:Publish`, SQS consume |

CDK's convenience methods were deliberately avoided in two places.
`grantReadData` would additionally permit `dynamodb:Scan` — precisely the expensive
operation the key schema exists to prevent — and `grantWriteData` would permit
`UpdateItem`, `DeleteItem`, and `BatchWriteItem`. Granting the single action each
handler actually performs yields a property worth stating plainly: **no component
of this system is permitted to modify or delete a report once stored.**

Resource-based policies are equally narrow. API Gateway's permission to invoke each
function is conditioned on `ArnLike` matching that function's specific route ARN.

### 3.4 Data protection

**Encryption at rest** was verified on the deployed resources, not merely
configured:

- DynamoDB returns `SSEType: KMS` with a populated `KMSMasterKeyArn`. This
  distinction matters: a table using AWS's default owned key returns no
  `SSEDescription` at all, so the presence of one demonstrates that encryption was
  configured deliberately rather than inherited.
- All S3 buckets return `SSEAlgorithm: AES256` (SSE-S3). A customer-managed KMS key
  was considered and rejected on cost grounds: approximately US$1 per month per key
  plus per-request charges is material against a NZ$60 budget, and both options
  satisfy encryption at rest.

**Encryption in transit** is enforced rather than merely available. Every S3 bucket
and both SQS queues carry a policy statement denying all actions when
`aws:SecureTransport` is false. CloudFront redirects HTTP to HTTPS.

**Public access** is blocked at the bucket level on all four block settings for
every bucket, verified post-deployment.

**Data minimisation and retention.** DynamoDB TTL expires reports after seven days,
bounding both storage cost and the window during which location data persists.
CloudWatch log groups are created explicitly with 14-day retention; the default is
never to expire, which accrues storage charges indefinitely.

### 3.5 Secrets handling

No credentials appear in source control. `.env` is git-ignored and `.env.example`
documents required variables without values. The Cognito user pool id and
application client id are compiled into the frontend bundle, which is correct and
intentional — these are public identifiers, and security derives from the pool's
configuration rather than from their obscurity.

### 3.6 Input validation and injection resistance

All API input is validated server-side before use: resource type and status are
checked against enumerations, coordinates against valid latitude and longitude
ranges, notes against a length limit, and capacity for internal consistency. The
`bbox` parameter is parsed defensively and rejected with a structured 400 rather
than an exception.

User-submitted text rendered into map popups is HTML-escaped at the point of
interpolation.

Every error response carries a `requestId` that correlates to the corresponding
CloudWatch log entry, allowing a user-reported failure to be traced without
guesswork — while exposing no internal detail to the client.

### 3.7 Account-level controls

Root account MFA is enabled and root access keys have been removed. Billing
guardrails comprise an AWS Budget at US$30/month with alerts at 40%, 60%, and 80%
of actual spend plus a **forecasted** 100% alert, and a Cost Anomaly Detection
monitor at US$5.

A CloudWatch billing alarm was attempted and found unavailable: the
`AWS/Billing` `EstimatedCharges` metric is published only to the payer account
under consolidated billing, and this account is an Organization member. Budgets and
Cost Anomaly Detection therefore serve as the two independent tripwires.

### 3.8 Known deviation

`[TO COMPLETE — confirm final state before submission]`

The original design specified four IAM groups with per-area least-privilege
policies and MFA enforced by policy. As the practical division of labour narrowed,
the account was operated instead with a single IAM user holding
`AdministratorAccess`, with MFA enabled and CLI access via
`sts:GetSessionToken`.

This is stated explicitly rather than omitted. Its consequence is that the
*human* half of the least-privilege story is weaker than designed, while the
*service* half — every Lambda execution role, queue policy, and bucket policy —
is unaffected and is where the majority of the system's authorisation decisions
actually live. The per-area group policies remain specified and are additive if
required.

---

## 4. Automated Deployment

The entire environment is reproducible from the repository. `cdk deploy` creates
every AWS resource; `npm run deploy:web` builds the frontend, synchronises it to S3
with appropriate cache headers, and invalidates the CloudFront distribution.

The deployment script reads the bucket name and distribution id from
CloudFormation stack outputs rather than hardcoding them, so it survives
environment changes. Fingerprinted assets are uploaded with a one-year immutable
cache policy; `index.html` is uploaded with `no-cache`, because it is the one file
whose name never changes and caching it would strand clients on stale asset
references.

CDK's `BucketDeployment` construct was deliberately not used. It performs the same
upload but provisions a custom-resource Lambda and IAM role to do so, and the
plain script is identical to what a CI pipeline would run.

`[TO COMPLETE]` — CI/CD pipeline (GitHub Actions vs CodePipeline), automated
`cdk deploy` on merge, and rehearsed teardown-and-redeploy.

---

## 5. Actual AWS Expenditure

`[TO COMPLETE — obtain real figures before submission]`

Retrieve actual spend with:

```
aws ce get-cost-and-usage \
  --time-period Start=2026-09-01,End=2026-09-28 \
  --granularity MONTHLY --metrics BlendedCost \
  --group-by Type=DIMENSION,Key=SERVICE
```

Expected shape of the result, for comparison against actuals:

| Service | Expected cost | Reason |
|---|---|---|
| Lambda | ~$0.00 | Free tier: 1M requests/month |
| DynamoDB | <$0.01 | On-demand; a handful of items |
| S3 | <$0.01 | Minimal objects |
| API Gateway | ~$0.00 | Free tier: 1M requests |
| CloudFront | ~$0.00 | Free tier: 1 TB egress |
| Cognito | $0.00 | Lite tier free allowance |
| SQS / SNS | $0.00 | Well within free tier |
| CloudWatch | $0.00 | Within 10-alarm free allowance |

The architecture's defining cost property is that **no always-on resource exists**.
Spend is proportional to use, and an idle system costs effectively nothing. The
principal risks identified and avoided were a NAT Gateway (~US$32/month), an idle
load balancer (~US$16–22/month), and provisioned DynamoDB capacity.

`[TO COMPLETE]` — if an Application Load Balancer is added to satisfy the service
requirement, record its actual accrued cost here and note the teardown date.

---

## 6. Team, Contributions, and Meeting Minutes

`[TO COMPLETE — only the team can supply this]`

### 6.1 Members and roles

| Member | Student ID | Stack area |
|---|---|---|
| Eli Murray | `[ID]` | Backend / API — Lambda, IAM |
| Prasamsha Gurung | `[ID]` | Frontend / map UI — CloudFront |
| Sunita Rana | `[ID]` | Data pipeline — S3, DynamoDB, NOAA/FEMA |
| Alexander Trotter | `[ID]` | Security, monitoring, CI/CD — CloudWatch, SQS/SNS |

### 6.2 Individual contributions

`[TO COMPLETE]` — describe what each member did, with contribution percentages if
work was not evenly balanced. The brief requires this explicitly.

### 6.3 Weekly meeting minutes

`[TO COMPLETE]` — the brief requires weekly meeting points. Record date,
attendees, decisions taken, and actions assigned.

---

## 7. Conclusion

DERF demonstrates that a surge-tolerant, secure, geographically-indexed reporting
system can be built entirely from managed AWS services within a small fixed budget.
The design decisions that mattered most were architectural rather than
technological: returning 202 to decouple ingest from storage, partitioning by
geohash to bound read cost, granting exactly the IAM actions the code performs, and
surfacing partial results honestly rather than presenting them as complete.

Identified future work comprises multi-resolution geographic indexing, pre-signed
image upload, a CI/CD pipeline, and tightening CORS from a development wildcard to
the specific distribution origin.

---

## References

`[TO COMPLETE — IEEE citation format]`

Sources to cite:

1. AWS Registry of Open Data — NOAA GHCN. https://registry.opendata.aws/noaa-ghcn/
2. OpenFEMA dataset documentation. https://www.fema.gov/about/openfema/data-sets
3. NIST SP 800-63B, Digital Identity Guidelines — Authentication and Lifecycle Management.
4. AWS, *Amazon DynamoDB Developer Guide* — best practices for partition key design.
5. AWS, *Amazon SQS Developer Guide* — dead-letter queues and partial batch responses.
6. G. Niemeyer, geohash algorithm (1:8 subdivision encoding).
7. AWS, *Amazon CloudFront Developer Guide* — restricting access with Origin Access Control.

---

## Appendix A: Verification Evidence

Commands run against the deployed system, with the properties they confirm.

| Check | Command | Result |
|---|---|---|
| Table encryption | `aws dynamodb describe-table` | `SSEType: KMS`, KMS key ARN present |
| Table key schema | `aws dynamodb describe-table` | PK `geohash`, SK `reportedAtId`, `PAY_PER_REQUEST` |
| TTL | `aws dynamodb describe-time-to-live` | `ENABLED` on `expiresAt` |
| Bucket encryption | `aws s3api get-bucket-encryption` | `AES256` |
| Public access block | `aws s3api get-public-access-block` | All four settings `true` |
| TLS enforcement | `aws s3api get-bucket-policy` | `Deny s3:*` when `SecureTransport` false |
| MFA configuration | `aws cognito-idp get-user-pool-mfa-config` | TOTP enabled, no SMS configuration |
| Cognito tier | `aws cognito-idp describe-user-pool` | `LITE` |
| Auth boundary | `curl -X POST /reports` (no token, invalid body) | **401**, not 400 |
| Public read | `curl /reports?bbox=...` | 200 with reports |
| Geohash correctness | Unit check against reference value | `57.64911,10.40744` → `u4pruydqqvj` |
| End-to-end pipeline | SQS inject → API read-back | Report stored, geohash `rckq2` |
| Idempotency | Duplicate SQS message | One row; duplicate ignored |

## Appendix B: Requirements Coverage

| Requirement | Implementation |
|---|---|
| User-collected data | Community reports via authenticated Cognito accounts |
| Public dataset | `[TO COMPLETE]` NOAA GHCN + FEMA |
| Data storage | S3 (3 buckets) and DynamoDB |
| EC2 or Lambda | Five Lambda functions |
| Elastic Load Balancing | ALB with a Lambda target group serving the public read path (§2.8) |
| CloudWatch | 5 log groups, DLQ alarm, structured JSON logging |
| IAM | Per-function execution roles, resource policies |
| Two+ of CloudFront/SQS/SNS/… | CloudFront, SQS, SNS (three) |
| User accounts | Amazon Cognito with SRP |
| Data secured | §3 |
