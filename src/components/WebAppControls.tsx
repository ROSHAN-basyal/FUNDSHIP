import { BellRing, Download, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  canOfferInstall,
  disableWebPollPush,
  enableWebPollPush,
  installPwa,
  isStandalonePwa,
  pollSoundEnabled,
  setPollSoundEnabled,
  webPushState,
  type WebPushState,
} from '../lib/pwa';

export function WebAppControls({ notify }: { notify(message: string): void }) {
  const [push, setPush] = useState<WebPushState | null>(null);
  const [sound, setSound] = useState(pollSoundEnabled());
  const [busy, setBusy] = useState(false);
  const refresh = () => void webPushState().then(setPush);
  useEffect(refresh, []);
  async function togglePush() {
    setBusy(true);
    try {
      if (push?.subscribed) {
        await disableWebPollPush();
        notify('Web poll notifications disabled');
      } else {
        await enableWebPollPush();
        notify('Web poll notifications enabled');
      }
      refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update web notifications.');
    } finally {
      setBusy(false);
    }
  }
  return <section className="web-app-controls">
    <header><span><BellRing size={19}/></span><div><strong>Web app & poll alerts</strong><small>Browser support varies by device and operating system.</small></div></header>
    <div className="web-control-row"><div><strong>Poll push notifications</strong><small>{push?.explanation || (push?.subscribed ? 'Enabled for this browser.' : 'Receive polls even when this window is closed.')}</small></div><button type="button" disabled={busy||!push?.available||!push?.configured} onClick={()=>void togglePush()}>{push?.subscribed?'Disable':'Enable'}</button></div>
    <div className="web-control-row"><div><strong>Poll sound while FUNDSHIP is open</strong><small>Background web notifications use the sound chosen by your browser or OS.</small></div><button type="button" onClick={()=>{const next=!sound;setSound(next);setPollSoundEnabled(next);notify(next?'Poll sound enabled':'Poll sound disabled')}}>{sound?<><Volume2 size={15}/> On</>:<><VolumeX size={15}/> Off</>}</button></div>
    {!isStandalonePwa()&&<div className="web-control-row"><div><strong>Install this web app</strong><small>{canOfferInstall()?'A standalone installation is available.':'Use your browser’s “Install app” or “Add to Home Screen” menu if available.'}</small></div>{canOfferInstall()&&<button type="button" onClick={()=>void installPwa()}><Download size={15}/> Install</button>}</div>}
  </section>;
}
