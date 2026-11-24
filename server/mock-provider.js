// Simulator provider: an in-memory CodePipeline that behaves like the real
// service (stages, run order, approvals with tokens, retries, stage
// transitions, superseding) so Flowline is fully usable without AWS.
import { randomUUID } from 'node:crypto';
import { DEMO_PIPELINE_NAME } from './demo-stack.js';
import { normalizeRelease } from './demo-source.js';

const LIVE_SPEED = 14; // live runs play back 14× faster than "real" durations
const MIN = 60_000;
const DAY = 86_400_000;

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261124);
const between = ([a, b]) => a + (b - a) * rnd();
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const hex = (n) => [...Array(n)].map(() => Math.floor(rnd() * 16).toString(16)).join('');

const A = (name, category, provider, dur, failRate = 0, extra = {}) => ({
  name, category, provider, owner: provider === 'GitHub' || provider === 'CodeStarSourceConnection' ? 'AWS' : 'AWS', runOrder: 1, dur, failRate, ...extra,
});

const COMMITS = [
  'Fix cart total rounding for multi-currency orders',
  'Add retry with jitter to payment webhook handler',
  'Bump aws-sdk to 3.700 and refresh lockfile',
  'Lazy-load product gallery images',
  'Refactor auth middleware into its own module',
  'Add p95 latency alarm for checkout API',
  'Feature flag: one-click reorder',
  'Fix flaky integration test in orders.spec',
  'Reduce Lambda cold start by trimming bundle',
  'Migrate nightly ETL to Glue 4.0',
  'Add dark mode tokens to design system',
  'Hotfix: null pointer in invoice PDF export',
  'Improve search relevance for partial SKUs',
  'Tighten IAM policy for S3 export role',
  'Add canary step to production deploy',
];
const AUTHORS = ['amira', 'jdoe', 'kchen', 'rsingh', 'mlopez', 'tnguyen'];

const BLUEPRINTS = [
  {
    name: 'storefront-web',
    executionMode: 'SUPERSEDED',
    sourceProvider: 'CodeStarSourceConnection',
    repo: 'acme/storefront-web',
    stages: [
      { name: 'Source', actions: [A('GitHub', 'Source', 'CodeStarSourceConnection', [8, 20])] },
      { name: 'Build', actions: [A('CompileAndBundle', 'Build', 'CodeBuild', [140, 260], 0.06)] },
      {
        name: 'Test',
        actions: [
          A('UnitTests', 'Test', 'CodeBuild', [90, 160], 0.05),
          A('IntegrationTests', 'Test', 'CodeBuild', [180, 300], 0.08),
          A('SecurityScan', 'Test', 'CodeBuild', [60, 120], 0.02),
        ],
      },
      { name: 'Staging', actions: [A('DeployStaging', 'Deploy', 'S3', [20, 45], 0.01), A('SmokeTest', 'Invoke', 'Lambda', [15, 40], 0.04, { runOrder: 2 })] },
      { name: 'Approval', actions: [A('ProductSignOff', 'Approval', 'Manual', [300, 3600])] },
      { name: 'Production', actions: [A('DeployProd', 'Deploy', 'S3', [20, 45], 0.01), A('InvalidateCDN', 'Invoke', 'Lambda', [30, 70], 0.01, { runOrder: 2 })] },
    ],
  },
  {
    name: 'payments-api',
    executionMode: 'QUEUED',
    sourceProvider: 'CodeStarSourceConnection',
    repo: 'acme/payments-api',
    stages: [
      { name: 'Source', actions: [A('GitHub', 'Source', 'CodeStarSourceConnection', [8, 20])] },
      { name: 'Build', actions: [A('DockerBuild', 'Build', 'CodeBuild', [200, 380], 0.05), A('PushToECR', 'Build', 'ECR', [20, 50], 0.0, { runOrder: 2 })] },
      { name: 'Deploy-Staging', actions: [A('ECSBlueGreen', 'Deploy', 'CodeDeployToECS', [240, 420], 0.07)] },
      { name: 'Deploy-Prod', actions: [A('ECSBlueGreen', 'Deploy', 'CodeDeployToECS', [300, 480], 0.04)] },
    ],
  },
  {
    name: 'data-etl-jobs',
    executionMode: 'SUPERSEDED',
    sourceProvider: 'S3',
    repo: 's3://acme-etl-src/jobs.zip',
    stages: [
      { name: 'Source', actions: [A('S3Source', 'Source', 'S3', [5, 12])] },
      { name: 'Package', actions: [A('SamPackage', 'Build', 'CodeBuild', [90, 180], 0.04)] },
      { name: 'Deploy', actions: [A('CloudFormationDeploy', 'Deploy', 'CloudFormation', [120, 300], 0.12)] },
    ],
  },
  {
    name: 'mobile-app-release',
    executionMode: 'QUEUED',
    sourceProvider: 'CodeStarSourceConnection',
    repo: 'acme/mobile-app',
    stages: [
      { name: 'Source', actions: [A('GitHub', 'Source', 'CodeStarSourceConnection', [8, 20])] },
      { name: 'Build', actions: [A('BuildAndroid', 'Build', 'CodeBuild', [400, 700], 0.07), A('BuildiOS', 'Build', 'CodeBuild', [500, 800], 0.09)] },
      { name: 'Beta', actions: [A('DistributeTestFlight', 'Deploy', 'Lambda', [60, 120], 0.03)] },
      { name: 'StoreSubmit', actions: [A('SubmitForReview', 'Deploy', 'Lambda', [60, 120], 0.02)] },
    ],
  },
];

const ERRORS = {
  Build: ['Build failed: exit status 2 in phase BUILD', 'COMMAND_EXECUTION_ERROR: npm run build exited with 1', 'Out of memory in webpack bundle step'],
  Test: ['2 tests failed in checkout.spec.ts', 'Integration test timeout: orders API did not respond in 30s', 'Coverage dropped below 80% threshold'],
  Deploy: ['ECS service did not stabilize: tasks failed ELB health checks', 'Stack UPDATE_ROLLBACK_COMPLETE: Lambda handler not found', 'Access denied writing to deployment bucket'],
  Invoke: ['Lambda returned FunctionError: smoke test 503 on /health'],
};

// ------------------------------------------------------------------
const state = { pipelines: [], demo: { state: 'none', startedAt: null, deletingAt: null, deployed: null } };

function newActionRun(def, startAt, live, outcomeOverride) {
  const realMs = between(def.dur) * 1000;
  const planned = def.category === 'Approval' ? Infinity : live ? realMs / LIVE_SPEED : realMs;
  return {
    status: 'InProgress',
    start: startAt,
    end: null,
    plannedMs: planned,
    outcome: outcomeOverride ?? (rnd() < def.failRate ? 'Failed' : 'Succeeded'),
    actionExecutionId: randomUUID(),
    externalExecutionId: def.provider === 'CodeBuild' ? `${def.name.toLowerCase()}:${randomUUID()}` : def.category === 'Approval' ? null : `ext-${hex(12)}`,
    token: def.category === 'Approval' ? randomUUID() : null,
    summary: null,
    errorMessage: null,
  };
}

function finishAction(p, ex, def, run, at) {
  run.end = at;
  run.status = run.outcome;
  if (run.status === 'Failed') {
    run.errorMessage = ex.release?.breakBuild && def.provider === 'CodeBuild'
      ? 'COMMAND_EXECUTION_ERROR in PRE_BUILD: node test.js exited 1 (failing: checkout flow returns 200)'
      : pick(ERRORS[def.category] ?? ERRORS.Build);
    run.summary = 'Action failed';
  } else {
    run.summary =
      def.category === 'Source'
        ? ex.sourceRevisions[0]?.summary
        : def.provider === 'CodeBuild'
          ? `Build ${def.name} #${100 + Math.floor(rnd() * 900)} succeeded`
          : def.category === 'Deploy'
            ? `Deployed revision ${ex.sourceRevisions[0]?.revisionId.slice(0, 7)}`
            : 'Completed';
  }
}

function newExecution(p, startAt, { live, trigger, revision, overrides = {} } = {}) {
  const message = revision?.message ?? pick(COMMITS);
  const ex = {
    id: randomUUID(),
    status: 'InProgress',
    start: startAt,
    end: null,
    updated: startAt,
    live,
    trigger: trigger ?? { type: 'Webhook', detail: `${pick(AUTHORS)} pushed to main` },
    sourceRevisions: [
      { actionName: p.stages[0].actions[0].name, revisionId: revision?.id ?? hex(40), summary: message, url: p.repo.startsWith('s3') ? null : `https://github.com/${p.repo}/commit/` },
    ],
    stageRuns: {},
    cursor: 0,
    waiting: false,
    overrides, // { [stageName]: { [actionName]: 'Failed' } }
    release: revision?.release ?? null,
  };
  if (ex.sourceRevisions[0].url) ex.sourceRevisions[0].url += ex.sourceRevisions[0].revisionId;
  return ex;
}

// Advance one execution up to `now`. Uses virtual timestamps so catch-up is exact.
function advance(p, ex, now, autoApprove = false) {
  if (ex.status !== 'InProgress') return;
  let clock = ex.updated;
  while (ex.cursor < p.stages.length) {
    const sdef = p.stages[ex.cursor];
    let run = ex.stageRuns[sdef.name];
    if (!run) {
      const tr = p.transitions[sdef.name];
      if (ex.cursor > 0 && tr && !tr.enabled) {
        ex.waiting = true;
        break;
      }
      ex.waiting = false;
      run = ex.stageRuns[sdef.name] = { status: 'InProgress', start: clock, end: null, actions: {} };
    }
    // Run-order groups
    const orders = [...new Set(sdef.actions.map((a) => a.runOrder))].sort((a, b) => a - b);
    let groupStart = run.start;
    let blocked = false;
    let failed = false;
    for (const order of orders) {
      const group = sdef.actions.filter((a) => a.runOrder === order);
      let groupEnd = groupStart;
      for (const def of group) {
        let ar = run.actions[def.name];
        if (!ar) ar = run.actions[def.name] = newActionRun(def, groupStart, ex.live, ex.overrides?.[sdef.name]?.[def.name]);
        if (ar.status === 'InProgress') {
          if (def.category === 'Approval') {
            if (autoApprove) {
              ar.outcome = 'Succeeded';
              finishAction(p, ex, def, ar, ar.start + between(def.dur) * 1000);
              ar.summary = `Approved by ${pick(AUTHORS)}`;
            } else {
              blocked = true;
              continue;
            }
          } else if (ar.start + ar.plannedMs <= now) {
            finishAction(p, ex, def, ar, ar.start + ar.plannedMs);
          } else {
            blocked = true;
            continue;
          }
        }
        if (ar.status === 'Failed') failed = true;
        groupEnd = Math.max(groupEnd, ar.end ?? groupEnd);
      }
      if (blocked || failed) break;
      groupStart = groupEnd;
    }
    if (blocked) break; // wait for in-flight actions (or an approval) before closing the stage
    const ends = Object.values(run.actions).map((a) => a.end ?? 0);
    run.end = Math.max(...ends);
    clock = run.end;
    if (failed) {
      run.status = 'Failed';
      ex.status = 'Failed';
      ex.end = run.end;
      ex.updated = run.end;
      return;
    }
    run.status = 'Succeeded';
    ex.updated = run.end;
    ex.cursor++;
    if (p.name === DEMO_PIPELINE_NAME && sdef.name === 'Deploy' && ex.release) {
      state.demo.deployed = { ...ex.release, build: ex.buildNo, at: run.end };
    }
  }
  if (ex.cursor >= p.stages.length) {
    ex.status = 'Succeeded';
    ex.end = clock;
    ex.updated = clock;
  }
}

function tick() {
  const now = Date.now();
  for (const p of state.pipelines) {
    // Execute in chronological order so QUEUED semantics are roughly respected.
    for (const ex of [...p.executions].reverse()) advance(p, ex, now);
  }
  tickDemo(now);
}

// ------------------------------------------------------------------
function seed() {
  const now = Date.now();
  for (const bp of BLUEPRINTS) {
    const p = {
      name: bp.name,
      pipelineType: 'V2',
      executionMode: bp.executionMode,
      version: 3 + Math.floor(rnd() * 9),
      created: new Date(now - (40 + rnd() * 200) * DAY).toISOString(),
      updated: new Date(now - (1 + rnd() * 20) * DAY).toISOString(),
      repo: bp.repo,
      stages: bp.stages,
      transitions: Object.fromEntries(bp.stages.map((s) => [s.name, { enabled: true, reason: null }])),
      executions: [],
    };
    // 14 days of history
    let t = now - 14 * DAY;
    while (t < now - 2 * 3600_000) {
      t += (2 + rnd() * 9) * 3600_000;
      if (t > now - 2 * 3600_000) break;
      const ex = newExecution(p, t, { live: false });
      advance(p, ex, Infinity, true);
      if (rnd() < 0.04 && ex.status === 'Succeeded') ex.status = 'Superseded';
      p.executions.unshift(ex);
    }
    state.pipelines.push(p);
  }
  const [store, payments, etl, mobile] = state.pipelines;

  // storefront: waiting at approval right now
  {
    const ex = newExecution(store, now - 25 * MIN, { live: false });
    ex.overrides = Object.fromEntries(store.stages.map((s) => [s.name, Object.fromEntries(s.actions.map((a) => [a.name, 'Succeeded']))]));
    advance(store, ex, now);
    ex.live = true;
    store.executions.unshift(ex);
  }
  // payments: actively running
  {
    const ex = newExecution(payments, now - 4000, { live: true });
    ex.overrides = { Build: { DockerBuild: 'Succeeded', PushToECR: 'Succeeded' } };
    payments.executions.unshift(ex);
  }
  // etl: latest failed in Deploy (ready for retry)
  {
    const ex = newExecution(etl, now - 47 * MIN, { live: false });
    ex.overrides = { Source: { S3Source: 'Succeeded' }, Package: { SamPackage: 'Succeeded' }, Deploy: { CloudFormationDeploy: 'Failed' } };
    advance(etl, ex, now);
    ex.live = true;
    etl.executions.unshift(ex);
  }
  // mobile: change freeze on StoreSubmit
  mobile.transitions.StoreSubmit = { enabled: false, reason: 'Release freeze until App Store review completes' };
  {
    const ex = newExecution(mobile, now - 70 * MIN, { live: false });
    ex.overrides = { Build: { BuildAndroid: 'Succeeded', BuildiOS: 'Succeeded' }, Beta: { DistributeTestFlight: 'Succeeded' } };
    advance(mobile, ex, now);
    ex.live = true;
    mobile.executions.unshift(ex);
  }
}
seed();

// ------------------------------------------------------------------
const find = (name) => {
  const p = state.pipelines.find((x) => x.name === name);
  if (!p) throw Object.assign(new Error(`Pipeline ${name} not found`), { status: 404 });
  return p;
};
const iso = (t) => (t == null || !Number.isFinite(t) ? null : new Date(t).toISOString());

const mapExecution = (ex) => ({
  id: ex.id,
  status: ex.status,
  statusSummary: ex.waiting ? 'Waiting for a disabled stage transition' : null,
  start: iso(ex.start),
  updated: iso(ex.updated),
  end: iso(ex.end),
  trigger: ex.trigger,
  sourceRevisions: ex.sourceRevisions,
});

function detail(p) {
  return {
    name: p.name,
    pipelineType: p.pipelineType,
    executionMode: p.executionMode,
    version: p.version,
    created: p.created,
    updated: p.updated,
    arn: `arn:aws:codepipeline:us-east-1:123456789012:${p.name}`,
    stages: p.stages.map((s) => {
      const latest = p.executions.find((e) => e.stageRuns[s.name]);
      const run = latest?.stageRuns[s.name];
      return {
        name: s.name,
        inboundTransition: p.transitions[s.name],
        latest: latest ? { executionId: latest.id, status: latest.status === 'Stopped' && run.status === 'InProgress' ? 'Stopped' : run.status } : null,
        actions: s.actions.map((a) => {
          const ar = run?.actions[a.name];
          return {
            name: a.name,
            category: a.category,
            owner: a.owner,
            provider: a.provider,
            runOrder: a.runOrder,
            configuration: a.category === 'Approval' ? { CustomData: 'Verify staging, then sign off the release.' } : {},
            status: ar?.status ?? null,
            summary: ar?.summary ?? null,
            lastStatusChange: iso(ar?.end ?? ar?.start),
            externalUrl: null,
            externalExecutionId: ar?.externalExecutionId ?? null,
            errorMessage: ar?.errorMessage ?? null,
            token: ar?.status === 'InProgress' ? ar.token : null,
            executionId: ar?.actionExecutionId ?? null,
            pipelineExecutionId: latest?.id ?? null,
          };
        }),
      };
    }),
  };
}

function buildLogLines(def, ar, ex) {
  const t0 = ar.start;
  const L = [];
  const add = (dt, text) => L.push({ t: t0 + dt, text });
  add(0, `[Container] ${iso(t0)} Running on CodeBuild On-demand`);
  add(400, '[Container] Waiting for agent ping');
  add(1500, '[Container] Phase is DOWNLOAD_SOURCE');
  add(2200, `[Container] CODEBUILD_SRC_DIR=/codebuild/output/src${hex(9)}/src`);
  add(2600, '[Container] Phase complete: DOWNLOAD_SOURCE State: SUCCEEDED');
  add(2700, '[Container] Phase is INSTALL');
  add(3100, '[Container] Running command node --version → v20.18.1');
  add(6000, '[Container] Phase complete: INSTALL State: SUCCEEDED');
  add(6100, '[Container] Phase is PRE_BUILD');
  add(6200, '[Container] Running command npm ci');
  add(14000, `added ${800 + Math.floor(rnd() * 400)} packages in 7s`);
  add(14100, '[Container] Phase is BUILD');
  if (def.category === 'Test') {
    ['auth', 'cart', 'checkout', 'orders', 'search'].forEach((m, i) => add(15000 + i * 900, `  ✓ ${m}.spec.ts (${12 + i * 3} tests)`));
  } else {
    add(15000, `[Container] Running command npm run build`);
    add(22000, `vite v5.4.11 building for production...`);
    add(30000, `✓ ${1400 + Math.floor(rnd() * 300)} modules transformed.`);
    add(31000, `dist/assets/index-${hex(8)}.js  ${200 + Math.floor(rnd() * 80)}.31 kB │ gzip: 71.02 kB`);
  }
  if (ar.status === 'Failed') {
    add(32000, `[Container] Command did not exit successfully exit status 1`);
    add(32100, `[Container] Phase complete: BUILD State: FAILED`);
    add(32200, `[Container] ${ar.errorMessage}`);
  } else if (ar.status === 'Succeeded') {
    add(32000, '[Container] Phase complete: BUILD State: SUCCEEDED');
    add(32100, '[Container] Phase is UPLOAD_ARTIFACTS');
    add(33000, '[Container] Phase complete: UPLOAD_ARTIFACTS State: SUCCEEDED');
  } else {
    add(32000, '[Container] Phase is BUILD … streaming');
  }
  const elapsed = (ar.end ?? Date.now()) - ar.start;
  const scale = Math.min(1, elapsed / 33000) || 1;
  return L.map((l) => ({ t: t0 + (l.t - t0) * scale, text: l.text })).filter((l) => ar.status !== 'InProgress' || l.t <= Date.now());
}

// ------------------------------------------------------------------
// Demo Lab (simulated CloudFormation)
const DEMO_RESOURCES = [
  ['ArtifactBucket', 'AWS::S3::Bucket'],
  ['SiteBucket', 'AWS::S3::Bucket'],
  ['BuildLogGroup', 'AWS::Logs::LogGroup'],
  ['BuildRole', 'AWS::IAM::Role'],
  ['BuildProject', 'AWS::CodeBuild::Project'],
  ['PipelineRole', 'AWS::IAM::Role'],
  ['Pipeline', 'AWS::CodePipeline::Pipeline'],
];
const PROVISION_MS = 14_000;
let demoBuildNo = 0;

function demoPipelineBlueprint() {
  return {
    name: DEMO_PIPELINE_NAME,
    pipelineType: 'V2',
    executionMode: 'SUPERSEDED',
    version: 1,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    repo: 's3://flowline-src/source.zip',
    stages: [
      { name: 'Source', actions: [A('Checkout', 'Source', 'S3', [40, 60])] },
      { name: 'Build', actions: [A('TestAndBuild', 'Build', 'CodeBuild', [120, 160])] },
      { name: 'Approve', actions: [A('ReleaseGate', 'Approval', 'Manual', [60, 600])] },
      { name: 'Deploy', actions: [A('PublishSite', 'Deploy', 'S3', [40, 70])] },
    ],
    transitions: { Source: { enabled: true, reason: null }, Build: { enabled: true, reason: null }, Approve: { enabled: true, reason: null }, Deploy: { enabled: true, reason: null } },
    executions: [],
  };
}

function demoRun(p, release) {
  const r = normalizeRelease(release);
  const ex = newExecution(p, Date.now(), {
    live: true,
    trigger: { type: 'StartPipelineExecution', detail: 'Flowline Demo Lab' },
    revision: { message: `v${r.version} · ${r.message}`, release: r },
  });
  ex.buildNo = ++demoBuildNo;
  ex.overrides = { Source: { Checkout: 'Succeeded' }, Build: { TestAndBuild: r.breakBuild ? 'Failed' : 'Succeeded' }, Deploy: { PublishSite: 'Succeeded' } };
  // superseded semantics
  for (const old of p.executions) if (old.status === 'InProgress') { old.status = 'Superseded'; old.end = Date.now(); old.updated = Date.now(); }
  p.executions.unshift(ex);
  return ex;
}

function tickDemo(now) {
  const d = state.demo;
  if (d.state === 'creating' && now - d.startedAt >= PROVISION_MS) {
    d.state = 'ready';
    const p = demoPipelineBlueprint();
    state.pipelines.push(p);
    demoRun(p, d.initial);
  }
  if (d.state === 'deleting' && now - d.deletingAt >= 8000) {
    d.state = 'none';
    d.deployed = null;
  }
}

function demoEvents(now) {
  const d = state.demo;
  const ev = [];
  if (d.startedAt) {
    ev.push({ t: iso(d.startedAt), resource: 'flowline-demo', type: 'AWS::CloudFormation::Stack', status: 'CREATE_IN_PROGRESS', reason: 'User Initiated' });
    DEMO_RESOURCES.forEach(([id, type], i) => {
      const s = d.startedAt + 600 + i * 1500;
      const e = s + 1200 + i * 200;
      if (now >= s) ev.push({ t: iso(s), resource: id, type, status: 'CREATE_IN_PROGRESS', reason: null });
      if (now >= e) ev.push({ t: iso(e), resource: id, type, status: 'CREATE_COMPLETE', reason: null });
    });
    if (now >= d.startedAt + PROVISION_MS) ev.push({ t: iso(d.startedAt + PROVISION_MS), resource: 'flowline-demo', type: 'AWS::CloudFormation::Stack', status: 'CREATE_COMPLETE', reason: null });
  }
  if (d.deletingAt) ev.push({ t: iso(d.deletingAt), resource: 'flowline-demo', type: 'AWS::CloudFormation::Stack', status: 'DELETE_IN_PROGRESS', reason: 'User Initiated' });
  return ev.sort((a, b) => new Date(b.t) - new Date(a.t));
}

function renderSite(r) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(r.appName)}</title>
<style>:root{--a:${r.accent}}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1020;color:#e2e8f0;font:16px/1.5 system-ui,sans-serif}
.card{width:min(560px,92vw);padding:40px;border-radius:20px;background:linear-gradient(160deg,#141b2e,#0f1526);border:1px solid #26314a;box-shadow:0 30px 80px -20px color-mix(in srgb,var(--a) 45%,transparent)}
.tag{display:inline-block;padding:4px 10px;border-radius:999px;background:color-mix(in srgb,var(--a) 18%,transparent);color:var(--a);font:600 12px/1.6 ui-monospace,monospace;letter-spacing:.04em}
h1{margin:16px 0 8px;font-size:34px;letter-spacing:-.02em}p{margin:0;color:#94a3b8}.meta{margin-top:28px;display:grid;grid-template-columns:auto 1fr;gap:6px 16px;font:13px/1.6 ui-monospace,monospace;color:#64748b}.meta b{color:#cbd5e1;font-weight:500}.bar{height:4px;border-radius:4px;background:var(--a);margin-top:28px}</style></head>
<body><main class="card"><span class="tag">LIVE · v${esc(r.version)}</span><h1>${esc(r.appName)}</h1><p>${esc(r.message)}</p>
<div class="meta"><span>build</span><b>#${esc(r.build)}</b><span>shipped by</span><b>${esc(r.author)}</b><span>built at</span><b>${iso(r.at)}</b><span>pipeline</span><b>AWS CodePipeline → CodeBuild → S3 (simulated)</b></div><div class="bar"></div></main></body></html>`;
}

// ------------------------------------------------------------------
export function createMockProvider() {
  const withTick = (fn) => async (...args) => {
    tick();
    const r = await fn(...args);
    tick();
    return r;
  };
  return {
    mode: 'mock',
    identity: async () => ({ mode: 'mock', account: '123456789012', arn: 'arn:aws:iam::123456789012:user/flowline-simulator', region: 'us-east-1' }),
    listPipelines: withTick(async () => state.pipelines.map((p) => ({ ...detail(p), executions: p.executions.slice(0, 50).map(mapExecution) }))),
    getPipeline: withTick(async (name) => detail(find(name))),
    listExecutions: withTick(async (name, max = 50) => find(name).executions.slice(0, max).map(mapExecution)),
    getExecution: withTick(async (name, id) => {
      const p = find(name);
      const ex = p.executions.find((e) => e.id === id);
      if (!ex) throw Object.assign(new Error('Execution not found'), { status: 404 });
      const out = [];
      for (const s of p.stages) {
        const run = ex.stageRuns[s.name];
        if (!run) continue;
        for (const a of s.actions) {
          const ar = run.actions[a.name];
          if (!ar) continue;
          out.push({
            stage: s.name,
            action: a.name,
            status: ar.status,
            start: iso(ar.start),
            end: iso(ar.end),
            category: a.category,
            provider: a.provider,
            summary: ar.summary,
            externalUrl: null,
            externalExecutionId: ar.externalExecutionId,
            errorMessage: ar.errorMessage,
            actionExecutionId: ar.actionExecutionId,
          });
        }
      }
      return out.sort((a, b) => new Date(a.start) - new Date(b.start));
    }),
    buildLogs: withTick(async (buildId) => {
      for (const p of state.pipelines)
        for (const ex of p.executions)
          for (const s of p.stages) {
            const run = ex.stageRuns[s.name];
            if (!run) continue;
            for (const a of s.actions) {
              const ar = run.actions[a.name];
              if (ar?.externalExecutionId === buildId) {
                let lines = buildLogLines(a, ar, ex);
                if (p.name === DEMO_PIPELINE_NAME && ex.release) {
                  const failing = ex.release.breakBuild;
                  lines = lines.filter((l) => !/✓|modules|vite|dist\//.test(l.text));
                  lines.splice(9, 0,
                    { t: ar.start + 15000, text: '  ✓ release.json has a version' },
                    { t: ar.start + 15200, text: '  ✓ release.json has a message' },
                    { t: ar.start + 15400, text: '  ✓ accent color is a valid hex' },
                    { t: ar.start + 15600, text: failing ? '  ✗ checkout flow returns 200' : '  ✓ checkout flow returns 200' },
                    { t: ar.start + 15800, text: failing ? '3 passing, 1 failing' : '4 passing, 0 failing' }
                  );
                  lines = lines.filter((l) => ar.status !== 'InProgress' || l.t <= Date.now());
                }
                const phases = ['SUBMITTED', 'PROVISIONING', 'DOWNLOAD_SOURCE', 'INSTALL', 'PRE_BUILD', 'BUILD', 'UPLOAD_ARTIFACTS', 'COMPLETED'].map((n) => ({ name: n, status: ar.status === 'Failed' && n === 'BUILD' ? 'FAILED' : 'SUCCEEDED' }));
                return { buildStatus: ar.status === 'InProgress' ? 'IN_PROGRESS' : ar.status.toUpperCase(), phases, lines };
              }
            }
          }
      return { lines: [], note: 'Build not found.' };
    }),
    start: withTick(async (name) => {
      const p = find(name);
      const ex = newExecution(p, Date.now(), { live: true, trigger: { type: 'StartPipelineExecution', detail: 'Released from Flowline' } });
      if (p.executionMode === 'SUPERSEDED')
        for (const old of p.executions) if (old.status === 'InProgress') { old.status = 'Superseded'; old.end = Date.now(); old.updated = Date.now(); }
      p.executions.unshift(ex);
      return { executionId: ex.id };
    }),
    stop: withTick(async (name, id, { abandon } = {}) => {
      const ex = find(name).executions.find((e) => e.id === id);
      if (!ex || ex.status !== 'InProgress') throw Object.assign(new Error('Execution is not in progress'), { status: 400 });
      ex.status = 'Stopped';
      ex.end = ex.updated = Date.now();
      for (const run of Object.values(ex.stageRuns)) {
        if (run.status === 'InProgress') run.status = 'Stopped';
        for (const ar of Object.values(run.actions)) if (ar.status === 'InProgress') { ar.status = abandon ? 'Abandoned' : 'Abandoned'; ar.end = Date.now(); }
      }
      return {};
    }),
    retry: withTick(async (name, stage, id) => {
      const p = find(name);
      const ex = p.executions.find((e) => e.id === id);
      const run = ex?.stageRuns[stage];
      if (!run || run.status !== 'Failed') throw Object.assign(new Error('Only failed stages can be retried'), { status: 400 });
      const now = Date.now();
      run.status = 'InProgress';
      run.end = null;
      for (const [aname, ar] of Object.entries(run.actions)) {
        if (ar.status === 'Failed') {
          const def = p.stages.find((s) => s.name === stage).actions.find((a) => a.name === aname);
          // A retry re-runs the same source revision: a genuinely broken demo build fails again.
          const outcome = p.name === DEMO_PIPELINE_NAME && ex.release?.breakBuild ? 'Failed' : 'Succeeded';
          run.actions[aname] = newActionRun(def, now, true, outcome);
        }
      }
      run.start = now;
      ex.status = 'InProgress';
      ex.end = null;
      ex.updated = now;
      ex.live = true;
      return {};
    }),
    setTransition: withTick(async (name, stage, enabled, reason) => {
      const p = find(name);
      p.transitions[stage] = { enabled, reason: enabled ? null : reason || 'Paused from Flowline' };
      if (enabled) for (const ex of p.executions) if (ex.waiting) ex.updated = Date.now();
      return {};
    }),
    approve: withTick(async (name, stage, action, token, status, summary) => {
      const p = find(name);
      for (const ex of p.executions) {
        const ar = ex.stageRuns[stage]?.actions[action];
        if (ar && ar.token === token && ar.status === 'InProgress') {
          ar.outcome = status === 'Approved' ? 'Succeeded' : 'Failed';
          ar.status = ar.outcome;
          ar.end = Date.now();
          ar.summary = summary || `${status} in Flowline`;
          if (status !== 'Approved') ar.errorMessage = `Rejected: ${summary || 'no reason given'}`;
          ex.updated = ex.stageRuns[stage].start; // let advance() close the stage
          return {};
        }
      }
      throw Object.assign(new Error('Approval token is no longer valid'), { status: 400 });
    }),
    demoStatus: withTick(async () => {
      const d = state.demo;
      const now = Date.now();
      return {
        state: d.state,
        stackStatus: { none: null, creating: 'CREATE_IN_PROGRESS', ready: 'CREATE_COMPLETE', deleting: 'DELETE_IN_PROGRESS' }[d.state],
        outputs: d.state === 'ready' ? { PipelineName: DEMO_PIPELINE_NAME, SiteBucket: 'flowline-demo-sitebucket-sim', ArtifactBucket: 'flowline-demo-artifactbucket-sim', BuildProject: 'flowline-demo-build' } : {},
        events: d.state === 'none' ? [] : demoEvents(now),
        pipelineName: DEMO_PIPELINE_NAME,
        sourceBucket: 'flowline-src-123456789012-us-east-1',
        progress: d.state === 'creating' ? Math.min(1, (now - d.startedAt) / PROVISION_MS) : d.state === 'ready' ? 1 : 0,
      };
    }),
    demoProvision: withTick(async (input) => {
      if (state.demo.state !== 'none') throw Object.assign(new Error('The demo stack already exists.'), { status: 409 });
      state.demo = { state: 'creating', startedAt: Date.now(), deletingAt: null, deployed: null, initial: { ...input, message: input?.message || 'Initial release from Flowline' } };
      return { ok: true };
    }),
    demoShip: withTick(async (input) => {
      const p = state.pipelines.find((x) => x.name === DEMO_PIPELINE_NAME);
      if (!p) throw Object.assign(new Error('Provision the demo pipeline first.'), { status: 400 });
      const ex = demoRun(p, input);
      return { executionId: ex.id, release: ex.release };
    }),
    demoSite: withTick(async () => (state.demo.deployed ? { html: renderSite(state.demo.deployed), lastModified: iso(state.demo.deployed.at) } : null)),
    demoTeardown: withTick(async () => {
      state.pipelines = state.pipelines.filter((p) => p.name !== DEMO_PIPELINE_NAME);
      state.demo = { ...state.demo, state: 'deleting', deletingAt: Date.now() };
      return { ok: true };
    }),
  };
}
