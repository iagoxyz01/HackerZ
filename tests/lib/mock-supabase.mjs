// Servidor local com o mesmo contrato HTTP do PostgREST/Supabase (RPC + leitura de views),
// por cima do Postgres de teste (PGlite) com as migrações reais do projeto.
// Serve apenas para testes: permite exercitar o frontend compilado sem acesso à internet.
import http from 'node:http';
import {rpc, select} from './db.mjs';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-expose-headers': '*'
};

function send(res, status, body) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {...CORS, 'content-type': 'application/json'});
  res.end(payload);
}

const readBody = req => new Promise(resolve => {
  let data = '';
  req.on('data', c => (data += c));
  req.on('end', () => resolve(data));
});

function parseFilters(params) {
  const filters = [];
  const order = [];
  let columns = '*';
  let limit;
  for (const [key, value] of params) {
    if (key === 'select') columns = value;
    else if (key === 'limit') limit = value;
    else if (key === 'order') {
      for (const part of value.split(',')) {
        const [col, dir] = part.split('.');
        order.push([col, dir]);
      }
    } else if (value.startsWith('eq.')) filters.push([key, value.slice(3)]);
  }
  return {columns, filters, order, limit};
}

export function startMockSupabase(db, {port = 0} = {}) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204);
    const url = new URL(req.url, 'http://localhost');
    const m = url.pathname.match(/^\/rest\/v1\/(rpc\/)?([a-z_]+)$/);
    if (!m) return send(res, 404, {message: 'not found'});
    try {
      if (m[1] && req.method === 'POST') {
        const args = JSON.parse((await readBody(req)) || '{}');
        calls.push(m[2]);
        const out = await rpc(db, m[2], args, 'anon');
        return out === null ? send(res, 204) : send(res, 200, out);
      }
      if (!m[1] && req.method === 'GET') {
        const rows = await select(db, m[2], parseFilters(url.searchParams), 'anon');
        return send(res, 200, rows);
      }
      return send(res, 405, {message: 'method not allowed'});
    } catch (e) {
      return send(res, e.status || 400, {code: e.code || 'P0001', message: e.message, details: null, hint: null});
    }
  });
  return new Promise(resolve => {
    server.listen(port, '127.0.0.1', () => resolve({server, port: server.address().port, calls}));
  });
}
