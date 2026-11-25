// Banco de teste: Postgres em WASM (PGlite) com a mesma linhagem de migrações do projeto.
//
// Única diferença em relação ao Supabase: o PGlite não traz a extensão pgcrypto, então
// criamos um "digest()" equivalente (somente sha256) nos schemas `extensions` e `public`
// e removemos as linhas "create extension pgcrypto" ao aplicar os arquivos. Nada disso
// altera os arquivos SQL do projeto.
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => readFileSync(path.join(root, rel), 'utf8');

const SHIM = `
create role anon nologin;
create role authenticated nologin;
create publication supabase_realtime;
create schema if not exists extensions;
create function extensions.digest(t text, a text) returns bytea language sql immutable as $$ select sha256(convert_to(t,'UTF8')) $$;
create function public.digest(t text, a text) returns bytea language sql immutable as $$ select sha256(convert_to(t,'UTF8')) $$;
`;

const stripPgcrypto = sql => sql
  .replace(/create extension if not exists pgcrypto with schema extensions;/gi, '')
  .replace(/create extension if not exists pgcrypto;/gi, '');

export const FILES = {
  base: 'tests/fixtures/000_base_schema.sql',
  security: 'supabase/schema.sql',
  events: 'supabase/002_operator_events.sql'
};

export async function createTestDb({upTo = 'events'} = {}) {
  const db = new PGlite();
  await db.exec(SHIM);
  const order = ['base', 'security', 'events'];
  for (const step of order) {
    await db.exec(stripPgcrypto(read(FILES[step])));
    if (step === upTo) break;
  }
  return db;
}

export async function applyFile(db, key) {
  await db.exec(stripPgcrypto(read(FILES[key])));
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const sigCache = new WeakMap();

async function signature(db, fn) {
  if (!sigCache.has(db)) sigCache.set(db, new Map());
  const cache = sigCache.get(db);
  if (cache.has(fn)) return cache.get(fn);
  const res = await db.query(
    `select p.proargnames as names,
            (select array_agg(format_type(t,null)) from unnest(p.proargtypes) t) as types
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=$1`, [fn]);
  const row = res.rows[0] || null;
  cache.set(fn, row);
  return row;
}

// Simula POST /rest/v1/rpc/<fn> do PostgREST, executando com o papel informado.
export async function rpc(db, fn, args = {}, role = 'anon') {
  if (!IDENT.test(fn)) throw httpError(404, 'PGRST202', 'Função inválida');
  const sig = await signature(db, fn);
  if (!sig) throw httpError(404, 'PGRST202', `Could not find the function public.${fn}`);
  const names = Object.keys(args);
  const typeOf = Object.fromEntries(sig.names.map((n, i) => [n, sig.types[i]]));
  for (const n of names) if (!IDENT.test(n) || !typeOf[n]) throw httpError(404, 'PGRST202', `Argumento desconhecido: ${n}`);
  const placeholders = names.map((n, i) => `${n} => $${i + 1}::${typeOf[n]}`).join(', ');
  const params = names.map(n => {
    const v = args[n];
    return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
  });
  try {
    const out = await db.transaction(async tx => {
      await tx.exec(`set local role ${role}`);
      return tx.query(`select public.${fn}(${placeholders}) as result`, params);
    });
    const value = out.rows[0]?.result;
    return value === '' || value === undefined ? null : value;
  } catch (e) {
    throw toHttpError(e);
  }
}

// Simula GET /rest/v1/<relação>?select=...&col=eq.valor&order=col.desc&limit=n
export async function select(db, rel, {columns = '*', filters = [], order = [], limit} = {}, role = 'anon') {
  if (!IDENT.test(rel)) throw httpError(404, 'PGRST205', 'Relação inválida');
  const cols = columns === '*' ? '*' : columns.split(',').map(c => {
    if (!IDENT.test(c)) throw httpError(400, 'PGRST100', 'Coluna inválida');
    return c;
  }).join(',');
  const params = [];
  const where = filters.map(([col, val]) => {
    if (!IDENT.test(col)) throw httpError(400, 'PGRST100', 'Filtro inválido');
    params.push(val);
    return `${col} = $${params.length}`;
  });
  const orderBy = order.map(([col, dir]) => {
    if (!IDENT.test(col)) throw httpError(400, 'PGRST100', 'Ordenação inválida');
    return `${col} ${dir === 'desc' ? 'desc' : 'asc'}`;
  });
  let sql = `select ${cols} from public.${rel}`;
  if (where.length) sql += ` where ${where.join(' and ')}`;
  if (orderBy.length) sql += ` order by ${orderBy.join(', ')}`;
  if (limit) sql += ` limit ${Number(limit) | 0}`;
  try {
    const out = await db.transaction(async tx => {
      await tx.exec(`set local role ${role}`);
      return tx.query(sql, params);
    });
    return out.rows;
  } catch (e) {
    throw toHttpError(e);
  }
}

function httpError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function toHttpError(e) {
  if (e.status) return e;
  const err = new Error(e.message);
  err.code = e.code || 'P0001';
  err.status = err.code === '42501' ? 403 : err.code === '42P01' ? 404 : 400;
  return err;
}

export const token = () => Array.from({length: 64}, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
