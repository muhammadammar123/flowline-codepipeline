# Live demo guide: AWS CodePipeline (Muhammad Ammar)

Total time for your part is about 12 minutes: 7–8 minutes of slides (6–10) and 4–5 minutes of live demo.
Speaker notes for every slide are in the deck (PowerPoint → View → Notes, or Presenter View).

---

## The day before

1. Put the AWS key in `flowline\.env` (see README) and run `npm run dev`. The sidebar badge must say **LIVE AWS**.
2. Go to **Demo Lab → Provision demo pipeline**. Wait about 2 minutes until the stack shows CREATE_COMPLETE.
3. Let the first run reach **Approve**, then approve it, so a live site already exists.
4. Ship one change with **Ship a failing test** turned on, so the history already contains a red build.
5. Leave the stack running for class. It costs cents. Tear it down after class.

> Why provision the day before? Provisioning plus the first build takes 2–4 minutes, which is too slow to show live. In class you only *ship* changes, and each run takes about 1–2 minutes.

## 10 minutes before class

- Run `npm run dev` and open http://localhost:5173.
- Zoom the browser to 110–125% so the back row can read it (Ctrl + plus).
- Open these tabs in order:
  1. Flowline **Demo Lab**
  2. Flowline **Pipelines → flowline-demo-pipeline**
  3. The AWS Console → **CodePipeline → flowline-demo-pipeline**. This proves it's real AWS, not a mock-up.
- Turn on Do Not Disturb or Focus Assist, and close chats and email.
- Hotspot or Wi-Fi: check that the AWS console loads.

## In class: demo script (about 5 minutes)

| Time | Show | Say |
|---|---|---|
| 0:00 | **Overview** page | "This dashboard reads my real AWS account through the CodePipeline API. These are the delivery metrics: deploy frequency, success rate, average run time and recovery time." |
| 0:40 | **Demo Lab → Ship a change**: type "Add holiday banner", pick a new colour, click **Push** | "I'm pushing a new version. The app uploads my source to S3 and calls StartPipelineExecution." |
| 1:00 | Scroll to the flow graph. Source turns green, Build turns blue | "Source picked up my change. Now CodeBuild is installing, testing and building it." |
| 1:30 | Click **Logs** on the Build action | "These are live CodeBuild logs from CloudWatch. You can see the tests passing." |
| 2:15 | Build turns green and Approve turns amber. Click **Review → Approve** | "Here's the manual approval gate. Nothing reaches production until a human approves it." |
| 2:45 | Deploy turns green. The site preview on the right updates | "Deployed. The live site now shows the new version and colour." |
| 3:15 | Click the **lock** between Approve and Deploy | "During a change freeze, I can pause the transition, and runs stop at this point." |
| 3:40 | Switch to the AWS Console tab and refresh | "Same pipeline in the real AWS console, same run, same status." |
| 4:15 | Back to Flowline. Open the failed run from yesterday and show its error and logs | "If a test fails, the pipeline stops. Broken code never reaches users. I can fix it and retry." |
| 4:45 | Close | "That's CodePipeline: every change tested, approved and deployed the same way, for fractions of a cent per run." |

**Tip:** while Build runs (about 1 minute), talk about the buildspec on slide 8 or answer a question. Don't stand in silence.

## Backup plan (have it ready)

- **No internet or AWS problems:** on the **Connect AWS** page, click **Use the simulator**. Every button still works on realistic data. Say so honestly: "The network is down, so this is the built-in simulator, which behaves the same way."
- **Build too slow:** go to **Pipelines → storefront-web** (simulator) or show yesterday's runs in the history table.
- Record a 2-minute screen video of the demo the day before (Win + Alt + R with Xbox Game Bar) as a last resort.

## Likely questions

- **CodePipeline vs Jenkins or GitHub Actions?** CodePipeline is fully managed, with no servers to patch. It integrates natively with IAM and AWS deploy targets, and you pay per action-minute.
- **What's the difference between CodeBuild and CodePipeline?** CodeBuild runs the build and test commands. CodePipeline orchestrates the whole flow: source → build → approve → deploy.
- **What happens if a build fails?** The run stops and later stages don't run. You fix the code and push again, or retry the failed stage.
- **How much did this demo cost?** Inside the free tier: 100 V2 action-minutes and 100 CodeBuild minutes a month. Without the free tier, a few cents.
- **Can it deploy to EC2 or containers?** Yes: CodeDeploy to EC2, ECS (including blue/green), EKS, Lambda, CloudFormation, Elastic Beanstalk and S3.

## After class

**Demo Lab → Tear down**. Then, in IAM, delete the `flowline` user's access key, or the whole user.
