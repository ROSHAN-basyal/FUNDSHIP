import { useEffect, useState } from 'react';
import { Bell, Check, Link2, Trash2, UsersRound, X } from 'lucide-react';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import { mutate } from '../lib/api';
import { relativeTime } from '../lib/format';
import type { Bootstrap } from '../types';

export function NotificationCenter({data,onData,onClose,onNavigate,onGroups,notify}:{
  data:Bootstrap;onData:(data:Bootstrap)=>void;onClose:()=>void;onNavigate:(page:string)=>void;onGroups:()=>void;notify:(message:string)=>void;
}) {
  const [busy,setBusy]=useState('');
  const items=data.notifications.filter(item=>item.type!=='payment_request'&&!item.type.startsWith('poll_')&&item.type!=='event_due');
  useEffect(()=>{if(items.some(item=>!item.read)){void mutate('/notifications/read').then(onData).catch(()=>undefined)}},[]);

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

  async function respondConnection(notificationId:string,id:string,accept:boolean) {
    setBusy(notificationId);
    try {const next=await mutate(`/connections/${encodeURIComponent(id)}/respond`,{accept});onData(next);notify(accept?'Connection accepted':'Connection declined');}
    catch(err){notify(err instanceof Error?err.message:'Could not respond.')} finally {setBusy('')}
  }

  async function respondGroupInvite(notificationId:string,id:string,accept:boolean) {
    setBusy(notificationId);
    try {const next=await mutate(`/group-invites/${encodeURIComponent(id)}/respond`,{accept});onData(next);notify(accept?'Group invitation accepted':'Group invitation declined');}
    catch(err){notify(err instanceof Error?err.message:'Could not respond.')} finally {setBusy('')}
  }

  const connectionByEntity=new Map(data.connectionRequests.filter(item=>!item.outgoing).map(item=>[item.id,item]));
  const groupInviteByEntity=new Map(data.groupInvites.map(item=>[item.id,item]));
  return <Modal title="Notifications" subtitle={`${items.length} item${items.length===1?'':'s'} in your inbox`} onClose={onClose} wide>
    <div className="notification-list">
      {items.map(item=>{const connection=connectionByEntity.get(item.entityId);const groupInvite=groupInviteByEntity.get(item.entityId);const actionable=Boolean(connection||groupInvite);const Icon=item.type.startsWith('connection')?Link2:item.type==='group_invite'?UsersRound:Bell;return <article className={`notification-item ${item.read?'':'unread'} ${item.persistentUntil&&!item.canClear?'persistent':''}`} key={item.id}>
        <button className="notification-body" onClick={()=>openItem(item.type,item.entityId)}><span className="notification-type"><Icon size={18}/></span><div><strong>{item.title}</strong><p>{item.body}</p><small>{relativeTime(item.createdAt)}{item.persistentUntil&&!item.canClear?' · stays until event':''}</small></div></button>
        {actionable?<div className="notification-actions"><button disabled={busy===item.id} onClick={()=>connection?respondConnection(item.id,connection.id,false):respondGroupInvite(item.id,groupInvite!.id,false)} aria-label="Decline request"><X size={14}/><span>Decline</span></button><button className="accept" disabled={busy===item.id} onClick={()=>connection?respondConnection(item.id,connection.id,true):respondGroupInvite(item.id,groupInvite!.id,true)} aria-label="Accept request"><Check size={14}/><span>Accept</span></button></div>:item.canClear?<button className="notification-clear" disabled={busy===item.id} onClick={()=>clear(item.id)} aria-label="Clear notification"><Trash2 size={15}/></button>:null}
      </article>})}
      {items.length===0&&<div className="empty-state"><Bell size={31}/><strong>You’re all caught up</strong><p>Group and connection updates will appear here.</p></div>}
    </div>
  </Modal>;
}
