const $ = id => document.getElementById(id);
const f = (value, digits=1) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(digits);
let latestState = null, receivedAt = 0, selectedZone = null, energyScene = null, sceneFailed = false, motionPaused = false;
const theme = Object.fromEntries(['line','muted','feed','a','b'].map(key=>[key,getComputedStyle(document.documentElement).getPropertyValue('--'+key).trim()]));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const pill = (id, cls, text) => { $(id).className = 'pill '+cls; $(id).lastElementChild.textContent = text; };
const isFresh = () => !!(latestState?.latest && ['CONNECTED','SIMULATION'].includes(latestState.connection) && (latestState.age_seconds || 0) + (performance.now()-receivedAt)/1000 < 4);

function fitPrimaryViewport() {
  if ($('dashboard-screen').hidden) return;
  const panel = document.querySelector('.experience-grid');
  const top = panel.getBoundingClientRect().top + scrollY;
  panel.style.setProperty('--experience-height', Math.max(0, innerHeight - top - 16) + 'px');
}
const layoutObserver = new ResizeObserver(fitPrimaryViewport);
for (const element of [document.querySelector('.app-header'), document.querySelector('.page-heading'), $('sim')]) layoutObserver.observe(element);
addEventListener('resize', fitPrimaryViewport);

function selectScreen(moveFocus=false) {
  const debugging = location.hash === '#debugging';
  $('dashboard-screen').hidden = debugging; $('debug-screen').hidden = !debugging;
  for (const [id,active] of [['nav-dashboard',!debugging],['nav-debugging',debugging]]) {
    if (active) $(id).setAttribute('aria-current','page'); else $(id).removeAttribute('aria-current');
  }
  document.title = (debugging?'Debugging':'Dashboard')+' · GridScope';
  if (!debugging) fitPrimaryViewport();
  energyScene?.visibility(!debugging);
  if (!debugging && latestState) chart(latestState.history || []);
  if (moveFocus) $(debugging?'debug-heading':'dashboard-heading').focus({preventScroll:true});
}
addEventListener('hashchange',()=>selectScreen(true));
selectScreen();

function selectZone(zone) {
  selectedZone = selectedZone === zone ? null : zone;
  document.querySelectorAll('[data-zone]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.zone===selectedZone)));
  energyScene?.select(selectedZone);
  updateInspection();
}
document.querySelectorAll('[data-zone]').forEach(button=>button.addEventListener('click',()=>selectZone(button.dataset.zone)));
function updateInspection() {
  const r=latestState?.latest || latestState?.last_known;
  const key=selectedZone==='a'?'branch_a_w':selectedZone==='b'?'branch_b_w':'main_w';
  $('inspect-type').textContent=selectedZone?'Lighting circuit':'System view';
  $('inspect-name').textContent=selectedZone==='a'?'Zone A lighting':selectedZone==='b'?'Zone B lighting':'Main feeder';
  $('inspect-description').textContent=selectedZone?(r&&r[key]==null?'A reading is not available for this circuit.':'Current and estimated power for Zone '+selectedZone.toUpperCase()+' lighting.'):'Total current and estimated power across both lighting circuits.';
  $('inspect-w').textContent=f(r?.[key]);
}
function setCamera(view) {
  energyScene?.view(view);
  $('view-perspective').setAttribute('aria-pressed',String(view==='perspective'));
  $('view-top').setAttribute('aria-pressed',String(view==='top'));
}
$('view-perspective').addEventListener('click',()=>setCamera('perspective'));
$('view-top').addEventListener('click',()=>setCamera('top'));
$('rotate-left').addEventListener('click',()=>energyScene?.rotate(-.2));
$('rotate-right').addEventListener('click',()=>energyScene?.rotate(.2));
$('zoom-out').addEventListener('click',()=>energyScene?.zoom(1));
$('zoom-in').addEventListener('click',()=>energyScene?.zoom(-1));
$('reset-view').addEventListener('click',()=>setCamera('perspective'));
function updateMotionControl(){
  $('pause-motion').disabled=sceneFailed||reducedMotion.matches;
  $('pause-motion').textContent=sceneFailed?'3D unavailable':reducedMotion.matches?'Motion reduced':motionPaused?'Resume flow':'Pause flow';
  $('pause-motion').setAttribute('aria-pressed',String(motionPaused||reducedMotion.matches));
  energyScene?.pause(motionPaused||reducedMotion.matches);
}
$('pause-motion').addEventListener('click',()=>{motionPaused=!motionPaused;updateMotionControl();});
reducedMotion.addEventListener('change',updateMotionControl);updateMotionControl();
function showSceneFallback(){
  sceneFailed=true;$('energy-canvas').hidden=true;$('scene-fallback').hidden=false;
  $('scene-message').hidden=true;document.querySelectorAll('.scene-label').forEach(el=>el.hidden=true);
  document.querySelectorAll('.view-controls button,.camera-tools button').forEach(el=>el.disabled=true);
}
document.addEventListener('scene-unavailable',showSceneFallback);
import('/static/energy-scene.js').then(({createEnergyScene})=>{
  energyScene=createEnergyScene({onSelect:selectZone});
  energyScene.visibility(!$('dashboard-screen').hidden);
  $('scene-message').hidden=true;updateMotionControl();updateActivity();
}).catch(showSceneFallback);

function chart(history) {
  const svg=$('chart'), W=Math.max(280,svg.clientWidth||700), H=190, left=34, right=W-9, top=12, bottom=161;
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  const points=history.filter(r=>Number.isFinite(r.main_w));
  $('chart-empty').hidden=points.length>=2;
  $('chart-range').textContent=points.length?`${points.length} recorded samples · estimated watts`:'Waiting for recorded samples';
  if(points.length<2){svg.replaceChildren();return;}
  const max=Math.max(20,Math.ceil(Math.max(...points.map(r=>Math.max(r.main_w||0,r.branch_a_w||0,r.branch_b_w||0)))/20)*20);
  const first=points[0].timestamp, elapsed=Math.max(1,points.at(-1).timestamp-first);
  const x=r=>left+(r.timestamp-first)/elapsed*(right-left), y=v=>bottom-v/max*(bottom-top);
  const ns='http://www.w3.org/2000/svg';svg.replaceChildren();
  function node(tag,attrs,text){const el=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);if(text!=null)el.textContent=text;svg.append(el);return el;}
  for(let i=0;i<=4;i++){const value=max*i/4,yy=y(value);node('line',{x1:left,x2:right,y1:yy,y2:yy,stroke:theme.line,'stroke-dasharray':'3 5'});node('text',{x:left-8,y:yy+3,fill:theme.muted,'font-size':9,'text-anchor':'end'},f(value,0));}
  const fill=points.map((r,i)=>`${i?'L':'M'}${x(r)},${y(r.main_w)}`).join(' ')+` L${x(points.at(-1))},${bottom} L${left},${bottom} Z`;
  node('path',{d:fill,fill:theme.feed,'fill-opacity':.045,stroke:'none'});
  for(const [key,color] of [['main_w',theme.feed],['branch_a_w',theme.a],['branch_b_w',theme.b]]){
    let d='',continuing=false;
    for(const row of points){if(row[key]==null||!Number.isFinite(row[key])){continuing=false;continue;}d+=`${continuing?' L':' M'}${x(row)},${y(row[key])}`;continuing=true;}
    node('path',{d,fill:'none',stroke:color,'stroke-width':key==='main_w'?2:1.5,'stroke-linejoin':'round','stroke-linecap':'round'});
  }
  for(const [r,anchor] of [[points[0],'start'],[points.at(-1),'end']])node('text',{x:x(r),y:184,fill:theme.muted,'font-size':9,'text-anchor':anchor},new Date(r.timestamp*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}));
}

function updateActivity() {
  const state=latestState, fresh=isFresh(), r=state?.latest || state?.last_known;
  const threshold=Math.max(state?.settings?.active_current_ma||35,r?.tolerance_ma||15);
  const activeA=fresh&&r.branch_a_ma>=threshold, activeB=fresh&&r.branch_b_ma!=null&&r.branch_b_ma>=threshold;
  $('scene').dataset.state=fresh?'live':r?'stale':'waiting';
  $('scene').dataset.activeA=String(activeA);$('scene').dataset.activeB=String(activeB);
  energyScene?.update(r,fresh,threshold);
  document.querySelector('.circuit-card.zone-a').classList.toggle('active',activeA);
  document.querySelector('.circuit-card.zone-b').classList.toggle('active',activeB);
  $('zone-a-status').textContent=!fresh?(r?'Last received':'Waiting for data'):activeA?'Active':'Below detection';
  $('zone-b-status').textContent=!fresh?(r?'Last received':'Waiting for data'):r.branch_b_ma==null?'Sensor mismatch':activeB?'Active':'Below resolution';
  $('reading-tag').textContent=fresh?(state.mode==='DEMO'?'Simulated':'Live'):r?'Last received':'Waiting';
  $('summary-dot').classList.toggle('live',fresh);
  $('overview-status').textContent=fresh?(state.mode==='DEMO'?'Showing simulated readings':'Receiving live sensor readings'):r?'Connection lost. Showing last readings.':'Waiting for sensor readings';
  if(state) pill('pDev',fresh?'on':'off',fresh?(state.mode==='DEMO'?'Simulation':'Device online'):'Device offline');
}

function renderState(s) {
  latestState=s;receivedAt=performance.now();
  const r=s.latest||s.last_known,cfg=s.settings||{},totals=s.totals||{};
  $('sim').hidden=s.mode!=='DEMO';
  $('vM').textContent=f(r?.main_w);$('nM').textContent=f(r?.main_ma,0)+' mA';
  $('vA').textContent=f(r?.branch_a_w);$('nA').textContent=f(r?.branch_a_ma,0)+' mA';
  $('vB').textContent=f(r?.branch_b_w);$('nB').textContent=r?.branch_b_ma==null?'Not resolved':f(r.branch_b_ma,0)+' mA';
  $('label-a-w').textContent=f(r?.branch_a_w)+' W';$('label-b-w').textContent=f(r?.branch_b_w)+' W';$('scene-main').textContent=f(r?.main_w)+' W';
  $('voltage-assumption').textContent=f(cfg.assumed_voltage_v,0)+' V assumed';
  $('demand-limit').textContent=f(cfg.peak_demand_w,0)+' W';
  const demand=r&&cfg.peak_demand_w?r.main_w/cfg.peak_demand_w:0;
  $('demand-fill').style.width=Math.max(0,Math.min(100,demand*100))+'%';
  $('demand-fill').parentElement.classList.toggle('exceeded',demand>1);
  $('vE').textContent=f(totals.total_wh,2);$('energy-cost').textContent='₹'+f(totals.cost_inr,3);$('nE').textContent='₹'+f(cfg.tariff_inr_per_kwh,2)+' / kWh';
  $('tT').textContent=f(totals.total_wh,2);$('tA').textContent=f(totals.a_wh,2);$('tB').textContent=f(totals.b_wh,2);
  const sum=(totals.a_wh||0)+(totals.b_wh||0),pa=sum?(totals.a_wh||0)/sum*100:0;
  $('split-total').textContent=sum?f(sum,2):'—';$('energy-ring').style.background=sum?`conic-gradient(var(--a) 0 ${pa}%,var(--b) ${pa}% 100%)`:'var(--line)';
  $('sTxt').textContent=sum?`Zone A ${f(pa,0)}% · Zone B ${f(100-pa,0)}%`:'No circuit energy recorded';
  if(!$('dashboard-screen').hidden)chart(s.history||[]);
  $('ev').replaceChildren();
  const events=(s.events||[]).slice(0,3);
  if(!events.length){const empty=document.createElement('p');empty.className='empty-events';empty.textContent='No events recorded.';$('ev').append(empty);}
  for(const item of events){const row=document.createElement('div');row.className='event '+item.kind;const title=document.createElement('b');title.textContent=item.title;const when=document.createElement('time');when.textContent=new Date(item.timestamp*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});const detail=document.createElement('p');detail.textContent=item.details;row.append(when,title,detail);$('ev').append(row);}
  renderDebug(s);updateInspection();updateActivity();
}
function renderDebug(s) {
  $('api-response').textContent=JSON.stringify(s,null,2);
  $('connection-detail').textContent=(s.transport||'USB serial')+(s.port?' · '+s.port:'')+' · '+(s.error|| (s.connection==='CONNECTED'?'Receiving live readings':s.connection==='SIMULATION'?'Simulated readings':'Waiting for sensor readings'))+(s.age_seconds!=null?' · Last sample '+f(s.age_seconds,1)+' s ago':'');
  $('network-debug').hidden=s.transport!=='Wi-Fi';
  const scan=s.scan||{};$('scan-phase').textContent=scan.phase||'Starting';
  $('scan-summary').textContent=`Round ${scan.round||0} · ${scan.attempted||0}/${scan.total||0} checked · Ranges: ${(scan.ranges||[]).join(', ')||'detecting'} · Ports: ${(scan.ports||[]).join(', ')||'loading'}`;
  $('scan-progress').max=Math.max(1,scan.total||0);$('scan-progress').value=scan.attempted||0;
  $('device-status').textContent=s.device_health?'ESP sensor: '+s.device_health.status:'No ESP response yet';
  $('device-response').textContent=s.device_health?JSON.stringify(s.device_health,null,2):'No device response yet';$('raw-packet').textContent=s.last_packet||'No sensor packet yet';
  const rows=$('scan-results');rows.replaceChildren();
  [...(scan.results||[])].reverse().forEach(result=>{const tr=document.createElement('tr');if(result.result==='FOUND')tr.className='scan-found';[result.url,result.result,result.ms+' ms',result.detail].forEach(value=>{const td=document.createElement('td');td.textContent=value;tr.append(td)});rows.append(tr)});
  const c=s.cloud||{};pill('pCloud',!c.enabled?'':c.ok?(c.queued?'warn':'on'):'off',!c.enabled?'Cloud off':c.ok?(c.queued?`Cloud · ${c.queued} queued`:'Cloud synced'):'Cloud retrying');
  pill('pSrc','',s.source==='mongodb'?'Data: MongoDB':'Data: local');
}
async function tick() {
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),6000);
  try {const response=await fetch('/api/dashboard',{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('HTTP '+response.status);renderState(await response.json());}
  catch(error){if(latestState){latestState={...latestState,last_known:latestState.latest||latestState.last_known,latest:null,connection:'DISCONNECTED'};}updateActivity();pill('pDev','off','Server unreachable');const preview=location.pathname.includes('/templates/');$('overview-status').textContent=preview?'Open the dashboard started by python server.py':'Dashboard server is unreachable';$('connection-detail').textContent=preview?'Run python server.py and use the dashboard address it opens. This HTML preview server does not provide sensor data.':'Cannot fetch /api/dashboard: '+error.message;}
  finally{clearTimeout(timeout);setTimeout(tick,2000);}
}
setInterval(()=>{if(latestState&&!isFresh())updateActivity();},1000);
let resizeTimer;addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(latestState&&!$('dashboard-screen').hidden)chart(latestState.history||[]);},100);});
tick();
