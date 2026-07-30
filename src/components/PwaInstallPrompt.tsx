import { Download, MonitorDown, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { canOfferInstall, dismissInstallPrompt, installPwa } from '../lib/pwa';

export function PwaInstallPrompt({ notify }: { notify(message: string): void }) {
  const [visible, setVisible] = useState(() => innerWidth >= 900 && canOfferInstall());
  useEffect(() => {
    const update = () => setVisible(innerWidth >= 900 && canOfferInstall());
    window.addEventListener('fundship-install-available', update);
    window.addEventListener('fundship-install-changed', update);
    window.addEventListener('resize', update);
    update();
    return () => {
      window.removeEventListener('fundship-install-available', update);
      window.removeEventListener('fundship-install-changed', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  if (!visible) return null;
  return <aside className="pwa-install-prompt">
    <span><MonitorDown size={22}/></span>
    <div><strong>Install FUNDSHIP</strong><small>Open it like a desktop app and keep your session remembered.</small></div>
    <button onClick={()=>void installPwa().then(installed=>{if(installed)notify('FUNDSHIP installed')})}><Download size={16}/> Install</button>
    <button className="dismiss" aria-label="Dismiss install suggestion" onClick={()=>{dismissInstallPrompt();setVisible(false)}}><X size={16}/></button>
  </aside>;
}
