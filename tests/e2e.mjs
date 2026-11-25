// Teste ponta a ponta: frontend COMPILADO (vite build) em dois navegadores isolados ("dois celulares"),
// falando com a API local (mock-supabase) sobre o Postgres de teste com as migrações reais.
//
// Uso: node e2e.mjs            (compila o front apontando para o mock e roda o cenário)
//      SHOTS=./capturas node e2e.mjs   (salva capturas de tela de cada etapa)
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdirSync, readFileSync, existsSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import puppeteer from 'puppeteer-core';
import {createTestDb} from './lib/db.mjs';
import {startMockSupabase} from './lib/mock-supabase.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const SHOTS = process.env.SHOTS ? path.resolve(process.env.SHOTS) : '';
if (SHOTS) mkdirSync(SHOTS, {recursive: true});
const CHROME = process.env.CHROME || ['/usr/bin/google-chrome', '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'].find(existsSync);

let passed = 0;
const failures = [];
function check(label, ok, extra = '') {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label} ${extra}`);
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, label, timeout = 15000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(150);
  }
  throw new Error(`Tempo esgotado: ${label}`);
}

const text = (page, sel) => page.$eval(sel, el => el.textContent.trim()).catch(() => null);
const count = (page, sel) => page.$$eval(sel, els => els.length);
const clickText = (page, label) => page.evaluate(label => {
  const btn = [...document.querySelectorAll('button, a')].find(b => b.textContent.includes(label) && !b.disabled);
  if (!btn) return false;
  btn.click();
  return true;
}, label);
async function shot(page, name) {
  if (SHOTS) await page.screenshot({path: path.join(SHOTS, `${name}.png`), fullPage: true});
}

// ---------- 1) API local + build do front apontando para ela ----------
const db = await createTestDb();
const api = await startMockSupabase(db);
const apiUrl = `http://127.0.0.1:${api.port}`;
const dist = mkdtempSync(path.join(tmpdir(), 'hackerz-e2e-'));
console.log(`API local em ${apiUrl}`);
execFileSync('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error'], {
  cwd: root,
  stdio: 'inherit',
  env: {...process.env, VITE_SUPABASE_URL: apiUrl, VITE_SUPABASE_ANON_KEY: 'sb_publishable_teste_local_nao_secreta'}
});

const mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml'};
const web = createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const file = path.join(dist, p === '/' ? 'index.html' : p);
  if (!file.startsWith(dist) || !existsSync(file)) return (res.writeHead(404), res.end());
  res.writeHead(200, {'content-type': mime[path.extname(file)] || 'application/octet-stream'});
  res.end(readFileSync(file));
});
await new Promise(r => web.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${web.address().port}/`;

// ---------- 2) Dois "celulares" ----------
const browser = await puppeteer.launch({executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
async function phone(name, viewport = {width: 390, height: 844, isMobile: true, hasTouch: true}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  // "Failed to load resource" não traz a URL; falhas de rede reais já são capturadas em `requestfailed`
  // (que ignora apenas as Google Fonts, bloqueadas pelo proxy deste ambiente de teste).
  page.on('console', m => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(`${name} console: ${m.text()}`));
  page.on('requestfailed', r => !/fonts\.g/.test(r.url()) && errors.push(`${name} requestfailed: ${r.url()}`));
  return {name, ctx, page, errors};
}

const host = await phone('CRIADOR');
const guest = await phone('CONVIDADO');
const allErrors = () => [...host.errors, ...guest.errors];
let code = '';

try {
  console.log('\n[1] Início e configuração');
  await host.page.goto(base, {waitUntil: 'networkidle0'});
  check('não exibe "modo demonstração"', !(await host.page.content()).toLowerCase().includes('modo demonstra'));
  check('não exibe bloqueio de configuração', (await count(host.page, '.blocker')) === 0);
  check('título correto', (await host.page.title()).includes('HackerZ'));
  await shot(host.page, '01-inicio-mobile');

  console.log('\n[2] Criador cria a sala e já entra como jogador');
  await host.page.type('#nick', 'NIGHTFALL');
  await clickText(host.page, 'CRIAR SALA');
  await waitFor(() => host.page.$('.room-chip b'), 'sala criada');
  code = await text(host.page, '.room-chip b');
  check('código de 6 caracteres', /^[A-Z2-9]{6}$/.test(code), code);
  await waitFor(async () => (await count(host.page, '.roster li')) === 1, 'criador no roster');
  check('criador aparece na lista como jogador (VOCÊ)', (await text(host.page, '.roster li.me em')) === 'VOCÊ');
  check('criador vê controles de partida', (await count(host.page, '.host-box')) === 1);

  console.log('\n[3] Convidado entra com o código (em outro "aparelho")');
  await guest.page.goto(base, {waitUntil: 'networkidle0'});
  await guest.page.type('#nick', 'GHOST');
  await guest.page.type('#code', code.toLowerCase());
  await clickText(guest.page, 'ENTRAR NA SALA');
  await waitFor(() => guest.page.$('.lobby'), 'convidado na sala');
  check('convidado vê o mesmo código', (await text(guest.page, '.room-chip b')) === code);
  check('convidado NÃO vê controles de operador', (await count(guest.page, '.host-box')) === 0);
  await waitFor(async () => (await count(guest.page, '.roster li')) === 2, 'roster do convidado com 2');
  await waitFor(async () => (await count(host.page, '.roster li')) === 2, 'roster do criador com 2 (tempo real)');
  check('criador vê o convidado entrar sem recarregar', true);
  await shot(host.page, '02-sala-criador-mobile');
  await shot(guest.page, '03-sala-convidado-mobile');

  console.log('\n[4] Código inválido e codinome duplicado');
  const third = await phone('INTRUSO');
  await third.page.goto(base, {waitUntil: 'networkidle0'});
  await third.page.type('#nick', 'GHOST');
  await third.page.type('#code', code);
  await clickText(third.page, 'ENTRAR NA SALA');
  await waitFor(() => third.page.$('.toast'), 'aviso de codinome');
  check('codinome repetido é recusado com mensagem clara', (await text(third.page, '.toast')).includes('já está em uso'));
  await third.page.$eval('#code', el => (el.value = ''));
  await third.page.click('#code', {clickCount: 3});
  await third.page.type('#code', 'AAAAAA');
  await clickText(third.page, 'ENTRAR NA SALA');
  await waitFor(async () => (await text(third.page, '.toast'))?.includes('não encontrada'), 'sala inexistente');
  check('sala inexistente é recusada', true);
  await third.ctx.close();

  console.log('\n[5] Início simultâneo da partida');
  await clickText(host.page, 'INICIAR PARTIDA');
  await waitFor(() => host.page.$('.play'), 'criador na rodada');
  await waitFor(() => guest.page.$('.play'), 'convidado na rodada (sincronizado)');
  const qh = await text(host.page, '.q-head h1');
  const qg = await text(guest.page, '.q-head h1');
  check('ambos recebem a MESMA pergunta', qh && qh === qg, `${qh} / ${qg}`);
  check('criador tem alternativas clicáveis (joga)', (await count(host.page, '.answer:not([disabled])')) === 4);
  const tH = Number(await text(host.page, '.countdown strong'));
  const tG = Number(await text(guest.page, '.countdown strong'));
  check('cronômetro sincronizado (diferença ≤ 1s)', Math.abs(tH - tG) <= 1, `${tH}s / ${tG}s`);
  check('cronômetro dentro do esperado', tH > 10 && tH <= 20, `${tH}s`);
  await shot(host.page, '04-rodada-criador-mobile');
  await shot(guest.page, '05-rodada-convidado-mobile');

  console.log('\n[6] Ambos respondem corretamente; pontuação no banco');
  const correct = (await db.query(`select (current_question->>'correct')::int as c from public.rooms where code=$1`, [code])).rows[0].c;
  await host.page.click(`.answer:nth-child(${correct + 1})`);
  await waitFor(async () => (await text(host.page, '.feedback b'))?.startsWith('ACERTO'), 'feedback do criador');
  check('criador recebe feedback de acerto com pontos', /ACERTO \+\d+ XP/.test(await text(host.page, '.feedback b')));
  await guest.page.click(`.answer:nth-child(${correct + 1})`);
  await waitFor(async () => (await text(guest.page, '.feedback b'))?.startsWith('ACERTO'), 'feedback do convidado');
  const dbAnswers = (await db.query(`select count(*)::int n from public.answers`)).rows[0].n;
  check('2 respostas registradas no banco', dbAnswers === 2, String(dbAnswers));
  await waitFor(async () => /2 \/ 2/.test((await text(guest.page, '.progress-line span')) || ''), 'contador 2/2 no convidado');
  await waitFor(async () => /2 \/ 2/.test((await text(host.page, '.progress-line span')) || ''), 'contador 2/2 no criador');
  check('contador "já responderam" atualiza nos dois aparelhos', true);
  const scoreH = (await db.query(`select score from public.players where nickname='NIGHTFALL'`)).rows[0].score;
  await waitFor(async () => (await text(host.page, '.stats > div:nth-child(1) strong')) === String(scoreH), 'pontuação no HUD');
  check('pontuação do HUD = pontuação do banco', true, String(scoreH));
  await waitFor(async () => (await text(guest.page, '.ranking li:first-child')) !== null, 'ranking ao vivo');
  check('ranking ao vivo visível ao convidado', (await count(guest.page, '.ranking li')) === 2);

  console.log('\n[7] Defesa e ataque (mecânica fictícia)');
  await clickText(host.page, 'ATIVAR BLINDAGEM');
  await waitFor(async () => (await text(host.page, '.stats > div:nth-child(3) strong')) === '1', 'blindagem ativa');
  check('criador ativa blindagem (créditos −50, escudo +1)', (await text(host.page, '.stats > div:nth-child(2) strong')) === String(scoreH - 50));
  await guest.page.evaluate(() => {
    const row = [...document.querySelectorAll('.attack li')].find(li => li.textContent.includes('NIGHTFALL'));
    row.querySelector('button').click();
  });
  await waitFor(() => guest.page.$('.toast'), 'resultado do ataque');
  check('ataque contra alvo blindado é bloqueado', (await text(guest.page, '.toast')).includes('bloqueou'));
  await waitFor(async () => ((await text(host.page, '.feed')) || '').includes('DEFESA'), 'evento de defesa no feed do alvo');
  check('alvo vê o evento de combate (DEFESA contra GHOST)', (await text(host.page, '.feed')).includes('bloqueou o ataque de GHOST'));
  check('atacante fica sem novo ataque na rodada', await guest.page.$eval('.attack li button', b => b.disabled));
  await shot(guest.page, '06-combate-convidado-mobile');

  console.log('\n[8] Painel do operador (monitoramento, aba separada, somente leitura)');
  const ops = await host.ctx.newPage();
  await ops.setViewport({width: 1440, height: 900});
  ops.on('pageerror', e => host.errors.push(`painel: ${e.message}`));
  await ops.goto(`${base}#/operator/${code}`, {waitUntil: 'networkidle0'});
  await waitFor(() => ops.$('.kpis'), 'painel carregado');
  const kpi = async label => ops.evaluate(l => {
    const k = [...document.querySelectorAll('.kpi')].find(el => el.querySelector('small').textContent.includes(l));
    return k ? k.querySelector('strong').textContent.trim() : null;
  }, label);
  check('mostra jogadores conectados', (await kpi('CONECTADOS')) === '2/2', await kpi('CONECTADOS'));
  check('mostra rodada atual', (await kpi('RODADA ATUAL')) === '01/10', await kpi('RODADA ATUAL'));
  check('mostra ataques e bloqueios', (await kpi('ATAQUES')) === '1');
  check('mostra pontos perdidos (0: ataque foi bloqueado)', (await kpi('PONTOS PERDIDOS')) === '0');
  check('mostra defesas ativas (0: camada consumida pelo bloqueio)', (await kpi('DEFESAS ATIVAS')) === '0');
  check('mostra situação geral da partida', /RODADA 1\/10/.test(await text(ops, '.situation')));
  check('quem ataca quem', (await text(ops, '.duels')).includes('GHOST') && (await text(ops, '.duels')).includes('NIGHTFALL'));
  check('histórico de eventos real', (await count(ops, '.events li:not(.empty)')) >= 6);
  const evText = await text(ops, '.events');
  for (const tag of ['ENTRADA', 'RODADA', 'ACERTO', 'ESCUDO', 'DEFESA']) check(`histórico contém ${tag}`, evText.includes(tag));
  check('ranking em tempo real com 2 jogadores', (await count(ops, '.ops-ranking tbody tr')) === 2);
  check('painel NÃO é tela de jogo (sem alternativas, sem botão de resposta)', (await count(ops, '.answer')) === 0 && (await count(ops, '.question')) === 0);
  check('painel indica somente leitura', (await text(ops, '.readonly-tag')) === 'SOMENTE LEITURA');
  await shot(ops, '07-painel-operador-desktop');

  const intruder = await phone('SEM-CHAVE', {width: 1280, height: 800});
  await intruder.page.goto(`${base}#/operator/${code}`, {waitUntil: 'networkidle0'});
  check('sem a chave de operador o painel pede a chave', (await count(intruder.page, '.paste-form')) === 1);
  const wrongKey = 'a'.repeat(64);
  await intruder.page.type('.paste-form input', wrongKey);
  await clickText(intruder.page, 'ABRIR PAINEL');
  await waitFor(async () => (await count(intruder.page, '.alert.danger')) === 1, 'rejeição da chave errada');
  check('chave de operador errada é rejeitada', true);
  await intruder.ctx.close();

  console.log('\n[9] Recarregar a página não derruba o jogador');
  await guest.page.reload({waitUntil: 'networkidle0'});
  await waitFor(() => guest.page.$('.play'), 'convidado restaurado');
  check('convidado volta direto para a rodada após recarregar', (await text(guest.page, '.q-head h1')) === qh);
  check('resposta já enviada continua travada após recarregar', (await count(guest.page, '.answer:not([disabled])')) === 0);

  console.log('\n[10] Avanço de rodada e fim da partida');
  check('próxima rodada liberada (todos responderam)', await host.page.$eval('.host-controls .btn-primary', b => !b.disabled));
  await clickText(host.page, 'PRÓXIMA RODADA');
  await waitFor(async () => (await text(host.page, '.kicker span'))?.includes('02 /'), 'rodada 2 no criador');
  await waitFor(async () => (await text(guest.page, '.kicker span'))?.includes('02 /'), 'rodada 2 no convidado');
  const q2 = await text(guest.page, '.q-head h1');
  check('rodada 2 chega ao mesmo tempo nos dois', q2 === (await text(host.page, '.q-head h1')));
  check('convidado volta a poder responder na nova rodada', (await count(guest.page, '.answer:not([disabled])')) === 4);
  check('criador não consegue pular a rodada com respostas pendentes', await host.page.$eval('.host-controls .btn-primary', b => b.disabled));

  await clickText(host.page, 'ENCERRAR PARTIDA AGORA');
  await waitFor(() => host.page.$('.results'), 'ranking do criador');
  await waitFor(() => guest.page.$('.results'), 'ranking do convidado');
  check('todos veem o ranking final', (await count(host.page, '.board li')) === 2 && (await count(guest.page, '.board li')) === 2);
  check('ranking igual nos dois aparelhos', (await text(host.page, '.board')) === (await text(guest.page, '.board')));
  check('mostra a posição do próprio jogador', /VOCÊ TERMINOU EM/.test(await text(guest.page, '.my-place')));
  await waitFor(async () => /ENCERRADA/.test((await text(ops, '.situation')) || ''), 'painel mostra fim');
  check('painel do operador mostra partida encerrada', true);
  await shot(host.page, '08-resultados-mobile');
  await shot(ops, '09-painel-final-desktop');

  console.log('\n[11] Telas restantes e responsividade');
  const desk = await phone('DESKTOP', {width: 1440, height: 900, isMobile: false});
  await desk.page.goto(base, {waitUntil: 'networkidle0'});
  await shot(desk.page, '10-inicio-desktop');
  await desk.page.goto(`${base}#/diag`, {waitUntil: 'networkidle0'});
  await waitFor(async () => (await count(desk.page, '.checks li.run')) === 0, 'diagnóstico concluído', 20000);
  const bad = await desk.page.$$eval('.checks li.fail', els => els.map(e => e.textContent));
  check('diagnóstico: nenhuma verificação falhou', bad.length === 0, JSON.stringify(bad));
  check('diagnóstico conclui "tudo certo"', (await text(desk.page, '.alert')).includes('Tudo certo'));
  await shot(desk.page, '11-diagnostico-desktop');
  await desk.ctx.close();

  console.log('\n[12] Responsividade: sem rolagem horizontal em 360px (celular pequeno)');
  const small = await phone('PEQUENO', {width: 360, height: 740, isMobile: true, hasTouch: true});
  const overflowOf = page => page.evaluate(() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth}));
  async function noOverflow(label) {
    const {sw, cw} = await overflowOf(small.page);
    check(`${label}: sem rolagem horizontal`, sw <= cw + 1, `${sw}px > ${cw}px`);
  }
  await small.page.goto(base, {waitUntil: 'networkidle0'});
  await noOverflow('início');
  await small.page.type('#nick', 'MOBILE');
  await clickText(small.page, 'CRIAR SALA');
  await waitFor(() => small.page.$('.lobby'), 'sala (360px)');
  await noOverflow('sala de espera');
  await shot(small.page, '12-sala-360px');
  const smallCode = await text(small.page, '.room-chip b');
  await clickText(small.page, 'INICIAR PARTIDA');
  await waitFor(() => small.page.$('.play'), 'rodada (360px)');
  await noOverflow('rodada');
  await shot(small.page, '13-rodada-360px');
  await clickText(small.page, 'ENCERRAR PARTIDA AGORA');
  await waitFor(() => small.page.$('.results'), 'resultados (360px)');
  await noOverflow('resultados');
  const op360 = await small.ctx.newPage();
  await op360.setViewport({width: 360, height: 740, isMobile: true, hasTouch: true});
  await op360.goto(`${base}#/operator/${smallCode}`, {waitUntil: 'networkidle0'});
  await waitFor(() => op360.$('.kpis'), 'painel (360px)');
  const {sw: opSw, cw: opCw} = await overflowOf(op360);
  check('painel do operador: página sem rolagem horizontal (a tabela rola dentro do próprio cartão)', opSw <= opCw + 1, `${opSw}px > ${opCw}px`);
  await shot(op360, '14-painel-360px');
  await small.ctx.close();
} catch (e) {
  failures.push(`EXCEÇÃO: ${e.message}`);
  console.log(`\n  FAIL exceção: ${e.message}`);
  try { await shot(host.page, 'erro-criador'); await shot(guest.page, 'erro-convidado'); } catch {}
}

console.log('\n[13] Erros de navegador durante todo o cenário');
const errs = allErrors();
check('nenhum erro de JavaScript / rede nos dois aparelhos', errs.length === 0, '\n' + errs.join('\n'));

const mockCalls = api.calls.reduce((m, c) => ((m[c] = (m[c] || 0) + 1), m), {});
console.log('\nChamadas RPC feitas pelo navegador:', JSON.stringify(mockCalls));
await browser.close();
web.close();
api.server.close();
console.log(`\n${passed} verificações ok, ${failures.length} falha(s).`);
if (failures.length) {
  console.log(failures.map(f => ` - ${f}`).join('\n'));
  process.exit(1);
}
