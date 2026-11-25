begin;

-- HackerZ 002 — eventos de partida, ataque/defesa e painel do operador.
--
-- ADITIVA e IDEMPOTENTE: não apaga tabelas, colunas nem dados. Pode ser executada mais de uma vez.
-- Pré-requisito: supabase/schema.sql já executado (tabelas rooms/players/answers e funções seguras).
-- Execute no Supabase SQL Editor. Nunca use a chave service_role no frontend.

-- 1) Presença dos jogadores (batimento atualizado por hackerz_player_state).
alter table public.players add column if not exists last_seen timestamptz;

-- 2) Histórico de eventos da partida. Sem acesso direto para anon/authenticated:
--    a leitura passa pela view room_feed (pública) ou pela RPC do operador (autenticada).
create table if not exists public.game_events(
  id bigint generated always as identity primary key,
  room_code text not null references public.rooms(code) on delete cascade,
  round_no int not null default 0,
  kind text not null check (kind in ('join','round','answer','attack','defense','shield','finish')),
  actor_id uuid references public.players(id) on delete set null,
  actor_name text,
  target_id uuid references public.players(id) on delete set null,
  target_name text,
  points int not null default 0,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists game_events_room_idx on public.game_events(room_code,id desc);
alter table public.game_events enable row level security;
revoke all on public.game_events from anon,authenticated;

-- 3) Views públicas. room_state ganha server_now (relógio do servidor para sincronizar o cronômetro)
--    e deixa de expor a explicação da questão antes de o jogador responder.
create or replace view public.room_state with (security_barrier=true) as
select code,state,(current_question-'correct'-'explanation') as current_question,question_deadline,round_no,settings,created_at,now() as server_now,
  (select count(*) from public.players pl where pl.room_code=rooms.code) as player_count,
  (select count(*) from public.answers a join public.players pl on pl.id=a.player_id
    where pl.room_code=rooms.code and a.round_no=rooms.round_no) as answered_count
from public.rooms;

create or replace view public.room_feed with (security_barrier=true) as
select id,room_code,round_no,kind,actor_name,target_name,points,created_at
from public.game_events
where kind in ('join','round','attack','defense','shield','finish');

grant select on public.room_state,public.player_roster,public.room_feed to anon,authenticated;

-- 4) Registro interno de eventos (não chamável pelo navegador).
create or replace function public.hackerz_log(p_room text,p_round int,p_kind text,p_actor uuid,p_actor_name text,p_target uuid,p_target_name text,p_points int,p_detail jsonb)
returns void language sql security definer set search_path='' as $$
  insert into public.game_events(room_code,round_no,kind,actor_id,actor_name,target_id,target_name,points,detail)
  values(p_room,p_round,p_kind,p_actor,p_actor_name,p_target,p_target_name,coalesce(p_points,0),coalesce(p_detail,'{}'::jsonb));
$$;
revoke all on function public.hackerz_log(text,int,text,uuid,text,uuid,text,int,jsonb) from public,anon,authenticated;

-- 5) Entrada na sala: aceita entrada durante a partida, rejeita partida encerrada e codinome repetido.
create or replace function public.hackerz_join_room(p_code text,p_nickname text,p_session_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.rooms; p public.players; clean_name text;
begin
  clean_name := left(trim(coalesce(p_nickname,'')),18);
  if clean_name = '' then raise exception 'Informe um codinome'; end if;
  if length(coalesce(p_session_token,'')) < 40 then raise exception 'Credencial de jogador inválida'; end if;
  select * into r from public.rooms where code=upper(trim(p_code)) for update;
  if not found then raise exception 'Sala não encontrada. Confira o código.'; end if;
  if r.state = 'finished' then raise exception 'Esta partida já foi encerrada'; end if;
  if (select count(*) from public.players where room_code=r.code) >= 30 then raise exception 'Sala cheia (limite de 30 jogadores)'; end if;
  begin
    insert into public.players(room_code,nickname,session_hash,attack_hash,last_seen)
    values(r.code,clean_name,encode(extensions.digest(p_session_token,'sha256'),'hex'),encode(extensions.digest(pg_catalog.gen_random_uuid()::text,'sha256'),'hex'),now())
    returning * into p;
  exception when unique_violation then
    raise exception 'Esse codinome já está em uso nesta sala';
  end;
  perform public.hackerz_log(r.code,r.round_no,'join',p.id,p.nickname,null,null,0,'{}'::jsonb);
  return jsonb_build_object('id',p.id,'nickname',p.nickname,'credits',p.credits,'score',p.score,'shield',p.shield);
end $$;

-- 6) Início de rodada: só avança quando o tempo acabou ou todos já responderam.
create or replace function public.hackerz_start_round(p_code text,p_host_token text,p_question jsonb,p_seconds int,p_rounds int)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.rooms; next_round int; max_rounds int; secs int;
begin
  select * into r from public.rooms where code=upper(trim(p_code)) for update;
  if not found or r.host_token_hash <> encode(extensions.digest(coalesce(p_host_token,''),'sha256'),'hex') then raise exception 'Operador não autorizado'; end if;
  if r.state='finished' then raise exception 'Partida já encerrada'; end if;
  if r.state='playing' and r.question_deadline is not null and r.question_deadline > now() then
    if exists(select 1 from public.players pl where pl.room_code=r.code
              and not exists(select 1 from public.answers a where a.player_id=pl.id and a.round_no=r.round_no)) then
      raise exception 'Aguarde todos responderem ou o tempo da rodada acabar';
    end if;
  end if;
  max_rounds := least(greatest(coalesce(p_rounds,10),5),20);
  next_round := r.round_no+1;
  if next_round > max_rounds then raise exception 'Limite de rodadas atingido. Encerre a partida para ver o ranking.'; end if;
  if coalesce(p_question->>'prompt','')='' or jsonb_array_length(coalesce(p_question->'options','[]'::jsonb))<>4 then raise exception 'Pergunta inválida'; end if;
  if (p_question->>'correct')::int not between 0 and 3 then raise exception 'Alternativa correta inválida'; end if;
  secs := least(greatest(coalesce(p_seconds,20),10),60);
  update public.rooms set state='playing',current_question=p_question,round_no=next_round,
    settings=jsonb_build_object('rounds',max_rounds,'seconds',secs),
    question_deadline=now()+make_interval(secs=>secs) where code=r.code;
  perform public.hackerz_log(r.code,next_round,'round',null,null,null,null,0,jsonb_build_object('level',p_question->>'level','seconds',secs));
  return jsonb_build_object('round_no',next_round,'deadline',now()+make_interval(secs=>secs));
end $$;

-- 7) Resposta: igual à versão anterior, com registro do evento.
create or replace function public.hackerz_answer(p_player_id uuid,p_session_token text,p_answer int)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.players; r public.rooms; q jsonb; ok boolean; pts int;
begin
  select * into p from public.players where id=p_player_id for update;
  if not found or p.session_hash <> encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex') then raise exception 'Sessão de jogador inválida'; end if;
  select * into r from public.rooms where code=p.room_code for update;
  if r.state<>'playing' or r.question_deadline is null or r.question_deadline<now() then raise exception 'Tempo encerrado'; end if;
  if p_answer not between 0 and 3 then raise exception 'Resposta inválida'; end if;
  if exists(select 1 from public.answers where player_id=p.id and round_no=r.round_no) then raise exception 'Resposta já enviada'; end if;
  q:=r.current_question; ok:=p_answer=(q->>'correct')::int;
  pts:=case when ok then coalesce((q->>'points')::int,100) else 0 end;
  insert into public.answers(player_id,round_no,is_correct) values(p.id,r.round_no,ok);
  update public.players set score=score+pts,credits=credits+pts,last_seen=now() where id=p.id;
  perform public.hackerz_log(r.code,r.round_no,'answer',p.id,p.nickname,null,null,pts,jsonb_build_object('correct',ok));
  return jsonb_build_object('correct',ok,'points',pts,'explanation',q->>'explanation','round_no',r.round_no);
end $$;

-- 8) Defesa (blindagem fictícia): 50 créditos por camada.
create or replace function public.hackerz_activate_shield(p_player_id uuid,p_session_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.players; r public.rooms;
begin
  select * into p from public.players where id=p_player_id for update;
  if not found or p.session_hash <> encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex') then raise exception 'Sessão de jogador inválida'; end if;
  if p.credits<50 then raise exception 'Você precisa de 50 créditos para ativar a defesa'; end if;
  update public.players set credits=credits-50,shield=shield+1 where id=p.id returning * into p;
  select * into r from public.rooms where code=p.room_code;
  perform public.hackerz_log(p.room_code,r.round_no,'shield',p.id,p.nickname,null,null,0,jsonb_build_object('layers',p.shield));
  return jsonb_build_object('credits',p.credits,'shield',p.shield,'message','Blindagem digital ativada');
end $$;

-- 9) Ataque (mecânica fictícia do jogo): custa 50 créditos, 1 por rodada, só durante a rodada.
--    Alvo com blindagem consome uma camada e não perde pontos; sem blindagem perde até 75 pontos
--    e o atacante recebe metade do que o alvo perdeu.
create or replace function public.hackerz_attack(p_player_id uuid,p_session_token text,p_target_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.players; t public.players; r public.rooms; dmg int; gain int;
begin
  if p_target_id is null or p_target_id = p_player_id then raise exception 'Alvo inválido'; end if;
  perform 1 from public.players where id in (p_player_id,p_target_id) order by id for update;
  select * into a from public.players where id=p_player_id;
  if not found or a.session_hash <> encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex') then raise exception 'Sessão de jogador inválida'; end if;
  select * into t from public.players where id=p_target_id;
  if not found or t.room_code <> a.room_code then raise exception 'Alvo inválido'; end if;
  select * into r from public.rooms where code=a.room_code for update;
  if r.state<>'playing' or r.question_deadline is null or r.question_deadline<now() then raise exception 'Ataques só podem ser lançados durante uma rodada'; end if;
  if exists(select 1 from public.game_events where actor_id=a.id and round_no=r.round_no and kind in ('attack','defense')) then raise exception 'Você já atacou nesta rodada'; end if;
  if a.credits<50 then raise exception 'Você precisa de 50 créditos para lançar um ataque'; end if;
  update public.players set credits=credits-50 where id=a.id returning * into a;
  if t.shield>0 then
    update public.players set shield=shield-1 where id=t.id;
    perform public.hackerz_log(r.code,r.round_no,'defense',a.id,a.nickname,t.id,t.nickname,0,jsonb_build_object('blocked',true));
    return jsonb_build_object('blocked',true,'damage',0,'gained',0,'credits',a.credits,'message',t.nickname||' bloqueou o ataque com a blindagem');
  end if;
  dmg:=least(t.score,75); gain:=dmg/2;
  update public.players set score=score-dmg where id=t.id;
  update public.players set score=score+gain where id=a.id;
  perform public.hackerz_log(r.code,r.round_no,'attack',a.id,a.nickname,t.id,t.nickname,dmg,jsonb_build_object('blocked',false,'gained',gain));
  return jsonb_build_object('blocked',false,'damage',dmg,'gained',gain,'credits',a.credits,'message','Ataque em '||t.nickname||': -'||dmg||' pontos');
end $$;

-- 10) Encerramento (idempotente, com evento).
create or replace function public.hackerz_finish_room(p_code text,p_host_token text)
returns void language plpgsql security definer set search_path='' as $$
declare r public.rooms;
begin
  select * into r from public.rooms where code=upper(trim(p_code)) for update;
  if not found or r.host_token_hash <> encode(extensions.digest(coalesce(p_host_token,''),'sha256'),'hex') then raise exception 'Operador não autorizado'; end if;
  if r.state<>'finished' then
    update public.rooms set state='finished' where code=r.code;
    perform public.hackerz_log(r.code,r.round_no,'finish',null,null,null,null,0,'{}'::jsonb);
  end if;
end $$;

-- 11) Estado privado do jogador: pontuação real, sequência, resposta já enviada e ataques recebidos.
create or replace function public.hackerz_player_state(p_player_id uuid,p_session_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.players; r public.rooms; ans public.answers; streak int; has_answer boolean; feed jsonb; attacked boolean;
begin
  select * into p from public.players where id=p_player_id;
  if not found or p.session_hash <> encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex') then raise exception 'Sessão de jogador inválida'; end if;
  update public.players set last_seen=now() where id=p.id and (last_seen is null or last_seen < now()-interval '5 seconds');
  select * into p from public.players where id=p_player_id;
  select * into r from public.rooms where code=p.room_code;
  select * into ans from public.answers where player_id=p.id and round_no=r.round_no;
  has_answer := found;
  select count(*) into streak from (
    select bool_and(is_correct) over (order by round_no desc rows between unbounded preceding and current row) as run
    from public.answers where player_id=p.id) s where s.run;
  attacked := exists(select 1 from public.game_events where actor_id=p.id and round_no=r.round_no and kind in ('attack','defense'));
  select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc),'[]'::jsonb) into feed from (
    select id,round_no,kind,actor_name,target_name,points,created_at from public.game_events
    where (actor_id=p.id or target_id=p.id) and kind in ('attack','defense','shield') order by id desc limit 15) e;
  return jsonb_build_object('id',p.id,'nickname',p.nickname,'score',p.score,'credits',p.credits,'shield',p.shield,
    'streak',streak,'answered',has_answer,'answer_correct',case when has_answer then ans.is_correct else null end,
    'attacked_this_round',attacked,'feed',feed);
end $$;

-- 11b) Sincronização única do jogador: sala + ranking + estado privado + feed em UMA chamada por segundo.
create or replace function public.hackerz_sync(p_player_id uuid,p_session_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare mine jsonb; rs jsonb; ros jsonb; fd jsonb; v_code text;
begin
  mine := public.hackerz_player_state(p_player_id,p_session_token); -- valida a sessão e registra presença
  select pl.room_code into v_code from public.players pl where pl.id=p_player_id;
  select to_jsonb(s) into rs from public.room_state s where s.code=v_code;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.score desc,x.nickname),'[]'::jsonb) into ros from (
    select pr.id,pr.nickname,pr.score,pr.credits,pr.shield from public.player_roster pr where pr.room_code=v_code) x;
  select coalesce(jsonb_agg(to_jsonb(f) order by f.id desc),'[]'::jsonb) into fd from (
    select rf.id,rf.round_no,rf.kind,rf.actor_name,rf.target_name,rf.points,rf.created_at from public.room_feed rf where rf.room_code=v_code order by rf.id desc limit 30) f;
  return jsonb_build_object('room',rs,'roster',ros,'me',mine,'feed',fd);
end $$;

-- 12) Painel do operador: dados agregados e histórico, autorizados pela credencial do operador.
create or replace function public.hackerz_operator_dashboard(p_code text,p_host_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.rooms;
begin
  select * into r from public.rooms where code=upper(trim(p_code));
  if not found or r.host_token_hash <> encode(extensions.digest(coalesce(p_host_token,''),'sha256'),'hex') then raise exception 'Operador não autorizado'; end if;
  return jsonb_build_object(
    'room',jsonb_build_object('code',r.code,'state',r.state,'round_no',r.round_no,
      'rounds',(r.settings->>'rounds')::int,'seconds',(r.settings->>'seconds')::int,
      'deadline',r.question_deadline,'server_now',now()),
    'totals',(select jsonb_build_object(
        'players',count(*),
        'connected',count(*) filter (where last_seen > now()-interval '15 seconds'),
        'answered',(select count(*) from public.answers a join public.players pp on pp.id=a.player_id where pp.room_code=r.code and a.round_no=r.round_no),
        'shields',coalesce(sum(shield),0))
      from public.players where room_code=r.code),
    'attacks',(select jsonb_build_object(
        'total',count(*) filter (where kind in ('attack','defense')),
        'blocked',count(*) filter (where kind='defense'),
        'points_lost',coalesce(sum(points) filter (where kind='attack'),0))
      from public.game_events where room_code=r.code),
    'players',(select coalesce(jsonb_agg(to_jsonb(x) order by x.score desc,x.nickname),'[]'::jsonb) from (
        select pl.id,pl.nickname,pl.score,pl.credits,pl.shield,
          (pl.last_seen is not null and pl.last_seen > now()-interval '15 seconds') as connected,
          exists(select 1 from public.answers a where a.player_id=pl.id and a.round_no=r.round_no) as answered,
          (select count(*) from public.game_events e where e.actor_id=pl.id and e.kind in ('attack','defense')) as attacks_made,
          (select count(*) from public.game_events e where e.target_id=pl.id and e.kind in ('attack','defense')) as attacks_received,
          (select count(*) from public.game_events e where e.target_id=pl.id and e.kind='defense') as blocked,
          (select coalesce(sum(e.points),0) from public.game_events e where e.target_id=pl.id and e.kind='attack') as points_lost
        from public.players pl where pl.room_code=r.code) x),
    'events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc),'[]'::jsonb) from (
        select id,round_no,kind,actor_name,target_name,points,detail,created_at from public.game_events
        where room_code=r.code order by id desc limit 100) e)
  );
end $$;

-- 13) Permissões: somente as RPCs abaixo ficam expostas ao navegador.
revoke all on function public.hackerz_join_room(text,text,text) from public;
revoke all on function public.hackerz_start_round(text,text,jsonb,int,int) from public;
revoke all on function public.hackerz_answer(uuid,text,int) from public;
revoke all on function public.hackerz_activate_shield(uuid,text) from public;
revoke all on function public.hackerz_attack(uuid,text,uuid) from public;
revoke all on function public.hackerz_finish_room(text,text) from public;
revoke all on function public.hackerz_player_state(uuid,text) from public;
revoke all on function public.hackerz_sync(uuid,text) from public;
revoke all on function public.hackerz_operator_dashboard(text,text) from public;
grant execute on function public.hackerz_join_room(text,text,text) to anon,authenticated;
grant execute on function public.hackerz_start_round(text,text,jsonb,int,int) to anon,authenticated;
grant execute on function public.hackerz_answer(uuid,text,int) to anon,authenticated;
grant execute on function public.hackerz_activate_shield(uuid,text) to anon,authenticated;
grant execute on function public.hackerz_attack(uuid,text,uuid) to anon,authenticated;
grant execute on function public.hackerz_finish_room(text,text) to anon,authenticated;
grant execute on function public.hackerz_player_state(uuid,text) to anon,authenticated;
grant execute on function public.hackerz_sync(uuid,text) to anon,authenticated;
grant execute on function public.hackerz_operator_dashboard(text,text) to anon,authenticated;

commit;
