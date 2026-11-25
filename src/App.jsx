import React,{useCallback,useEffect,useMemo,useRef,useState} from "react";
import {createClient} from "@supabase/supabase-js";
import {LEVELS,pickQuestion} from "./questions";

const supabaseUrl=import.meta.env.VITE_SUPABASE_URL;
const supabaseKey=import.meta.env.VITE_SUPABASE_ANON_KEY;
const db=supabaseUrl&&supabaseKey?createClient(supabaseUrl,supabaseKey):null;
const makeToken=()=>{const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);return [...bytes].map(v=>v.toString(16).padStart(2,"0")).join("");};
const makeCode=()=>[...crypto.getRandomValues(new Uint8Array(8))].map(v=>"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[v%32]).join("").slice(0,6);
const storeKey=(kind,room)=>"hackerz:"+kind+":"+room;
const readSession=(kind,room)=>{try{return JSON.parse(sessionStorage.getItem(storeKey(kind,room))||"null")}catch{return null}};
const saveSession=(kind,room,value)=>sessionStorage.setItem(storeKey(kind,room),JSON.stringify(value));

export default function App(){
 const [screen,setScreen]=useState("home"),[nickname,setNickname]=useState(""),[room,setRoom]=useState(""),[isHost,setIsHost]=useState(false);
 const [hostToken,setHostToken]=useState(""),[player,setPlayer]=useState(null),[playerToken,setPlayerToken]=useState("");
 const [players,setPlayers]=useState([]),[question,setQuestion]=useState(null),[answer,setAnswer]=useState(null),[seconds,setSeconds]=useState(20);
 const [round,setRound]=useState(0),[settings,setSettings]=useState({rounds:10,seconds:20}),[notice,setNotice]=useState(""),[used,setUsed]=useState([]);
 const [feedback,setFeedback]=useState(""),[busy,setBusy]=useState(false),[localScore,setLocalScore]=useState(0);
 const lastRound=useRef(0);
 const score=player?.score??localScore;
 const showNotice=message=>{setNotice(message);window.clearTimeout(showNotice.timer);showNotice.timer=window.setTimeout(()=>setNotice(""),4500)};
 const roster=useCallback(async()=>{
   if(!db||!room)return;
   const {data,error}=await db.from("player_roster").select("id,nickname,score,credits,shield").eq("room_code",room).order("score",{ascending:false});
   if(error){showNotice(error.message);return;} setPlayers(data||[]);
 },[room]);
 const syncRoom=useCallback(async()=>{
   if(!db||!room)return;
   const {data:r,error}=await db.from("room_state").select("state,current_question,round_no,question_deadline,settings").eq("code",room).maybeSingle();
   if(error){showNotice(error.message);return;}
   if(!r)return;
   if(r.settings)setSettings(r.settings);
   if(r.state==="finished"){setScreen("results");return;}
   if(r.state==="playing"&&r.current_question){
     setQuestion(r.current_question);setRound(r.round_no);
     setSeconds(Math.max(0,Math.ceil((new Date(r.question_deadline).getTime()-Date.now())/1000)));
     if(lastRound.current!==r.round_no){lastRound.current=r.round_no;setAnswer(null);setFeedback("");}
     setScreen("question");
   }else if(r.state==="lobby"&&!isHost)setScreen("lobby");
 },[room,isHost]);
 const refresh=useCallback(async()=>{await Promise.all([roster(),syncRoom()]);},[roster,syncRoom]);
 useEffect(()=>{if(!db||!room)return;refresh();const channel=db.channel("hackerz-"+room).on("postgres_changes",{event:"*",schema:"public",table:"players",filter:"room_code=eq."+room},()=>roster()).on("postgres_changes",{event:"*",schema:"public",table:"rooms",filter:"code=eq."+room},()=>syncRoom()).subscribe();return()=>{db.removeChannel(channel)};},[room,refresh,roster,syncRoom]);
 useEffect(()=>{if(screen!=="question"||answer!==null)return;const timer=window.setInterval(()=>setSeconds(v=>Math.max(0,v-1)),1000);return()=>window.clearInterval(timer);},[screen,round,answer]);
 useEffect(()=>{if(screen==="question"&&seconds===0&&answer===null){setAnswer(-1);setFeedback("Tempo encerrado. Aguarde a próxima rodada.");}},[seconds,screen,answer]);
 useEffect(()=>{
   if(!db||!room)return;
   const host=readSession("host",room),guest=readSession("player",room);
   if(host?.token){setHostToken(host.token);setIsHost(true);setRoom(room);setNickname(host.nickname||"");setScreen("host");}
   else if(guest?.id&&guest?.token){setPlayer({id:guest.id,nickname:guest.nickname,score:0,credits:0,shield:0});setPlayerToken(guest.token);setNickname(guest.nickname);setScreen("lobby");}
 },[]);
 async function createRoom(){
   if(!nickname.trim())return showNotice("Escolha seu codinome para continuar.");
   if(!db)return showNotice("Configure o Supabase para criar uma sala multiplayer.");
   setBusy(true);try{
     const code=makeCode(),token=makeToken();
     const {error}=await db.rpc("hackerz_create_room",{p_code:code,p_host_token:token,p_settings:settings});
     if(error)throw error;
     const sessionToken=makeToken();
     const {data,error:joinError}=await db.rpc("hackerz_join_room",{p_code:code,p_nickname:nickname.trim(),p_session_token:sessionToken});
     if(joinError)throw joinError;
     saveSession("host",code,{token,nickname:nickname.trim()});
     saveSession("player",code,{id:data.id,token:sessionToken,nickname:data.nickname});
     setRoom(code);setHostToken(token);setPlayerToken(sessionToken);setPlayer(data);setIsHost(true);setScreen("host");showNotice("Sala criada. Compartilhe o código com os jogadores.");
   }catch(e){showNotice(e.message||"Não foi possível criar a sala.");}finally{setBusy(false);}
 }
 async function joinRoom(){
   if(!nickname.trim()||room.trim().length!==6)return showNotice("Informe seu codinome e o código de 6 caracteres.");
   if(!db)return showNotice("O modo multiplayer exige conexão com o Supabase.");
   setBusy(true);try{
     const token=makeToken(),{data,error}=await db.rpc("hackerz_join_room",{p_code:room.trim().toUpperCase(),p_nickname:nickname.trim(),p_session_token:token});
     if(error)throw error;
     saveSession("player",room.trim().toUpperCase(),{id:data.id,token,nickname:data.nickname});
     setPlayer(data);setPlayerToken(token);setRoom(room.trim().toUpperCase());setIsHost(false);setScreen("lobby");showNotice("Você entrou na sala.");
   }catch(e){showNotice(e.message||"Não foi possível entrar.");}finally{setBusy(false);}
 }
 async function startRound(){
   if(!isHost||busy)return;
   if(round>=(settings.rounds||10))return finishRoom();
   const level=LEVELS[Math.floor(Math.random()*LEVELS.length)].id,next=pickQuestion(level,used);
   setBusy(true);try{
     const {error}=await db.rpc("hackerz_start_round",{p_code:room,p_host_token:hostToken,p_question:next,p_seconds:settings.seconds,p_rounds:settings.rounds});
     if(error)throw error;
     setUsed(v=>[...v,next.id]);lastRound.current=0;await syncRoom();
   }catch(e){showNotice(e.message||"Não foi possível iniciar a rodada.");}finally{setBusy(false);}
 }
 async function submitAnswer(index){
   if(answer!==null||!question||busy)return;
   setAnswer(index);setBusy(true);
   try{
     const {data,error}=await db.rpc("hackerz_answer",{p_player_id:player.id,p_session_token:playerToken,p_answer:index});
     if(error)throw error;
     setFeedback((data.explanation||"Resposta registrada.")+(data.correct?"  •  +"+data.points+" XP":""));
     await roster();
   }catch(e){setAnswer(null);showNotice(e.message||"Não foi possível registrar a resposta.");}finally{setBusy(false);}
 }
 async function activateShield(){
   if(!player||busy)return;setBusy(true);
   try{const {data,error}=await db.rpc("hackerz_activate_shield",{p_player_id:player.id,p_session_token:playerToken});if(error)throw error;setPlayer(v=>({...v,credits:data.credits,shield:data.shield}));showNotice(data.message);}
   catch(e){showNotice(e.message||"Não foi possível ativar a blindagem.");}finally{setBusy(false);}
 }
 async function finishRoom(){
   if(!isHost)return;setBusy(true);
   try{const {error}=await db.rpc("hackerz_finish_room",{p_code:room,p_host_token:hostToken});if(error)throw error;setScreen("results");await roster();}
   catch(e){showNotice(e.message||"Não foi possível encerrar a partida.");}finally{setBusy(false);}
 }
 const ordered=useMemo(()=>[...players].sort((a,b)=>(b.score||0)-(a.score||0)),[players]);
 const copyRoom=async()=>{try{await navigator.clipboard.writeText(room);showNotice("Código copiado.");}catch{showNotice("Código da sala: "+room);}};
 const logout=()=>{if(room){sessionStorage.removeItem(storeKey("host",room));sessionStorage.removeItem(storeKey("player",room));}setScreen("home");setRoom("");setPlayer(null);setHostToken("");setPlayerToken("");setIsHost(false);setQuestion(null);setAnswer(null);};
 return <div className="app-shell">
  <header className="topbar"><a className="brand" href="#" onClick={e=>{e.preventDefault();if(screen==="home")return;showNotice("Sua sessão continua ativa nesta aba.");}}><img src="/hackerz-mark.svg" alt="HackerZ"/><span><b>HACKER<span>Z</span></b><small>THE DIGITAL UNDERWORLD</small></span></a>
   <div className="top-status"><i/>{db?"NETWORK ONLINE":"OFFLINE BUILD"}{room&&<button onClick={copyRoom}>ROOM // {room}</button>}</div>
  </header>
  {notice&&<button className="toast" onClick={()=>setNotice("")}>{notice}<b>×</b></button>}
  {screen==="home"&&<main className="landing">
    <div className="landing-copy"><div className="eyebrow"><span/> DIGITAL SURVIVAL PROTOCOL <span className="eyebrow-line"/></div>
     <h1>ENTER THE<br/><em>UNDERWORLD.</em></h1>
     <p className="lead">Conhecimento é poder. Encare desafios sobre redes sociais, privacidade e saúde digital. Sobreviva ao ruído. Domine o sistema.</p>
     <div className="landing-tags"><span>01 / THINK FAST</span><span>02 / STAY SHARP</span><span>03 / PROTECT YOURSELF</span></div>
     <div className="hero-seal"><img src="/hackerz-mark.svg" alt="Símbolo HackerZ"/><span>HACKERZ<br/>DIGITAL ARENA</span></div>
    </div>
    <section className="access-card"><div className="card-kicker">/// ACCESS TERMINAL</div><h2>CHOOSE YOUR<br/>OPERATION.</h2>
      <label>CODENAME</label><input value={nickname} onChange={e=>setNickname(e.target.value)} maxLength={18} placeholder="ex: NIGHTFALL"/>
      <button className="btn-primary" disabled={busy} onClick={createRoom}>{busy?"INITIALIZING...":"＋ CREATE A ROOM"}</button>
      <div className="separator"><span>OR JOIN AN EXISTING ROOM</span></div>
      <label>ROOM ACCESS CODE</label><input value={room} onChange={e=>setRoom(e.target.value.toUpperCase())} maxLength={6} placeholder="6-DIGIT CODE"/>
      <button className="btn-outline" disabled={busy} onClick={joinRoom}>CONNECT TO NETWORK <b>↗</b></button>
      <div className="card-foot"><span>UP TO 30 OPERATORS</span><span>4 DIFFICULTY TIERS</span></div>
    </section>
  </main>}
  {(screen==="host"||screen==="lobby")&&<main className="game-layout">
    <section className="game-main panel-dark"><div className="section-kicker">/// OPERATIONS ROOM <span>SECURE CHANNEL</span></div><div className="room-heading"><div><h1>{isHost?"MISSION CONTROL":"STANDBY MODE"}</h1><p>{isHost?"Gerencie a sessão e inicie os desafios.":"Aguarde o operador iniciar a próxima rodada."}</p></div><div className="room-chip"><small>ROOM CODE</small><b>{room}</b><button onClick={copyRoom}>COPY</button></div></div>
      <div className="metric-row"><div><strong>{players.length.toString().padStart(2,"0")}</strong><small>OPERATORS</small></div><div><strong>30</strong><small>MAX CAPACITY</small></div><div><strong>{round.toString().padStart(2,"0")}<i>/{settings.rounds}</i></strong><small>ROUND</small></div></div>
      <div className="roster-head"><h3>CONNECTED OPERATORS</h3><span>{players.length} ACTIVE</span></div>
      <div className="operator-list">{ordered.length?ordered.map((p,i)=><div className="operator-row" key={p.id}><b className="operator-index">{String(i+1).padStart(2,"0")}</b><span className="operator-dot"/><strong>{p.nickname}</strong><span className="operator-score">{p.score||0} XP</span></div>):<p className="empty-state">Aguardando conexões...</p>}</div>
      {isHost&&<div className="settings-box"><div className="roster-head"><h3>MISSION PARAMETERS</h3><span>HOST ONLY</span></div><label>ROUNDS <b>{settings.rounds}</b></label><input type="range" min="5" max="20" value={settings.rounds} onChange={e=>setSettings(v=>({...v,rounds:+e.target.value}))}/><label>TIME PER QUESTION <b>{settings.seconds}s</b></label><input type="range" min="10" max="60" step="5" value={settings.seconds} onChange={e=>setSettings(v=>({...v,seconds:+e.target.value}))}/><button className="btn-primary wide" disabled={busy} onClick={startRound}>▶ {round?"START NEXT ROUND":"START OPERATION"}</button><button className="btn-danger wide" disabled={busy} onClick={finishRoom}>END OPERATION</button></div>}
    </section>
    <aside className="side-column"><section className="panel-dark side-panel"><div className="section-kicker">/// DEFENSE MODULE</div><div className="shield-art">⬡</div><h2>HARDEN YOUR<br/>DIGITAL ARMOR.</h2><p>Ganhe créditos acertando perguntas. Use 50 créditos para ativar uma camada extra de blindagem no seu perfil.</p><div className="credit-line"><span>AVAILABLE CREDITS</span><b>{player?.credits??0} CR</b></div><div className="credit-line"><span>ACTIVE SHIELDS</span><b>{player?.shield??0}</b></div><button className="btn-outline wide" disabled={!player||busy} onClick={activateShield}>ACTIVATE SHIELD <b>↗</b></button></section>
    <section className="quote-panel"><span>FIELD NOTE // 001</span><p>“Nem todo link merece um clique. Nem toda notificação merece sua atenção.”</p></section></aside>
  </main>}
  {screen==="question"&&question&&<main className="question-wrap panel-dark"><div className="section-kicker">/// LIVE CHALLENGE <span>ROUND {round}</span></div><div className="question-head"><div><span className="difficulty">{LEVELS.find(x=>x.id===question.level)?.label||"CHALLENGE"}</span><h1>{question.prompt}</h1></div><div className="countdown"><strong>{seconds.toString().padStart(2,"0")}</strong><small>SECONDS</small></div></div><div className="timer-track"><i style={{width:Math.max(0,seconds/(settings.seconds||20)*100)+"%"}}/></div><div className="question-meta"><span>REWARD / {question.points} XP</span><span>SELECT ONE ANSWER</span></div><div className="answer-grid">{question.options.map((option,i)=><button key={i} disabled={answer!==null||busy} className={"answer-card "+(answer===i?"selected":"")} onClick={()=>submitAnswer(i)}><b>{String.fromCharCode(65+i)}</b><span>{option}</span><i>↗</i></button>)}</div>{feedback&&<div className="feedback-box">{feedback}</div>}{answer===-1&&<div className="feedback-box">Tempo encerrado. A próxima rodada será iniciada pelo operador.</div>}<div className="question-bottom"><span>YOUR SCORE <b>{score} XP</b></span><span>PLAYER / {player?.nickname}</span></div></main>}
  {screen==="results"&&<main className="results-wrap panel-dark"><div className="section-kicker">/// OPERATION COMPLETE</div><div className="results-title"><span>FINAL SCOREBOARD</span><h1>THE LAST<br/><em>OPERATORS.</em></h1></div>{ordered.map((p,i)=><div className="result-row" key={p.id}><b>{String(i+1).padStart(2,"0")}</b><span>{p.nickname}</span><strong>{p.score||0} XP</strong></div>)}<button className="btn-outline wide" onClick={logout}>RETURN TO MAIN MENU</button></main>}
  <footer className="site-footer"><span>HACKERZ // DIGITAL ARENA © 2026</span><span>STAY SHARP. STAY HUMAN.</span></footer>
 </div>;
}
