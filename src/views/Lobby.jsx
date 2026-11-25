import {operatorUrl, pad2} from '../lib/utils';

export default function Lobby({game}) {
  const {room, roster, me, isHost, hostToken, settings, setSettings, info, busy, advance, notify} = game;

  const copy = async (text, okMessage) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(okMessage, 'ok');
    } catch {
      notify(`Copie manualmente: ${text}`, 'warn');
    }
  };

  const shownRounds = info?.settings?.rounds ?? settings.rounds;
  const shownSeconds = info?.settings?.seconds ?? settings.seconds;

  return (
    <main className="lobby">
      <section className="panel lobby-main">
        <div className="kicker">/// SALA DE OPERAÇÕES <span>CANAL SEGURO</span></div>

        <div className="room-head">
          <div>
            <h1>{isHost ? 'CENTRAL DE COMANDO' : 'MODO DE ESPERA'}</h1>
            <p>{isHost
              ? 'Compartilhe o código, aguarde os jogadores e inicie quando todos estiverem prontos. Você também joga.'
              : 'Você está dentro. Aguarde o criador da sala iniciar a partida.'}</p>
          </div>
          <button className="room-chip" onClick={() => copy(room, 'Código copiado.')} aria-label="Copiar código da sala">
            <small>CÓDIGO DA SALA</small>
            <b>{room}</b>
            <span>TOQUE PARA COPIAR</span>
          </button>
        </div>

        <div className="metrics">
          <div><strong>{pad2(roster.length)}</strong><small>JOGADORES</small></div>
          <div><strong>{shownRounds}</strong><small>RODADAS</small></div>
          <div><strong>{shownSeconds}<i>s</i></strong><small>POR PERGUNTA</small></div>
        </div>

        <div className="list-head"><h3>JOGADORES NA SALA</h3><span>{roster.length} / 30</span></div>
        <ul className="roster">
          {roster.length === 0 && <li className="empty">Sincronizando…</li>}
          {roster.map((p, i) => (
            <li key={p.id} className={p.id === me?.id ? 'me' : ''}>
              <b>{pad2(i + 1)}</b>
              <span className="dot" />
              <strong>{p.nickname}</strong>
              {p.id === me?.id && <em>VOCÊ</em>}
            </li>
          ))}
        </ul>

        {isHost ? (
          <div className="host-box">
            <div className="list-head"><h3>PARÂMETROS DA PARTIDA</h3><span>SOMENTE CRIADOR</span></div>
            <label>RODADAS <b>{settings.rounds}</b>
              <input type="range" min="5" max="20" value={settings.rounds}
                onChange={(e) => setSettings((v) => ({...v, rounds: Number(e.target.value)}))} />
            </label>
            <label>TEMPO POR PERGUNTA <b>{settings.seconds}s</b>
              <input type="range" min="10" max="60" step="5" value={settings.seconds}
                onChange={(e) => setSettings((v) => ({...v, seconds: Number(e.target.value)}))} />
            </label>
            <button className="btn btn-primary" disabled={busy} onClick={advance}>▶ INICIAR PARTIDA</button>
            <div className="row">
              <button className="btn btn-outline" onClick={() => window.open(operatorUrl(room), '_blank', 'noopener')}>
                PAINEL DO OPERADOR <span>↗</span>
              </button>
              <button className="btn btn-ghost" onClick={() => copy(operatorUrl(room, hostToken), 'Link do painel copiado. Ele contém a chave de operador: não compartilhe com jogadores.')}>
                COPIAR LINK DO PAINEL
              </button>
            </div>
          </div>
        ) : (
          <p className="waiting"><i /><i /><i /> AGUARDANDO O CRIADOR INICIAR</p>
        )}
      </section>

      <aside className="side">
        <section className="panel rules">
          <div className="kicker">/// MANUAL DE CAMPO</div>
          <ol>
            <li><b>RESPONDA</b> antes do tempo acabar. Acertos rendem pontos e créditos.</li>
            <li><b>DEFENDA-SE</b>: 50 créditos ativam uma blindagem que bloqueia um ataque.</li>
            <li><b>ATAQUE</b>: 50 créditos tiram até 75 pontos de um rival. Um ataque por rodada.</li>
            <li><b>COMBO</b>: sequências de acertos sobem seu <em>style rank</em>, de D até SSS.</li>
          </ol>
          <p className="fine">Tudo é uma mecânica fictícia do jogo. Ninguém é invadido de verdade.</p>
        </section>
        <section className="quote">
          <span>NOTA DE CAMPO // 001</span>
          <p>“Nem todo link merece um clique. Nem toda notificação merece sua atenção.”</p>
        </section>
      </aside>
    </main>
  );
}
