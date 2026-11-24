// Live provider: talks to AWS CodePipeline (plus CodeBuild, CloudWatch Logs,
// S3, CloudFormation and STS for the extras). Credentials come from the
// standard AWS chain: env vars / .env, AWS_PROFILE, or ~/.aws/credentials.
import {
  CodePipelineClient,
  ListPipelinesCommand,
  GetPipelineCommand,
  GetPipelineStateCommand,
  ListPipelineExecutionsCommand,
  ListActionExecutionsCommand,
  StartPipelineExecutionCommand,
  StopPipelineExecutionCommand,
  RetryStageExecutionCommand,
  EnableStageTransitionCommand,
  DisableStageTransitionCommand,
  PutApprovalResultCommand,
} from '@aws-sdk/client-codepipeline';
import { CodeBuildClient, BatchGetBuildsCommand } from '@aws-sdk/client-codebuild';
import { CloudWatchLogsClient, GetLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import {
  S3Client,
  CreateBucketCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
  DeleteBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import {
  CloudFormationClient,
  CreateStackCommand,
  DescribeStacksCommand,
  DescribeStackEventsCommand,
  DeleteStackCommand,
} from '@aws-sdk/client-cloudformation';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { DEMO_STACK_NAME, DEMO_PIPELINE_NAME, SOURCE_KEY, demoTemplate } from './demo-stack.js';
import { buildSourceZip, normalizeRelease } from './demo-source.js';

const TERMINAL = new Set(['Succeeded', 'Failed', 'Stopped', 'Superseded', 'Cancelled']);

export function createAwsProvider({ region }) {
  const cfg = { region };
  const cp = new CodePipelineClient(cfg);
  const cb = new CodeBuildClient(cfg);
  const logs = new CloudWatchLogsClient(cfg);
  const s3 = new S3Client(cfg);
  const cfn = new CloudFormationClient(cfg);
  const sts = new STSClient(cfg);
  let accountId = null;

  async function identity() {
    const id = await sts.send(new GetCallerIdentityCommand({}));
    accountId = id.Account;
    return { mode: 'aws', account: id.Account, arn: id.Arn, region };
  }

  // ---------- mapping helpers ----------
  const mapExecution = (s) => ({
    id: s.pipelineExecutionId,
    status: s.status,
    statusSummary: s.statusSummary ?? null,
    start: s.startTime,
    updated: s.lastUpdateTime,
    end: TERMINAL.has(s.status) ? s.lastUpdateTime : null,
    executionMode: s.executionMode,
    trigger: s.trigger ? { type: s.trigger.triggerType, detail: s.trigger.triggerDetail } : null,
    sourceRevisions: (s.sourceRevisions ?? []).map((r) => ({
      actionName: r.actionName,
      revisionId: r.revisionId,
      summary: r.revisionSummary,
      url: r.revisionUrl,
    })),
  });

  async function listExecutions(name, max = 50) {
    const out = [];
    let nextToken;
    do {
      const res = await cp.send(new ListPipelineExecutionsCommand({ pipelineName: name, maxResults: 50, nextToken }));
      out.push(...(res.pipelineExecutionSummaries ?? []).map(mapExecution));
      nextToken = res.nextToken;
    } while (nextToken && out.length < max);
    return out.slice(0, max);
  }

  async function getPipeline(name) {
    const [def, state] = await Promise.all([
      cp.send(new GetPipelineCommand({ name })),
      cp.send(new GetPipelineStateCommand({ name })),
    ]);
    const p = def.pipeline;
    const stateByStage = Object.fromEntries((state.stageStates ?? []).map((s) => [s.stageName, s]));
    return {
      name: p.name,
      pipelineType: p.pipelineType ?? 'V1',
      executionMode: p.executionMode ?? 'SUPERSEDED',
      version: p.version,
      created: def.metadata?.created,
      updated: def.metadata?.updated,
      arn: def.metadata?.pipelineArn,
      stages: p.stages.map((stage) => {
        const st = stateByStage[stage.name] ?? {};
        const actionStates = Object.fromEntries((st.actionStates ?? []).map((a) => [a.actionName, a]));
        return {
          name: stage.name,
          inboundTransition: st.inboundTransitionState
            ? { enabled: st.inboundTransitionState.enabled, reason: st.inboundTransitionState.disabledReason ?? null }
            : { enabled: true, reason: null },
          latest: st.latestExecution ? { executionId: st.latestExecution.pipelineExecutionId, status: st.latestExecution.status } : null,
          actions: stage.actions.map((a) => {
            const as = actionStates[a.name]?.latestExecution;
            return {
              name: a.name,
              category: a.actionTypeId.category,
              owner: a.actionTypeId.owner,
              provider: a.actionTypeId.provider,
              runOrder: a.runOrder ?? 1,
              configuration: a.configuration ?? {},
              status: as?.status ?? null,
              summary: as?.summary ?? null,
              lastStatusChange: as?.lastStatusChange ?? null,
              externalUrl: as?.externalExecutionUrl ?? actionStates[a.name]?.entityUrl ?? null,
              externalExecutionId: as?.externalExecutionId ?? null,
              errorMessage: as?.errorDetails?.message ?? null,
              token: as?.token ?? null,
              executionId: as?.actionExecutionId ?? null,
              pipelineExecutionId: st.latestExecution?.pipelineExecutionId ?? null,
            };
          }),
        };
      }),
    };
  }

  async function listPipelines() {
    const names = [];
    let nextToken;
    do {
      const res = await cp.send(new ListPipelinesCommand({ nextToken }));
      names.push(...(res.pipelines ?? []));
      nextToken = res.nextToken;
    } while (nextToken);
    return Promise.all(
      names.map(async (p) => {
        const [detail, executions] = await Promise.all([getPipeline(p.name), listExecutions(p.name, 50)]);
        return { ...detail, executions };
      })
    );
  }

  async function getExecution(name, executionId) {
    const details = [];
    let nextToken;
    do {
      const res = await cp.send(
        new ListActionExecutionsCommand({ pipelineName: name, filter: { pipelineExecutionId: executionId }, nextToken })
      );
      details.push(...(res.actionExecutionDetails ?? []));
      nextToken = res.nextToken;
    } while (nextToken);
    return details
      .map((d) => ({
        stage: d.stageName,
        action: d.actionName,
        status: d.status,
        start: d.startTime,
        end: d.status === 'InProgress' ? null : d.lastUpdateTime,
        category: d.input?.actionTypeId?.category,
        provider: d.input?.actionTypeId?.provider,
        summary: d.output?.executionResult?.externalExecutionSummary ?? null,
        externalUrl: d.output?.executionResult?.externalExecutionUrl ?? null,
        externalExecutionId: d.output?.executionResult?.externalExecutionId ?? null,
        errorMessage: d.output?.executionResult?.errorDetails?.message ?? null,
        actionExecutionId: d.actionExecutionId,
      }))
      .sort((a, b) => new Date(a.start) - new Date(b.start));
  }

  async function buildLogs(buildId) {
    if (!buildId) return { lines: [], note: 'This action has no CodeBuild build attached yet.' };
    const res = await cb.send(new BatchGetBuildsCommand({ ids: [buildId] }));
    const build = res.builds?.[0];
    if (!build) return { lines: [], note: 'Build not found.' };
    const phases = (build.phases ?? []).map((p) => ({ name: p.phaseType, status: p.phaseStatus, seconds: p.durationInSeconds ?? null }));
    const { groupName, streamName, deepLink } = build.logs ?? {};
    if (!groupName || !streamName) return { lines: [], phases, buildStatus: build.buildStatus, note: 'Logs are not available yet.', url: deepLink };
    const ev = await logs.send(new GetLogEventsCommand({ logGroupName: groupName, logStreamName: streamName, startFromHead: true, limit: 500 }));
    return {
      buildStatus: build.buildStatus,
      phases,
      url: deepLink,
      lines: (ev.events ?? []).map((e) => ({ t: e.timestamp, text: e.message?.replace(/\n$/, '') ?? '' })),
    };
  }

  // ---------- mutations ----------
  const start = async (name) => {
    const r = await cp.send(new StartPipelineExecutionCommand({ name }));
    return { executionId: r.pipelineExecutionId };
  };
  const stop = (name, executionId, { abandon = false, reason } = {}) =>
    cp.send(new StopPipelineExecutionCommand({ pipelineName: name, pipelineExecutionId: executionId, abandon, reason: reason || 'Stopped from Flowline' }));
  const retry = (name, stage, executionId) =>
    cp.send(new RetryStageExecutionCommand({ pipelineName: name, stageName: stage, pipelineExecutionId: executionId, retryMode: 'FAILED_ACTIONS' }));
  const setTransition = (name, stage, enabled, reason) =>
    enabled
      ? cp.send(new EnableStageTransitionCommand({ pipelineName: name, stageName: stage, transitionType: 'Inbound' }))
      : cp.send(new DisableStageTransitionCommand({ pipelineName: name, stageName: stage, transitionType: 'Inbound', reason: reason || 'Paused from Flowline' }));
  const approve = (name, stage, action, token, status, summary) =>
    cp.send(new PutApprovalResultCommand({ pipelineName: name, stageName: stage, actionName: action, token, result: { status, summary: summary || `${status} in Flowline` } }));

  // ---------- Demo Lab ----------
  const sourceBucketName = () => `flowline-src-${accountId}-${region}`;

  async function stackInfo() {
    try {
      const res = await cfn.send(new DescribeStacksCommand({ StackName: DEMO_STACK_NAME }));
      return res.Stacks?.[0] ?? null;
    } catch (e) {
      if (/does not exist/.test(e.message)) return null;
      throw e;
    }
  }

  async function demoStatus() {
    if (!accountId) await identity();
    const stack = await stackInfo();
    if (!stack) return { state: 'none', events: [] };
    const outputs = Object.fromEntries((stack.Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue]));
    const ev = await cfn.send(new DescribeStackEventsCommand({ StackName: stack.StackId }));
    const events = (ev.StackEvents ?? []).slice(0, 40).map((e) => ({
      t: e.Timestamp,
      resource: e.LogicalResourceId,
      type: e.ResourceType,
      status: e.ResourceStatus,
      reason: e.ResourceStatusReason ?? null,
    }));
    const s = stack.StackStatus;
    const state = /_IN_PROGRESS$/.test(s)
      ? s.startsWith('DELETE')
        ? 'deleting'
        : 'creating'
      : s === 'CREATE_COMPLETE' || s === 'UPDATE_COMPLETE'
        ? 'ready'
        : s === 'DELETE_COMPLETE'
          ? 'none'
          : 'failed';
    return { state, stackStatus: s, outputs, events, pipelineName: DEMO_PIPELINE_NAME, sourceBucket: sourceBucketName() };
  }

  async function ensureSourceBucket() {
    const Bucket = sourceBucketName();
    try {
      await s3.send(new HeadBucketCommand({ Bucket }));
    } catch {
      await s3.send(
        new CreateBucketCommand({
          Bucket,
          ...(region === 'us-east-1' ? {} : { CreateBucketConfiguration: { LocationConstraint: region } }),
        })
      );
    }
    await s3.send(new PutBucketVersioningCommand({ Bucket, VersioningConfiguration: { Status: 'Enabled' } }));
    return Bucket;
  }

  async function uploadSource(release) {
    const Bucket = sourceBucketName();
    await s3.send(
      new PutObjectCommand({
        Bucket,
        Key: SOURCE_KEY,
        Body: buildSourceZip(release),
        ContentType: 'application/zip',
        // CodePipeline shows this as the source revision summary.
        Metadata: { 'codepipeline-artifact-revision-summary': `v${release.version} · ${release.message}`.slice(0, 2000) },
      })
    );
  }

  async function demoProvision(input) {
    if (!accountId) await identity();
    const existing = await stackInfo();
    if (existing && existing.StackStatus !== 'DELETE_COMPLETE') throw Object.assign(new Error('The demo stack already exists.'), { status: 409 });
    const Bucket = await ensureSourceBucket();
    await uploadSource(normalizeRelease({ ...input, message: input?.message || 'Initial release from Flowline' }));
    await cfn.send(
      new CreateStackCommand({
        StackName: DEMO_STACK_NAME,
        TemplateBody: JSON.stringify(demoTemplate()),
        Parameters: [{ ParameterKey: 'SourceBucketName', ParameterValue: Bucket }],
        Capabilities: ['CAPABILITY_IAM'],
        Tags: [{ Key: 'app', Value: 'flowline' }],
      })
    );
    return { ok: true };
  }

  async function demoShip(input) {
    if (!accountId) await identity();
    const release = normalizeRelease(input);
    await uploadSource(release);
    // PollForSourceChanges is off, so Flowline starts the run explicitly.
    const r = await cp.send(new StartPipelineExecutionCommand({ name: DEMO_PIPELINE_NAME }));
    return { executionId: r.pipelineExecutionId, release };
  }

  async function demoSite() {
    const st = await demoStatus();
    const Bucket = st.outputs?.SiteBucket;
    if (!Bucket) return null;
    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket, Key: 'index.html' }));
      return { html: await obj.Body.transformToString(), lastModified: obj.LastModified };
    } catch {
      return null;
    }
  }

  async function emptyBucket(Bucket, versioned) {
    try {
      if (versioned) {
        let KeyMarker, VersionIdMarker;
        do {
          const res = await s3.send(new ListObjectVersionsCommand({ Bucket, KeyMarker, VersionIdMarker }));
          const objs = [...(res.Versions ?? []), ...(res.DeleteMarkers ?? [])].map((v) => ({ Key: v.Key, VersionId: v.VersionId }));
          if (objs.length) await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: objs } }));
          KeyMarker = res.NextKeyMarker;
          VersionIdMarker = res.NextVersionIdMarker;
          if (!res.IsTruncated) break;
        } while (true);
      } else {
        let ContinuationToken;
        do {
          const res = await s3.send(new ListObjectsV2Command({ Bucket, ContinuationToken }));
          const objs = (res.Contents ?? []).map((o) => ({ Key: o.Key }));
          if (objs.length) await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: objs } }));
          ContinuationToken = res.NextContinuationToken;
        } while (ContinuationToken);
      }
    } catch (e) {
      if (!/NoSuchBucket|does not exist/.test(e.name + e.message)) throw e;
    }
  }

  async function demoTeardown() {
    if (!accountId) await identity();
    const st = await demoStatus();
    if (st.outputs?.ArtifactBucket) await emptyBucket(st.outputs.ArtifactBucket, false);
    if (st.outputs?.SiteBucket) await emptyBucket(st.outputs.SiteBucket, false);
    if (st.state !== 'none') await cfn.send(new DeleteStackCommand({ StackName: DEMO_STACK_NAME }));
    const src = sourceBucketName();
    await emptyBucket(src, true);
    try {
      await s3.send(new DeleteBucketCommand({ Bucket: src }));
    } catch (e) {
      if (!/NoSuchBucket/.test(e.name)) throw e;
    }
    return { ok: true };
  }

  return {
    mode: 'aws',
    identity,
    listPipelines,
    getPipeline,
    listExecutions,
    getExecution,
    buildLogs,
    start,
    stop,
    retry,
    setTransition,
    approve,
    demoStatus,
    demoProvision,
    demoShip,
    demoSite,
    demoTeardown,
  };
}
