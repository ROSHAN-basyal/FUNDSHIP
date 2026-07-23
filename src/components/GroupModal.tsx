import { useState } from 'react';
import { Check, Plus, UserPlus, UsersRound, X } from 'lucide-react';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import { displayName, relativeTime } from '../lib/format';
import { mutate } from '../lib/api';
import type { Bootstrap } from '../types';

const emojis=['👥','⛰️','🥟','⚽','🎬','🚗','🎉','🏡'];

export function GroupModal({data,onClose,onData,notify}:{data:Bootstrap;onClose:()=>void;onData:(d:Bootstrap)=>void;notify:(s:string)=>void}){
  const [name,setName]=useState('');const[emoji,setEmoji]=useState('👥');const[selected,setSelected]=useState<string[]>([]);const[busy,setBusy]=useState(false);const[error,setError]=useState('');
  async function respond(id:string,accept:boolean){setBusy(true);try{const d=await mutate(`/group-invites/${id}/respond`,{accept});onData(d);notify(accept?'Welcome to the group':'Invitation declined');}catch(err){setError(err instanceof Error?err.message:'Could not respond.')}finally{setBusy(false)}}
  async function create(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{const d=await mutate('/groups',{name,emoji,inviteeIds:selected});onData(d);notify('Group created · invitations sent');onClose();}catch(err){setError(err instanceof Error?err.message:'Could not create group.')}finally{setBusy(false)}}
  return <Modal title="Groups" subtitle="Create a circle or respond to an invitation" onClose={onClose} wide>
    {data.groupInvites.length>0&&<section className="invite-section"><span className="field-label">Invitations for you</span>{data.groupInvites.map(invite=><article className="invite-card" key={invite.id}><span className="invite-emoji" style={{background:invite.accent}}>{invite.emoji}</span><div><strong>{invite.groupName}</strong><span>{displayName(invite.inviterName)} invited you · {relativeTime(invite.createdAt)}</span></div><button disabled={busy} onClick={()=>respond(invite.id,false)}><X size={16}/></button><button disabled={busy} className="accept" onClick={()=>respond(invite.id,true)}><Check size={16}/></button></article>)}</section>}
    <form className="stack-form create-group-form" onSubmit={create}>
      <div className="form-rule"><span>Create a new group</span></div>
      <label><span>Group name</span><input placeholder="e.g. College friends" value={name} onChange={e=>setName(e.target.value)}/></label>
      <div className="field-block"><span className="field-label">Pick an icon</span><div className="emoji-picker">{emojis.map(item=><button type="button" className={emoji===item?'selected':''} key={item} onClick={()=>setEmoji(item)}>{item}</button>)}</div></div>
      <div className="field-block"><span className="field-label">Invite people <em>optional</em></span><div className="invite-people">{data.people.map(person=><button type="button" className={selected.includes(person.id)?'selected':''} onClick={()=>setSelected(v=>v.includes(person.id)?v.filter(x=>x!==person.id):[...v,person.id])} key={person.id}><Avatar name={person.name} color={person.avatarColor} size="sm"/><span>{displayName(person.name)}</span>{selected.includes(person.id)&&<Check size={14}/>}</button>)}</div><p className="helper-copy"><UserPlus size={14}/> They join only after accepting your invite.</p></div>
      {error&&<div className="form-error">{error}</div>}<button className="primary-btn full" disabled={busy}><UsersRound size={18}/>{busy?'Creating…':<>Create group {selected.length>0&&`· invite ${selected.length}`}</>}</button>
    </form>
  </Modal>;
}
