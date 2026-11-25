import {useState} from 'react';
import {Footer, Topbar} from '../components/Shell';
import {useOperator} from '../lib/useOperator';
import {hostStore} from '../lib/storage';
import {STATE_LABEL, clock, describeEvent, pad2, relTime} from '../lib/utils';

function extractKey(text) {
  const fromUrl = String(text).match(/[?&]k=([a-f0-9]{40,})/i);
  if (fromUrl) return fromUrl[1];
  const raw = String(text).trim();
  return /^[a-f0-9]{40,}$/i.test(raw) ? raw : '';
}

function Kpi({label, value, sub, tone}) {
  return (
    <div className={`kpi ${tone || ''}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      {sub && <span>{sub}</span>}
    </div>
  );
}

function situation(data, secondsLeft) {
  const {room, totals} = data;
  if (room.state === 'finished') return {text: 'PARTIDA ENCERRADA — RANKING FINAL DISPONÍVEL', tone: 'done'};
  if (room.state === 'lobby') {
    return {
      text: totals.players <= 1 ? 'AGUARDANDO JOGADORES ENTRAREM NA SALA' : `${totals.players} JOGADORES NA SALA — AGUARDANDO O INÍCIO`,
      tone: 'idle'
    };
  }
  if (secondsLeft > 0) return {text: `RODADA ${room.round_no}/${room.rounds} EM ANDAMENTO — ${totals.answered}/${totals.players} RESPONDERAM`, tone: 'live'};
  return {text: `RODADA ${room.round_no}/${room.rounds} ENCERRADA — AGUARDANDO O CRIADOR AVANÇAR`, tone: 'wait'};
}

export default function Operator({code, keyParam}) {
  const [token, setToken] = useState(() => {
    if (keyParam) {
      hostStore.set(code, {token: keyParam, nickname: 'operador'});
      window.history.replaceState(null, '', `#/operator/${code}`);
      return keyParam;
    }
    return hostStore.get(code)?.token || '';
  });
  const [paste, setPaste] = useState('');
  const {data, error, link, secondsLeft, updatedAt} = useOperator(code, token);

  if (!token) {
    const submit = (e) => {
      e.preventDefault();
      const key = extractKey(paste);
      if (!key) return;
      hostStore.set(code, {token: key, nickname: 'operador'});
      setToken(key);
    };
    return (
      <div className="app">
        <Topbar />
        <main className="blocker panel">
          <div className="kicker">/// PAINEL DO OPERADOR · SALA {code}</div>
          <h1>CHAVE DE OPERADOR<br /><em>NECESSÁRIA.</em></h1>
          <p className="lead">Este navegador não tem a chave desta sala. Abra o painel pelo botão “Painel do operador” na tela do criador, ou cole aqui o link copiado de lá.</p>
          <form onSubmit={submit} className="paste-form">
            <input value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Cole o link do painel ou a chave" autoComplete="off" />
            <button className="btn btn-primary" disabled={!extractKey(paste)}>ABRIR PAINEL</button>
          </form>
        </main>
        <Footer />
      </div>
    );
  }

  const fatal = /Credencial de operador inválida/.test(error);
  const now = Date.now();
  const sit = data ? situation(data, secondsLeft) : null;
  const topScore = data ? Math.max(1, ...data.players.map((p) => p.score || 0)) : 1;
  const duels = data ? data.events.filter((e) => e.kind === 'attack' || e.kind === 'defense').slice(0, 12) : [];

  return (
    <div className="app operator">
      <Topbar link={link}>
        <span className="room-tag">SALA <b>{code}</b></span>
      </Topbar>

      <main className="ops">
        <div className="ops-head">
          <div>
            <div className="kicker flat">/// PAINEL DO OPERADOR · MONITORAMENTO</div>
            <h1>CENTRO DE <em className="gothic">Vigilância.</em></h1>
          </div>
          <span className="readonly-tag">SOMENTE LEITURA</span>
        </div>

        {fatal && (
          <div className="alert danger">
            {error} Abra o painel de novo pela tela do criador.
            <button className="btn-mini" onClick={() => { hostStore.clear(code); setToken(''); }}>TROCAR CHAVE</button>
          </div>
        )}
        {!fatal && error && <div className="alert warn">{error}</div>}
        {!data && !error && <div className="alert">Conectando ao servidor…</div>}

        {data && (
          <>
            <div className={`situation ${sit.tone}`}><i />{sit.text}<small>{STATE_LABEL[data.room.state]}</small></div>

            <div className="kpis">
              <Kpi label="JOGADORES CONECTADOS" value={`${data.totals.connected}/${data.totals.players}`} sub="online / total" tone={data.totals.connected < data.totals.players ? 'warn' : 'ok'} />
              <Kpi label="RODADA ATUAL" value={`${pad2(data.room.round_no)}/${pad2(data.room.rounds)}`} sub={`${data.room.seconds}s por pergunta`} />
              <Kpi label="TEMPO DA RODADA" value={data.room.state === 'playing' ? `${pad2(secondsLeft)}s` : '—'} sub={data.room.state === 'playing' ? (secondsLeft > 0 ? 'em contagem' : 'encerrada') : 'sem rodada ativa'} tone={data.room.state === 'playing' && secondsLeft > 0 && secondsLeft <= 5 ? 'warn' : ''} />
              <Kpi label="RESPOSTAS" value={`${data.totals.answered}/${data.totals.players}`} sub="nesta rodada" />
              <Kpi label="ATAQUES" value={data.attacks.total} sub={`${data.attacks.blocked} bloqueados`} tone="danger" />
              <Kpi label="PONTOS PERDIDOS" value={data.attacks.points_lost} sub="em ataques bem-sucedidos" tone="danger" />
              <Kpi label="DEFESAS ATIVAS" value={data.totals.shields} sub="camadas de blindagem" tone="ok" />
            </div>

            <div className="ops-grid">
              <section className="panel ops-ranking">
                <div className="kicker">/// RANKING EM TEMPO REAL <span>{data.players.length} JOGADORES</span></div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>#</th><th>JOGADOR</th><th>PONTOS</th><th>CRÉD.</th><th>ESCUDOS</th><th title="Ataques lançados">ATK</th><th title="Ataques recebidos">RECEB.</th><th title="Ataques bloqueados">BLOQ.</th><th title="Pontos perdidos em ataques">PERDEU</th><th>STATUS</th></tr>
                    </thead>
                    <tbody>
                      {data.players.map((p, i) => (
                        <tr key={p.id}>
                          <td className="idx">{pad2(i + 1)}</td>
                          <td className="name"><span className={`dot ${p.connected ? 'on' : 'off'}`} />{p.nickname}
                            <i className="bar"><b style={{width: `${((p.score || 0) / topScore) * 100}%`}} /></i></td>
                          <td className="num strong">{p.score}</td>
                          <td className="num">{p.credits}</td>
                          <td className="num">{p.shield}</td>
                          <td className="num">{p.attacks_made}</td>
                          <td className="num">{p.attacks_received}</td>
                          <td className="num">{p.blocked}</td>
                          <td className={`num ${p.points_lost > 0 ? 'neg' : ''}`}>{p.points_lost > 0 ? `−${p.points_lost}` : 0}</td>
                          <td className="status">
                            {!p.connected ? <span className="tag muted">OFFLINE</span>
                              : data.room.state === 'playing' ? (p.answered ? <span className="tag ok">RESPONDEU</span> : <span className="tag warn">PENSANDO</span>)
                                : <span className="tag info">ONLINE</span>}
                          </td>
                        </tr>
                      ))}
                      {data.players.length === 0 && <tr><td colSpan="10" className="empty">Nenhum jogador ainda.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="panel duels">
                <div className="kicker">/// QUEM ATACA QUEM</div>
                <ul>
                  {duels.length === 0 && <li className="empty">Nenhum ataque registrado.</li>}
                  {duels.map((e) => (
                    <li key={e.id} className={e.kind === 'attack' ? 'danger' : 'warn'}>
                      <b>{e.actor_name}</b><span className="arrow">{e.kind === 'attack' ? '⟶' : '⟶⬡'}</span><b>{e.target_name}</b>
                      <em>{e.kind === 'attack' ? `−${e.points} pts` : 'BLOQUEADO'}</em>
                      <small>R{e.round_no}</small>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="panel events">
                <div className="kicker">/// HISTÓRICO DE EVENTOS <span>ÚLTIMOS {data.events.length}</span></div>
                <ul>
                  {data.events.length === 0 && <li className="empty">Sem eventos.</li>}
                  {data.events.map((e) => {
                    const d = describeEvent(e);
                    return (
                      <li key={e.id} className={d.tone}>
                        <time title={clock(e.created_at)}>{clock(e.created_at)}</time>
                        <b>{d.tag}</b>
                        <span>{d.text}</span>
                        <small>{relTime(e.created_at, now)}</small>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>

            <p className="refresh-note">Atualiza a cada ~1,5 s · última leitura {updatedAt ? relTime(new Date(updatedAt).toISOString(), now) : '—'} atrás</p>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
