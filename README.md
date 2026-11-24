# Flowline: a release command center for AWS CodePipeline

Flowline is a local web app that turns AWS CodePipeline into a live release cockpit. It runs fully on simulated data until you connect an AWS account. After that, every screen uses the real CodePipeline API.

| Screen | What it shows | CodePipeline APIs |
|---|---|---|
| **Overview** | DORA-style metrics (deploy frequency, success rate, lead time, MTTR), executions per day, pipeline health and recent activity | `ListPipelines`, `GetPipelineState`, `ListPipelineExecutions` |
| **Pipelines** | A card per pipeline with a live stage strip, last revision, a duration sparkline and a one-click **Release change** button | `StartPipelineExecution` |
| **Pipeline detail** | An animated flow graph (stages → run-order groups → actions), stage-transition lock gates, **Retry failed actions**, **Stop run** (optionally abandoning in-flight actions), an execution waterfall and run history | `GetPipeline`, `ListActionExecutions`, `RetryStageExecution`, `StopPipelineExecution`, `Enable/DisableStageTransition` |
| **Build logs** | A streaming log drawer for any CodeBuild action, with build phases | `codebuild:BatchGetBuilds`, `logs:GetLogEvents` |
| **Approvals** | An inbox of every waiting Manual approval, where you approve or reject with a comment | `PutApprovalResult` (with the action's token) |
| **Demo Lab** | One click provisions a real pipeline: S3 source → CodeBuild (test + build) → Manual approval → S3 deploy. You then ship versions from the UI, can break the build on purpose, approve releases and preview the deployed site | CloudFormation, S3, `StartPipelineExecution` |

The design system came from the **ui-ux-pro-max** skill: the "Dark Mode (OLED)" style, the "code dark + run green" palette, IBM Plex Sans with JetBrains Mono, and dashboard density. Charts never rely on colour alone, and the app also provides keyboard focus rings, `prefers-reduced-motion` support and a phone-width layout.

## Run it

```powershell
npm install
npm run dev
```

Open http://localhost:5173. With no credentials, Flowline uses the **simulator**: four realistic pipelines, 14 days of history, a run in progress, a pending approval, a failed stage and a change freeze.

## Connect your AWS account

Your keys stay on your machine. The local Node server signs AWS requests, and the browser never sees the keys. **Don't paste keys into a chat.**

1. **Create an IAM user** in the new account (IAM → Users → Create user, for example `flowline`, with no console access).
2. **Attach permissions**: on a throwaway account `AdministratorAccess` is simplest. Otherwise add [`iam-policy.json`](iam-policy.json) as an inline policy.
3. **Create an access key** (user → Security credentials → Create access key → "Local code").
4. Give it to Flowline in **one** of these ways:

   **Option A: `.env` file** (git-ignored)
   ```powershell
   Copy-Item .env.example .env
   notepad .env   # fill AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
   ```

   **Option B: AWS CLI profile**
   ```powershell
   aws configure --profile flowline
   ```
   ```powershell
   $env:AWS_PROFILE="flowline"; npm run dev
   ```
5. Restart `npm run dev`. The server log shows `Connected to AWS account …`, and the sidebar badge changes to **LIVE AWS**. You can switch between live AWS and the simulator on the **Connect AWS** page.

## Demo Lab in your account

**Provision** creates:
- the `flowline-src-<account>-<region>` versioned S3 bucket, which holds `source.zip`
- the `flowline-demo` CloudFormation stack, with an artifact bucket, a site bucket, two IAM roles, the `flowline-demo-build` CodeBuild project, a log group and the `flowline-demo-pipeline` V2 pipeline

**Ship a change** zips a tiny site (`buildspec.yml`, `test.js`, `build.js`, `release.json`), uploads it with a revision summary, then calls `StartPipelineExecution`. Turning on **Ship a failing test** makes `node test.js` exit 1, so you can see a red build, its CloudWatch logs and a retry.

**Tear down** empties all three buckets and deletes the stack. The free tiers cover a short demo; tear it down when you're done.

## Project layout

```
server/index.js          Express API (/api/*); picks the live or simulated provider
server/aws-provider.js   AWS SDK v3: CodePipeline, CodeBuild, Logs, S3, CloudFormation, STS
server/mock-provider.js  In-memory CodePipeline simulator (stages, run order, approvals, retries, transitions)
server/demo-stack.js     CloudFormation template for the Demo Lab
server/demo-source.js    Source bundle that CodeBuild tests and builds
server/stats.js          Delivery metrics from execution history
web/src/                 React app (Vite): pages, flow graph, waterfall, log drawer
```
