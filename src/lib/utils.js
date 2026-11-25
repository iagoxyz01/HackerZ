export const pad2 = (n) => String(Math.max(0, Number(n) || 0)).padStart(2, '0');

// "Style rank" estilo Devil May Cry, calculado pela sequência de acertos.
export const RANKS = ['D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];
export const RANK_NAMES = ['Dismal', 'Crazy', 'Badass', 'Apocalyptic', 'Savage', 'Sick Style', 'Smokin\' Sexy Style'];
export const rankIndex = (streak) => Math.min(Math.max(Number(streak) || 0, 0), RANKS.length - 1);

export function relTime(iso, nowMs = Date.now()) {
  const diff = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (diff < 5) return 'agora';
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  return `${Math.floor(diff / 3600)}h`;
}

export function clock(iso) {
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(pad2).join(':');
}

// Texto e tom de cada tipo de evento (usado no feed dos jogadores e no painel do operador).
export function describeEvent(e) {
  const a = e.actor_name || '—';
  const t = e.target_name || '—';
  switch (e.kind) {
    case 'join': return {tag: 'ENTRADA', tone: 'info', text: `${a} entrou na sala`};
    case 'round': return {tag: 'RODADA', tone: 'info', text: `Rodada ${e.round_no} iniciada`};
    case 'answer': return e.detail?.correct
      ? {tag: 'ACERTO', tone: 'ok', text: `${a} acertou (+${e.points} pts)`}
      : {tag: 'ERRO', tone: 'muted', text: `${a} errou a resposta`};
    case 'attack': return {tag: 'ATAQUE', tone: 'danger', text: `${a} atacou ${t}: −${e.points} pts`};
    case 'defense': return {tag: 'DEFESA', tone: 'warn', text: `${t} bloqueou o ataque de ${a}`};
    case 'shield': return {tag: 'ESCUDO', tone: 'ok', text: `${a} ativou uma blindagem`};
    case 'finish': return {tag: 'FIM', tone: 'info', text: 'Partida encerrada'};
    default: return {tag: String(e.kind || '').toUpperCase(), tone: 'muted', text: ''};
  }
}

export const STATE_LABEL = {lobby: 'AGUARDANDO INÍCIO', playing: 'PARTIDA EM ANDAMENTO', finished: 'PARTIDA ENCERRADA'};

export function operatorUrl(code, key) {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#/operator/${code}${key ? `?k=${key}` : ''}`;
}
