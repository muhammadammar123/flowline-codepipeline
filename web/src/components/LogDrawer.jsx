import { useEffect, useRef } from 'react';
import { ExternalLink, Copy } from 'lucide-react';
import { Drawer, Skeleton, useToast } from './ui.jsx';
import { usePoll, enc } from '../lib.js';

/** Streams CodeBuild logs (BatchGetBuilds → CloudWatch Logs GetLogEvents). */
export default function LogDrawer({ buildId, title, onClose }) {
  const { data, error, loading } = usePoll(`/builds/${enc(buildId)}/logs`, 3000);
  const toast = useToast();
  const end = useRef(null);
  const follow = useRef(true);
  const box = useRef(null);

  useEffect(() => {
    if (follow.current) end.current?.scrollIntoView({ block: 'end' });
  }, [data?.lines?.length]);

  const onScroll = () => {
    const el = box.current;
    if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText((data?.lines ?? []).map((l) => l.text).join('\n'));
      toast('ok', 'Log copied to clipboard');
    } catch {
      toast('err', 'Could not copy log');
    }
  };

  const cls = (t) => (/✓|SUCCEEDED|passing, 0 failing/.test(t) ? 'ok' : /✗|FAILED|error|did not exit|failing/i.test(t) ? 'bad' : /^\[Container\].*Phase is/.test(t) ? 'hd' : '');

  return (
    <Drawer
      title={title}
      subtitle={<span className="mono">{buildId}</span>}
      onClose={onClose}
      actions={
        <>
          <button className="btn sm" onClick={copy} disabled={!data?.lines?.length}><Copy size={14} /> Copy</button>
          {data?.url && <a className="btn sm" href={data.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> CloudWatch</a>}
        </>
      }
    >
      {data?.phases?.length > 0 && (
        <div className="phases" aria-label="Build phases">
          {data.phases.map((p) => <span key={p.name} className={`phase ${p.status ?? ''}`}>{p.name}</span>)}
          {data.buildStatus && <span className="chip" style={{ marginLeft: 'auto' }}>{data.buildStatus}</span>}
        </div>
      )}
      <pre className="terminal" ref={box} onScroll={onScroll} aria-live="polite">
        {loading && !data ? (
          <div className="stack" style={{ gap: 8 }}>{[...Array(8)].map((_, i) => <Skeleton key={i} h={12} w={`${40 + ((i * 37) % 55)}%`} />)}</div>
        ) : error ? (
          <span className="bad">{error}</span>
        ) : !data?.lines?.length ? (
          <span className="faint">{data?.note ?? 'Waiting for log output…'}</span>
        ) : (
          data.lines.map((l, i) => (
            <div className="ln" key={i}>
              <span className="n">{i + 1}</span>
              <span className={cls(l.text)}>{l.text}</span>
            </div>
          ))
        )}
        <div ref={end} />
      </pre>
    </Drawer>
  );
}
