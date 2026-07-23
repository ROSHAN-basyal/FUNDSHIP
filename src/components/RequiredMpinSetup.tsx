import { useState } from 'react';
import { ArrowRight, KeyRound, LogOut } from 'lucide-react';
import { request, session } from '../lib/api';

export function RequiredMpinSetup({ onChanged }: { onChanged: () => Promise<void> }) {
  const [mpin,setMpin]=useState('');
  const [confirm,setConfirm]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  async function submit(event:React.FormEvent){
    event.preventDefault();setError('');
    if(!/^\d{4}$/.test(mpin)){setError('Choose exactly 4 digits.');return}
    if(mpin!==confirm){setError('The MPINs do not match.');return}
    setBusy(true);
    try{await request('/auth/set-mpin',{method:'POST',body:JSON.stringify({newMpin:mpin})});await onChanged()}
    catch(value){setError(value instanceof Error?value.message:'Could not create your MPIN.')}
    finally{setBusy(false)}
  }

  return <main className="login-page">
    <section className="login-brand">
      <div className="brand-mark brand-mark-large"><span>F</span></div>
      <div><span className="eyebrow light">Final setup</span><h1>FUNDSHIP</h1></div>
      <p>Your MPIN protects payment verification when fingerprint is unavailable.</p>
    </section>
    <section className="login-panel">
      <div className="login-copy"><span className="eyebrow">Required once</span><h2>Create a 4-digit MPIN</h2><p>Keep it private. You will need your password and old MPIN to change it later.</p></div>
      <form className="login-form" onSubmit={submit}>
        <label><span>New MPIN</span><div className="input-wrap"><KeyRound size={18}/><input inputMode="numeric" pattern="[0-9]{4}" maxLength={4} type="password" value={mpin} onChange={event=>setMpin(event.target.value.replace(/\D/g,''))}/></div></label>
        <label><span>Confirm MPIN</span><div className="input-wrap"><KeyRound size={18}/><input inputMode="numeric" pattern="[0-9]{4}" maxLength={4} type="password" value={confirm} onChange={event=>setConfirm(event.target.value.replace(/\D/g,''))}/></div></label>
        {error&&<div className="form-error">{error}</div>}
        <button className="primary-btn login-btn" disabled={busy}>{busy?'Saving…':<>Finish setup <ArrowRight size={18}/></>}</button>
      </form>
      <button className="biometric-login" onClick={()=>{session.clear();location.reload()}}><LogOut size={21}/><span><strong>Sign out</strong><small>Finish setup later</small></span></button>
    </section>
  </main>
}
