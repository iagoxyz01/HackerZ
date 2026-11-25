import {useCallback, useEffect, useRef, useState} from 'react';
import {api} from './api';
import {db} from './db';
import {hostStore, makeCode, makeToken, playerStore} from './storage';
import {LEVELS, pickQuestion} from '../questions';

const POLL_MS = 1000;
const POLL_SLOW_MS = 4000;
const EMPTY = {room: null, roster: [], mine: null, feed: []};

// Estado do jogador. A FASE da tela vem sempre do servidor (lobby / play / results), então
// recarregar a página, trocar de aba ou perder a conexão não deixa ninguém dessincronizado.
export function useGame() {
  const [room, setRoom] = useState('');
  const [me, setMe] = useState(null);
  const [hostToken, setHostToken] = useState('');
  const [settings, setSettings] = useState({rounds: 10, seconds: 20});
  const [snap, setSnap] = useState(EMPTY);
  const [offset, setOffset] = useState(0);
  const [, setTick] = useState(0);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('ok');
  const [picked, setPicked] = useState(null);
  const [result, setResult] = useState(null);
  const meRef = useRef(null);
  const roomRef = useRef('');
  const noticeTimer = useRef(0);
  const pollNow = useRef(() => {});
  meRef.current = me;
  roomRef.current = room;

  const notify = useCallback((text, tone = 'error') => {
    window.clearTimeout(noticeTimer.current);
    setNotice(text ? {text, tone} : null);
    if (text) noticeTimer.current = window.setTimeout(() => setNotice(null), 5000);
  }, []);

  const leave = useCallback((message) => {
    const current = roomRef.current;
    if (current) {
      playerStore.clear(current);
      hostStore.clear(current);
    }
    setRoom('');
    playerStore.setLastRoom('');
    setMe(null);
    setHostToken('');
    setSnap(EMPTY);
    setPicked(null);
    setResult(null);
    setLink('ok');
    if (message) notify(message);
  }, [notify]);

  // Restaura a sessão desta aba depois de recarregar.
  useEffect(() => {
    const last = playerStore.lastRoom();
    if (!last) return;
    const player = playerStore.get(last);
    const host = hostStore.get(last);
    if (!player?.id || !player?.token) return;
    setRoom(last);
    setMe({id: player.id, token: player.token, nickname: player.nickname});
    if (host?.token) setHostToken(host.token);
  }, []);

  // Cronômetro: reavalia 4x por segundo, sempre contra o relógio do servidor.
  useEffect(() => {
    if (!room) return undefined;
    const id = window.setInterval(() => setTick((v) => v + 1), 250);
    return () => window.clearInterval(id);
  }, [room]);

  // Sincronização por polling. É o mecanismo principal (não depende de Realtime).
  useEffect(() => {
    if (!db || !room || !me) return undefined;
    let stopped = false;
    let running = false;
    let timer = 0;
    let failures = 0;

    const schedule = (state) => {
      if (stopped) return;
      const slow = document.hidden || state === 'finished';
      timer = window.setTimeout(run, slow ? POLL_SLOW_MS : POLL_MS);
    };

    async function run() {
      if (running || stopped) return;
      running = true;
      let state = null;
      try {
        const t0 = Date.now();
        const data = await api.sync({playerId: meRef.current.id, sessionToken: meRef.current.token});
        const t1 = Date.now();
        if (stopped) return;
        if (!data?.room) {
          leave('Sala não encontrada.');
          return;
        }
        if (data.room.server_now) setOffset(Date.parse(data.room.server_now) - (t0 + t1) / 2);
        setSnap({room: data.room, roster: data.roster || [], mine: data.me, feed: data.feed || []});
        state = data.room.state;
        failures = 0;
        setLink('ok');
      } catch (e) {
        if (stopped) return;
        if (/Sessão de jogador inválida/.test(e.message)) {
          leave('Sua sessão nesta sala expirou. Entre novamente.');
          return;
        }
        failures += 1;
        if (failures >= 2) setLink('retrying');
      } finally {
        running = false;
        window.clearTimeout(timer);
        schedule(state);
      }
    }

    pollNow.current = () => {
      window.clearTimeout(timer);
      run();
    };
    const onVisible = () => !document.hidden && pollNow.current();
    document.addEventListener('visibilitychange', onVisible);
    run();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      pollNow.current = () => {};
    };
  }, [room, me?.id, leave]);

  const refresh = useCallback(() => pollNow.current(), []);

  // ---------- Ações ----------
  const guard = useCallback(async (fn) => {
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      notify(e.message || 'Algo deu errado.');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [notify]);

  const createRoom = useCallback(async (nickname) => {
    const name = nickname.trim();
    if (!name) {
      notify('Escolha seu codinome para continuar.');
      return false;
    }
    const ok = await guard(async () => {
      const token = makeToken();
      let code = '';
      for (let attempt = 0; ; attempt += 1) {
        code = makeCode();
        try {
          await api.createRoom({code, hostToken: token, settings});
          break;
        } catch (e) {
          if (attempt < 4 && (e.code === '23505' || /duplicate|already exists/i.test(e.message))) continue;
          throw e;
        }
      }
      const sessionToken = makeToken();
      const player = await api.joinRoom({code, nickname: name, sessionToken});
      hostStore.set(code, {token, nickname: name, used: []});
      playerStore.set(code, {id: player.id, token: sessionToken, nickname: player.nickname});
      playerStore.setLastRoom(code);
      setSnap(EMPTY);
      setRoom(code);
      setHostToken(token);
      setMe({id: player.id, token: sessionToken, nickname: player.nickname});
      notify('Sala criada. Compartilhe o código com os jogadores.', 'ok');
      return true;
    });
    return Boolean(ok);
  }, [guard, notify, settings]);

  const joinRoom = useCallback(async (nickname, rawCode) => {
    const name = nickname.trim();
    const code = rawCode.trim().toUpperCase();
    if (!name || code.length !== 6) {
      notify('Informe seu codinome e o código de 6 caracteres.');
      return false;
    }
    const ok = await guard(async () => {
      const sessionToken = makeToken();
      const player = await api.joinRoom({code, nickname: name, sessionToken});
      playerStore.set(code, {id: player.id, token: sessionToken, nickname: player.nickname});
      playerStore.setLastRoom(code);
      setSnap(EMPTY);
      setRoom(code);
      setHostToken('');
      setMe({id: player.id, token: sessionToken, nickname: player.nickname});
      notify('Você entrou na sala.', 'ok');
      return true;
    });
    return Boolean(ok);
  }, [guard, notify]);

  const finishMatch = useCallback(() => guard(async () => {
    await api.finishRoom({code: room, hostToken});
    refresh();
  }), [guard, room, hostToken, refresh]);

  // Anfitrião: inicia a 1ª rodada ou avança para a próxima (ou encerra, se foi a última).
  const advance = useCallback(() => guard(async () => {
    const info = snap.room;
    const round = info?.round_no || 0;
    const total = info?.settings?.rounds ?? settings.rounds;
    if (round >= total) {
      await api.finishRoom({code: room, hostToken});
      refresh();
      return;
    }
    const level = LEVELS[Math.floor(Math.random() * LEVELS.length)].id;
    const used = hostStore.get(room)?.used || [];
    const question = pickQuestion(level, used);
    await api.startRound({
      code: room,
      hostToken,
      question,
      seconds: info?.settings?.seconds ?? settings.seconds,
      rounds: total
    });
    hostStore.patch(room, {used: [...used, question.id]});
    setPicked(null);
    setResult(null);
    refresh();
  }), [guard, snap.room, settings, room, hostToken, refresh]);

  const submitAnswer = useCallback(async (index) => {
    const round = snap.room?.round_no;
    if (!me || busy || snap.mine?.answered || picked?.round === round) return;
    setPicked({round, index});
    setBusy(true);
    try {
      const data = await api.answer({playerId: me.id, sessionToken: me.token, answer: index});
      setResult({round, ...data});
    } catch (e) {
      setPicked(null);
      notify(e.message || 'Não foi possível registrar a resposta.');
    } finally {
      setBusy(false);
      refresh();
    }
  }, [me, busy, snap.room, snap.mine, picked, notify, refresh]);

  const activateShield = useCallback(() => guard(async () => {
    const data = await api.activateShield({playerId: me.id, sessionToken: me.token});
    notify(data.message, 'ok');
    refresh();
  }), [guard, me, notify, refresh]);

  const attack = useCallback((targetId) => guard(async () => {
    const data = await api.attack({playerId: me.id, sessionToken: me.token, targetId});
    notify(data.message, data.blocked ? 'warn' : 'ok');
    refresh();
  }), [guard, me, notify, refresh]);

  const leaveRoom = useCallback(() => leave(), [leave]);

  // ---------- Derivados ----------
  const info = snap.room;
  const phase = !room ? 'home' : !info ? 'loading' : info.state === 'finished' ? 'results' : info.state === 'lobby' ? 'lobby' : 'play';
  const deadline = info?.question_deadline ? Date.parse(info.question_deadline) : 0;
  const serverNow = Date.now() + offset;
  const secondsLeft = deadline ? Math.max(0, Math.ceil((deadline - serverNow) / 1000)) : 0;
  const totalSeconds = info?.settings?.seconds || settings.seconds;
  const round = info?.round_no || 0;
  const totalRounds = info?.settings?.rounds || settings.rounds;
  const answered = Boolean(snap.mine?.answered) || picked?.round === round;
  const myPick = picked?.round === round ? picked.index : null;
  const myResult = result?.round === round ? result : null;

  return {
    room, me, isHost: Boolean(hostToken), hostToken,
    settings, setSettings,
    phase, info, roster: snap.roster, mine: snap.mine, feed: snap.feed,
    round, totalRounds, secondsLeft, totalSeconds, answered, myPick, myResult,
    notice, notify, busy, link,
    createRoom, joinRoom, advance, finishMatch, submitAnswer, activateShield, attack, leaveRoom
  };
}
