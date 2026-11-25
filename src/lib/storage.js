// Credenciais de sessão.
//  - Jogador: sessionStorage (uma identidade por aba; permite testar vários jogadores no mesmo navegador).
//  - Operador/anfitrião: localStorage, para que o painel do operador abra em outra aba do mesmo navegador.
// Os tokens nunca são enviados em texto puro ao banco: ele guarda apenas o hash.
const DAY = 24 * 60 * 60 * 1000;

const safe = fn => {
  try {
    return fn();
  } catch {
    return null;
  }
};

export function makeToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map(v => v.toString(16).padStart(2, '0')).join('');
}

export function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map(v => alphabet[v % alphabet.length]).join('');
}

export const hostStore = {
  get(code) {
    const value = safe(() => JSON.parse(localStorage.getItem('hackerz:host:' + code) || 'null'));
    if (!value || !value.token) return null;
    if (Date.now() - (value.at || 0) > DAY) {
      hostStore.clear(code);
      return null;
    }
    return value;
  },
  set(code, value) {
    safe(() => localStorage.setItem('hackerz:host:' + code, JSON.stringify({...value, at: Date.now()})));
  },
  patch(code, partial) {
    const current = hostStore.get(code);
    if (current) hostStore.set(code, {...current, ...partial, at: current.at});
  },
  clear(code) {
    safe(() => localStorage.removeItem('hackerz:host:' + code));
  }
};

export const playerStore = {
  get(code) {
    return safe(() => JSON.parse(sessionStorage.getItem('hackerz:player:' + code) || 'null'));
  },
  set(code, value) {
    safe(() => sessionStorage.setItem('hackerz:player:' + code, JSON.stringify(value)));
  },
  clear(code) {
    safe(() => sessionStorage.removeItem('hackerz:player:' + code));
  },
  lastRoom() {
    return safe(() => sessionStorage.getItem('hackerz:lastRoom'));
  },
  setLastRoom(code) {
    safe(() => (code ? sessionStorage.setItem('hackerz:lastRoom', code) : sessionStorage.removeItem('hackerz:lastRoom')));
  }
};
