import {pad2} from '../lib/utils';

export default function Results({game}) {
  const {roster, me, mine, leaveRoom} = game;
  const myIndex = roster.findIndex((p) => p.id === me?.id);
  const podium = [roster[1], roster[0], roster[2]].map((p, i) => ({p, place: [2, 1, 3][i]}));

  return (
    <main className="results panel">
      <div className="kicker">/// OPERAÇÃO CONCLUÍDA</div>
      <div className="results-title">
        <span>PLACAR FINAL</span>
        <h1>OS ÚLTIMOS<br /><em className="gothic">Sobreviventes.</em></h1>
        {myIndex >= 0 && (
          <p className="my-place">VOCÊ TERMINOU EM <b>{myIndex + 1}º</b> COM <b>{mine?.score ?? roster[myIndex].score} PONTOS</b></p>
        )}
      </div>

      {roster.length >= 2 && (
        <div className="podium">
          {podium.map(({p, place}) => p && (
            <div key={p.id} className={`step place-${place}${p.id === me?.id ? ' me' : ''}`}>
              <small>{place}º</small>
              <strong>{p.nickname}</strong>
              <span>{p.score} pts</span>
            </div>
          ))}
        </div>
      )}

      <ol className="board">
        {roster.map((p, i) => (
          <li key={p.id} className={p.id === me?.id ? 'me' : ''}>
            <b>{pad2(i + 1)}</b><span>{p.nickname}</span><strong>{p.score} XP</strong>
          </li>
        ))}
      </ol>

      <button className="btn btn-outline" onClick={leaveRoom}>VOLTAR AO INÍCIO <span>↗</span></button>
    </main>
  );
}
