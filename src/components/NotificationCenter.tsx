import { useEffect, useState } from 'react';
import { Bell, CalendarClock, Check, CreditCard, Link2, Trash2, UsersRound, X } from 'lucide-react';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import { mutate } from '../lib/api';
import { relativeTime } from '../lib/format';
import type { Bootstrap } from '../types';

export function NotificationCenter({data,onData,onClose,onNavigate,onGroups,notify}:{
  data:Bootstrap;onData:(data:Bootstrap)=>void;onClose:()=>void;onNavigate:(page:string)=>void;onGroups:()=>void;notify:(message:string)=>void;
}) {
  const [busy,setBusy]=useState('');
  useEffect(()=>{if(data.notifications.some(item=>!item.read)){void mutate('/notifications/read').then(onData).catch(()=>undefined)}},[]);

  function openItem(type:string,entityId:string) {
    if (type==='payment_request') onNavigate('home');
    else if (type==='group_invite') onGroups();
    else {
      const owner=data.groups.find(group=>group.polls.some(poll=>poll.id===entityId));
      if (owner) onNavigate(owner.id);
    }
    onClose();
  }

  async function clear(id:string) {
    setBusy(id);
    try { const next=await mutate(`/notifications/${id}`,undefined,'DELETE');onData(next); }
    catch(err){notify(err instanceof Error?err.message:'Could not clear notification.')} finally {setBusy('')}
  }

  async function respond(id:string,accept:boolean) {
    setBusy(id);
    try {const next=await mutate(`/connections/${encodeURIComponent(id)}/respond`,{accept});onData(next);notify(accept?'Connection accepted':'Connection declined');}
    catch(err){notify(err instanceof Error?err.message:'Could not respond.')} finally {setBusy('')}
  }

  const connectionByEntity=new Map(data.connectionRequests.filter(item=>!item.outgoing).map(item=>[item.id,item]));
  return <Modal title="Notifications" subtitle={`${data.notifications.length} item${data.notifications.length===1?'':'s'} in your inbox`} onClose={onClose} wide>
    <div className="notification-list">
      {data.notifications.map(item=>{const connection=connectionByEntity.get(item.entityId);const Icon=item.type==='payment_request'?CreditCard:item.type.startsWith('connection')?Link2:item.type==='group_invite'?UsersRound:item.type==='event_due'?CalendarClock:Bell;return <article className={`notification-item ${item.read?'':'unread'} ${item.persistentUntil&&!item.canClear?'persistent':''}`} key={item.id}>
        <button className="notification-body" onClick={()=>openItem(item.type,item.entityId)}><span className="notification-type"><Icon size={18}/></span><div><strong>{item.title}</strong><p>{item.body}</p><small>{relativeTime(item.createdAt)}{item.persistentUntil&&!item.canClear?' · stays until event':''}</small></div></button>
        {connection?<div className="notification-actions"><button disabled={busy===item.id} onClick={()=>respond(connection.id,false)}><X size={15}/></button><button className="accept" disabled={busy===item.id} onClick={()=>respond(connection.id,true)}><Check size={15}/> Accept</button></div>:item.canClear?<button className="notification-clear" disabled={busy===item.id} onClick={()=>clear(item.id)} aria-label="Clear notification"><Trash2 size={15}/></button>:null}
      </article>})}
      {data.notifications.length===0&&<div className="empty-state"><Bell size={31}/><strong>You’re all caught up</strong><p>Payment, poll, group, and connection updates will appear here.</p></div>}
    </div>
  </Modal>;
}
