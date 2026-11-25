-- HackerZ security + gameplay migration
-- Run this file in Supabase SQL Editor. Existing rooms are invalidated when host credentials rotate.
create extension if not exists pgcrypto;

alter table public.rooms add column if not exists host_token_hash text;
alter table public.players add column if not exists session_hash text;

-- Hash legacy host tokens and immediately remove the plaintext column.
update public.rooms set host_token_hash = encode(digest(host_token, 'sha256'), 'hex')
where host_token_hash is null and host_token is not null;
alter table public.rooms drop column if exists host_token;

-- Legacy player rows remain visible in the roster, but cannot submit actions without a newly issued session token.
alter table public.rooms alter column host_token_hash set not null;

alter table public.rooms drop constraint if exists rooms_state_check;
alter table public.rooms add constraint rooms_state_check check (state in ('lobby','playing','finished'));

create or replace view public.room_state with (security_barrier=true) as
select code,state,(current_question-'correct') as current_question,question_deadline,round_no,settings,created_at
from public.rooms;

create or replace view public.player_roster with (security_barrier=true) as
select id,room_code,nickname,credits,score,shield,created_at
from public.players;

revoke all on public.rooms,public.players,public.answers from anon,authenticated;
grant select on public.room_state,public.player_roster to anon,authenticated;

drop function if exists public.hackerz_create_room(text,text,jsonb);
drop function if exists public.hackerz_join_room(text,text);
drop function if exists public.hackerz_start_round(text,text,jsonb,int);
drop function if exists public.hackerz_answer(uuid,int);
drop function if exists public.hackerz_attack(uuid,uuid,text);
drop function if exists public.hackerz_finish_room(text,text);
drop function if exists public.hackerz_activate_shield(uuid,text);

create or replace function public.hackerz_create_room(p_code text,p_host_token text,p_settings jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare clean_code text; rounds_limit int; seconds_limit int;
begin
  clean_code := upper(trim(p_code));
  if clean_code !~ '^[A-Z0-9]{6}$' then raise exception 'Código de sala inválido'; end if;
  if length(coalesce(p_host_token,'')) < 40 then raise exception 'Credencial do operador inválida'; end if;
  rounds_limit := least(greatest(coalesce((p_settings->>'rounds')::int,10),5),20);
  seconds_limit := least(greatest(coalesce((p_settings->>'seconds')::int,20),10),60);
  insert into rooms(code,host_token_hash,settings)
  values(clean_code,encode(digest(p_host_token,'sha256'),'hex'),
    jsonb_build_object('rounds',rounds_limit,'seconds',seconds_limit));
  return jsonb_build_object('code',clean_code,'rounds',rounds_limit,'seconds',seconds_limit);
end $$;

create or replace function public.hackerz_join_room(p_code text,p_nickname text,p_session_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare r rooms; p players; clean_name text;
begin
  clean_name := left(trim(coalesce(p_nickname,'')),18);
  if clean_name = '' then raise exception 'Informe um codinome'; end if;
  if length(coalesce(p_session_token,'')) < 40 then raise exception 'Credencial de jogador inválida'; end if;
  select * into r from rooms where code=upper(trim(p_code)) for update;
  if not found or r.state <> 'lobby' then raise exception 'Sala não encontrada ou já iniciada'; end if;
  if (select count(*) from players where room_code=r.code) >= 30 then raise exception 'Sala cheia'; end if;
  insert into players(room_code,nickname,session_hash,attack_hash)
  values(r.code,clean_name,encode(digest(p_session_token,'sha256'),'hex'),encode(digest(gen_random_uuid()::text,'sha256'),'hex'))
  returning * into p;
  return jsonb_build_object('id',p.id,'nickname',p.nickname,'credits',p.credits,'score',p.score,'shield',p.shield);
end $$;

create or replace function public.hackerz_start_round(p_code text,p_host_token text,p_question jsonb,p_seconds int)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare r rooms; next_round int; max_rounds int; secs int;
begin
  select * into r from rooms where code=upper(trim(p_code)) for update;
  if not found or r.host_token_hash <> encode(digest(coalesce(p_host_token,''),'sha256'),'hex') then raise exception 'Operador não autorizado'; end if;
  if r.state='finished' then raise exception 'Partida já encerrada'; end if;
  max_rounds := least(greatest(coalesce((r.settings->>'rounds')::int,10),5),20);
  next_round := r.round_no+1;
  if next_round > max_rounds then raise exception 'Limite de rodadas atingido. Encerre a partida para ver o ranking.'; end if;
  if coalesce(p_question->>'prompt','')='' or jsonb_array_length(coalesce(p_question->'options','[]'::jsonb))<>4 then raise exception 'Pergunta inválida'; end if;
  if (p_question->>'correct')::int not between 0 and 3 then raise exception 'Alternativa correta inválida'; end if;
  secs := least(greatest(coalesce(p_seconds,20),10),60);
  update rooms set state='playing',current_question=p_question,round_no=next_round,
    question_deadline=now()+make_interval(secs=>secs) where code=r.code;
  return jsonb_build_object('round_no',next_round,'deadline',now()+make_interval(secs=>secs));
end $$;

create or replace function public.hackerz_answer(p_player_id uuid,p_session_token text,p_answer int)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare p players; r rooms; q jsonb; ok boolean; pts int; prior answers;
begin
  select * into p from players where id=p_player_id for update;
  if not found or p.session_hash <> encode(digest(coalesce(p_session_token,''),'sha256'),'hex') then raise exception 'Sessão de jogador inválida'; end if;
  select * into r from rooms where code=p.room_code for update;
  if r.state<>'playing' or r.question_deadline is null or r.question_deadline<now() then raise exception 'Tempo encerrado'; end if;
  if p_answer not between 0 and 3 then raise exception 'Resposta inválida'; end if;
  if exists(select 1 from answers where player_id=p.id and round_no=r.round_no) then raise exception 'Resposta já enviada'; end if;
  q:=r.current_question; ok:=p_answer=(q->>'correct')::int;
  pts:=case when ok then coalesce((q->>'points')::int,100) else 0 end;
  insert into answers(player_id,round_no,is_correct) values(p.id,r.round_no,ok);
  update players set score=score+pts,credits=credits+pts where id=p.id;
  return jsonb_build_object('correct',ok,'points',pts,'explanation',q->>'explanation','round_no',r.round_no);
end $$;

create or replace function public.hackerz_activate_shield(p_player_id uuid,p_session_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare p players;
begin
  select * into p from players where id=p_player_id for update;
  if not found or p.session_hash <> encode(digest(coalesce(p_session_token,''),'sha256'),'hex') then raise exception 'Sessão de jogador inválida'; end if;
  if p.credits<50 then raise exception 'Você precisa de 50 créditos para ativar a defesa'; end if;
  update players set credits=credits-50,shield=shield+1 where id=p.id returning * into p;
  return jsonb_build_object('credits',p.credits,'shield',p.shield,'message','Blindagem digital ativada');
end $$;

create or replace function public.hackerz_finish_room(p_code text,p_host_token text)
returns void language plpgsql security definer set search_path=public,extensions as $$
begin
  if not exists(select 1 from rooms where code=upper(trim(p_code)) and host_token_hash=encode(digest(coalesce(p_host_token,''),'sha256'),'hex')) then
    raise exception 'Operador não autorizado';
  end if;
  update rooms set state='finished' where code=upper(trim(p_code));
end $$;

revoke all on function public.hackerz_create_room(text,text,jsonb) from public;
revoke all on function public.hackerz_join_room(text,text,text) from public;
revoke all on function public.hackerz_start_round(text,text,jsonb,int) from public;
revoke all on function public.hackerz_answer(uuid,text,int) from public;
revoke all on function public.hackerz_activate_shield(uuid,text) from public;
revoke all on function public.hackerz_finish_room(text,text) from public;
grant execute on function public.hackerz_create_room(text,text,jsonb) to anon,authenticated;
grant execute on function public.hackerz_join_room(text,text,text) to anon,authenticated;
grant execute on function public.hackerz_start_round(text,text,jsonb,int) to anon,authenticated;
grant execute on function public.hackerz_answer(uuid,text,int) to anon,authenticated;
grant execute on function public.hackerz_activate_shield(uuid,text) to anon,authenticated;
grant execute on function public.hackerz_finish_room(text,text) to anon,authenticated;

do $$ begin alter publication supabase_realtime add table public.rooms; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.players; exception when duplicate_object then null; end $$;
