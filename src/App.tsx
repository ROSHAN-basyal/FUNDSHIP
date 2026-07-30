import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, GripVertical, Home, LogOut, Plus, Settings2, UsersRound, WalletCards } from 'lucide-react';
import { LoginScreen } from './components/LoginScreen';
import { HomePage } from './components/HomePage';
import { GroupPage, PollAlert } from './components/GroupPage';
import { ProfileModal } from './components/ProfileModal';
import { GroupModal } from './components/GroupModal';
import { NotificationCenter } from './components/NotificationCenter';
import { RequiredPasswordChange } from './components/RequiredPasswordChange';
import { RequiredMpinSetup } from './components/RequiredMpinSetup';
import { Avatar } from './components/Avatar';
import { ApiError, applyPollVote, cachedBootstrap, getBootstrap, getSync, mutate, rememberBootstrap, request, session } from './lib/api';
import { isNativeAndroid, onNativeAppResume, PollNotifications, prepareNativeNotifications, requestNativeNotificationPermission, showNativePayment, showNativePoll } from './lib/native';
import { syncQueuedPayments } from './lib/offlineQueue';
import { consumeBackgroundSyncCount, setActiveOfflineUser } from './lib/offlineQueue';
import { playPollSound } from './lib/pwa';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import { DownloadPage } from './components/DownloadPage';
import type { Bootstrap } from './types';

function useKeyboardAwareFocus(){
  useEffect(()=>{
    let timer=0;
    const reveal=()=>{
      if(!matchMedia('(max-width: 900px)').matches)return;
      const field=document.activeElement;
      if(!(field instanceof HTMLInputElement||field instanceof HTMLTextAreaElement||field instanceof HTMLSelectElement))return;
      field.scrollIntoView({block:'center',inline:'nearest',behavior:'smooth'});
    };
    const schedule=()=>{window.clearTimeout(timer);timer=window.setTimeout(reveal,180)};
    document.addEventListener('focusin',schedule);
    window.visualViewport?.addEventListener('resize',schedule);
    return()=>{window.clearTimeout(timer);document.removeEventListener('focusin',schedule);window.visualViewport?.removeEventListener('resize',schedule)};
  },[]);
}

function AppShell({data,onData}:{data:Bootstrap;onData:(d:Bootstrap)=>void}){
  const [page,setPage]=useState(()=>new URLSearchParams(location.search).get('page')||'home');const[profileOpen,setProfileOpen]=useState(false);const[groupOpen,setGroupOpen]=useState(false);const[notificationOpen,setNotificationOpen]=useState(false);const[incomingAlert,setIncomingAlert]=useState<{group:Bootstrap['groups'][number];poll:Bootstrap['groups'][number]['polls'][number]}|null>(null);const[toast,setToast]=useState('');
  const [slideDirection,setSlideDirection]=useState<'left'|'right'>('left');
  const [nativeStatus,setNativeStatus]=useState<{notificationsGranted:boolean;notificationsEnabled:boolean;fullScreenIntentGranted:boolean}|null>(null);
  const [online,setOnline]=useState(navigator.onLine);
  const [groupOrder,setGroupOrder]=useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem('sajilo_group_order')||'[]')}catch{return[]}});
  const dragId=useRef<string|null>(null);const touchX=useRef(0);
  const delivering=useRef(new Set<string>());
  const syncing=useRef(false);
  const groups=useMemo(()=>[...data.groups].sort((a,b)=>{const ai=groupOrder.indexOf(a.id),bi=groupOrder.indexOf(b.id);if(ai<0&&bi<0)return 0;if(ai<0)return 1;if(bi<0)return-1;return ai-bi}),[data.groups,groupOrder]);
  const pages=['home',...groups.map(g=>g.id)];
  const currentGroup=groups.find(g=>g.id===page);
  useEffect(()=>{void setActiveOfflineUser(data.user.id);const receive=(event:MessageEvent)=>{if(event.data?.type==='FUNDSHIP_SYNCED')notify(`${Number(event.data.count)||1} offline request${Number(event.data.count)===1?'':'s'} sent`)};navigator.serviceWorker?.addEventListener('message',receive);void consumeBackgroundSyncCount().then(count=>{if(count)notify(`${count} offline request${count===1?'':'s'} sent`)});return()=>navigator.serviceWorker?.removeEventListener('message',receive)},[data.user.id]);
  useEffect(()=>{
    const sync=async()=>{
      if(!navigator.onLine||document.visibilityState!=='visible'||syncing.current)return;
      syncing.current=true;
      try{
        const queued=await syncQueuedPayments(data.user.id);
        if(queued.data)onData(queued.data);
        if(queued.synced)notify(`${queued.synced} offline request${queued.synced===1?'':'s'} sent`);
        const result=await getSync((queued.data||data).revision||0);
        if(result.changed)onData(rememberBootstrap(result.snapshot));
      }catch(error){
        if(error instanceof ApiError&&error.status===401){
          await setActiveOfflineUser(null);
          session.clear();
          window.location.reload();
        }
      }finally{syncing.current=false}
    };
    const connected=()=>{setOnline(true);void sync()};
    const disconnected=()=>{setOnline(false);if(page!=='home')setPage('home')};
    window.addEventListener('online',connected);
    window.addEventListener('offline',disconnected);
    const timer=window.setInterval(()=>void sync(),6000);
    const visible=()=>{if(document.visibilityState==='visible')void sync()};
    document.addEventListener('visibilitychange',visible);
    if(navigator.onLine)void sync();
    return()=>{
      clearInterval(timer);
      window.removeEventListener('online',connected);
      window.removeEventListener('offline',disconnected);
      document.removeEventListener('visibilitychange',visible);
    };
  },[data.revision,data.user.id,onData,page]);
  useEffect(()=>{if(!isNativeAndroid)return;let active=true;void prepareNativeNotifications().then(async status=>{if(!status||!active)return;let next=status;if(!localStorage.getItem('sajilo_notification_permission_asked')){localStorage.setItem('sajilo_notification_permission_asked','1');next=await requestNativeNotificationPermission()||status}if(active)setNativeStatus(next)});return()=>{active=false}},[]);
  useEffect(()=>{if(!online)return;const candidates=groups.flatMap(group=>group.polls.map(poll=>({group,poll}))).filter(item=>item.poll.status==='open'&&item.poll.approvalStatus==='approved'&&!item.poll.myVote&&Number(localStorage.getItem(`sajilo_remind_${item.poll.id}`)||0)<Date.now());if(!candidates.length)return;if(isNativeAndroid){for(const candidate of candidates){const key=`sajilo_native_notified_${candidate.poll.id}`;if(Number(localStorage.getItem(key)||0)>Date.now()-30*60*1000)continue;localStorage.setItem(key,String(Date.now()));void showNativePoll(candidate.group,candidate.poll)}return}const timer=window.setTimeout(()=>{const key=`fundship_web_poll_sound_${candidates[0].poll.id}`;if(Number(localStorage.getItem(key)||0)<Date.now()-30*60*1000){localStorage.setItem(key,String(Date.now()));playPollSound()}setIncomingAlert(candidates[0])},900);return()=>clearTimeout(timer)},[data.groups,online]);
  useEffect(()=>{if(!isNativeAndroid)return;for(const item of data.notifications.filter(notification=>!notification.nativeDelivered&&(notification.type==='poll_open'||notification.type==='payment_request'))){if(delivering.current.has(item.id))continue;delivering.current.add(item.id);void(async()=>{try{let shown=false;if(item.type==='poll_open'){const owner=groups.find(group=>group.polls.some(poll=>poll.id===item.entityId));const poll=owner?.polls.find(value=>value.id===item.entityId);shown=owner&&poll&&!poll.myVote?await showNativePoll(owner,poll):true}else{const payment=data.payments.incoming.find(value=>value.id===item.entityId);shown=payment?await showNativePayment(payment.id,payment.payeeName,payment.amount,payment.purpose):false}if(shown)await request(`/notifications/${item.id}/delivered`,{method:'POST'})}finally{delivering.current.delete(item.id)}})()}},[data.notifications,data.groups,data.payments.incoming,nativeStatus?.notificationsGranted,nativeStatus?.notificationsEnabled]);
  useEffect(()=>{if(!isNativeAndroid)return;const consume=async()=>{const {actions}=await PollNotifications.getPendingActions();for(const action of actions){if(!action.action||!action.pollId)continue;const owner=groups.find(group=>group.polls.some(poll=>poll.id===action.pollId));if(owner)navigate(owner.id);if(action.action==='yes'||action.action==='no'){try{const result=await request<{revision:number}>(`/polls/${action.pollId}/vote`,{method:'POST',body:JSON.stringify({choice:action.action})});onData(applyPollVote(data,action.pollId,action.action,result.revision));notify(action.action==='yes'?'Yes vote sent':'No vote sent')}catch(err){notify(err instanceof Error?err.message:'Could not send a poll vote.')}finally{await PollNotifications.cancelPoll({pollId:action.pollId})}}else if(action.action==='later')localStorage.setItem(`sajilo_remind_${action.pollId}`,String(Date.now()+2*60*60*1000))}try{const result=await getSync(data.revision||0);if(result.changed)onData(rememberBootstrap(result.snapshot))}catch{/* keep the current offline view */}};void consume();return onNativeAppResume(()=>{void consume()})},[data]);
  function notify(message:string){setToast(message);window.setTimeout(()=>setToast(''),2800)}
  function requireOnline(action:()=>void){if(!online){notify('This feature requires an internet connection.');return}action()}
  function navigate(next:string){if(next===page)return;if(!online&&next!=='home'){notify('Groups require an internet connection.');return}const current=pages.indexOf(page),target=pages.indexOf(next);setSlideDirection(target>=current?'left':'right');setPage(next)}
  function movePage(direction:number){const index=pages.indexOf(page);navigate(pages[Math.max(0,Math.min(pages.length-1,index+direction))]);}
  function drop(targetId:string){if(!dragId.current||dragId.current===targetId)return;const ids=groups.map(g=>g.id);const from=ids.indexOf(dragId.current),to=ids.indexOf(targetId);ids.splice(to,0,ids.splice(from,1)[0]);setGroupOrder(ids);localStorage.setItem('sajilo_group_order',JSON.stringify(ids));notify('Group order updated');dragId.current=null;}
  async function logout(){try{await request('/auth/logout',{method:'POST'})}catch{/* local sign-out still proceeds */}finally{await setActiveOfflineUser(null);session.clear();window.location.reload()}}
  return <div className="app-shell" onTouchStart={e=>touchX.current=e.changedTouches[0].clientX} onTouchEnd={e=>{const d=e.changedTouches[0].clientX-touchX.current;if(Math.abs(d)>85)movePage(d<0?1:-1)}}>
    <header className="app-header">
      <button className="wordmark" onClick={()=>navigate('home')}><span className="brand-mark"><span>स</span></span><span><strong>FUNDSHIP</strong><small>plans & payments</small></span></button>
      <nav className="page-tabs" aria-label="Main pages">
        <button className={page==='home'?'active':''} onClick={()=>navigate('home')}><Home size={16}/><span>Home</span></button>
        {groups.map(group=><button draggable onDragStart={()=>dragId.current=group.id} onDragOver={e=>e.preventDefault()} onDrop={()=>drop(group.id)} className={page===group.id?'active':''} onClick={()=>navigate(group.id)} key={group.id}><GripVertical className="drag-grip" size={13}/><span>{group.emoji}</span><span>{group.name}</span>{group.polls.some(p=>p.status==='open'&&!p.myVote)&&<i className="tab-alert"/>}</button>)}
        <button className="add-group-tab" onClick={()=>requireOnline(()=>setGroupOpen(true))} title="Create or join a group"><Plus size={16}/><span>Group</span>{data.groupInvites.length>0&&<i className="invite-count">{data.groupInvites.length}</i>}</button>
      </nav>
      <div className="header-tools"><button className="notification-btn" onClick={()=>requireOnline(()=>setNotificationOpen(true))}><Bell size={19}/>{data.notifications.some(item=>!item.read&&item.type!=='payment_request'&&!item.type.startsWith('poll_')&&item.type!=='event_due')&&<i/>}</button><button className="profile-button" onClick={()=>requireOnline(()=>setProfileOpen(true))}><Avatar name={data.user.name} color={data.user.avatarColor} size="sm"/><span><strong>{data.user.name.split(' ')[0]}</strong><small>{data.user.credentialId}</small></span><Settings2 size={15}/></button><button className="logout-btn" onClick={()=>requireOnline(()=>void logout())} title="Sign out"><LogOut size={18}/></button></div>
    </header>
    <main className="app-main">
      {isNativeAndroid&&nativeStatus&&(!nativeStatus.notificationsGranted||!nativeStatus.notificationsEnabled||!nativeStatus.fullScreenIntentGranted)&&<div className="native-permission-banner"><Bell size={18}/><div><strong>{!nativeStatus.notificationsGranted||!nativeStatus.notificationsEnabled?'Turn on poll notifications':'Allow lock-screen poll alerts'}</strong><span>{!nativeStatus.notificationsGranted||!nativeStatus.notificationsEnabled?'Required to receive votes and deadline updates.':'Android requires separate special access for full-screen alerts.'}</span></div><button onClick={async()=>{if(!nativeStatus.notificationsGranted){const requested=await requestNativeNotificationPermission();if(requested?.notificationsGranted){setNativeStatus(requested);return}const next=await PollNotifications.openNotificationSettings();setNativeStatus(next)}else{const next=await PollNotifications.openFullScreenSettings();setNativeStatus(next)}}}>Enable</button></div>}
      <div key={page} className={`page-transition slide-${slideDirection}`}>{page==='home'?<HomePage data={data} online={online} onData={onData} notify={notify}/>:currentGroup?<GroupPage data={data} group={currentGroup} userId={data.user.id} onData={onData} notify={notify}/>:null}</div>
    </main>
    <nav className="mobile-nav"><button className={page==='home'?'active':''} onClick={()=>navigate('home')}><WalletCards/><span>Home</span></button>{groups.slice(0,3).map(group=><button key={group.id} className={page===group.id?'active':''} onClick={()=>navigate(group.id)}><span className="mobile-emoji">{group.emoji}</span><span>{group.name.split(' ')[0]}</span></button>)}<button onClick={()=>requireOnline(()=>setGroupOpen(true))}><UsersRound/><span>Groups</span></button></nav>
    {profileOpen&&<ProfileModal data={data} onClose={()=>setProfileOpen(false)} onData={onData} notify={notify}/>}
    {groupOpen&&<GroupModal data={data} onClose={()=>setGroupOpen(false)} onData={onData} notify={notify}/>}
    {notificationOpen&&<NotificationCenter data={data} onData={onData} onClose={()=>setNotificationOpen(false)} onNavigate={navigate} onGroups={()=>{setNotificationOpen(false);setGroupOpen(true)}} notify={notify}/>}
    {incomingAlert&&<PollAlert group={incomingAlert.group} poll={incomingAlert.poll} onClose={()=>{localStorage.setItem(`sajilo_remind_${incomingAlert.poll.id}`,String(Date.now()+2*60*60*1000));setIncomingAlert(null)}} onVote={async(id,choice)=>{const result=await request<{revision:number}>(`/polls/${id}/vote`,{method:'POST',body:JSON.stringify({choice})});onData(applyPollVote(data,id,choice,result.revision));setIncomingAlert(null);notify('Vote sent to the group')}}/>}
    <PwaInstallPrompt notify={notify}/>
    {toast&&<div className="toast"><span>✓</span>{toast}</div>}
  </div>;
}

function FundshipApplication(){
  useKeyboardAwareFocus();
  const initial=useMemo(()=>session.exists()?cachedBootstrap():null,[]);const [data,setData]=useState<Bootstrap|null>(initial);const[loading,setLoading]=useState(Boolean(session.exists()&&!initial));const[error,setError]=useState('');
  async function load(){setLoading(true);setError('');try{setData(await getBootstrap())}catch(err){const cached=cachedBootstrap();if(err instanceof ApiError&&err.status===401){session.clear();setError(err.message)}else if(cached){setData(cached);setError('You are offline. Only queued payment requests are available.')}else{setError(err instanceof Error?err.message:'Could not load your account.')}}finally{setLoading(false)}}
  useEffect(()=>{if(!session.exists())return;if(!initial){void load();return}void getSync(initial.revision||0).then(result=>{if(result.changed)setData(rememberBootstrap(result.snapshot))}).catch(()=>{/* cached state stays usable offline */})},[]);
  if(loading)return <div className="splash"><div className="brand-mark brand-mark-large"><span>F</span></div><strong>FUNDSHIP</strong><span className="loading-dots"><i/><i/><i/></span></div>;
  if(!data)return <><LoginScreen onLogin={()=>load()}/>{error&&<div className="floating-error">{error}</div>}</>;
  if(data.user.onboardingStep==='change_password'||data.user.mustChangePassword)return <RequiredPasswordChange onChanged={load}/>;
  if(data.user.onboardingStep==='create_mpin'||data.user.hasMpin===false)return <RequiredMpinSetup onChanged={load}/>;
  return <AppShell data={data} onData={setData}/>;
}

export default function App(){
  const path=location.pathname.replace(/\/+$/,'')||'/';
  return path==='/download'?<DownloadPage/>:<FundshipApplication/>;
}
