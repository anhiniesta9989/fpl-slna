const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  mode: 'live',
  managerId: 2320843,
  bootstrap: null,
  fixtures: [],
  manager: null,
  history: null,
  picks: null,
  gw: null,
  playersById: new Map(),
  teamsById: new Map(),
  planned: JSON.parse(localStorage.getItem('fpl-planned-transfers') || '[]'),
  ft: Number(localStorage.getItem('fpl-ft') || 3),
  opponent: null,
  currentOverrides: JSON.parse(localStorage.getItem('fpl-current-overrides') || JSON.stringify([
    {outName:'Mosquera', inName:'Konsa'},
    {outName:'Igor Jesus', inName:'Wissa'}
  ])),
};

// v3 migration: current confirmed state after GW4 transfers Mosquera→Konsa and Igor Jesus→Wissa.
// Runs once per browser origin; user can still edit FT manually afterwards.
if (!localStorage.getItem('fpl-v3-state-migrated')) {
  state.ft = 1;
  localStorage.setItem('fpl-ft', '1');
  localStorage.setItem('fpl-current-overrides', JSON.stringify(state.currentOverrides));
  localStorage.setItem('fpl-v3-state-migrated', '1');
}

const posName = {1:'GK',2:'DEF',3:'MID',4:'FWD'};
const posOrder = [1,2,3,4];

function fmtMoney(cost) { return `£${(Number(cost||0)/10).toFixed(1)}m`; }
function fmtNum(n) { return new Intl.NumberFormat('vi-VN').format(Number(n||0)); }
function deadlineText(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('vi-VN', { dateStyle:'short', timeStyle:'short' });
}
function setStatus(text, kind='') { const el=$('#statusBar'); el.textContent=text; el.className=`status-bar ${kind}`; }

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) { const e=await r.json().catch(()=>({})); throw new Error(e.detail || e.error || `HTTP ${r.status}`); }
  return r.json();
}

function chooseEvent(events) {
  return events.find(e=>e.is_current) || events.find(e=>e.is_next) || [...events].reverse().find(e=>e.finished) || events[0];
}

async function loadLive(teamId) {
  state.mode='live'; state.managerId=Number(teamId);
  setStatus('Đang tải dữ liệu từ public FPL API…');
  const [bootstrap, fixtures, manager, history] = await Promise.all([
    getJson('/api/fpl/bootstrap'), getJson('/api/fpl/fixtures'), getJson(`/api/fpl/entry/${teamId}`), getJson(`/api/fpl/history/${teamId}`)
  ]);
  state.bootstrap=bootstrap; state.fixtures=fixtures; state.manager=manager; state.history=history;
  state.gw=chooseEvent(bootstrap.events);
  state.playersById=new Map(bootstrap.elements.map(p=>[p.id,p]));
  state.teamsById=new Map(bootstrap.teams.map(t=>[t.id,t]));

  const completed = [...bootstrap.events].filter(e=>e.finished || e.is_current).map(e=>e.id);
  const publicGw = completed.length ? Math.max(...completed) : Math.max(1, state.gw.id-1);
  try { state.picks=await getJson(`/api/fpl/picks/${teamId}/${publicGw}`); }
  catch { state.picks=null; }
  setStatus(`Live mode • Team ${teamId} • public squad source GW${publicGw}`, 'good');
  render();
}

function loadDemo() {
  state.mode='demo'; const d=window.FPL_DEMO;
  state.managerId=d.manager.id; state.manager=d.manager; state.gw=d.event; state.picks=d.picks; state.fixtures=[];
  state.bootstrap={elements:d.players,teams:d.teams,events:[d.event]};
  state.playersById=new Map(d.players.map(p=>[p.id,p])); state.teamsById=new Map(d.teams.map(t=>[t.id,t]));
  setStatus('Demo offline • dữ liệu minh họa từ squad hiện tại của bạn', 'warn');
  render();
}

function nextFixture(player, gw=state.gw?.id) {
  if (player.demo_fixture) return player.demo_fixture;
  if (!state.fixtures?.length || !gw) return '—';
  const f=state.fixtures.find(x=>x.event===gw && (x.team_h===player.team || x.team_a===player.team));
  if (!f) return '—';
  const oppId=f.team_h===player.team ? f.team_a : f.team_h;
  const opp=state.teamsById.get(oppId)?.short_name || '?';
  return f.team_h===player.team ? `${opp} (H)` : `${opp} (A)`;
}

function nextFixtures(player, count=4) {
  if (!state.fixtures?.length) return [];
  const nowGw=state.gw?.id || 1;
  return state.fixtures.filter(f=>f.event>=nowGw && (f.team_h===player.team || f.team_a===player.team)).sort((a,b)=>(a.event||99)-(b.event||99)).slice(0,count).map(f=>{
    const home=f.team_h===player.team;
    return { difficulty: home ? f.team_h_difficulty : f.team_a_difficulty, home, event:f.event };
  });
}

function startConfidence(p) {
  if (p.demo_start != null) return p.demo_start;
  if (p.chance_of_playing_next_round != null) return Math.max(5, Math.min(99, p.chance_of_playing_next_round));
  if (p.status && p.status !== 'a') return p.status==='d' ? 55 : 10;
  const gwPlayed=Math.max(1,(state.gw?.id||1)-1);
  const startsRate=Math.min(1, Number(p.starts||0)/gwPlayed);
  const minRate=Math.min(1, Number(p.minutes||0)/(gwPlayed*90));
  return Math.round(62 + 20*startsRate + 13*minRate);
}

function holdScore(p) {
  if (p.demo_hold != null) return p.demo_hold;
  const price=Math.max(3.8,Number(p.now_cost||50)/10);
  const form=Math.min(10,Number(p.form||0));
  const ppg=Math.min(10,Number(p.points_per_game||0));
  const xgi=Math.min(5,Number(p.expected_goal_involvements||0));
  const fixtures=nextFixtures(p,4);
  const avgFdr=fixtures.length ? fixtures.reduce((s,f)=>s+Number(f.difficulty||3),0)/fixtures.length : 3;
  const fixtureScore=Math.max(0,10-(avgFdr-1)*2.1);
  const minutes=startConfidence(p)/10;
  const value=Math.min(10,(Number(p.total_points||0)+1)/price*1.7);
  const raw=.24*form+.18*ppg+.16*Math.min(10,xgi*2)+.18*fixtureScore+.16*minutes+.08*value;
  return Math.max(1,Math.min(10,Math.round(raw*10)/10));
}

function mainSignal(p, hold, start) {
  const setPiece = Number(p.penalties_order||0)===1 ? 'Pens' : Number(p.corners_and_indirect_freekicks_order||0)===1 ? 'Set pieces' : '';
  if (start<55) return '⬇ Minutes risk';
  if (hold>=9) return `🔒 Core${setPiece?` • ${setPiece}`:''}`;
  if (hold>=7.5) return `✅ Hold${setPiece?` • ${setPiece}`:''}`;
  if (hold<5) return '⚠️ Sell watch';
  return `↔ Hold/Watch${setPiece?` • ${setPiece}`:''}`;
}

function currentSquad() {
  if (!state.picks) return [];
  const base=[...state.picks.picks].sort((a,b)=>a.position-b.position).map(pk=>({pick:pk,player:state.playersById.get(pk.element)})).filter(x=>x.player);
  return applyCurrentOverrides(base);
}

function plannedSquad() {
  let squad=currentSquad().map(x=>({...x, player:{...x.player}}));
  for (const tr of state.planned) {
    const idx=squad.findIndex(x=>x.player.id===tr.outId);
    const inp=state.playersById.get(tr.inId);
    if (idx>=0 && inp) squad[idx]={...squad[idx], player:inp, pick:{...squad[idx].pick,element:inp.id}};
  }
  return squad;
}

function optimalXI(squad) {
  const all=squad.map(x=>({ ...x, score: holdScore(x.player)*.55 + startConfidence(x.player)*.035 + fixtureBonus(x.player) }));
  const byPos={1:[],2:[],3:[],4:[]}; all.forEach(x=>byPos[x.player.element_type]?.push(x));
  Object.values(byPos).forEach(a=>a.sort((a,b)=>b.score-a.score));
  const xi=[...(byPos[1]||[]).slice(0,1),...(byPos[2]||[]).slice(0,3),...(byPos[3]||[]).slice(0,4),...(byPos[4]||[]).slice(0,3)];
  // 3-4-3 default; if only 2 FWD, add MID; if only 4 MID etc.
  while (xi.length<11) {
    const remaining=all.filter(x=>!xi.includes(x) && x.player.element_type!==1).sort((a,b)=>b.score-a.score);
    if (!remaining.length) break;
    const candidate=remaining.find(x=>{
      const cnt=xi.filter(y=>y.player.element_type===x.player.element_type).length;
      return (x.player.element_type===2 && cnt<5)||(x.player.element_type===3 && cnt<5)||(x.player.element_type===4 && cnt<3);
    });
    if (!candidate) break; xi.push(candidate);
  }
  return xi.slice(0,11);
}
function fixtureBonus(p) {
  const fx=nextFixtures(p,1)[0]; if (!fx) return 0;
  return (6-Number(fx.difficulty||3))*.35;
}

function formationLabel(xi) {
  const counts={2:0,3:0,4:0}; xi.forEach(x=>{if(counts[x.player.element_type]!=null) counts[x.player.element_type]++;});
  return `${counts[2]}-${counts[3]}-${counts[4]}`;
}


const kitStyles = {
  ARS:'linear-gradient(90deg,#f5f5f5 0 18%,#d71920 18% 82%,#f5f5f5 82%)',
  AVL:'linear-gradient(90deg,#6aaee8 0 18%,#7a263a 18% 82%,#6aaee8 82%)',
  BOU:'repeating-linear-gradient(90deg,#d71920 0 12px,#111 12px 24px)',
  BRE:'repeating-linear-gradient(90deg,#fff 0 12px,#d71920 12px 24px)',
  BHA:'repeating-linear-gradient(90deg,#fff 0 12px,#0057b8 12px 24px)',
  CHE:'#034694', COV:'#5bbfe8', CRY:'linear-gradient(90deg,#17479e 0 50%,#d71920 50%)',
  EVE:'#003399', FUL:'linear-gradient(90deg,#fff 0 72%,#111 72%)', HUL:'repeating-linear-gradient(90deg,#f5a623 0 14px,#111 14px 28px)',
  IPS:'#0057b8', LEE:'linear-gradient(90deg,#fff 0 70%,#f5e642 70%)', LIV:'#c8102e', MCI:'#6cabdd', MUN:'#da291c',
  NEW:'repeating-linear-gradient(90deg,#fff 0 12px,#111 12px 24px)', NFO:'#dd0000', SUN:'repeating-linear-gradient(90deg,#fff 0 12px,#d71920 12px 24px)',
  TOT:'#f6f6f6', WHU:'linear-gradient(90deg,#7a263a 0 72%,#6aaee8 72%)', WOL:'#fdb913'
};
function teamShort(p){ return state.teamsById.get(p.team)?.short_name || 'FPL'; }
function kitHtml(p){
  const short=teamShort(p); const bg=kitStyles[short] || '#77839a';
  return `<div class="kit-wrap"><div class="kit-shirt" style="--kit-bg:${bg}"><span class="kit-crest">${escapeHtml(short)}</span></div></div>`;
}
function normalizeName(v=''){ return String(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,''); }
function findPlayerByName(name){
  const n=normalizeName(name); return [...state.playersById.values()].find(p=>normalizeName(p.web_name)===n || normalizeName(p.first_name+' '+p.second_name)===n) ||
    [...state.playersById.values()].find(p=>normalizeName(p.web_name).includes(n) || n.includes(normalizeName(p.web_name)));
}
function applyCurrentOverrides(squad){
  let out=squad.map(x=>({...x,player:{...x.player},pick:{...x.pick}}));
  for(const tr of state.currentOverrides){
    const idx=out.findIndex(x=>normalizeName(x.player.web_name)===normalizeName(tr.outName));
    if(idx<0) continue;
    const inp=findPlayerByName(tr.inName); if(!inp) continue;
    out[idx]={...out[idx],player:inp,pick:{...out[idx].pick,element:inp.id}};
  }
  return out;
}

function playerChip(x, captainId, viceId) {
  const p=x.player; const cls=p.id===captainId?'captain':p.id===viceId?'vice':'';
  const team=teamShort(p);
  const marker=p.id===captainId?'<span class="cap-badge">C</span>':p.id===viceId?'<span class="cap-badge vice-badge">V</span>':'';
  return `<div class="player-chip ${cls}">${marker}${kitHtml(p)}<div class="pname">${escapeHtml(p.web_name)}</div><div class="fixture">${team} • ${escapeHtml(nextFixture(p))}</div></div>`;
}
function escapeHtml(s='') { return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

function renderPitch(target, squad, planned=false) {
  const xi= planned ? optimalXI(squad) : squad.filter(x=>Number(x.pick.multiplier)>0).slice(0,11);
  const fallback=xi.length===11 ? xi : optimalXI(squad);
  const cap=squad.find(x=>x.pick.is_captain)?.player.id;
  const vc=squad.find(x=>x.pick.is_vice_captain)?.player.id;
  target.innerHTML=posOrder.map(pos=>{
    const row=fallback.filter(x=>x.player.element_type===pos);
    if (!row.length) return '';
    return `<div class="pitch-row">${row.map(x=>playerChip(x,cap,vc)).join('')}</div>`;
  }).join('');
  return {xi:fallback, formation:formationLabel(fallback)};
}

function renderOverview() {
  const squad=currentSquad();
  const manager=state.manager||{}; const eh=state.picks?.entry_history||{};
  $('#metricGw').textContent=state.gw?`GW${state.gw.id}`:'—';
  $('#metricDeadline').textContent=state.gw?.deadline_time ? `Deadline ${deadlineText(state.gw.deadline_time)}` : '—';
  $('#metricPoints').textContent=eh.points ?? manager.summary_overall_points ?? '—';
  $('#metricRank').textContent=manager.summary_overall_rank ? `OR ${fmtNum(manager.summary_overall_rank)}` : '—';
  const val=eh.value ?? manager.last_deadline_value; const bank=eh.bank ?? manager.last_deadline_bank;
  $('#metricValue').textContent=val!=null?fmtMoney(val):'—'; $('#metricBank').textContent=bank!=null?`Bank ${fmtMoney(bank)}`:'—';
  $('#metricFt').textContent=state.ft;
  $('#ftInput').value=state.ft;
  $('#managerInfo').innerHTML=`<div><span class="muted">Manager</span><br><strong>${escapeHtml([manager.player_first_name,manager.player_last_name].filter(Boolean).join(' ')||'—')}</strong></div><div><span class="muted">Team</span><br>${escapeHtml(manager.name||`Team ${state.managerId}`)}</div><div><span class="muted">ID</span><br>${state.managerId}</div>`;

  if (!squad.length) {
    $('#pitch').innerHTML='<div class="empty">Public picks chưa khả dụng cho GW này.</div>';
    $('#playerTable tbody').innerHTML=''; return;
  }

  const rendered=renderPitch($('#pitch'),squad,false);
  $('#formationBadge').textContent=rendered.formation;
  $('#squadSource').textContent=state.mode==='demo'?'Current GW4 local squad':'Public picks gần nhất + local transfers Konsa/Wissa';
  const bench=squad.filter(x=>Number(x.pick.multiplier)===0).sort((a,b)=>a.pick.position-b.pick.position);
  $('#bench').innerHTML=bench.map((x,i)=>`<div class="bench-item"><div class="bench-label">${i===0&&x.player.element_type===1?'GK':i}</div>${kitHtml(x.player)}<strong>${escapeHtml(x.player.web_name)}</strong><span class="muted">${escapeHtml(nextFixture(x.player))}</span></div>`).join('');
  const cap=squad.find(x=>x.pick.is_captain)?.player; const vice=squad.find(x=>x.pick.is_vice_captain)?.player;
  $('#captainLine').innerHTML=`<span>Captain: <strong>${escapeHtml(cap?.web_name||'—')}</strong></span><span>Vice: <strong>${escapeHtml(vice?.web_name||'—')}</strong></span><span>Chip: <strong>${escapeHtml(state.picks.active_chip||'None')}</strong></span>`;

  const rows=squad.map(x=>{
    const p=x.player, h=holdScore(p), sc=startConfidence(p), team=state.teamsById.get(p.team)?.short_name||'—';
    return {p,h,sc,team,signal:mainSignal(p,h,sc)};
  });
  $('#playerTable tbody').innerHTML=rows.map(({p,h,sc,team,signal})=>`<tr><td><strong>${escapeHtml(p.web_name)}</strong></td><td>${team}</td><td>${escapeHtml(nextFixture(p))}</td><td>${fmtMoney(p.now_cost)}</td><td>${escapeHtml(p.selected_by_percent||'—')}</td><td>${escapeHtml(p.expected_goal_involvements||'—')}</td><td>${sc}%</td><td><span class="score ${h>=8?'high':h>=5.5?'mid':'low'}">${h}/10</span></td><td>${signal}</td></tr>`).join('');

  const risks=rows.filter(r=>r.sc<60||r.h<5);
  if (!risks.length) { $('#quickDecision').textContent=`ROLL FT • ${state.ft} FT`; $('#decisionReason').textContent='Không có minutes/hold risk rõ rệt trong squad.'; }
  else if (risks.length<=2 && state.ft>0) { $('#quickDecision').textContent=`WAIT → ${Math.min(risks.length,state.ft)} FT candidate`; $('#decisionReason').textContent=`Watch: ${risks.map(r=>r.p.web_name).join(', ')}. Chờ team news trước khi bấm.`; }
  else { $('#quickDecision').textContent='STRUCTURE WATCH'; $('#decisionReason').textContent=`${risks.length} vị trí có risk; cân nhắc FT/WC dựa trên 4–6GW.`; }

  renderTransferOptions();
  renderPlanned();
}

function renderTransferOptions() {
  const squad=currentSquad(); const out=$('#transferOut'), inp=$('#transferIn');
  out.innerHTML=squad.map(x=>`<option value="${x.player.id}">${escapeHtml(x.player.web_name)} • ${posName[x.player.element_type]} • ${fmtMoney(x.player.now_cost)}</option>`).join('');
  function fillIn(){
    const outP=state.playersById.get(Number(out.value)); if(!outP) return;
    const currentIds=new Set(squad.map(x=>x.player.id));
    const candidates=[...state.playersById.values()].filter(p=>p.element_type===outP.element_type&&!currentIds.has(p.id)).sort((a,b)=>holdScore(b)-holdScore(a)).slice(0,120);
    inp.innerHTML=candidates.map(p=>`<option value="${p.id}">${escapeHtml(p.web_name)} • ${state.teamsById.get(p.team)?.short_name||''} • ${fmtMoney(p.now_cost)} • H${holdScore(p)}</option>`).join('');
    updateTransferPreview();
  }
  out.onchange=fillIn; inp.onchange=updateTransferPreview; fillIn();
}
function updateTransferPreview(){
  const outP=state.playersById.get(Number($('#transferOut').value)); const inP=state.playersById.get(Number($('#transferIn').value));
  if(!outP||!inP) return;
  const diff=(Number(outP.now_cost)-Number(inP.now_cost))/10; const delta=holdScore(inP)-holdScore(outP);
  $('#transferPreview').innerHTML=`<strong>${escapeHtml(outP.web_name)} → ${escapeHtml(inP.web_name)}</strong><br><span class="muted">Budget change: ${diff>=0?'+':''}£${diff.toFixed(1)}m • Hold delta: ${delta>=0?'+':''}${delta.toFixed(1)} • Start: ${startConfidence(outP)}% → ${startConfidence(inP)}%</span>`;
}
function renderPlanned(){
  const el=$('#plannedTransfers');
  if(!state.planned.length) el.innerHTML='<div class="empty">Chưa có transfer trong kế hoạch.</div>';
  else el.innerHTML=state.planned.map((tr,i)=>{const o=state.playersById.get(tr.outId),n=state.playersById.get(tr.inId); return `<div class="planned-row"><span>${escapeHtml(o?.web_name||tr.outName)} → <strong>${escapeHtml(n?.web_name||tr.inName)}</strong></span><button class="btn ghost remove-transfer" data-i="${i}">×</button></div>`}).join('');
  $$('.remove-transfer').forEach(b=>b.onclick=()=>{state.planned.splice(Number(b.dataset.i),1);savePlanned();renderPlanned();renderPlannedPitch();});
  renderPlannedPitch();
}
function renderPlannedPitch(){
  const s=plannedSquad(); if(!s.length){$('#plannedPitch').innerHTML='<div class="empty">Tải squad trước.</div>';return;}
  const r=renderPitch($('#plannedPitch'),s,true); $('#plannedFormationBadge').textContent=r.formation;
}
function savePlanned(){localStorage.setItem('fpl-planned-transfers',JSON.stringify(state.planned));}


function projectedPoints(x){
  const p=x.player; const sc=startConfidence(p)/100; const h=holdScore(p); const fx=nextFixtures(p,1)[0];
  const fdr=Number(fx?.difficulty||3); const ppg=Math.min(9,Number(p.points_per_game||0)); const form=Math.min(9,Number(p.form||0));
  const xgi=Math.min(3,Number(p.expected_goal_involvements||0));
  let base=1.4 + .28*ppg + .18*form + .9*xgi + .34*h + (3.3-fdr)*.55;
  if(p.element_type===1||p.element_type===2) base += (3.5-fdr)*.35;
  return Math.max(.5,base*sc);
}
function teamProjectedScore(squad){
  const xi=squad.filter(x=>Number(x.pick.multiplier)>0).slice(0,11); const use=xi.length===11?xi:optimalXI(squad);
  return use.reduce((sum,x)=>sum+projectedPoints(x)*Math.max(1,Number(x.pick.multiplier)||1),0);
}
function winProbability(delta){ return Math.max(.08,Math.min(.92,1/(1+Math.exp(-delta/7.5)))); }
function h2hStrategy(prob,myDiff,opDiff,myCap,opCap){
  if(prob>=.62) return {mode:'SAFE',text:'Bạn đang cửa trên: giữ captain có xPts cao, ưu tiên minutes chắc và tránh transfer chỉ để cover đối thủ.'};
  if(prob<=.42) return {mode:'AGGRESSIVE',text:'Bạn đang cửa dưới: cần tăng variance có chọn lọc qua 1–2 differential ceiling cao; chỉ đổi captain nếu mô hình xPts đủ gần.'};
  return {mode:'BALANCED',text:'Kèo khá cân: giữ core template, tận dụng differential tự nhiên và tránh hit/transfer phòng thủ chỉ để bắt chước đối thủ.'};
}

function clubCount(squad, teamId, ignorePlayerId=null){
  return squad.filter(x=>x.player.team===teamId && x.player.id!==ignorePlayerId).length;
}
function transferRecommendationPool(mine, oppSquad, prob){
  const mineIds=new Set(mine.map(x=>x.player.id));
  const oppIds=new Set(oppSquad.map(x=>x.player.id));
  const pool=[];
  for(const out of mine){
    const outHold=holdScore(out.player), outStart=startConfidence(out.player), outXp=projectedPoints({...out,pick:{...out.pick,multiplier:1}});
    // Don't churn strong core just for H2H variance.
    if(outHold>=8.7 && outStart>=85) continue;
    for(const p of state.playersById.values()){
      if(p.element_type!==out.player.element_type || mineIds.has(p.id)) continue;
      if(clubCount(mine,p.team,out.player.id)>=3) continue;
      const inp={player:p,pick:{multiplier:1,is_captain:false,is_vice_captain:false}};
      const inHold=holdScore(p), inStart=startConfidence(p), inXp=projectedPoints(inp);
      const xpDelta=inXp-outXp, holdDelta=inHold-outHold, startDelta=inStart-outStart;
      if(inStart<72 || inHold<6.2) continue;
      if(xpDelta<0.45 && holdDelta<0.65) continue;
      const unique=!oppIds.has(p.id);
      const h2hBonus=prob<=.42 ? (unique?.55:-.15) : prob>=.62 ? (unique?.05:.18) : (unique?.22:0);
      const score=xpDelta + holdDelta*.85 + startDelta*.012 + h2hBonus;
      pool.push({out,inp,xpDelta,holdDelta,startDelta,unique,score,budgetDelta:(Number(out.player.now_cost||0)-Number(p.now_cost||0))/10});
    }
  }
  // Avoid returning five different replacements for the same outgoing player.
  const result=[], usedOut=new Set();
  for(const r of pool.sort((a,b)=>b.score-a.score)){
    if(usedOut.has(r.out.player.id)) continue;
    usedOut.add(r.out.player.id); result.push(r);
    if(result.length>=4) break;
  }
  return result;
}
function modelCaptainAdvice(mine, oppSquad, prob){
  const xi=optimalXI(mine).map(x=>({x,pts:projectedPoints({...x,pick:{...x.pick,multiplier:1}})})).sort((a,b)=>b.pts-a.pts);
  if(!xi.length) return null;
  const top=xi[0], alt=xi[1]||xi[0];
  const opCap=oppSquad.find(x=>x.pick.is_captain)?.player;
  const topSame=opCap && opCap.id===top.x.player.id;
  if(prob<=.42 && topSame && alt.pts>=top.pts-.8){
    return {player:alt.x.player,pts:alt.pts,mode:'DIFFERENTIAL',reason:`Bạn đang cửa dưới và đối thủ captain ${opCap.web_name}. ${alt.x.player.web_name} chỉ kém model-top ${(top.pts-alt.pts).toFixed(1)} xPts nên là phương án tăng variance có kiểm soát.`};
  }
  return {player:top.x.player,pts:top.pts,mode:'MODEL TOP',reason:`Giữ captain theo expected points cao nhất của squad; không tạo variance nếu chênh xPts không đủ nhỏ.`};
}
function recommendationHtml(rec, idx, context){
  const out=rec.out.player, inp=rec.inp.player;
  const budget=rec.budgetDelta>=0?`giải phóng £${rec.budgetDelta.toFixed(1)}m`:`cần thêm £${Math.abs(rec.budgetDelta).toFixed(1)}m`;
  const tag=context==='h2h' ? (rec.unique?'DIFF UPSIDE':'COVER + VALUE') : '4–6GW';
  return `<div class="rec-row"><div class="rec-title"><span>${idx+1}. ${escapeHtml(out.web_name)} → ${escapeHtml(inp.web_name)}</span><span class="tag">${tag}</span></div>
    <div class="rec-reason">${context==='h2h'?(rec.unique?'Tăng ceiling H2H mà không cần bắt chước đối thủ.':'Có thể neutralize threat của đối thủ nhưng chỉ đáng làm vì model cũng đánh giá tốt.'):'Cải thiện minutes/fixture/hold score; ưu tiên giá trị bền hơn một Gameweek.'}</div>
    <div class="rec-metrics">GW xPts ${rec.xpDelta>=0?'+':''}${rec.xpDelta.toFixed(1)} • Hold ${rec.holdDelta>=0?'+':''}${rec.holdDelta.toFixed(1)} • Start ${rec.startDelta>=0?'+':''}${Math.round(rec.startDelta)}pp • ${budget}</div></div>`;
}
function renderH2HRecommendations(mine,oppSquad,prob,delta,strat){
  const el=$('#h2hRecommendations'); if(!el) return;
  const recs=transferRecommendationPool(mine,oppSquad,prob);
  const cap=modelCaptainAdvice(mine,oppSquad,prob);
  const structural=mine.filter(x=>holdScore(x.player)<5 || startConfidence(x.player)<60).sort((a,b)=>(holdScore(a.player)+startConfidence(a.player)/100)-(holdScore(b.player)+startConfidence(b.player)/100));
  const weak=mine.filter(x=>holdScore(x.player)<6.3 || startConfidence(x.player)<75).sort((a,b)=>holdScore(a.player)-holdScore(b.player)).slice(0,4);
  const core=mine.filter(x=>holdScore(x.player)>=8.3 && startConfidence(x.player)>=82).sort((a,b)=>holdScore(b.player)-holdScore(a.player)).slice(0,7);
  const strongest=recs[0];
  let nowAction='NO FORCED MOVE', nowClass='rec-good', nowReason='Không dùng transfer chỉ để cover đối thủ. Chỉ hành động khi move cải thiện cả GW này và 4–6GW.';
  if(prob<=.42 && strongest && strongest.xpDelta>=.8 && strongest.holdDelta>=.35){
    nowAction=state.ft>0?'CONSIDER 1 FT':'AVOID HIT'; nowClass=state.ft>0?'rec-warn':'rec-bad';
    nowReason=state.ft>0?`Bạn đang cửa dưới ${Math.abs(delta).toFixed(1)} projected pts; có 1 move vừa tăng H2H vừa không phá dài hạn.`:`Bạn đang cửa dưới nhưng không có FT; hit -4 chỉ hợp lý nếu lợi ích nhiều GW vượt rõ chi phí.`;
  }else if(prob>=.62){ nowAction='PROTECT EDGE'; nowReason='Bạn đang cửa trên: ưu tiên minutes chắc, captain tốt nhất và roll FT nếu không có injury/mất suất.'; }
  else if(strongest && strongest.xpDelta>=1.1 && strongest.holdDelta>=.7){ nowAction=state.ft>0?'1 FT VALUE MOVE':'ROLL / NO HIT'; nowClass='rec-warn'; nowReason='Kèo cân nhưng có transfer mang giá trị cả ngắn hạn lẫn 4–6GW; không cần chase differential thuần H2H.'; }

  const wcText=structural.length>=3 ? `<span class="rec-warn">WC WATCH</span> — ${structural.length} structural flags; chỉ kích hoạt nếu pressers/fixtures xác nhận vấn đề kéo dài.` : `<span class="rec-good">NO WC</span> — chỉ ${structural.length} structural flag${structural.length===1?'':'s'}; targeted FT/roll hiệu quả hơn.`;
  const longRows=recs.length?recs.slice(0,3).map((r,i)=>recommendationHtml(r,i,'long')).join(''):'<div class="rec-row"><div class="rec-title">ROLL FT</div><div class="rec-reason">Model chưa thấy upgrade cùng vị trí đủ lớn cho 4–6GW.</div></div>';
  const h2hRows=recs.length?recs.slice(0,2).map((r,i)=>recommendationHtml(r,i,'h2h')).join(''):'<div class="rec-row"><div class="rec-title">Giữ squad</div><div class="rec-reason">Không có move H2H nào vượt ngưỡng mà vẫn giữ chất lượng dài hạn.</div></div>';
  const capHtml=cap?`<div class="rec-row"><div class="rec-title"><span>Captain model: ${escapeHtml(cap.player.web_name)}</span><span class="tag">${cap.mode}</span></div><div class="rec-reason">${escapeHtml(cap.reason)}</div><div class="rec-metrics">~${cap.pts.toFixed(1)} base xPts trước captain multiplier</div></div>`:'';
  const weakHtml=weak.length?weak.map(x=>`<span class="season-pill">⚠ ${escapeHtml(x.player.web_name)} H${holdScore(x.player)} / ${startConfidence(x.player)}%</span>`).join(''):'<span class="season-pill">Không có weak link rõ</span>';
  const coreHtml=core.length?core.map(x=>`<span class="season-pill">🔒 ${escapeHtml(x.player.web_name)}</span>`).join(''):'—';
  $('#recommendationMode').textContent=`${strat.mode} • ${state.ft} FT`;
  el.innerHTML=`
    <section class="recommend-block"><h3>⚔️ H2H — hành động GW này</h3><div class="sub">Tối ưu xác suất thắng nhưng không hy sinh đội hình chỉ để bắt chước đối thủ.</div>
      <div class="rec-row"><div class="rec-title"><span class="${nowClass}">${nowAction}</span><span class="tag">WIN ${Math.round(prob*100)}%</span></div><div class="rec-reason">${nowReason}</div></div>${capHtml}${h2hRows}</section>
    <section class="recommend-block"><h3>📈 4–6 Gameweek</h3><div class="sub">Các move chỉ được xếp cao nếu Start confidence/Hold/xPts cùng cải thiện.</div>${longRows}</section>
    <section class="recommend-block"><h3>🧭 Cấu trúc cả mùa</h3><div class="sub">Không đánh giá chip/Wildcard chỉ bằng một H2H.</div>
      <div class="rec-row"><div class="rec-title">${wcText}</div></div>
      <div class="rec-row"><div class="rec-title">Weak links</div><div class="rec-reason">${weakHtml}</div></div>
      <div class="rec-row"><div class="rec-title">Core nên bảo vệ</div><div class="rec-reason">${coreHtml}</div></div>
      <div class="rec-row"><div class="rec-title">FT policy</div><div class="rec-reason">Ưu tiên roll tới tối đa 5 FT. Không hit vì H2H riêng lẻ; -4 chỉ khi injury/mất suất hoặc projected gain nhiều GW đủ bù chi phí.</div></div>
    </section>`;
}

async function loadOpponent(){
  const id=Number($('#opponentId').value); if(!id) return;
  setStatus(`Đang tải opponent ${id}…`);
  try{
    const manager=await getJson(`/api/fpl/entry/${id}`);
    const gw=state.picks?.entry_history?.event || Math.max(1,(state.gw?.id||1)-1);
    const picks=await getJson(`/api/fpl/picks/${id}/${gw}`);
    state.opponent={id,manager,picks}; renderH2H(); setStatus(`Đã tải H2H với Team ${id}`,'good');
  }catch(e){setStatus(`Không tải được opponent: ${e.message}`,'bad');}
}
function renderH2H(){
  const mine=currentSquad(); const opp=state.opponent; if(!opp) return;
  const oppSquad=opp.picks.picks.map(pk=>({pick:pk,player:state.playersById.get(pk.element)})).filter(x=>x.player);
  const myIds=new Set(mine.map(x=>x.player.id)), opIds=new Set(oppSquad.map(x=>x.player.id));
  const myDiff=mine.filter(x=>!opIds.has(x.player.id)), opDiff=oppSquad.filter(x=>!myIds.has(x.player.id));
  const myCap=mine.find(x=>x.pick.is_captain)?.player.web_name||'—', opCap=oppSquad.find(x=>x.pick.is_captain)?.player.web_name||'—';
  const myProj=teamProjectedScore(mine), opProj=teamProjectedScore(oppSquad), delta=myProj-opProj, prob=winProbability(delta), draw=Math.max(.05,.15-Math.abs(delta)*.008), lose=Math.max(0,1-prob-draw);
  const strat=h2hStrategy(prob,myDiff,opDiff,myCap,opCap);
  const swing=[...myDiff.map(x=>({name:x.player.web_name,val:projectedPoints(x),side:'you'})),...opDiff.map(x=>({name:x.player.web_name,val:-projectedPoints(x),side:'opp'}))].sort((a,b)=>Math.abs(b.val)-Math.abs(a.val)).slice(0,5);
  $('#h2hSummary').innerHTML=`<div class="card-title">${escapeHtml(state.manager?.name||'You')} vs ${escapeHtml(opp.manager.name||`Team ${opp.id}`)}</div>
    <div class="h2h-prob"><div><strong>${Math.round(prob*100)}%</strong><span>Win</span></div><div><strong>${Math.round(draw*100)}%</strong><span>Draw</span></div><div><strong>${Math.round(lose*100)}%</strong><span>Lose</span></div></div>
    <div class="proj-line"><span>Projected</span><strong>${myProj.toFixed(1)} – ${opProj.toFixed(1)}</strong><span>${delta>=0?'+':''}${delta.toFixed(1)} edge</span></div>
    <div class="captain-battle">Captain: <strong>${escapeHtml(myCap)}</strong> vs <strong>${escapeHtml(opCap)}</strong></div>
    <div class="strategy-card ${strat.mode.toLowerCase()}"><b>${strat.mode}</b><span>${strat.text}</span></div>
    <div class="muted small">Win probability là heuristic từ projected points/start confidence/fixtures, không phải xác suất official.</div>`;
  $('#differentials').innerHTML=`<div class="diff-col"><strong>Your differentials</strong>${myDiff.map(x=>`<div class="diff-row plus"><span>+ ${escapeHtml(x.player.web_name)}</span><b>${projectedPoints(x).toFixed(1)} xPts</b></div>`).join('')||'<div class="muted">None</div>'}</div><div class="diff-col"><strong>Opponent differentials</strong>${opDiff.map(x=>`<div class="diff-row minus"><span>− ${escapeHtml(x.player.web_name)}</span><b>${projectedPoints(x).toFixed(1)} xPts</b></div>`).join('')||'<div class="muted">None</div>'}</div>
    <div class="diff-col swing-col"><strong>Biggest swings</strong>${swing.map(x=>`<div class="diff-row"><span>${x.side==='you'?'🟢':'🔴'} ${escapeHtml(x.name)}</span><b>${Math.abs(x.val).toFixed(1)}</b></div>`).join('')}</div>`;  renderH2HRecommendations(mine,oppSquad,prob,delta,strat);
}
function renderChallenge(){
  const saved=JSON.parse(localStorage.getItem('fpl-challenge-rules')||'null');
  if(saved){$('#challengeName').value=saved.name;$('#challengeSize').value=saved.size;$('#challengeClubMax').value=saved.clubMax;$('#challengeBudget').value=saved.budget;$('#challengeRule').value=saved.rule;}
}
function challengeDraft(){
  const names=['Donnarumma','Maguire','Semenyo','B. Fernandes','Mbeumo','Haaland'];
  const positions=[1,2,3,3,3,4];
  const fake=names.map((n,i)=>({player:{id:9000+i,web_name:n,element_type:positions[i],team:i%2?8:7,demo_fixture:'MUN–MCI'},pick:{is_captain:n==='Haaland',is_vice_captain:false,multiplier:1}}));
  const savedTeams=new Map(state.teamsById); if(!state.teamsById.get(7)) state.teamsById.set(7,{short_name:'MCI'}); if(!state.teamsById.get(8)) state.teamsById.set(8,{short_name:'MUN'});
  renderPitch($('#challengePitch'),fake,false); state.teamsById=savedTeams;
}

function render(){
  $('#teamId').value=state.managerId; renderOverview(); renderChallenge();
}

$$('.tab').forEach(btn=>btn.addEventListener('click',()=>{$$('.tab').forEach(b=>b.classList.remove('active'));$$('.tab-panel').forEach(p=>p.classList.remove('active'));btn.classList.add('active');$(`#${btn.dataset.tab}`).classList.add('active');}));
$('#loadBtn').onclick=()=>loadLive($('#teamId').value).catch(e=>{setStatus(`FPL API chưa truy cập được: ${e.message}. Bạn có thể bấm Demo offline.`,'bad');});
$('#demoBtn').onclick=loadDemo;
$('#ftInput').onchange=(e)=>{state.ft=Math.max(0,Math.min(5,Number(e.target.value)||0));localStorage.setItem('fpl-ft',String(state.ft));$('#metricFt').textContent=state.ft;renderOverview();};
$('#addTransferBtn').onclick=()=>{const outP=state.playersById.get(Number($('#transferOut').value)),inP=state.playersById.get(Number($('#transferIn').value));if(!outP||!inP)return;state.planned=state.planned.filter(t=>t.outId!==outP.id);state.planned.push({outId:outP.id,inId:inP.id,outName:outP.web_name,inName:inP.web_name});savePlanned();renderPlanned();};
$('#clearTransfersBtn').onclick=()=>{state.planned=[];savePlanned();renderPlanned();};
$('#loadOpponentBtn').onclick=loadOpponent;
$('#saveChallengeBtn').onclick=()=>{const r={name:$('#challengeName').value,size:$('#challengeSize').value,clubMax:$('#challengeClubMax').value,budget:$('#challengeBudget').value,rule:$('#challengeRule').value};localStorage.setItem('fpl-challenge-rules',JSON.stringify(r));setStatus('Đã lưu Challenge rule trên trình duyệt này.','good');};
$('#loadChallengeDraftBtn').onclick=challengeDraft;

loadLive(2320843).catch(()=>loadDemo());
