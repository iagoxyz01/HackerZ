import {useState} from 'react';
import {Mark} from '../components/Logo';

export default function Home({game}) {
  const [nickname, setNickname] = useState('');
  const [code, setCode] = useState('');

  const submit = (event) => {
    event.preventDefault();
    if (game.busy) return;
    if (code.trim().length === 6) game.joinRoom(nickname, code);
    else game.createRoom(nickname);
  };

  return (
    <main className="landing">
      <section className="hero">
        <div className="eyebrow"><span className="pip" /> PROTOCOLO DE SOBREVIVÊNCIA DIGITAL <span className="rule" /></div>
        <h1>
          <span className="h1-top">ENTRE NO</span>
          <em className="gothic">Submundo.</em>
        </h1>
        <p className="lead">
          Quiz multiplayer sobre redes sociais, privacidade e saúde digital. Responda rápido, blinde seu perfil
          e derrube a concorrência — tudo fictício, aprendizado de verdade.
        </p>
        <ul className="hero-tags">
          <li><b>01</b> PENSE RÁPIDO</li>
          <li><b>02</b> DEFENDA-SE</li>
          <li><b>03</b> DOMINE O RANKING</li>
        </ul>
        <Mark size={420} className="hero-sigil" />
      </section>

      <form className="access panel" onSubmit={submit}>
        <div className="kicker">/// TERMINAL DE ACESSO</div>
        <h2>ESCOLHA SUA<br />OPERAÇÃO.</h2>

        <label htmlFor="nick">CODINOME</label>
        <input id="nick" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={18}
          placeholder="ex.: NIGHTFALL" autoComplete="off" autoCapitalize="characters" />

        <button type="button" className="btn btn-primary" disabled={game.busy} onClick={() => game.createRoom(nickname)}>
          {game.busy ? 'CONECTANDO…' : '＋ CRIAR SALA'}
        </button>
        <p className="hint">O criador da sala também joga e responde às perguntas.</p>

        <div className="separator"><span>OU ENTRE EM UMA SALA</span></div>

        <label htmlFor="code">CÓDIGO DA SALA</label>
        <input id="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          maxLength={6} placeholder="6 CARACTERES" autoComplete="off" autoCapitalize="characters" className="code-input" />
        <button type="button" className="btn btn-outline" disabled={game.busy} onClick={() => game.joinRoom(nickname, code)}>
          ENTRAR NA SALA <span>↗</span>
        </button>

        <div className="card-foot"><span>ATÉ 30 JOGADORES</span><span>4 NÍVEIS DE DIFICULDADE</span></div>
      </form>
    </main>
  );
}
