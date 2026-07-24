import { useState } from 'react';
import { Bell, Camera, Check, KeyRound, Link2, LockKeyhole, Shield, Smartphone, UserPlus, X } from 'lucide-react';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import { mutate, request } from '../lib/api';
import { displayName } from '../lib/format';
import type { Bootstrap } from '../types';

function readImage(file:File,onDone:(data:string)=>void){
  const reader=new FileReader();
  reader.onload=()=>{
    const image=new Image();
    image.onload=()=>{
      const scale=Math.min(1,256/Math.max(image.width,image.height));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(image.width*scale));
      canvas.height=Math.max(1,Math.round(image.height*scale));
      canvas.getContext('2d')?.drawImage(image,0,0,canvas.width,canvas.height);
      onDone(canvas.toDataURL('image/jpeg',.82));
    };
    image.src=String(reader.result);
  };
  reader.readAsDataURL(file);
}

export function ProfileModal({data,onClose,onData,notify}:{data:Bootstrap;onClose:()=>void;onData:(d:Bootstrap)=>void;notify:(s:string)=>void}){
  const [tab,setTab]=useState<'profile'|'connections'|'security'>('profile');
  const [phone,setPhone]=useState(data.user.phone||'');const[photo,setPhoto]=useState(data.user.profilePhoto||'');
  const [oldPassword,setOldPassword]=useState('');const[newPassword,setNewPassword]=useState('');
  const [password,setPassword]=useState('');const[oldMpin,setOldMpin]=useState('');const[newMpin,setNewMpin]=useState('');
  const [busy,setBusy]=useState(false);const[error,setError]=useState('');
  const [connectionId,setConnectionId]=useState('');
  async function saveProfile(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{const d=await mutate('/profile',{phone,profilePhoto:photo});onData(d);notify('Profile updated');onClose();}catch(err){setError(err instanceof Error?err.message:'Could not update profile.')}finally{setBusy(false)}}
  async function changePassword(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{await request('/auth/change-password',{method:'POST',body:JSON.stringify({oldPassword,newPassword})});notify('Password changed');setOldPassword('');setNewPassword('');}catch(err){setError(err instanceof Error?err.message:'Could not change password.')}finally{setBusy(false)}}
  async function changeMpin(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{await request('/auth/change-mpin',{method:'POST',body:JSON.stringify({password,oldMpin,newMpin})});notify('MPIN changed');setPassword('');setOldMpin('');setNewMpin('');}catch(err){setError(err instanceof Error?err.message:'Could not change MPIN.')}finally{setBusy(false)}}
  async function sendConnection(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{const d=await mutate('/connections/request',{credentialId:connectionId});onData(d);setConnectionId('');notify('Connection request sent');}catch(err){setError(err instanceof Error?err.message:'Could not send request.')}finally{setBusy(false)}}
  async function respondConnection(id:string,accept:boolean){setBusy(true);setError('');try{const d=await mutate(`/connections/${encodeURIComponent(id)}/respond`,{accept});onData(d);notify(accept?'Connection accepted':'Connection declined');}catch(err){setError(err instanceof Error?err.message:'Could not respond.')}finally{setBusy(false)}}
  return <Modal title="Your profile" subtitle={`${data.user.credentialId} · system-issued ID`} onClose={onClose} wide>
    <div className="profile-tabs"><button className={tab==='profile'?'active':''} onClick={()=>{setTab('profile');setError('')}}><Smartphone size={17}/> Profile</button><button className={tab==='connections'?'active':''} onClick={()=>{setTab('connections');setError('')}}><Link2 size={17}/> Connections</button><button className={tab==='security'?'active':''} onClick={()=>{setTab('security');setError('')}}><Shield size={17}/> Security</button></div>
    {tab==='profile'?<form className="stack-form" onSubmit={saveProfile}>
      <div className="profile-photo-row"><div className="photo-preview">{photo?<img src={photo} alt="Profile preview"/>:<Avatar name={data.user.name} color={data.user.avatarColor} size="xl"/>}<label><Camera size={15}/><input type="file" accept="image/*" onChange={e=>e.target.files?.[0]&&readImage(e.target.files[0],setPhoto)}/></label></div><div><strong>{data.user.name}</strong><span>{data.user.credentialId}</span></div></div>
      <label><span>Payment-linked phone number</span><input inputMode="tel" maxLength={10} value={phone} onChange={e=>setPhone(e.target.value.replace(/\D/g,''))} placeholder="98XXXXXXXX"/></label>
      {error&&<div className="form-error">{error}</div>}<button className="primary-btn full" disabled={busy}><Check size={18}/>{busy?'Saving…':'Save profile'}</button>
    </form>:tab==='connections'?<div className="connection-panel">
      <form className="connection-form" onSubmit={sendConnection}><label><span>Connect by user ID</span><div><input value={connectionId} onChange={e=>setConnectionId(e.target.value.toUpperCase())} placeholder="e.g. NP-002"/><button disabled={busy||!connectionId.trim()}><UserPlus size={17}/> Send</button></div></label></form>
      {data.connectionRequests.filter(item=>!item.outgoing).length>0&&<section><span className="field-label"><Bell size={14}/> Requests for you</span>{data.connectionRequests.filter(item=>!item.outgoing).map(item=><article className="connection-request" key={item.id}><Avatar name={item.requester.name} color={item.requester.avatarColor}/><div><strong>{displayName(item.requester.name)}</strong><small>{item.requester.credentialId}</small></div><button onClick={()=>respondConnection(item.id,false)}><X size={15}/></button><button className="accept" onClick={()=>respondConnection(item.id,true)}><Check size={15}/></button></article>)}</section>}
      <section><span className="field-label">Connected people · {data.connections.length}</span><div className="connected-list">{data.connections.map(person=><article key={person.id}><Avatar name={person.name} color={person.avatarColor}/><div><strong>{displayName(person.name)}</strong><small>{person.credentialId}</small></div><span><Link2 size={13}/> Connected</span></article>)}</div></section>
      {data.connectionRequests.filter(item=>item.outgoing).length>0&&<p className="connection-pending">{data.connectionRequests.filter(item=>item.outgoing).length} sent request(s) awaiting approval.</p>}
      {error&&<div className="form-error">{error}</div>}
    </div>:<div className="security-stack">
      <form className="security-card" onSubmit={changePassword}><header><span><KeyRound size={19}/></span><div><strong>Change password</strong><small>Your current password is required.</small></div></header><label><span>Current password</span><input type="password" value={oldPassword} onChange={e=>setOldPassword(e.target.value)}/></label><label><span>New password</span><input type="password" minLength={8} value={newPassword} onChange={e=>setNewPassword(e.target.value)}/></label><button className="outline-btn" disabled={busy}>Update password</button></form>
      <form className="security-card" onSubmit={changeMpin}><header><span><LockKeyhole size={19}/></span><div><strong>Change MPIN</strong><small>Requires both password and old MPIN.</small></div></header><label><span>Account password</span><input type="password" value={password} onChange={e=>setPassword(e.target.value)}/></label><div className="form-two"><label><span>Old MPIN</span><input type="password" inputMode="numeric" maxLength={4} value={oldMpin} onChange={e=>setOldMpin(e.target.value.replace(/\D/g,''))}/></label><label><span>New MPIN</span><input type="password" inputMode="numeric" maxLength={4} value={newMpin} onChange={e=>setNewMpin(e.target.value.replace(/\D/g,''))}/></label></div><button className="outline-btn" disabled={busy}>Update MPIN</button></form>
      {error&&<div className="form-error">{error}</div>}
    </div>}
  </Modal>;
}
