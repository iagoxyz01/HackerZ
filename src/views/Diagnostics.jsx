import {useCallback, useEffect, useState} from 'react';
import {Footer, Topbar} from '../components/Shell';
import {PROBLEM_TEXT, configProblem, db, envSummary} from '../lib/db';

const MISSING_FN = /could not find the function|PGRST202|schema cache/i;
const MISSING_REL = /does not exist|PGRST205|schema cache/i;

// Chama uma RPC com argumentos inválidos de propósito: o erro de validação esperado prova que a função existe
// no banco, sem criar nenhum dado.
async function expectRpcError(fn, args, pattern, missingHint) {
  const {error} = await db.rpc(fn, args);
  if (!error) return {status: 'warn', detail: 'Resposta inesperada (sem erro de validação).'};
  const text = `${error.message} ${error.code || ''}`;
  if (pattern.test(error.message)) return {status: 'ok', detail: 'Função publicada e validando.'};
  if (MISSING_FN.test(text)) return {status: 'fail', detail: missingHint};
  return {status: 'warn', detail: error.message};
}

async function expectView(name, columns) {
  const t0 = performance.now();
  const {error} = await db.from(name).select(columns).eq(name === 'room_feed' ? 'room_code' : 'code', 'ZZZZZZ').limit(1);
  const ms = Math.round(performance.now() - t0);
  if (!error) return {status: 'ok', detail: `Leitura pública OK (${ms} ms).`};
  if (MISSING_REL.test(`${error.message} ${error.code || ''}`)) return {status: 'fail', detail: `A view ${name} não existe. Execute as migrações SQL.`};
  return {status: 'fail', detail: error.message};
}

function buildChecks() {
  const {urlInfo, keyInfo, keyPresent, url} = envSummary;
  const checks = [
    {
      id: 'env-url', label: 'VITE_SUPABASE_URL no build',
      run: async () => (!url ? {status: 'fail', detail: PROBLEM_TEXT['missing-url']}
        : urlInfo.ok ? {status: 'ok', detail: urlInfo.host} : {status: 'fail', detail: urlInfo.reason})
    },
    {
      id: 'env-key', label: 'VITE_SUPABASE_ANON_KEY no build',
      run: async () => {
        if (!keyPresent) return {status: 'fail', detail: PROBLEM_TEXT['missing-key']};
        if (!keyInfo.safe && ['secret', 'jwt'].includes(keyInfo.kind)) return {status: 'fail', detail: PROBLEM_TEXT['unsafe-key']};
        return {status: 'ok', detail: keyInfo.kind === 'publishable' ? 'Chave publishable (segura para o navegador).' : `Chave pública, papel: ${keyInfo.role || 'desconhecido'}.`};
      }
    }
  ];
  if (!db) {
    checks.push({id: 'blocked', label: 'Testes de rede', run: async () => ({status: 'fail', detail: `Ignorados: ${PROBLEM_TEXT[configProblem] || 'configuração inválida'}`})});
    return checks;
  }
  return checks.concat([
    {id: 'rest', label: 'API REST e view room_state', run: () => expectView('room_state', 'code,server_now')},
    {id: 'feed', label: 'View room_feed (migração 002)', run: () => expectView('room_feed', 'id')},
    {
      id: 'create', label: 'RPC hackerz_create_room (schema.sql)',
      run: () => expectRpcError('hackerz_create_room', {p_code: 'x', p_host_token: 'x', p_settings: {}}, /Código de sala inválido/, 'Execute supabase/schema.sql no SQL Editor.')
    },
    {
      id: 'sync', label: 'RPC hackerz_sync (migração 002)',
      run: () => expectRpcError('hackerz_sync', {p_player_id: '00000000-0000-0000-0000-000000000000', p_session_token: 'x'}, /Sessão de jogador inválida/, 'Execute supabase/002_operator_events.sql no SQL Editor.')
    },
    {
      id: 'attack', label: 'RPC hackerz_attack (migração 002)',
      run: () => expectRpcError('hackerz_attack', {p_player_id: '00000000-0000-0000-0000-000000000000', p_session_token: 'x', p_target_id: '00000000-0000-0000-0000-000000000001'}, /Sessão de jogador inválida|Alvo inválido/, 'Execute supabase/002_operator_events.sql no SQL Editor.')
    },
    {
      id: 'operator', label: 'RPC hackerz_operator_dashboard (migração 002)',
      run: () => expectRpcError('hackerz_operator_dashboard', {p_code: 'ZZZZZZ', p_host_token: 'x'}, /Operador não autorizado/, 'Execute supabase/002_operator_events.sql no SQL Editor.')
    },
    {
      id: 'tables', label: 'Tabelas protegidas (anon não lê rooms)',
      run: async () => {
        const {error} = await db.from('rooms').select('code').limit(1);
        return error && /permission denied|42501/i.test(`${error.message} ${error.code || ''}`)
          ? {status: 'ok', detail: 'Acesso direto bloqueado, como esperado.'}
          : {status: 'warn', detail: 'O visitante consegue ler a tabela rooms diretamente. Reexecute supabase/schema.sql.'};
      }
    }
  ]);
}

const ICON = {ok: '✓', fail: '✕', warn: '!', run: '…'};

export default function Diagnostics() {
  const [rows, setRows] = useState([]);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    const checks = buildChecks();
    setRows(checks.map((c) => ({id: c.id, label: c.label, status: 'run', detail: 'Verificando…'})));
    for (const check of checks) {
      let outcome;
      try {
        outcome = await check.run();
      } catch (e) {
        outcome = {status: 'fail', detail: e.message || String(e)};
      }
      setRows((prev) => prev.map((r) => (r.id === check.id ? {...r, ...outcome} : r)));
    }
    setRunning(false);
  }, []);

  useEffect(() => { run(); }, [run]);

  const failed = rows.filter((r) => r.status === 'fail').length;
  const warned = rows.filter((r) => r.status === 'warn').length;
  const done = rows.length > 0 && !running;

  return (
    <div className="app">
      <Topbar />
      <main className="diag panel">
        <div className="kicker">/// DIAGNÓSTICO DO SERVIDOR <span>MODO {envSummary.mode.toUpperCase()}</span></div>
        <h1>SAÚDE DA <em className="gothic">Conexão.</em></h1>
        <p className="lead">Verifica o que este site publicado realmente enxerga: variáveis do build, API, funções e permissões do Supabase. Nenhum dado é criado nem alterado.</p>

        {done && (
          <div className={`alert ${failed ? 'danger' : warned ? 'warn' : 'ok'}`}>
            {failed ? `${failed} problema(s) impedem o multiplayer. Corrija de cima para baixo.` : warned ? 'Funcionando, com avisos.' : 'Tudo certo: o site está conectado e o banco está pronto.'}
          </div>
        )}

        <ul className="checks">
          {rows.map((r) => (
            <li key={r.id} className={r.status}>
              <b aria-hidden="true">{ICON[r.status]}</b>
              <div><strong>{r.label}</strong><span>{r.detail}</span></div>
            </li>
          ))}
        </ul>

        <div className="row">
          <button className="btn btn-outline" onClick={run} disabled={running}>{running ? 'VERIFICANDO…' : 'VERIFICAR NOVAMENTE'}</button>
          <a className="btn btn-ghost" href="#/">VOLTAR AO JOGO</a>
        </div>
        <p className="fine">Dica: as variáveis VITE_* são lidas na compilação. Alterou algo na Vercel? Faça Redeploy e recarregue esta página.</p>
      </main>
      <Footer />
    </div>
  );
}
