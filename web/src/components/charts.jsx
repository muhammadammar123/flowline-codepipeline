import { fmtDuration } from '../lib.js';

/** Stacked daily bars: succeeded / failed / other. Text tooltips + sr summary, never colour alone. */
export function DailyBars({ daily }) {
  const max = Math.max(1, ...daily.map((d) => d.succeeded + d.failed + d.other));
  const total = daily.reduce((a, d) => a + d.succeeded + d.failed + d.other, 0);
  return (
    <div>
      <div className="bars" role="img" aria-label={`${total} executions over ${daily.length} days`}>
        {daily.map((d) => {
          const label = new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          return (
            <div className="bar-col" key={d.date} tabIndex={0} aria-label={`${label}: ${d.succeeded} succeeded, ${d.failed} failed, ${d.other} other`}>
              <div className="tip">
                <b>{label}</b> · <span className="c-Succeeded">{d.succeeded} ok</span> · <span className="c-Failed">{d.failed} failed</span>
                {d.other ? <> · {d.other} other</> : null}
              </div>
              {d.other > 0 && <div className="b oth" style={{ height: `${(d.other / max) * 100}%` }} />}
              {d.failed > 0 && <div className="b bad" style={{ height: `${(d.failed / max) * 100}%` }} />}
              {d.succeeded > 0 && <div className="b ok" style={{ height: `${(d.succeeded / max) * 100}%` }} />}
            </div>
          );
        })}
      </div>
      <div className="bar-x" aria-hidden="true">
        {daily.map((d, i) => (
          <span key={d.date}>{i % 2 === daily.length % 2 ? '' : new Date(d.date + 'T00:00:00').getDate()}</span>
        ))}
      </div>
    </div>
  );
}

/** Success-rate ring. */
export function Ring({ value, size = 92, stroke = 9, label }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = value ?? 0;
  const color = value == null ? 'var(--slate)' : v >= 0.9 ? 'var(--green)' : v >= 0.75 ? 'var(--amber)' : 'var(--red)';
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? `Success rate ${Math.round(v * 100)}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${c * v} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray .6s cubic-bezier(.2,.8,.2,1)' }}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fill="var(--fg)" style={{ font: '600 19px var(--mono)' }}>
        {value == null ? '—' : `${Math.round(v * 100)}%`}
      </text>
    </svg>
  );
}

/** Duration mini-bars for recent runs, coloured + patterned by outcome. */
export function DurationSpark({ durations, height = 34 }) {
  const items = durations.filter((d) => d.ms != null);
  if (!items.length) return <div className="tiny faint">No finished runs yet</div>;
  const max = Math.max(...items.map((d) => d.ms));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height }} role="img" aria-label={`Durations of last ${items.length} runs`}>
      {items.map((d) => (
        <div
          key={d.id}
          title={`${d.status} · ${fmtDuration(d.ms)}`}
          style={{
            flex: 1,
            maxWidth: 10,
            height: `${Math.max(8, (d.ms / max) * 100)}%`,
            borderRadius: 2,
            background: d.status === 'Succeeded' ? 'var(--green)' : d.status === 'Failed' ? 'repeating-linear-gradient(45deg,var(--red) 0 2px,#b91c1c 2px 4px)' : 'var(--slate)',
            opacity: d.status === 'Succeeded' ? 0.85 : 1,
          }}
        />
      ))}
    </div>
  );
}
