// Testa o comportamento do site compilado conforme as variáveis de ambiente (o que acontece na Vercel):
//   1) sem variáveis        -> bloqueio explicando o que falta (nunca "modo demonstração")
//   2) chave service_role   -> o site se recusa a usá-la
//   3) URL inválida         -> mensagem de formato
//   4) chave pública válida -> abre o jogo
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {readFileSync, existsSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || ['/usr/bin/google-chrome', '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'].find(existsSync);
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = role => `${b64({alg: 'HS256', typ: 'JWT'})}.${b64({iss: 'supabase', ref: 'abc', role})}.assinatura-falsa`;

const cases = [
  {name: 'sem variáveis', env: {}, expect: {blocker: true, text: 'não estavam definidas'}},
  {name: 'chave service_role', env: {VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_ANON_KEY: jwt('service_role')}, expect: {blocker: true, text: 'NÃO é a chave pública'}},
  {name: 'chave sb_secret_', env: {VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_ANON_KEY: 'sb_secret_abcdef'}, expect: {blocker: true, text: 'NÃO é a chave pública'}},
  {name: 'URL inválida', env: {VITE_SUPABASE_URL: 'abc.supabase.co', VITE_SUPABASE_ANON_KEY: jwt('anon')}, expect: {blocker: true, text: 'formato inválido'}},
  {name: 'chave anon (JWT)', env: {VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_ANON_KEY: jwt('anon')}, expect: {blocker: false}},
  {name: 'chave publishable', env: {VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_ANON_KEY: 'sb_publishable_abcdef'}, expect: {blocker: false}}
];

const mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml'};
const browser = await puppeteer.launch({executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
let failures = 0;

for (const c of cases) {
  const dist = mkdtempSync(path.join(tmpdir(), 'hackerz-cfg-'));
  const env = {...process.env};
  delete env.VITE_SUPABASE_URL;
  delete env.VITE_SUPABASE_ANON_KEY;
  execFileSync('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error'], {cwd: root, stdio: 'inherit', env: {...env, ...c.env}});
  const server = createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    const file = path.join(dist, p === '/' ? 'index.html' : p);
    if (!file.startsWith(dist) || !existsSync(file)) return (res.writeHead(404), res.end());
    res.writeHead(200, {'content-type': mime[path.extname(file)] || 'application/octet-stream'});
    res.end(readFileSync(file));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil: 'domcontentloaded'});
  await page.waitForSelector('.blocker, .landing', {timeout: 10000});
  const hasBlocker = Boolean(await page.$('.blocker'));
  const body = await page.$eval('body', b => b.innerText);
  const demo = /modo demonstra/i.test(body);
  let ok = hasBlocker === c.expect.blocker && !demo;
  if (c.expect.text) ok = ok && body.includes(c.expect.text);
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${c.name}: ${hasBlocker ? 'bloqueio exibido' : 'jogo exibido'}${demo ? ' [MODO DEMO!]' : ''}`);
  if (!ok) failures += 1;
  await page.close();
  server.close();
}

await browser.close();
console.log(failures ? `\n${failures} falha(s).` : '\nConfiguração: todos os cenários ok.');
process.exit(failures ? 1 : 0);
