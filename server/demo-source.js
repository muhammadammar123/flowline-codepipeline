// Builds the source bundle that the Demo Lab pushes into the pipeline's S3 source bucket.
// CodeBuild runs buildspec.yml: tests first (test.js), then renders the release page (build.js).
import AdmZip from 'adm-zip';

const BUILDSPEC = `version: 0.2
phases:
  install:
    runtime-versions:
      nodejs: 20
  pre_build:
    commands:
      - echo "Running test suite"
      - node test.js
  build:
    commands:
      - echo "Rendering release page"
      - node build.js
artifacts:
  base-directory: dist
  files:
    - '**/*'
`;

const TEST_JS = `const release = require('./release.json');
const tests = [
  ['release.json has a version', () => typeof release.version === 'string' && release.version.length > 0],
  ['release.json has a message', () => typeof release.message === 'string'],
  ['accent color is a valid hex', () => /^#[0-9a-fA-F]{6}$/.test(release.accent)],
  ['checkout flow returns 200', () => !release.breakBuild],
];
let failed = 0;
for (const [name, fn] of tests) {
  let ok = false;
  try { ok = fn(); } catch (e) { ok = false; }
  console.log((ok ? '  \\u2713 ' : '  \\u2717 ') + name);
  if (!ok) failed++;
}
console.log('');
console.log(tests.length - failed + ' passing, ' + failed + ' failing');
if (failed) { console.error('Test suite failed'); process.exit(1); }
`;

const BUILD_JS = `const fs = require('fs');
const r = require('./release.json');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const build = process.env.CODEBUILD_BUILD_NUMBER || 'local';
const html = \`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>\${esc(r.appName)} \${esc(r.version)}</title>
<style>
:root{--a:\${r.accent}}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1020;color:#e2e8f0;font:16px/1.5 system-ui,sans-serif}
.card{width:min(560px,92vw);padding:40px;border-radius:20px;background:linear-gradient(160deg,#141b2e,#0f1526);border:1px solid #26314a;box-shadow:0 30px 80px -20px color-mix(in srgb,var(--a) 45%,transparent)}
.tag{display:inline-block;padding:4px 10px;border-radius:999px;background:color-mix(in srgb,var(--a) 18%,transparent);color:var(--a);font:600 12px/1.6 ui-monospace,monospace;letter-spacing:.04em}
h1{margin:16px 0 8px;font-size:34px;letter-spacing:-.02em}p{margin:0;color:#94a3b8}.meta{margin-top:28px;display:grid;grid-template-columns:auto 1fr;gap:6px 16px;font:13px/1.6 ui-monospace,monospace;color:#64748b}.meta b{color:#cbd5e1;font-weight:500}
.bar{height:4px;border-radius:4px;background:var(--a);margin-top:28px}
</style></head><body><main class="card"><span class="tag">LIVE · v\${esc(r.version)}</span>
<h1>\${esc(r.appName)}</h1><p>\${esc(r.message)}</p>
<div class="meta"><span>build</span><b>#\${esc(build)}</b><span>shipped by</span><b>\${esc(r.author)}</b><span>built at</span><b>\${new Date().toISOString()}</b><span>pipeline</span><b>AWS CodePipeline → CodeBuild → S3</b></div>
<div class="bar"></div></main></body></html>\`;
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', html);
fs.writeFileSync('dist/release.json', JSON.stringify({ ...r, build }, null, 2));
console.log('Wrote dist/index.html for v' + r.version);
`;

export function buildSourceZip(release) {
  const zip = new AdmZip();
  zip.addFile('buildspec.yml', Buffer.from(BUILDSPEC));
  zip.addFile('test.js', Buffer.from(TEST_JS));
  zip.addFile('build.js', Buffer.from(BUILD_JS));
  zip.addFile('release.json', Buffer.from(JSON.stringify(release, null, 2)));
  return zip.toBuffer();
}

export function normalizeRelease(input = {}) {
  const accent = /^#[0-9a-fA-F]{6}$/.test(input.accent || '') ? input.accent : '#22C55E';
  return {
    appName: String(input.appName || 'Flowline Demo Store').slice(0, 60),
    version: String(input.version || '1.0.0').slice(0, 20),
    message: String(input.message || 'Initial release').slice(0, 200),
    author: String(input.author || 'flowline').slice(0, 40),
    accent,
    breakBuild: Boolean(input.breakBuild),
  };
}
