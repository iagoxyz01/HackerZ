import {useCallback, useEffect, useRef, useState} from 'react';
import {api} from './api';
import {db} from './db';

const POLL_MS = 1500;

// Painel do operador: leitura somente. Autorizado pela credencial do operador (hash no banco).
export function useOperator(code, hostToken) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [link, setLink] = useState('ok');
  const [offset, setOffset] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [, setTick] = useState(0);
  const pollNow = useRef(() => {});

  useEffect(() => {
    if (!db || !code || !hostToken) return undefined;
    let stopped = false;
    let running = false;
    let timer = 0;
    let failures = 0;
    let fatal = false; // credencial recusada: não adianta insistir

    async function run() {
      if (running || stopped) return;
      running = true;
      try {
        const t0 = Date.now();
        const next = await api.operatorDashboard({code, hostToken});
        const t1 = Date.now();
        if (stopped) return;
        if (next?.room?.server_now) setOffset(Date.parse(next.room.server_now) - (t0 + t1) / 2);
        setData(next);
        setUpdatedAt(Date.now());
        setError('');
        setLink('ok');
        failures = 0;
      } catch (e) {
        if (stopped) return;
        failures += 1;
        if (/Operador não autorizado/.test(e.message)) {
          fatal = true;
          setError('Credencial de operador inválida para esta sala.');
          return;
        }
        if (failures >= 2) setLink('retrying');
        setError(e.message);
      } finally {
        running = false;
        window.clearTimeout(timer);
        if (!stopped && !fatal) timer = window.setTimeout(run, document.hidden ? 5000 : POLL_MS);
      }
    }

    pollNow.current = () => {
      window.clearTimeout(timer);
      run();
    };
    run();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [code, hostToken]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((v) => v + 1), 500);
    return () => window.clearInterval(id);
  }, []);

  const refresh = useCallback(() => pollNow.current(), []);
  const deadline = data?.room?.deadline ? Date.parse(data.room.deadline) : 0;
  const secondsLeft = deadline ? Math.max(0, Math.ceil((deadline - (Date.now() + offset)) / 1000)) : 0;
  return {data, error, link, secondsLeft, updatedAt, refresh};
}
