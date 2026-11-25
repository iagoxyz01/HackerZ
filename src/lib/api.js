import {db} from './db';

export class ApiError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'ApiError';
    this.cause = cause;
    this.code = cause?.code;
  }
}

function friendly(error) {
  const msg = String(error?.message || error || 'Erro desconhecido');
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return 'Sem conexão com o servidor. Verifique a internet e tente novamente.';
  }
  if (/could not find the function|PGRST202|schema cache/i.test(msg)) {
    return 'O banco ainda não tem a versão mais recente. Execute supabase/002_operator_events.sql no SQL Editor do Supabase.';
  }
  if (/relation .* does not exist|PGRST205/i.test(msg)) {
    return 'O banco não possui as tabelas/views do jogo. Execute supabase/schema.sql e depois supabase/002_operator_events.sql.';
  }
  if (/invalid api key|JWT/i.test(msg)) {
    return 'A chave do Supabase foi recusada. Confira VITE_SUPABASE_ANON_KEY na Vercel e faça um novo deploy.';
  }
  return msg;
}

async function rpc(fn, args) {
  if (!db) throw new ApiError('Supabase não configurado.');
  let res;
  try {
    res = await db.rpc(fn, args);
  } catch (e) {
    throw new ApiError(friendly(e), e);
  }
  if (res.error) throw new ApiError(friendly(res.error), res.error);
  return res.data;
}

async function read(builder) {
  let res;
  try {
    res = await builder;
  } catch (e) {
    throw new ApiError(friendly(e), e);
  }
  if (res.error) throw new ApiError(friendly(res.error), res.error);
  return res.data;
}

export const api = {
  createRoom: ({code, hostToken, settings}) =>
    rpc('hackerz_create_room', {p_code: code, p_host_token: hostToken, p_settings: settings}),
  joinRoom: ({code, nickname, sessionToken}) =>
    rpc('hackerz_join_room', {p_code: code, p_nickname: nickname, p_session_token: sessionToken}),
  startRound: ({code, hostToken, question, seconds, rounds}) =>
    rpc('hackerz_start_round', {p_code: code, p_host_token: hostToken, p_question: question, p_seconds: seconds, p_rounds: rounds}),
  finishRoom: ({code, hostToken}) =>
    rpc('hackerz_finish_room', {p_code: code, p_host_token: hostToken}),
  answer: ({playerId, sessionToken, answer}) =>
    rpc('hackerz_answer', {p_player_id: playerId, p_session_token: sessionToken, p_answer: answer}),
  activateShield: ({playerId, sessionToken}) =>
    rpc('hackerz_activate_shield', {p_player_id: playerId, p_session_token: sessionToken}),
  attack: ({playerId, sessionToken, targetId}) =>
    rpc('hackerz_attack', {p_player_id: playerId, p_session_token: sessionToken, p_target_id: targetId}),
  playerState: ({playerId, sessionToken}) =>
    rpc('hackerz_player_state', {p_player_id: playerId, p_session_token: sessionToken}),
  sync: ({playerId, sessionToken}) =>
    rpc('hackerz_sync', {p_player_id: playerId, p_session_token: sessionToken}),
  operatorDashboard: ({code, hostToken}) =>
    rpc('hackerz_operator_dashboard', {p_code: code, p_host_token: hostToken}),

  roomState: async code => {
    const rows = await read(db.from('room_state')
      .select('code,state,current_question,question_deadline,round_no,settings,server_now,player_count,answered_count')
      .eq('code', code).limit(1));
    return rows?.[0] || null;
  },
  roster: code => read(db.from('player_roster')
    .select('id,nickname,score,credits,shield')
    .eq('room_code', code).order('score', {ascending: false}).order('nickname', {ascending: true})),
  feed: code => read(db.from('room_feed')
    .select('id,round_no,kind,actor_name,target_name,points,created_at')
    .eq('room_code', code).order('id', {ascending: false}).limit(30))
};
