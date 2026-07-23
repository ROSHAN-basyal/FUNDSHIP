import { useEffect, useState } from 'react';
import { ArrowRight, Eye, EyeOff, Fingerprint, LockKeyhole, Sparkles, UserRound } from 'lucide-react';
import { login, session } from '../lib/api';
import { biometricSessionLogin, isNativeAndroid, nativeBiometricConfirm, rememberBiometricSession, storedBiometricSession } from '../lib/native';

export function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [credentialId, setCredentialId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [biometricId,setBiometricId]=useState('');

  useEffect(()=>{void storedBiometricSession().then(value=>{if(value.available)setBiometricId(value.credentialId)})},[]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(''); setLoading(true);
    try { const data = await login(credentialId, password);if(isNativeAndroid&&!biometricId){const approved=await nativeBiometricConfirm('Enable fingerprint login','Use your fingerprint for faster sign-in next time','Not now');const token=session.get();if(approved&&token)await rememberBiometricSession(token,data.user.credentialId)}onLogin(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not sign in.'); }
    finally { setLoading(false); }
  }

  async function fingerprintLogin(){setLoading(true);setError('');try{const result=await biometricSessionLogin();if(!result?.verified||!result.token)return;session.set(result.token);onLogin()}catch(err){setError(err instanceof Error?err.message:'Fingerprint login failed.')}finally{setLoading(false)}}

  return (
    <main className="login-page">
      <div className="login-orb orb-one" /><div className="login-orb orb-two" />
      <section className="login-brand">
        <div className="brand-mark brand-mark-large"><span>स</span></div>
        <div><span className="eyebrow light">Plan together · settle simply</span><h1>FUNDSHIP</h1></div>
        <p>One calm place for the plans you make and the money you share.</p>
        <div className="login-preview">
          <div className="preview-icon"><Sparkles size={18}/></div>
          <div><strong>Weekend Crew</strong><span>Hike confirmed · 4 going</span></div>
          <div className="preview-avatars"><i>RB</i><i>NP</i><i>+2</i></div>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-copy"><span className="eyebrow">Welcome back</span><h2>Sign in to your circle</h2><p>Use the ID and initial password issued to you.</p></div>
        <form onSubmit={submit} className="login-form">
          <label><span>User ID</span><div className="input-wrap"><UserRound size={18}/><input value={credentialId} onChange={e=>setCredentialId(e.target.value)} autoCapitalize="characters" autoComplete="username"/></div></label>
          <label><span>Password</span><div className="input-wrap"><LockKeyhole size={18}/><input value={password} onChange={e=>setPassword(e.target.value)} type={showPassword?'text':'password'} autoComplete="current-password"/><button type="button" onClick={()=>setShowPassword(v=>!v)} aria-label="Show password">{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label>
          {error && <div className="form-error">{error}</div>}
          <button className="primary-btn login-btn" disabled={loading}>{loading?'Signing in…':<>Sign in <ArrowRight size={18}/></>}</button>
        </form>
        {biometricId&&<button className="biometric-login" disabled={loading} onClick={()=>void fingerprintLogin()}><Fingerprint size={23}/><span><strong>Sign in with fingerprint</strong><small>{biometricId}</small></span></button>}
        <div className="demo-note"><strong>Private beta</strong><span>Ask the administrator for your account ID.</span></div>
      </section>
    </main>
  );
}
