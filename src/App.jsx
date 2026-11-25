import {useEffect, useState} from 'react';
import {ConfigBlocker, Footer, Toast, Topbar} from './components/Shell';
import {isConfigured} from './lib/db';
import {useGame} from './lib/useGame';
import {operatorUrl} from './lib/utils';
import Diagnostics from './views/Diagnostics';
import Home from './views/Home';
import Lobby from './views/Lobby';
import Operator from './views/Operator';
import Play from './views/Play';
import Results from './views/Results';

// Rotas por hash (funcionam na Vercel sem regras de reescrita):
//   #/                      jogo (jogador, inclusive o criador da sala)
//   #/operator/CODIGO       painel de monitoramento do operador
//   #/diag                  diagnóstico da conexão
function parseRoute(hash) {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'operator' && parts[1]) {
    return {name: 'operator', code: parts[1].toUpperCase(), key: new URLSearchParams(query).get('k') || ''};
  }
  if (parts[0] === 'diag') return {name: 'diag'};
  return {name: 'game'};
}

function useRoute() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return parseRoute(hash);
}

function GameApp() {
  const game = useGame();
  const {phase, room, isHost, link, notice, notify} = game;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room);
      notify('Código copiado.', 'ok');
    } catch {
      notify(`Código da sala: ${room}`, 'warn');
    }
  };
  const exit = () => {
    if (window.confirm('Sair da sala? Você perderá o acesso a esta partida neste navegador.')) game.leaveRoom();
  };

  if (!isConfigured) {
    return (
      <div className="app">
        <Topbar link="retrying" />
        <ConfigBlocker />
        <Footer />
      </div>
    );
  }

  return (
    <div className="app">
      <Topbar link={link}>
        {room && <button className="chip-btn" onClick={copyCode}>SALA // <b>{room}</b></button>}
        {room && isHost && (
          <button className="chip-btn" onClick={() => window.open(operatorUrl(room), '_blank', 'noopener')}>PAINEL ↗</button>
        )}
        {room && <button className="chip-btn quiet" onClick={exit}>SAIR</button>}
      </Topbar>
      <Toast notice={notice} onClose={() => notify('')} />
      {phase === 'home' && <Home game={game} />}
      {phase === 'loading' && <main className="loading panel"><div className="kicker">/// CONEXÃO</div><p>SINCRONIZANDO COM O SERVIDOR…</p></main>}
      {phase === 'lobby' && <Lobby game={game} />}
      {phase === 'play' && <Play game={game} />}
      {phase === 'results' && <Results game={game} />}
      <Footer />
    </div>
  );
}

export default function App() {
  const route = useRoute();
  if (route.name === 'diag') return <Diagnostics />;
  if (route.name === 'operator') return <Operator key={route.code} code={route.code} keyParam={route.key} />;
  return <GameApp />;
}
