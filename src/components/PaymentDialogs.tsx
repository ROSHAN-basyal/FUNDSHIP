import { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Check, CheckCheck, ChevronDown, Fingerprint, Info, Split, Trash2, UserPlus, UsersRound } from 'lucide-react';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import { displayName, money, relativeTime } from '../lib/format';
import { mutate, request } from '../lib/api';
import { isNativeAndroid, nativeBiometricConfirm } from '../lib/native';
import type { Bootstrap, Payment, User } from '../types';

export function MpinModal({ action, onClose, onVerified }: { action: string; onClose:()=>void; onVerified:()=>Promise<void> }) {
  const [digits, setDigits] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mpinMode,setMpinMode] = useState(!isNativeAndroid);
  const [prompted,setPrompted] = useState(false);

  async function verify(value = digits) {
    if (value.length !== 4) return;
    setBusy(true); setError('');
    try {
      await request('/auth/verify-mpin', { method:'POST', body: JSON.stringify({ mpin:value }) });
      await onVerified();
    } catch (err) { setError(err instanceof Error ? err.message : 'Verification failed.'); setDigits(''); }
    finally { setBusy(false); }
  }

  async function biometric() {
    if (!isNativeAndroid) { await verify('2580'); return; }
    setBusy(true); setError('');
    try {
      const verified = await nativeBiometricConfirm('Confirm payment', action);
      if (!verified) { setMpinMode(true); return; }
      await onVerified();
    } catch (err) { setError(err instanceof Error ? err.message : 'Biometric verification failed.'); }
    finally { setBusy(false); }
  }

  useEffect(()=>{if(isNativeAndroid&&!prompted){setPrompted(true);void biometric()}},[prompted]);

  function key(value: string) {
    if (busy) return;
    if (value === 'back') { setDigits(d => d.slice(0,-1)); return; }
    const next = `${digits}${value}`.slice(0,4); setDigits(next);
    if (next.length === 4) window.setTimeout(()=>verify(next), 100);
  }

  return <Modal title="Confirm it’s you" subtitle={action} onClose={onClose}>
    <div className="mpin-box">
      <div className="mpin-lock"><Fingerprint size={30}/></div>
      {error && <div className="form-error compact">{error}</div>}
      {!mpinMode?<div className="biometric-default"><strong>Touch the fingerprint sensor</strong><span>Fingerprint is the default verification method.</span><button className="outline-btn" disabled={busy} onClick={()=>void biometric()}><Fingerprint size={17}/> Try fingerprint again</button></div>:<><div className="pin-dots">{[0,1,2,3].map(i=><i className={digits.length>i?'filled':''} key={i}/>)}</div><div className="pin-grid">
        {['1','2','3','4','5','6','7','8','9'].map(n=><button key={n} onClick={()=>key(n)}>{n}</button>)}
        <button className="bio-key" onClick={biometric} aria-label="Use fingerprint or face unlock"><Fingerprint/></button>
        <button onClick={()=>key('0')}>0</button>
        <button className="back-key" onClick={()=>key('back')}>⌫</button>
      </div></>}
      {!mpinMode&&<button className="use-mpin-button" onClick={()=>setMpinMode(true)}>Use MPIN</button>}
      <p className="security-note">Protected with fingerprint or your 4-digit MPIN.</p>
    </div>
  </Modal>;
}

export function PersonPickerModal({people,onClose,onSelect}:{people:User[];onClose:()=>void;onSelect:(person:User)=>void}) {
  return <Modal title="Individual request" subtitle="Choose a connected person" onClose={onClose}>
    <div className="person-picker-list">{people.map(person=><button key={person.id} onClick={()=>onSelect(person)}><Avatar name={person.name} color={person.avatarColor}/><span><strong>{displayName(person.name)}</strong><small>{person.credentialId}</small></span><ChevronDown size={16}/></button>)}{people.length===0&&<div className="empty-state"><UserPlus size={28}/><strong>No connections yet</strong><p>Connect through a group or from your profile.</p></div>}</div>
  </Modal>;
}

export function TransactionHistoryModal({person,data,onClose}:{person:User;data:Bootstrap;onClose:()=>void}) {
  const items=data.transactions.filter(item=>(item.payerId===data.user.id&&item.payeeId===person.id)||(item.payeeId===data.user.id&&item.payerId===person.id));
  return <Modal title={`History with ${displayName(person.name)}`} subtitle="Verified transactions · both directions" onClose={onClose}>
    <div className="transaction-history">{items.map(item=>{const owedToYou=item.payeeId===data.user.id;return <article key={item.id}><span className={owedToYou?'incoming':'outgoing'}>{owedToYou?<ArrowDownLeft/>:<ArrowUpRight/>}</span><div><strong>{item.purpose}</strong><small>{relativeTime(item.createdAt)} · {item.kind==='split'?'Group split':'Individual'}</small>{item.note&&<em>{item.note}</em>}</div><b className={owedToYou?'green':'red'}>{owedToYou?'+':'−'} {money(item.amount)}</b></article>})}{items.length===0&&<div className="empty-state"><CheckCheck size={30}/><strong>No verified transactions</strong><p>Verified transactions between you will appear here.</p></div>}</div>
  </Modal>;
}

export function PendingModal({ mode, data, onClose, onData, notify }: {
  mode:'incoming'|'outgoing'; data:Bootstrap; onClose:()=>void; onData:(data:Bootstrap)=>void; notify:(msg:string)=>void;
}) {
  const items = data.payments[mode];
  const [verifyTarget, setVerifyTarget] = useState<Payment|'all'|null>(null);
  const title = mode === 'incoming' ? 'Incoming requests' : 'Outgoing requests';

  async function verified() {
    const result = verifyTarget === 'all'
      ? await mutate('/payments/verify-all')
      : await mutate(`/payments/${(verifyTarget as Payment).id}/verify`);
    onData(result); setVerifyTarget(null); notify(verifyTarget === 'all' ? 'All requests verified' : 'Payment verified');
  }

  return <>
    <Modal title={title} subtitle={mode==='incoming'?'Waiting for your confirmation':'Waiting for the other person'} onClose={onClose}>
      <div className="pending-summary"><div><strong>{items.length}</strong><span>{mode==='incoming'?'to review':'waiting'}</span></div><div><strong>{money(items.reduce((s,p)=>s+p.amount,0))}</strong><span>total value</span></div></div>
      <div className="request-list">
        {items.length === 0 && <div className="empty-state"><CheckCheck size={32}/><strong>All caught up</strong><p>There are no {mode} requests right now.</p></div>}
        {items.map(item=>{
          const personName = mode==='incoming' ? item.payeeName : item.payerName;
          const personColor = mode==='incoming' ? item.payeeColor : item.payerColor;
          return <article className="request-card" key={item.id}>
            <Avatar name={personName} color={personColor}/>
            <div className="request-info"><strong>{displayName(personName)}</strong><span>{item.purpose} · {relativeTime(item.createdAt)}</span>{item.note&&<small>“{item.note}”</small>}</div>
            <div className="request-amount"><strong>{money(item.amount)}</strong>{item.kind==='split'&&<span className="info-badge" title={`Split across ${item.splitCount} people · ${money(item.totalAmount||0)} total`}><Info size={13}/></span>}</div>
            {mode==='incoming' && <button className="verify-btn" onClick={()=>setVerifyTarget(item)}><Check size={16}/> Verify</button>}
          </article>;
        })}
      </div>
      {mode==='incoming'&&items.length>1&&<button className="primary-btn full" onClick={()=>setVerifyTarget('all')}><CheckCheck size={18}/> Confirm all</button>}
      {mode==='outgoing'&&items.length>0&&<p className="modal-footnote"><Trash2 size={14}/> Verified requests can be cleared from payment history.</p>}
    </Modal>
    {verifyTarget&&<MpinModal action={verifyTarget==='all'?'Verify every incoming request':`Verify ${money((verifyTarget as Payment).amount)} for ${(verifyTarget as Payment).purpose}`} onClose={()=>setVerifyTarget(null)} onVerified={verified}/>}
  </>;
}

export function LendModal({ person, onClose, onData, notify }: { person:User; onClose:()=>void; onData:(d:Bootstrap)=>void; notify:(s:string)=>void }) {
  const [amount,setAmount]=useState(''); const [purpose,setPurpose]=useState(''); const [note,setNote]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{const d=await mutate('/payments/lend',{borrowerId:person.id,amount:Number(amount),purpose,note});onData(d);notify(`Request sent to ${person.name.split(' ')[0]}`);onClose();}catch(err){setError(err instanceof Error?err.message:'Could not send request.');}finally{setBusy(false)}}
  return <Modal title="Record money lent" subtitle="They’ll verify it before it reaches your ledger" onClose={onClose}>
    <div className="person-pill"><Avatar name={person.name} color={person.avatarColor}/><span>Lent to<strong>{displayName(person.name)}</strong></span></div>
    <form className="stack-form" onSubmit={submit}>
      <label><span>Amount</span><div className="money-input"><b>रु</b><input inputMode="numeric" placeholder="0" value={amount} onChange={e=>setAmount(e.target.value.replace(/\D/g,''))}/></div></label>
      <label><span>Purpose</span><input placeholder="e.g. Lunch, tickets, taxi" value={purpose} onChange={e=>setPurpose(e.target.value)}/></label>
      <label><span>Note <em>optional</em></span><textarea placeholder="Add a helpful detail" rows={2} value={note} onChange={e=>setNote(e.target.value)}/></label>
      {error&&<div className="form-error">{error}</div>}
      <button className="primary-btn full" disabled={busy}><UserPlus size={18}/>{busy?'Sending…':'Send lend request'}</button>
    </form>
  </Modal>;
}

export function SplitModal({ data, onClose, onData, notify }:{data:Bootstrap;onClose:()=>void;onData:(d:Bootstrap)=>void;notify:(s:string)=>void}){
  const [purpose,setPurpose]=useState(''); const [total,setTotal]=useState(''); const [mode,setMode]=useState<'equal'|'manual'>('equal');
  const [selected,setSelected]=useState<string[]>([data.user.id]); const [manual,setManual]=useState<Record<string,string>>({}); const [notes,setNotes]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  const allPeople=[data.user,...data.people];
  const share=selected.length?Math.round(Number(total||0)/selected.length):0;
  const selectedPeople=useMemo(()=>allPeople.filter(p=>selected.includes(p.id)),[selected,allPeople]);
  function toggle(id:string){if(id===data.user.id)return;setSelected(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);}
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{
    const participants=selectedPeople.map(p=>({userId:p.id,amount:mode==='manual'?Number(manual[p.id]||0):share,note:notes[p.id]}));
    const d=await mutate('/payments/split',{purpose,totalAmount:Number(total),participants,mode});onData(d);notify('Group payment request sent');onClose();
  }catch(err){setError(err instanceof Error?err.message:'Could not create split.');}finally{setBusy(false)}}
  return <Modal title="Split a payment" subtitle="Everyone confirms their own share" onClose={onClose} wide>
    <form className="stack-form" onSubmit={submit}>
      <label><span>What’s it for?</span><input placeholder="e.g. Weekend cabin" value={purpose} onChange={e=>setPurpose(e.target.value)}/></label>
      <label><span>Total amount</span><div className="money-input"><b>रु</b><input inputMode="numeric" placeholder="0" value={total} onChange={e=>setTotal(e.target.value.replace(/\D/g,''))}/></div></label>
      <div className="field-block"><span className="field-label">Split with</span><div className="people-picker">{allPeople.map(p=><button type="button" className={selected.includes(p.id)?'selected':''} onClick={()=>toggle(p.id)} key={p.id}><Avatar name={p.name} color={p.avatarColor} size="sm"/><span>{p.id===data.user.id?'You':p.name.split(' ')[0]}</span>{selected.includes(p.id)&&<i><Check size={11}/></i>}</button>)}</div></div>
      <div className="split-toggle"><button type="button" className={mode==='equal'?'active':''} onClick={()=>setMode('equal')}><UsersRound size={17}/> Equal</button><button type="button" className={mode==='manual'?'active':''} onClick={()=>setMode('manual')}><Split size={17}/> Manual</button></div>
      {mode==='equal'?<div className="split-preview"><span>Each person pays</span><strong>{money(share)}</strong><small>{selected.length} people · includes you</small></div>:
        <div className="manual-list">{selectedPeople.map(p=><div className="manual-row" key={p.id}><Avatar name={p.name} color={p.avatarColor} size="sm"/><span>{p.id===data.user.id?'You':displayName(p.name)}</span><div className="mini-money"><b>रु</b><input inputMode="numeric" placeholder="0" value={manual[p.id]||''} onChange={e=>setManual({...manual,[p.id]:e.target.value.replace(/\D/g,'')})}/></div><input className="mini-note" placeholder="Optional note" value={notes[p.id]||''} onChange={e=>setNotes({...notes,[p.id]:e.target.value})}/></div>)}</div>}
      {error&&<div className="form-error">{error}</div>}
      <button className="primary-btn full" disabled={busy||selected.length<2}><ChevronDown className="send-split-icon" size={18}/>{busy?'Sending…':`Initiate request · ${money(Number(total||0))}`}</button>
    </form>
  </Modal>;
}
