import {LEVELS} from '../questions';
import {RANKS, RANK_NAMES, describeEvent, pad2, rankIndex} from '../lib/utils';

const LETTERS = ['A', 'B', 'C', 'D'];
const ATTACK_COST = 50;

function Countdown({left, total}) {
  const radius = 34;
  const length = 2 * Math.PI * radius;
  const ratio = total > 0 ? Math.min(1, left / total) : 0;
  const urgent = left <= 5 && left > 0;
  return (
    <div className={`countdown${urgent ? ' urgent' : ''}${left === 0 ? ' over' : ''}`} role="timer" aria-label={`${left} segundos`}>
      <svg viewBox="0 0 84 84" aria-hidden="true">
        <circle cx="42" cy="42" r={radius} className="ring-bg" />
        <circle cx="42" cy="42" r={radius} className="ring" strokeDasharray={length} strokeDashoffset={length * (1 - ratio)} transform="rotate(-90 42 42)" />
      </svg>
      <strong>{pad2(left)}</strong>
    </div>
  );
}

function Feedback({answered, timeUp, result, mine, myPick}) {
  if (!answered && timeUp) {
    return <div className="feedback miss"><b>TEMPO ESGOTADO</b><span>Aguarde a próxima rodada.</span></div>;
  }
  if (!answered) return null;
  const correct = result ? result.correct : mine?.answer_correct;
  const explanation = result?.explanation;
  if (correct === true) {
    return <div className="feedback hit"><b>ACERTO{result ? ` +${result.points} XP` : ''}</b>{explanation && <span>{explanation}</span>}</div>;
  }
  if (correct === false) {
    return <div className="feedback miss"><b>RESPOSTA INCORRETA</b>{explanation && <span>{explanation}</span>}</div>;
  }
  return <div className="feedback"><b>RESPOSTA REGISTRADA</b>{myPick === null && <span>Aguardando o servidor confirmar…</span>}</div>;
}

export default function Play({game}) {
  const {info, round, totalRounds, secondsLeft, totalSeconds, answered, myPick, myResult, mine, roster, feed, me, isHost, busy} = game;
  const q = info.current_question;
  const timeUp = secondsLeft === 0;
  const locked = answered || timeUp || busy;
  const answeredCount = Number(info.answered_count) || 0;
  const playerCount = Number(info.player_count) || roster.length;
  const canAdvance = timeUp || answeredCount >= playerCount;
  const isLast = round >= totalRounds;

  const credits = mine?.credits ?? 0;
  const rank = rankIndex(mine?.streak);
  const attackBlock = mine?.attacked_this_round
    ? 'Você já atacou nesta rodada.'
    : timeUp ? 'A rodada terminou: ataques bloqueados.'
      : credits < ATTACK_COST ? `Faltam ${ATTACK_COST - credits} créditos para atacar.` : '';
  const others = roster.filter((p) => p.id !== me?.id);
  const topScore = Math.max(1, ...roster.map((p) => p.score || 0));
  const combat = feed.filter((e) => ['attack', 'defense', 'shield'].includes(e.kind)).slice(0, 8);
  const level = LEVELS.find((l) => l.id === q?.level);

  return (
    <main className="play">
      <section className="panel question">
        <div className="kicker">/// DESAFIO AO VIVO <span>RODADA {pad2(round)} / {pad2(totalRounds)}</span></div>

        <div className="q-head">
          <div>
            <span className="difficulty">{level?.label || 'DESAFIO'} · {q?.points} XP</span>
            <h1>{q?.prompt}</h1>
          </div>
          <Countdown left={secondsLeft} total={totalSeconds} />
        </div>

        <div className="answers">
          {q?.options.map((option, i) => {
            const picked = myPick === i;
            const state = picked && (myResult ? (myResult.correct ? 'hit' : 'miss') : mine?.answer_correct === true ? 'hit' : mine?.answer_correct === false ? 'miss' : 'picked');
            return (
              <button key={i} disabled={locked} className={`answer ${picked ? state || 'picked' : ''}`} onClick={() => game.submitAnswer(i)}>
                <b>{LETTERS[i]}</b><span>{option}</span>
              </button>
            );
          })}
        </div>

        <Feedback answered={answered} timeUp={timeUp} result={myResult} mine={mine} myPick={myPick} />

        <div className="progress-line">
          <span>{answeredCount} / {playerCount} JÁ RESPONDERAM</span>
          <i><b style={{width: `${playerCount ? (answeredCount / playerCount) * 100 : 0}%`}} /></i>
        </div>

        {isHost && (
          <div className="host-controls">
            <p>Você é o criador e também joga. {canAdvance ? 'Todos prontos ou tempo esgotado.' : 'A próxima rodada libera quando todos responderem ou o tempo acabar.'}</p>
            <button className="btn btn-primary" disabled={busy || !canAdvance} onClick={game.advance}>
              {isLast ? 'ENCERRAR E VER O RANKING →' : 'PRÓXIMA RODADA →'}
            </button>
            {!isLast && <button className="btn btn-ghost" disabled={busy} onClick={game.finishMatch}>ENCERRAR PARTIDA AGORA</button>}
          </div>
        )}
      </section>

      <aside className="side">
        <section className="panel hud">
          <div className="kicker">/// STATUS DO OPERADOR <span>{me?.nickname}</span></div>
          <div className="rank-card" data-rank={RANKS[rank]}>
            <div className="rank-letter">{RANKS[rank]}</div>
            <div><small>STYLE RANK</small><b>{RANK_NAMES[rank]}</b><span>Sequência: {mine?.streak ?? 0}</span></div>
          </div>
          <div className="stats">
            <div><strong>{mine?.score ?? 0}</strong><small>PONTOS</small></div>
            <div><strong>{credits}</strong><small>CRÉDITOS</small></div>
            <div><strong>{mine?.shield ?? 0}</strong><small>BLINDAGENS</small></div>
          </div>
          <button className="btn btn-outline" disabled={busy || credits < 50} onClick={game.activateShield}>
            ⬡ ATIVAR BLINDAGEM <span>50 CR</span>
          </button>
        </section>

        <section className="panel attack">
          <div className="kicker">/// ATAQUE <span>{ATTACK_COST} CR · 1 POR RODADA</span></div>
          {attackBlock && <p className="attack-note">{attackBlock}</p>}
          <ul>
            {others.length === 0 && <li className="empty">Nenhum rival na sala ainda.</li>}
            {others.map((p) => (
              <li key={p.id}>
                <strong>{p.nickname}</strong>
                <small>{p.score} pts{p.shield > 0 ? ` · ⬡${p.shield}` : ''}</small>
                <button className="btn-mini" disabled={busy || Boolean(attackBlock)} onClick={() => game.attack(p.id)}>ATACAR</button>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel ranking">
          <div className="kicker">/// RANKING AO VIVO</div>
          <ol>
            {roster.slice(0, 6).map((p, i) => (
              <li key={p.id} className={p.id === me?.id ? 'me' : ''}>
                <b>{pad2(i + 1)}</b><span>{p.nickname}</span><strong>{p.score}</strong>
                <i style={{width: `${((p.score || 0) / topScore) * 100}%`}} />
              </li>
            ))}
          </ol>
        </section>

        <section className="panel feed">
          <div className="kicker">/// ATIVIDADE DE COMBATE</div>
          <ul>
            {combat.length === 0 && <li className="empty">Sem ataques até agora.</li>}
            {combat.map((e) => {
              const d = describeEvent(e);
              return <li key={e.id} className={`${d.tone}`}><b>{d.tag}</b><span>{d.text}</span></li>;
            })}
          </ul>
        </section>
      </aside>
    </main>
  );
}
