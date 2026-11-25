import {createClient} from '@supabase/supabase-js';

// As variáveis VITE_* são embutidas no bundle NA HORA DO BUILD. Se forem cadastradas na Vercel
// depois do último deploy, é preciso fazer um novo deploy para que o site as enxergue.
const url = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
const key = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

function decodeJwtRole(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)).role || null;
  } catch {
    return null;
  }
}

// Diagnostica a chave sem nunca expô-la: tipo, papel e se é seguro usar no navegador.
export function inspectKey(value) {
  if (!value) return {kind: 'missing', safe: false};
  if (value.startsWith('sb_secret_')) return {kind: 'secret', role: 'secret', safe: false};
  if (value.startsWith('sb_publishable_')) return {kind: 'publishable', role: 'anon', safe: true};
  const role = decodeJwtRole(value);
  if (role === 'service_role') return {kind: 'jwt', role, safe: false};
  if (role === 'anon') return {kind: 'jwt', role, safe: true};
  return {kind: 'unknown', role, safe: Boolean(value)};
}

export function inspectUrl(value) {
  try {
    const u = new URL(value);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !local) return {ok: false, reason: 'A URL do Supabase precisa começar com https://'};
    return {ok: true, host: u.host};
  } catch {
    return {ok: false, reason: 'VITE_SUPABASE_URL não é uma URL válida'};
  }
}

function findProblem() {
  if (!url && !key) return 'missing';
  if (!url) return 'missing-url';
  if (!key) return 'missing-key';
  if (!inspectUrl(url).ok) return 'bad-url';
  if (!inspectKey(key).safe && ['secret', 'jwt'].includes(inspectKey(key).kind)) return 'unsafe-key';
  return null;
}

export const configProblem = findProblem();
export const isConfigured = configProblem === null;
export const envSummary = {
  url,
  urlInfo: inspectUrl(url),
  keyInfo: inspectKey(key),
  keyPresent: Boolean(key),
  mode: import.meta.env.MODE
};

// Sem sessão de autenticação: o jogo usa apenas a chave pública (anon) e RPCs com credenciais próprias.
export const db = isConfigured
  ? createClient(url, key, {
      auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false},
      realtime: {params: {eventsPerSecond: 5}}
    })
  : null;

export const PROBLEM_TEXT = {
  missing: 'As variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY não estavam definidas quando este site foi compilado.',
  'missing-url': 'A variável VITE_SUPABASE_URL não estava definida quando este site foi compilado.',
  'missing-key': 'A variável VITE_SUPABASE_ANON_KEY não estava definida quando este site foi compilado.',
  'bad-url': 'VITE_SUPABASE_URL está em formato inválido. Use o Project URL do Supabase (https://xxxx.supabase.co).',
  'unsafe-key': 'A chave configurada NÃO é a chave pública (anon/publishable). Por segurança o site se recusa a usá-la. Troque pela anon key e gere um novo deploy.'
};
