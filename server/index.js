// Flowline API server. Credentials never reach the browser: the server signs
// AWS requests with the standard credential chain (.env, AWS_PROFILE, ~/.aws).
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAwsProvider } from './aws-provider.js';
import { createMockProvider } from './mock-provider.js';
import { computeStats } from './stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.FLOWLINE_API_PORT || 4000);
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
const REQUESTED = (process.env.FLOWLINE_MODE || 'auto').toLowerCase();

const mock = createMockProvider();
const aws = createAwsProvider({ region: REGION });
let awsCheck = { ok: false, error: 'Not checked yet', identity: null };
let active = mock;

async function checkAws() {
  try {
    const identity = await aws.identity();
    awsCheck = { ok: true, error: null, identity };
  } catch (e) {
    awsCheck = { ok: false, error: e.name === 'CredentialsProviderError' ? 'No AWS credentials found (.env, AWS_PROFILE or ~/.aws/credentials).' : e.message, identity: null };
  }
  return awsCheck;
}

const app = express();
app.use(express.json({ limit: '100kb' }));

const h = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (e) {
    const status = e.status || e.$metadata?.httpStatusCode || 500;
    console.error(`[${req.method} ${req.path}]`, e.name, e.message);
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: e.message, code: e.name });
  }
};

// ---- session / mode ----
app.get('/api/session', h(async () => ({
  mode: active.mode,
  region: REGION,
  identity: await active.identity(),
  aws: { available: awsCheck.ok, error: awsCheck.error, identity: awsCheck.identity },
})));
app.post('/api/session', h(async (req) => {
  const want = req.body?.mode;
  if (want === 'aws') {
    const c = await checkAws();
    if (!c.ok) throw Object.assign(new Error(c.error), { status: 400 });
    active = aws;
  } else active = mock;
  return { mode: active.mode };
}));
app.post('/api/session/recheck', h(async () => checkAws()));

// ---- pipelines ----
app.get('/api/pipelines', h(async () => {
  const pipelines = await active.listPipelines();
  return pipelines.map((p) => {
    const { executions, ...rest } = p;
    return { ...rest, latest: executions[0] ?? null, stats: computeStats(executions), recent: executions.slice(0, 12) };
  });
}));
app.get('/api/overview', h(async () => {
  const pipelines = await active.listPipelines();
  const all = pipelines.flatMap((p) => p.executions.map((e) => ({ ...e, pipeline: p.name })));
  const approvals = pipelines.flatMap((p) =>
    p.stages.flatMap((s) =>
      s.actions
        .filter((a) => a.category === 'Approval' && a.status === 'InProgress' && a.token)
        .map((a) => ({ pipeline: p.name, stage: s.name, action: a.name, token: a.token, since: a.lastStatusChange, customData: a.configuration?.CustomData ?? null, executionId: a.pipelineExecutionId, revision: p.executions.find((e) => e.id === a.pipelineExecutionId)?.sourceRevisions?.[0] ?? null }))
    )
  );
  return {
    stats: computeStats(all),
    approvals,
    running: all.filter((e) => e.status === 'InProgress').length,
    pipelines: pipelines.map((p) => ({ name: p.name, latest: p.executions[0] ?? null, stats: computeStats(p.executions), stages: p.stages.map((s) => ({ name: s.name, status: s.latest?.status ?? null, transition: s.inboundTransition })) })),
    feed: all.sort((a, b) => new Date(b.updated) - new Date(a.updated)).slice(0, 14),
  };
}));
app.get('/api/pipelines/:name', h(async (req) => {
  const [detail, executions] = await Promise.all([active.getPipeline(req.params.name), active.listExecutions(req.params.name, 50)]);
  return { ...detail, executions, stats: computeStats(executions) };
}));
app.get('/api/pipelines/:name/executions/:id', h(async (req) => active.getExecution(req.params.name, req.params.id)));
app.get('/api/builds/:id/logs', h(async (req) => active.buildLogs(req.params.id)));

app.post('/api/pipelines/:name/start', h(async (req) => active.start(req.params.name)));
app.post('/api/pipelines/:name/executions/:id/stop', h(async (req) => active.stop(req.params.name, req.params.id, { abandon: !!req.body?.abandon, reason: req.body?.reason })));
app.post('/api/pipelines/:name/stages/:stage/retry', h(async (req) => active.retry(req.params.name, req.params.stage, req.body?.executionId)));
app.post('/api/pipelines/:name/stages/:stage/transition', h(async (req) => active.setTransition(req.params.name, req.params.stage, !!req.body?.enabled, req.body?.reason)));
app.post('/api/pipelines/:name/stages/:stage/actions/:action/approval', h(async (req) => {
  const { token, status, summary } = req.body ?? {};
  if (!['Approved', 'Rejected'].includes(status)) throw Object.assign(new Error('status must be Approved or Rejected'), { status: 400 });
  return active.approve(req.params.name, req.params.stage, req.params.action, token, status, summary);
}));

app.get('/api/iam-policy', (_req, res) => res.type('text/plain').send(fs.readFileSync(path.join(__dirname, '..', 'iam-policy.json'), 'utf8')));

// ---- Demo Lab ----
app.get('/api/demo', h(async () => active.demoStatus()));
app.post('/api/demo/provision', h(async (req) => active.demoProvision(req.body)));
app.post('/api/demo/ship', h(async (req) => active.demoShip(req.body)));
app.post('/api/demo/teardown', h(async () => active.demoTeardown()));
app.get('/api/demo/site', h(async (req, res) => {
  const site = await active.demoSite();
  if (!site) return res.status(404).type('html').send('<!doctype html><body style="background:#0b1020;color:#64748b;font:14px system-ui;display:grid;place-items:center;height:100vh;margin:0">Nothing deployed yet</body>');
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'").type('html').send(site.html);
}));

// ---- static (production build) ----
const dist = path.join(__dirname, '..', 'web', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, '127.0.0.1', async () => {
  console.log(`Flowline API on http://127.0.0.1:${PORT} (region ${REGION})`);
  if (REQUESTED !== 'mock') {
    const c = await checkAws();
    if (c.ok) {
      active = aws;
      console.log(`Connected to AWS account ${c.identity.account} as ${c.identity.arn}`);
    } else {
      console.log(`AWS not connected (${c.error}). Running the simulator.`);
    }
  } else console.log('FLOWLINE_MODE=mock — running the simulator.');
});
