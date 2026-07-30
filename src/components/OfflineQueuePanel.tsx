import { AlertTriangle, Check, CloudUpload, LoaderCircle, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { money, relativeTime } from '../lib/format';
import {
  listQueuedPayments,
  QUEUE_CHANGED_EVENT,
  retryQueuedPayment,
  type QueuedPayment,
} from '../lib/offlineQueue';

export function OfflineQueuePanel({ userId, online }: { userId: string; online: boolean }) {
  const [items, setItems] = useState<QueuedPayment[]>([]);
  useEffect(() => {
    let active = true;
    const load = () => void listQueuedPayments(userId).then((value) => {
      if (active) setItems(value);
    }).catch(() => undefined);
    load();
    window.addEventListener(QUEUE_CHANGED_EVENT, load);
    return () => {
      active = false;
      window.removeEventListener(QUEUE_CHANGED_EVENT, load);
    };
  }, [userId]);
  if (items.length === 0) return null;
  return <section className="offline-queue-panel">
    <header><span><CloudUpload size={18}/><strong>Payment outbox</strong></span><small>{online ? 'Syncs automatically' : 'Waiting for internet'}</small></header>
    <div>{items.map(item => <article key={item.id} className={`queue-${item.status}`}>
      <span className="queue-status-icon">
        {item.status === 'sending' ? <LoaderCircle/> : item.status === 'sent' ? <Check/> : item.status === 'failed' ? <AlertTriangle/> : <CloudUpload/>}
      </span>
      <span><strong>{item.label}</strong><small>{item.purpose} · {money(item.amount)} · {relativeTime(item.createdAt)}</small>{item.lastError&&<em>{item.lastError}</em>}</span>
      <b>{item.status[0].toUpperCase() + item.status.slice(1)}</b>
      {item.status === 'failed'&&<button onClick={()=>void retryQueuedPayment(item.id)} title="Retry this request"><RefreshCw size={14}/></button>}
    </article>)}</div>
  </section>;
}
