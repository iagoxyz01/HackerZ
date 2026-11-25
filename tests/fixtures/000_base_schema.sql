create extension if not exists pgcrypto;
create table if not exists public.rooms(code text primary key check(length(code)=6),host_token text not null,state text not null default 'lobby' check(state in('lobby','playing','finished')),current_question jsonb,question_deadline timestamptz,round_no int not null default 0,settings jsonb not null default '{"rounds":10,"seconds":20}'::jsonb,created_at timestamptz not null default now());
create table if not exists public.players(id uuid primary key default gen_random_uuid(),room_code text not null references public.rooms(code) on delete cascade,nickname text not null check(length(nickname) between 1 and 18),attack_hash text not null,credits int not null default 0,score int not null default 0,shield int not null default 0,created_at timestamptz not null default now(),unique(room_code,nickname));
create table if not exists public.answers(id bigint generated always as identity primary key,player_id uuid not null references public.players(id) on delete cascade,round_no int not null,is_correct boolean not null,unique(player_id,round_no));
alter table public.rooms enable row level security;alter table public.players enable row level security;alter table public.answers enable row level security;
create policy "read room state" on public.rooms for select using(true);
create policy "read player roster" on public.players for select using(true);
revoke all on public.rooms,public.players,public.answers from anon,authenticated;
grant select on public.rooms,public.players to anon,authenticated;
create or replace function public.hackerz_join_room(p_code text,p_nickname text) returns jsonb language plpgsql security definer set search_path=public as $$
declare r rooms;p players;
begin select * into r from rooms where code=upper(p_code) for update;
if not found or r.state<>'lobby' then raise exception 'Sala não encontrada ou já iniciada';end if;
if (select count(*) from players where room_code=r.code)>=30 then raise exception 'Sala cheia';end if;
insert into players(room_code,nickname,attack_hash) values(r.code,left(trim(p_nickname),18),encode(digest(gen_random_uuid()::text,'sha256'),'hex')) returning * into p;
return jsonb_build_object('id',p.id,'nickname',p.nickname,'credits',p.credits,'score',p.score,'shield',p.shield);end $$;
create or replace function public.hackerz_start_round(p_code text,p_host_token text,p_question jsonb,p_seconds int) returns void language plpgsql security definer set search_path=public as $$
declare r rooms;
begin select * into r from rooms where code=upper(p_code) for update;
if not found or r.host_token<>p_host_token then raise exception 'Operador não autorizado';end if;
update rooms set state='playing',current_question=p_question,round_no=round_no+1,question_deadline=now()+make_interval(secs=>least(greatest(p_seconds,10),60)) where code=r.code;end $$;
create or replace function public.hackerz_answer(p_player_id uuid,p_answer int) returns jsonb language plpgsql security definer set search_path=public as $$
declare p players;r rooms;q jsonb;ok boolean;pts int;
begin select * into p from players where id=p_player_id for update;if not found then raise exception 'Jogador inválido';end if;
select * into r from rooms where code=p.room_code for update;if r.state<>'playing' or r.question_deadline<now() then raise exception 'Tempo encerrado';end if;
q:=r.current_question;if exists(select 1 from answers where player_id=p.id and round_no=r.round_no) then raise exception 'Resposta já enviada';end if;
ok:=p_answer=(q->>'correct')::int;pts:=case when ok then coalesce((q->>'points')::int,100) else 0 end;
insert into answers(player_id,round_no,is_correct) values(p.id,r.round_no,ok);update players set score=score+pts,credits=credits+pts where id=p.id;
return jsonb_build_object('correct',ok,'points',pts,'explanation',q->>'explanation');end $$;
create or replace function public.hackerz_attack(p_attacker_id uuid,p_target_id uuid,p_guess text) returns jsonb language plpgsql security definer set search_path=public as $$
declare a players;t players;
begin select * into a from players where id=p_attacker_id for update;select * into t from players where id=p_target_id for update;
if a.id is null or t.id is null or a.id=t.id or a.room_code<>t.room_code then raise exception 'Alvo inválido';end if;
if a.credits<50 then raise exception 'São necessários 50 créditos';end if;
update players set credits=credits-50 where id=a.id;
if encode(digest(p_guess,'sha256'),'hex')=t.attack_hash then
if t.shield>0 then update players set shield=shield-1 where id=t.id;return jsonb_build_object('success',false,'message','Escudo bloqueou a invasão.');end if;
update players set credits=greatest(0,credits-100) where id=t.id;update players set credits=credits+100,score=score+100 where id=a.id;
return jsonb_build_object('success',true,'message','Invasão bem-sucedida: +100 créditos.');end if;
return jsonb_build_object('success',false,'message','Senha incorreta. 50 créditos consumidos.');end $$;
grant execute on function public.hackerz_join_room(text,text),public.hackerz_start_round(text,text,jsonb,int),public.hackerz_answer(uuid,int),public.hackerz_attack(uuid,uuid,text) to anon,authenticated;
alter publication supabase_realtime add table public.rooms;alter publication supabase_realtime add table public.players;
