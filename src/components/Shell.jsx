import {Mark, Wordmark} from './Logo';
import {PROBLEM_TEXT, configProblem} from '../lib/db';

const LINK_LABEL = {ok: 'ONLINE', retrying: 'RECONECTANDO'};

export function Topbar({link = 'ok', children}) {
  return (
    <header className="topbar">
      <a className="brand" href="#/" aria-label="HackerZ — início">
        <Mark size={44} />
        <Wordmark />
      </a>
      <div className="topbar-right">
        <span className={`link-chip ${link}`}><i />{LINK_LABEL[link] || 'ONLINE'}</span>
        {children}
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <span>HACKERZ // DIGITAL UNDERWORLD © 2026</span>
      <span><a href="#/diag">DIAGNÓSTICO</a> · FICÇÃO EDUCATIVA — NADA AQUI É HACKING REAL</span>
    </footer>
  );
}

export function Toast({notice, onClose}) {
  if (!notice) return null;
  return (
    <button className={`toast ${notice.tone}`} onClick={onClose} role="status">
      <span>{notice.text}</span><b aria-hidden="true">×</b>
    </button>
  );
}

// Substitui o antigo "modo demonstração": sem Supabase não há multiplayer, então o site explica o que falta.
export function ConfigBlocker() {
  return (
    <main className="blocker panel">
      <div className="kicker">/// CONEXÃO COM O SERVIDOR</div>
      <h1>SERVIDOR NÃO<br /><em>CONFIGURADO.</em></h1>
      <p className="lead">{PROBLEM_TEXT[configProblem]}</p>
      <ol className="steps">
        <li>Na Vercel, abra <b>Settings → Environment Variables</b> e cadastre <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> para <b>Production</b> e <b>Preview</b>.</li>
        <li>Use a chave <b>anon / publishable</b> do Supabase. Nunca a <code>service_role</code>.</li>
        <li>Vá em <b>Deployments</b> e faça <b>Redeploy</b>. As variáveis só entram no site quando ele é compilado de novo.</li>
      </ol>
      <a className="btn btn-outline" href="#/diag">ABRIR DIAGNÓSTICO <span>↗</span></a>
    </main>
  );
}
