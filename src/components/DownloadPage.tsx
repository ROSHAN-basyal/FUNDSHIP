import { useEffect } from 'react';
import {
  ArrowRight,
  AlertTriangle,
  BellRing,
  Check,
  CheckCircle2,
  Download,
  Fingerprint,
  Globe2,
  LockKeyhole,
  MessageCircle,
  ShieldCheck,
  Smartphone,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import './download-page.css';

const release = {
  version: '2.3-native',
  versionCode: 5,
  fileSize: '4.6 MB',
  minimumAndroid: 'Android 7.0+',
  sha256: '19270760fd3b4977a30d31776bc5516365aff8a09ca7f489f8b7325ca6c0b011',
};

function Brand() {
  return (
    <a className="download-brand" href="/" aria-label="FUNDSHIP web app">
      <span className="download-brand-mark">F</span>
      <span>
        <strong>FUNDSHIP</strong>
        <small>plans &amp; payments</small>
      </span>
    </a>
  );
}

function PhonePreview() {
  return (
    <div className="download-phone-stage" aria-label="FUNDSHIP Android app preview">
      <div className="download-orbit orbit-one" />
      <div className="download-orbit orbit-two" />
      <div className="download-phone">
        <div className="download-phone-speaker" />
        <div className="download-phone-screen">
          <div className="phone-topline">
            <span className="phone-mini-brand">F</span>
            <span>FUNDSHIP</span>
            <BellRing size={15} />
          </div>
          <div className="phone-greeting">
            <small>YOUR MONEY, TOGETHER</small>
            <strong>Home</strong>
          </div>
          <div className="phone-summary">
            <div>
              <span>↗ Owed to you</span>
              <strong>रु 4,250</strong>
            </div>
            <div>
              <span>↘ You owe</span>
              <strong>रु 1,200</strong>
            </div>
          </div>
          <div className="phone-actions">
            <span><UsersRound size={15} /> Group request</span>
            <span><WalletCards size={15} /> Individual</span>
          </div>
          <div className="phone-ledger-title">
            <strong>LEDGER</strong>
            <small>3 connected friends</small>
          </div>
          {[
            ['RB', 'Roshan_(B)', '+ रु 2,400'],
            ['NP', 'Nawaraj_(P)', '− रु 1,200'],
            ['HB', 'Hemanta_(B)', '+ रु 1,850'],
          ].map(([initials, name, amount], index) => (
            <div className="phone-ledger-row" key={name}>
              <i className={`phone-avatar avatar-${index}`}>{initials}</i>
              <span>{name}</span>
              <b className={amount.startsWith('+') ? 'positive' : 'negative'}>{amount}</b>
            </div>
          ))}
          <div className="phone-navigation">
            <span className="active"><WalletCards size={17} /> Home</span>
            <span><UsersRound size={17} /> Groups</span>
          </div>
        </div>
      </div>
      <div className="download-float-card download-poll-float">
        <span><BellRing size={16} /></span>
        <div><strong>New group poll</strong><small>Vote without opening the app</small></div>
      </div>
      <div className="download-float-card download-secure-float">
        <span><Fingerprint size={17} /></span>
        <div><strong>Protected actions</strong><small>Fingerprint or MPIN</small></div>
      </div>
    </div>
  );
}

export function DownloadPage() {
  const configuredUrl = String(import.meta.env.VITE_ANDROID_APK_URL || '').trim();
  const downloadReady = /^https:\/\/.+\.supabase\.co\/storage\/v1\/object\/public\//i.test(configuredUrl);

  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = description?.content;
    document.title = 'Download FUNDSHIP for Android';
    if (description) description.content = 'Download the official FUNDSHIP Android beta for group polls, chat, and shared payments.';
    return () => {
      document.title = previousTitle;
      if (description && previousDescription) description.content = previousDescription;
    };
  }, []);

  return (
    <div className="download-page">
      <header className="download-header">
        <Brand />
        <nav aria-label="Download page navigation">
          <a href="#features">Features</a>
          <a href="#install">How to install</a>
          <a className="download-web-link" href="/">Open web app <ArrowRight size={15} /></a>
        </nav>
      </header>

      <main>
        <section className="download-hero">
          <div className="download-hero-copy">
            <div className="download-beta-pill"><span /> Android beta · Version {release.version}</div>
            <h1>Plans made.<br /><em>Balances clear.</em></h1>
            <p>
              Poll your group, keep conversations together, and settle shared money
              without the awkward follow-up.
            </p>

            <div className="download-primary-actions">
              {downloadReady ? (
                <a className="download-apk-button" href={configuredUrl} rel="noopener">
                  <Download size={21} />
                  <span><strong>Download for Android</strong><small>APK · {release.fileSize}</small></span>
                  <ArrowRight size={18} />
                </a>
              ) : (
                <span className="download-apk-button download-disabled" aria-disabled="true">
                  <Download size={21} />
                  <span><strong>Android download is being prepared</strong><small>Supabase release pending</small></span>
                </span>
              )}
              <a className="download-browser-button" href="/">
                <Globe2 size={19} />
                Use in browser
              </a>
            </div>

            <div className="download-trust-row">
              <span><ShieldCheck size={16} /> Official FUNDSHIP build</span>
              <span><CheckCircle2 size={16} /> Verified release details</span>
              <span><Smartphone size={16} /> {release.minimumAndroid}</span>
            </div>
          </div>
          <PhonePreview />
        </section>

        <section className="download-feature-section" id="features">
          <div className="download-section-heading">
            <span>BUILT FOR REAL GROUPS</span>
            <h2>One place for the plan<br />and the payment.</h2>
            <p>Everything your circle needs before, during, and after getting together.</p>
          </div>
          <div className="download-feature-grid">
            <article>
              <span className="feature-icon green"><BellRing /></span>
              <small>DECIDE</small>
              <h3>Polls people notice</h3>
              <p>Important full-screen poll alerts, flexible options, deadlines, and clear results.</p>
            </article>
            <article>
              <span className="feature-icon orange"><WalletCards /></span>
              <small>SETTLE</small>
              <h3>Shared money, simplified</h3>
              <p>Individual requests, equal or manual group splits, and a clean net ledger.</p>
            </article>
            <article>
              <span className="feature-icon blue"><MessageCircle /></span>
              <small>CONNECT</small>
              <h3>Chat where plans happen</h3>
              <p>Keep group decisions and conversations close without another crowded chat app.</p>
            </article>
            <article>
              <span className="feature-icon dark"><LockKeyhole /></span>
              <small>PROTECT</small>
              <h3>Confirmation that is yours</h3>
              <p>Use fingerprint or your private MPIN when approving important payment actions.</p>
            </article>
          </div>
        </section>

        <section className="download-install-section" id="install">
          <div className="install-copy">
            <span className="install-kicker">INSTALL IN A MINUTE</span>
            <h2>From download<br />to FUNDSHIP.</h2>
            <p>This beta is distributed directly while the Play Store release is being prepared.</p>
            <div className="release-facts">
              <div><small>VERSION</small><strong>{release.version}</strong></div>
              <div><small>VERSION CODE</small><strong>{release.versionCode}</strong></div>
              <div><small>DOWNLOAD SIZE</small><strong>{release.fileSize}</strong></div>
              <div><small>REQUIRES</small><strong>{release.minimumAndroid}</strong></div>
            </div>
          </div>
          <div className="install-guide">
            <ol className="install-steps">
              <li>
                <span>01</span>
                <div><strong>Download the APK</strong><p>Tap the Android download button and let the file finish downloading.</p></div>
                <Check size={18} />
              </li>
              <li>
                <span>02</span>
                <div><strong>Allow this installation</strong><p>If Android asks, permit your browser to install apps from this source.</p></div>
                <Check size={18} />
              </li>
              <li>
                <span>03</span>
                <div><strong>Install and sign in</strong><p>Open the APK, choose Install, then use the FUNDSHIP ID issued to you.</p></div>
                <Check size={18} />
              </li>
            </ol>
            <aside className="install-compatibility-note">
              <AlertTriangle size={19} />
              <p><strong>Previously installed through USB?</strong> Uninstall that older FUNDSHIP test build once, including from Private Space or cloned profiles, before installing this signed beta.</p>
            </aside>
          </div>
        </section>

        <section className="download-security-strip">
          <ShieldCheck size={31} />
          <div>
            <small>RELEASE INTEGRITY</small>
            <strong>Know exactly what you are installing.</strong>
          </div>
          <dl>
            <div><dt>Package</dt><dd>com.sajilo.split</dd></div>
            <div><dt>SHA-256</dt><dd>{release.sha256}</dd></div>
          </dl>
        </section>
      </main>

      <footer className="download-footer">
        <Brand />
        <p>Made for friends who plan together.</p>
        <div><a href="/">Web app</a><a href="#install">Installation help</a></div>
      </footer>
    </div>
  );
}
