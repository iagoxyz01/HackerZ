// Testes do backend: executa schema base -> supabase/schema.sql -> supabase/002_operator_events.sql
// num Postgres em WASM e exercita cada RPC com o papel `anon`, como o navegador faria.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestDb, applyFile, rpc, select, token} from './lib/db.mjs';

const question = (correct = 0, points = 100) => ({
  id: 't:' + correct, prompt: 'Pergunta de teste?', options: ['A', 'B', 'C', 'D'], correct,
  explanation: 'Explicação secreta', level: 'normal', points
});

async function failsWith(promise, pattern) {
  await assert.rejects(promise, err => {
    assert.match(err.message, pattern);
    return true;
  });
}

// Cria sala + n jogadores. O primeiro é o criador (jogador e anfitrião ao mesmo tempo).
async function setup(db, code, names = ['NERO', 'DANTE']) {
  const host = token();
  await rpc(db, 'hackerz_create_room', {p_code: code, p_host_token: host, p_settings: {rounds: 5, seconds: 20}});
  const players = [];
  for (const name of names) {
    const session = token();
    const p = await rpc(db, 'hackerz_join_room', {p_code: code, p_nickname: name, p_session_token: session});
    players.push({...p, session});
  }
  return {code, host, players};
}

const startRound = (db, room, correct = 0, points = 100) =>
  rpc(db, 'hackerz_start_round', {p_code: room.code, p_host_token: room.host, p_question: question(correct, points), p_seconds: 20, p_rounds: 5});
const answer = (db, player, option) => rpc(db, 'hackerz_answer', {p_player_id: player.id, p_session_token: player.session, p_answer: option});
const expire = (db, code) => db.exec(`update public.rooms set question_deadline = now() - interval '1 second' where code='${code}'`);
const stateOf = (db, player) => rpc(db, 'hackerz_player_state', {p_player_id: player.id, p_session_token: player.session});

test('migrações: cadeia completa aplica e a 002 é idempotente', async () => {
  const db = await createTestDb();
  await applyFile(db, 'events');
  await applyFile(db, 'events');
});

test('permissões: anon só lê views públicas e não executa rotinas internas', async () => {
  const db = await createTestDb();
  const room = await setup(db, 'PERM01');
  for (const rel of ['rooms', 'players', 'answers', 'game_events']) {
    await failsWith(select(db, rel), /permission denied/i);
  }
  for (const rel of ['room_state', 'player_roster', 'room_feed']) {
    const rows = await select(db, rel);
    assert.ok(Array.isArray(rows), rel);
  }
  await failsWith(rpc(db, 'hackerz_log', {p_room: room.code, p_round: 0, p_kind: 'join', p_actor: null, p_actor_name: 'x', p_target: null, p_target_name: null, p_points: 0, p_detail: {}}), /permission denied/i);
});

test('room_state não vaza a alternativa correta nem a explicação', async () => {
  const db = await createTestDb();
  const room = await setup(db, 'LEAK01');
  await startRound(db, room, 2);
  const [row] = await select(db, 'room_state', {filters: [['code', room.code]]});
  assert.equal(row.state, 'playing');
  assert.equal(row.current_question.prompt, 'Pergunta de teste?');
  assert.equal('correct' in row.current_question, false);
  assert.equal('explanation' in row.current_question, false);
  assert.ok(row.server_now, 'server_now presente para sincronizar o cronômetro');
  assert.deepEqual([Number(row.player_count), Number(row.answered_count)], [2, 0]);
  await answer(db, room.players[0], 2);
  const [after] = await select(db, 'room_state', {filters: [['code', room.code]]});
  assert.equal(Number(after.answered_count), 1, 'contador de respostas da rodada atual');
});

test('sala: código inválido, credencial curta e código duplicado', async () => {
  const db = await createTestDb();
  await failsWith(rpc(db, 'hackerz_create_room', {p_code: 'ab', p_host_token: token(), p_settings: {}}), /Código de sala inválido/);
  await failsWith(rpc(db, 'hackerz_create_room', {p_code: 'ABCDEF', p_host_token: 'curto', p_settings: {}}), /Credencial do operador inválida/);
  await rpc(db, 'hackerz_create_room', {p_code: 'ABCDEF', p_host_token: token(), p_settings: {}});
  await assert.rejects(rpc(db, 'hackerz_create_room', {p_code: 'ABCDEF', p_host_token: token(), p_settings: {}}));
});

test('entrada: anfitrião e convidados entram pelo código, com validações', async () => {
  const db = await createTestDb();
  const room = await setup(db, 'JOIN01', ['NERO', 'DANTE']);
  assert.equal((await select(db, 'player_roster', {filters: [['room_code', 'JOIN01']]})).length, 2);
  await failsWith(rpc(db, 'hackerz_join_room', {p_code: 'JOIN01', p_nickname: 'DANTE', p_session_token: token()}), /Esse codinome já está em uso/);
  await failsWith(rpc(db, 'hackerz_join_room', {p_code: 'JOIN01', p_nickname: '  ', p_session_token: token()}), /Informe um codinome/);
  await failsWith(rpc(db, 'hackerz_join_room', {p_code: 'JOIN01', p_nickname: 'X', p_session_token: 'curto'}), /Credencial de jogador inválida/);
  await failsWith(rpc(db, 'hackerz_join_room', {p_code: 'NOROOM', p_nickname: 'X', p_session_token: token()}), /Sala não encontrada/);
  // Entrada tardia durante a partida é permitida.
  await startRound(db, room);
  const late = await rpc(db, 'hackerz_join_room', {p_code: 'JOIN01', p_nickname: 'LADY', p_session_token: token()});
  assert.equal(late.nickname, 'LADY');
});

test('entrada: limite de 30 jogadores e sala encerrada', async () => {
  const db = await createTestDb();
  const room = await setup(db, 'FULL01', Array.from({length: 30}, (_, i) => 'P' + i));
  await failsWith(rpc(db, 'hackerz_join_room', {p_code: 'FULL01', p_nickname: 'EXTRA', p_session_token: token()}), /Sala cheia/);
  await rpc(db, 'hackerz_finish_room', {p_code: room.code, p_host_token: room.host});
  const other = await setup(db, 'DONE01', ['NERO']);
  await rpc(db, 'hackerz_finish_room', {p_code: other.code, p_host_token: other.host});
  await failsWith(rpc(db, 'hackerz_join_room', {p_code: 'DONE01', p_nickname: 'LATE', p_session_token: token()}), /já foi encerrada/);
});

test('rodada: só o operador inicia; avança quando todos respondem ou o tempo acaba', async () => {
  const db = await createTestDb();
  const room = await setup(db, 'RND001');
  const [host, guest] = room.players;
  await failsWith(rpc(db, 'hackerz_start_round', {p_code: room.code, p_host_token: token(), p_question: question(), p_seconds: 20, p_rounds: 5}), /Operador não autorizado/);
  const r1 = await startRound(db, room);
  assert.equal(r1.round_no, 1);
  await answer(db, host, 0);
  await failsWith(startRound(db, room), /Aguarde todos responderem/);
  await answer(db, guest, 1);
  const r2 = await startRound(db, room); // todos responderam: liberado
  assert.equal(r2.round_no, 2);
  await expire(db, room.code);
  const r3 = await startRound(db, room); // tempo acabou: liberado
  assert.equal(r3.round_no, 3);
  await expire(db, room.code);
  await failsWith(rpc(db, 'hackerz_start_round', {p_code: room.code, p_host_token: room.host, p_question: {prompt: '', options: []}, p_seconds: 20, p_rounds: 5}), /Pergunta inválida/);
  await failsWith(rpc(db, 'hackerz_start_round', {p_code: room.code, p_host_token: room.host, p_question: question(9), p_seconds: 20, p_rounds: 5}), /Alternativa correta inválida/);
});

test('rodada: limite de rodadas respeitado', async () => {
  const db = await createTestDb();
  const room = await setup(db, 'LIM001', ['NERO']);
  for (let i = 1; i <= 5; i++) {
    await expire(db, room.code);
    assert.equal((await startRound(db, room)).round_no, i);
  }
  await expire(db, room.code);
  await failsWith(startRound(db, room), /Limite de rodadas atingido/);
});

test('resposta: pontua, bloqueia duplicata, sessão inválida e fora do tempo', async () => {
  const db = await createTestDb();
  const room = await setup(db, 'ANS001');
  const [host, guest] = room.players;
  await failsWith(answer(db, host, 0), /Tempo encerrado/); // nenhuma rodada ainda
  await startRound(db, room, 1, 150);
  const ok = await answer(db, host, 1);
  assert.deepEqual([ok.correct, ok.points, ok.explanation], [true, 150, 'Explicação secreta']);
  const bad = await answer(db, guest, 3);
  assert.deepEqual([bad.correct, bad.points], [false, 0]);
  await failsWith(answer(db, host, 1), /Resposta já enviada/);
  await failsWith(rpc(db, 'hackerz_answer', {p_player_id: guest.id, p_session_token: token(), p_answer: 0}), /Sessão de jogador inválida/);
  await expire(db, room.code);
  await failsWith(answer(db, guest, 1), /Tempo encerrado/);
  const roster = await select(db, 'player_roster', {filters: [['room_code', room.code]], order: [['score', 'desc']]});
  assert.deepEqual(roster.map(p => [p.nickname, p.score, p.credits]), [['NERO', 150, 150], ['DANTE', 0, 0]]);
});

test('defesa: blindagem custa 50 créditos e empilha', async () => {
  const db = await createTestDb();
  const room = await setup(db, 'SHD001', ['NERO']);
  const [host] = room.players;
  const shield = () => rpc(db, 'hackerz_activate_shield', {p_player_id: host.id, p_session_token: host.session});
  await failsWith(shield(), /50 créditos/);
  await startRound(db, room, 0, 250);
  await answer(db, host, 0);
  const a = await shield();
  assert.deepEqual([a.credits, a.shield], [200, 1]);
  const b = await shield();
  assert.deepEqual([b.credits, b.shield], [150, 2]);
});

test('ataque: dano, ganho do atacante, limite por rodada e validações', async () => {
  const db = await createTestDb();
  const room = await setup(db, 'ATK001');
  const [host, guest] = room.players;
  const attack = (from, to) => rpc(db, 'hackerz_attack', {p_player_id: from.id, p_session_token: from.session, p_target_id: to.id});
  await failsWith(attack(guest, host), /durante uma rodada/); // sala ainda no lobby
  await startRound(db, room, 0, 250);
  await failsWith(attack(guest, host), /50 créditos/);
  await answer(db, host, 0);
  await answer(db, guest, 0); // ambos com 250
  await failsWith(attack(host, host), /Alvo inválido/);
  const hit = await attack(guest, host);
  assert.deepEqual([hit.blocked, hit.damage, hit.gained, hit.credits], [false, 75, 37, 200]);
  await failsWith(attack(guest, host), /já atacou nesta rodada/);
  const roster = await select(db, 'player_roster', {filters: [['room_code', room.code]]});
  const byName = Object.fromEntries(roster.map(p => [p.nickname, p]));
  assert.equal(byName.NERO.score, 175);
  assert.equal(byName.DANTE.score, 250 + 37);
  assert.equal(byName.NERO.credits, 250, 'o alvo perde pontos, não créditos');
  await expire(db, room.code);
  await failsWith(attack(host, guest), /durante uma rodada/);
  // alvo de outra sala
  const other = await setup(db, 'ATK002', ['ZED']);
  await startRound(db, room, 0, 250);
  await failsWith(attack(host, other.players[0]), /Alvo inválido/);
});

test('ataque: blindagem bloqueia, consome uma camada e registra a defesa', async () => {
  const db = await createTestDb();
  const room = await setup(db, 'DEF001');
  const [host, guest] = room.players;
  await startRound(db, room, 0, 250);
  await answer(db, host, 0);
  await answer(db, guest, 0);
  await rpc(db, 'hackerz_activate_shield', {p_player_id: host.id, p_session_token: host.session});
  const res = await rpc(db, 'hackerz_attack', {p_player_id: guest.id, p_session_token: guest.session, p_target_id: host.id});
  assert.deepEqual([res.blocked, res.damage, res.gained], [true, 0, 0]);
  const roster = await select(db, 'player_roster', {filters: [['room_code', room.code]]});
  const byName = Object.fromEntries(roster.map(p => [p.nickname, p]));
  assert.equal(byName.NERO.shield, 0, 'camada consumida');
  assert.equal(byName.NERO.score, 250, 'sem perda de pontos');
  assert.equal(byName.DANTE.credits, 200, 'atacante paga o custo mesmo bloqueado');
});

test('ataque: alvo sem pontos não fica negativo', async () => {
  const db = await createTestDb();
  const room = await setup(db, 'ZER001');
  const [host, guest] = room.players;
  await startRound(db, room, 0, 100);
  await answer(db, host, 0); // host: 100 créditos
  await answer(db, guest, 3); // guest: 0 pontos
  const res = await rpc(db, 'hackerz_attack', {p_player_id: host.id, p_session_token: host.session, p_target_id: guest.id});
  assert.equal(res.damage, 0);
  const roster = await select(db, 'player_roster', {filters: [['room_code', room.code]]});
  assert.ok(roster.every(p => p.score >= 0));
});

test('estado do jogador: pontuação real, resposta enviada, sequência e feed de ataques', async () => {
  const db = await createTestDb();
  const room = await setup(db, 'PST001');
  const [host, guest] = room.players;
  let s = await stateOf(db, host);
  assert.deepEqual([s.score, s.credits, s.shield, s.streak, s.answered], [0, 0, 0, 0, false]);
  await startRound(db, room, 0, 100);
  await answer(db, host, 0);
  await answer(db, guest, 0);
  s = await stateOf(db, host);
  assert.deepEqual([s.score, s.answered, s.answer_correct, s.streak], [100, true, true, 1]);
  await expire(db, room.code);
  await startRound(db, room, 0, 100);
  await answer(db, host, 0);
  await answer(db, guest, 0);
  assert.equal((await stateOf(db, host)).streak, 2);
  await rpc(db, 'hackerz_attack', {p_player_id: guest.id, p_session_token: guest.session, p_target_id: host.id});
  s = await stateOf(db, host);
  assert.equal(s.feed[0].kind, 'attack');
  assert.equal(s.feed[0].actor_name, 'DANTE');
  assert.equal((await stateOf(db, guest)).attacked_this_round, true);
  await failsWith(rpc(db, 'hackerz_player_state', {p_player_id: host.id, p_session_token: token()}), /Sessão de jogador inválida/);
});

test('sincronização: uma chamada devolve sala, ranking, estado privado e feed', async () => {
  const db = await createTestDb();
  const room = await setup(db, 'SYN001');
  const [host, guest] = room.players;
  const sync = p => rpc(db, 'hackerz_sync', {p_player_id: p.id, p_session_token: p.session});
  let s = await sync(guest);
  assert.equal(s.room.state, 'lobby');
  assert.equal(s.roster.length, 2);
  assert.equal(s.me.nickname, 'DANTE');
  await startRound(db, room, 0, 250);
  await answer(db, host, 0);
  s = await sync(guest);
  assert.equal(s.room.state, 'playing');
  assert.equal(s.room.current_question.prompt, 'Pergunta de teste?');
  assert.equal('correct' in s.room.current_question, false);
  assert.equal(s.roster[0].nickname, 'NERO');
  assert.equal(s.roster[0].score, 250);
  assert.equal(Number(s.room.answered_count), 1);
  assert.equal(s.me.answered, false);
  assert.ok(s.feed.some(e => e.kind === 'round'));
  await failsWith(rpc(db, 'hackerz_sync', {p_player_id: host.id, p_session_token: token()}), /Sessão de jogador inválida/);
});

test('painel do operador: autorização, totais, ataques, jogadores e histórico', async () => {
  const db = await createTestDb();
  const room = await setup(db, 'OPR001', ['NERO', 'DANTE', 'LADY']);
  const [host, guest, lady] = room.players;
  const dash = () => rpc(db, 'hackerz_operator_dashboard', {p_code: room.code, p_host_token: room.host});
  await failsWith(rpc(db, 'hackerz_operator_dashboard', {p_code: room.code, p_host_token: token()}), /Operador não autorizado/);
  await failsWith(rpc(db, 'hackerz_operator_dashboard', {p_code: 'NOROOM', p_host_token: room.host}), /Operador não autorizado/);
  let d = await dash();
  assert.deepEqual([d.room.state, d.totals.players, d.totals.connected, d.attacks.total], ['lobby', 3, 3, 0]);

  await startRound(db, room, 0, 250);
  await answer(db, host, 0);
  await answer(db, guest, 0);
  await rpc(db, 'hackerz_activate_shield', {p_player_id: host.id, p_session_token: host.session});
  await rpc(db, 'hackerz_attack', {p_player_id: guest.id, p_session_token: guest.session, p_target_id: host.id}); // bloqueado
  await expire(db, room.code);
  await startRound(db, room, 0, 250);
  await answer(db, host, 0);
  await answer(db, guest, 0);
  await rpc(db, 'hackerz_attack', {p_player_id: guest.id, p_session_token: guest.session, p_target_id: host.id}); // acerta

  d = await dash();
  assert.deepEqual([d.room.state, d.room.round_no, d.room.rounds], ['playing', 2, 5]);
  assert.equal(d.totals.answered, 2);
  assert.deepEqual([d.attacks.total, d.attacks.blocked, d.attacks.points_lost], [2, 1, 75]);
  const nero = d.players.find(p => p.nickname === 'NERO');
  const dante = d.players.find(p => p.nickname === 'DANTE');
  const ladyRow = d.players.find(p => p.nickname === 'LADY');
  assert.deepEqual([nero.attacks_received, nero.blocked, nero.points_lost], [2, 1, 75]);
  assert.equal(dante.attacks_made, 2);
  assert.equal(ladyRow.answered, false);
  assert.ok(d.players[0].score >= d.players[1].score, 'jogadores ordenados por pontuação');
  const kinds = d.events.map(e => e.kind);
  for (const k of ['join', 'round', 'answer', 'shield', 'defense', 'attack']) assert.ok(kinds.includes(k), 'evento ' + k);
  assert.ok(d.events[0].id > d.events[d.events.length - 1].id, 'histórico do mais novo para o mais antigo');

  // jogadores só veem o feed público, sem eventos de resposta
  const feed = await select(db, 'room_feed', {filters: [['room_code', room.code]]});
  assert.ok(feed.length > 0 && feed.every(e => e.kind !== 'answer'));

  // presença: jogador sem batimento recente aparece como desconectado
  await db.exec(`update public.players set last_seen = now() - interval '1 minute' where nickname='LADY'`);
  d = await dash();
  assert.equal(d.totals.connected, 2);
  assert.equal(d.players.find(p => p.nickname === 'LADY').connected, false);
  await stateOf(db, lady); // batimento
  d = await dash();
  assert.equal(d.totals.connected, 3);
});

test('encerramento: autorizado, idempotente e libera o ranking', async () => {
  const db = await createTestDb();
  const room = await setup(db, 'FIN001');
  await failsWith(rpc(db, 'hackerz_finish_room', {p_code: room.code, p_host_token: token()}), /Operador não autorizado/);
  await rpc(db, 'hackerz_finish_room', {p_code: room.code, p_host_token: room.host});
  await rpc(db, 'hackerz_finish_room', {p_code: room.code, p_host_token: room.host});
  const [row] = await select(db, 'room_state', {filters: [['code', room.code]]});
  assert.equal(row.state, 'finished');
  const events = await select(db, 'room_feed', {filters: [['room_code', room.code]]});
  assert.equal(events.filter(e => e.kind === 'finish').length, 1, 'um único evento de encerramento');
  await failsWith(startRound(db, room), /Partida já encerrada/);
});
