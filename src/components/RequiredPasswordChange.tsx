import { useState } from 'react';
import { ArrowRight, LockKeyhole, LogOut } from 'lucide-react';
import { request, session } from '../lib/api';

export function RequiredPasswordChange({ onChanged }: { onChanged: () => Promise<void> }) {
  const [currentPassword,setCurrentPassword]=useState('');
  const [newPassword,setNewPassword]=useState('');
  const [confirmPassword,setConfirmPassword]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  async function submit(event:React.FormEvent){
    event.preventDefault();setError('');
    if(newPassword.length<8){setError('Use at least 8 characters.');return}
    if(newPassword!==confirmPassword){setError('The new passwords do not match.');return}
    setBusy(true);
    try{
      await request('/auth/change-password',{method:'POST',body:JSON.stringify({oldPassword:currentPassword,newPassword})});
      await onChanged();
    }catch(value){setError(value instanceof Error?value.message:'Could not change your password.')}
    finally{setBusy(false)}
  }

  return <main className="login-page">
    <section className="login-brand">
      <div className="brand-mark brand-mark-large"><span>F</span></div>
      <div><span className="eyebrow light">Account setup</span><h1>FUNDSHIP</h1></div>
      <p>Replace the temporary password issued by your administrator before entering the app.</p>
    </section>
    <section className="login-panel">
      <div className="login-copy"><span className="eyebrow">Required once</span><h2>Create your private password</h2><p>You will use this password on new devices.</p></div>
      <form className="login-form" onSubmit={submit}>
        <label><span>Initial password</span><div className="input-wrap"><LockKeyhole size={18}/><input type="password" autoComplete="current-password" value={currentPassword} onChange={event=>setCurrentPassword(event.target.value)}/></div></label>
        <label><span>New password</span><div className="input-wrap"><LockKeyhole size={18}/><input type="password" autoComplete="new-password" value={newPassword} onChange={event=>setNewPassword(event.target.value)}/></div></label>
        <label><span>Confirm new password</span><div className="input-wrap"><LockKeyhole size={18}/><input type="password" autoComplete="new-password" value={confirmPassword} onChange={event=>setConfirmPassword(event.target.value)}/></div></label>
        {error&&<div className="form-error">{error}</div>}
        <button className="primary-btn login-btn" disabled={busy}>{busy?'Saving…':<>Save and continue <ArrowRight size={18}/></>}</button>
      </form>
      <button className="biometric-login" onClick={()=>{session.clear();location.reload()}}><LogOut size={21}/><span><strong>Sign out</strong><small>Use a different account</small></span></button>
    </section>
  </main>
}
