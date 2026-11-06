const $ = id => document.getElementById(id);
const f = (value, digits=1) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(digits);
let latestState = null, receivedAt = 0, energyScene = null, sceneFailed = false, motionPaused = false;
let chartVisible=false,lastEventsKey='',lastChartKey='',lastScanKey='';
let pollTimer=0,pollController=null,polling=false;
const setText=(id,value)=>{const node=$(id);if(node&&node.textContent!==value)node.textContent=value;};
const frontendPreview = new URLSearchParams(location.search).get('demo') === '1' || location.pathname.includes('/templates/');
if(frontendPreview)$('nav-analytics').href=location.pathname.includes('/templates/')?'/templates/analytics.html?demo=1':'/analytics?demo=1';
const theme = Object.fromEntries(['line','muted','feed','a','b'].map(key=>[key,getComputedStyle(document.documentElement).getPropertyValue('--'+key).trim()]));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const isFresh = () => !!(latestState?.latest && ['CONNECTED','SIMULATION'].includes(latestState.connection) && (latestState.age_seconds || 0) + (performance.now()-receivedAt)/1000 < 4);

// Native compositor animations keep motion local, brief, and dependency-free.
function revealElements(elements,stagger=0,duration=160){
  if(reducedMotion.matches)return;
  [...elements].forEach((element,index)=>{
    element.getAnimations().filter(animation=>animation.id==='gridscope-ui').forEach(animation=>animation.cancel());
    const animation=element.animate([{opacity:.6},{opacity:1}],{duration,delay:index*stagger,easing:'ease-out'});
    animation.id='gridscope-ui';
  });
}
reducedMotion.addEventListener('change',()=>{
  if(reducedMotion.matches)document.getAnimations().filter(animation=>animation.id==='gridscope-ui').forEach(animation=>animation.cancel());
});
const previewMenu=$('preview-menu');
previewMenu.addEventListener('toggle',event=>{
  $('preview-launcher').setAttribute('aria-expanded',String(event.newState==='open'));
});
document.querySelectorAll('details').forEach(details=>details.addEventListener('toggle',()=>{
  if(details.open)revealElements([...details.children].filter(child=>child.tagName!=='SUMMARY'),0,220);
}));

function fitPrimaryViewport() {
  if ($('dashboard-screen').hidden) return;
  const panel = document.querySelector('.experience-grid');
  const top = panel.getBoundingClientRect().top + scrollY;
  const bottomSpace=frontendPreview&&innerWidth<=760?70:16;
  const height=Math.round(Math.max(0,innerHeight-top-bottomSpace))+'px';
  if(panel.style.getPropertyValue('--experience-height')!==height)panel.style.setProperty('--experience-height',height);
}
const layoutObserver = new ResizeObserver(fitPrimaryViewport);
for (const element of [document.querySelector('.app-header'), document.querySelector('.page-heading')]) layoutObserver.observe(element);
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
  if (!debugging && latestState) renderState(latestState,false);
  if (debugging && latestState) renderDebug(latestState);
  revealElements([$(debugging?'debug-heading':'dashboard-heading')]);
  if (moveFocus) $(debugging?'debug-heading':'dashboard-heading').focus({preventScroll:true});
}
addEventListener('hashchange',()=>selectScreen(true));
selectScreen();

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
  $('scene-message').hidden=true;
  $('pause-motion').disabled=true;
}
document.addEventListener('scene-unavailable',showSceneFallback);
import('/static/energy-scene.js').then(({createEnergyScene})=>{
  energyScene=createEnergyScene();
  energyScene.visibility(!$('dashboard-screen').hidden);
  $('scene-message').hidden=true;updateMotionControl();updateActivity();
}).catch(showSceneFallback);

function chart(history) {
  if(!chartVisible||document.hidden||$('dashboard-screen').hidden)return;
  const svg=$('chart'), W=Math.max(280,svg.clientWidth||700), H=190, left=34, right=W-9, top=12, bottom=161;
  const key=W+':'+JSON.stringify(history);
  if(key===lastChartKey)return;
  lastChartKey=key;
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
const chartObserver=new IntersectionObserver(entries=>{
  chartVisible=entries[0].isIntersecting;
  if(chartVisible&&latestState)chart(latestState.history||[]);
});
chartObserver.observe($('chart'));
document.addEventListener('visibilitychange',()=>{
  clearTimeout(pollTimer);
  if(document.hidden){pollController?.abort();return;}
  if(latestState)renderState(latestState,false);
  if(!frontendPreview)tick();
});

function updateActivity() {
  const state=latestState, fresh=isFresh(), r=state?.latest || state?.last_known;
  const threshold=Math.max(state?.settings?.active_current_ma||35,r?.tolerance_ma||15);
  const activeA=fresh&&r.branch_a_ma>=threshold, activeB=fresh&&r.branch_b_ma!=null&&r.branch_b_ma>=threshold;
  const scene=$('scene');
  for(const [key,value] of Object.entries({state:fresh?'live':r?'stale':'waiting',activeA:String(activeA),activeB:String(activeB)})){
    if(scene.dataset[key]!==value)scene.dataset[key]=value;
  }
  energyScene?.update(r,fresh,threshold);
  document.querySelector('.circuit-card.zone-a').classList.toggle('active',activeA);
  document.querySelector('.circuit-card.zone-b').classList.toggle('active',activeB);
  setText('zone-a-status',!fresh?(r?'Last received':'Waiting for data'):activeA?'Active':'Below detection');
  setText('zone-b-status',!fresh?(r?'Last received':'Waiting for data'):r.branch_b_ma==null?'Sensor mismatch':activeB?'Active':r.sensor_layout==='independent'?'Below detection':'Below resolution');
}

function renderState(s,received=true) {
  if(received){latestState=s;receivedAt=performance.now();}
  if(document.hidden)return;
  if(!$('debug-screen').hidden){renderDebug(s);return;}
  const r=s.latest||s.last_known,cfg=s.settings||{},totals=s.totals||{};
  setText('vM',f(r?.main_w));setText('nM',f(r?.main_ma,0)+' mA');
  setText('vA',f(r?.branch_a_w));setText('nA',f(r?.branch_a_ma,0)+' mA');
  setText('vB',f(r?.branch_b_w));setText('nB',r?.branch_b_ma==null?'Not resolved':f(r.branch_b_ma,0)+' mA');
  setText('voltage-assumption',f(cfg.assumed_voltage_v,0)+' V assumed');
  setText('demand-limit',f(cfg.peak_demand_w,0)+' W');
  const demand=r&&cfg.peak_demand_w?r.main_w/cfg.peak_demand_w:0;
  $('demand-fill').style.transform=`scaleX(${Math.max(0,Math.min(1,demand))})`;
  $('demand-fill').parentElement.classList.toggle('exceeded',demand>1);
  setText('vE',f(totals.total_wh,2));setText('energy-cost',totals.cost_inr==null?'—':'₹'+f(totals.cost_inr,3));
  const tariff=s.tariff,official=tariff?.kind==='msedcl_first_slab',rate=tariff?.rate_inr_per_kwh??cfg.tariff_inr_per_kwh;
  $('nE').textContent=rate==null?'Rate unavailable':'₹'+f(rate,2)+'/kWh · '+(official?'MSEDCL':'custom');
  const today=new Date().toISOString().slice(0,10),currentTariff=official&&today>=tariff.effective_from&&today<=tariff.effective_until;
  const costNote=rate==null?'Tariff data unavailable. Energy recording continues.':official?(currentTariff?'First 100 monthly units. Fixed fees, FAC and taxes excluded.':'Tariff needs review. Fixed fees, FAC and taxes excluded.'):'Configured energy rate. Fixed fees and other bill charges excluded.';
  if($('cost-note'))$('cost-note').textContent=costNote;
  $('nE').title=official?`${tariff.category}, ${tariff.monthly_slab}. ₹${f(tariff.energy_inr_per_kwh,2)} energy + ₹${f(tariff.wheeling_inr_per_kwh,2)} wheeling per kWh. Valid ${tariff.effective_from} to ${tariff.effective_until}. ${tariff.basis} ${costNote}`:'Configured flat energy rate. '+costNote;
  if(official)$('nE').href=tariff.source_url;else $('nE').removeAttribute('href');
  setText('tT',f(totals.total_wh,2));setText('tA',f(totals.a_wh,2));setText('tB',f(totals.b_wh,2));
  const sum=(totals.a_wh||0)+(totals.b_wh||0),pa=sum?(totals.a_wh||0)/sum*100:0;
  $('split-total').textContent=sum?f(sum,2):'—';$('energy-ring').style.background=sum?`conic-gradient(var(--a) 0 ${pa}%,var(--b) ${pa}% 100%)`:'var(--line)';
  $('sTxt').textContent=sum?`Zone A ${f(pa,0)}% · Zone B ${f(100-pa,0)}%`:'No circuit energy recorded';
  if(!$('dashboard-screen').hidden)chart(s.history||[]);
  const events=(s.events||[]).slice(0,3);
  const eventsKey=JSON.stringify(events);
  if($('ev')&&eventsKey!==lastEventsKey){
    lastEventsKey=eventsKey;$('ev').replaceChildren();
    if(!events.length){const empty=document.createElement('p');empty.className='empty-events';empty.textContent='No events recorded.';$('ev').append(empty);}
    for(const item of events){const row=document.createElement('div');row.className='event '+item.kind;const title=document.createElement('b');title.textContent=item.title;const when=document.createElement('time');when.textContent=new Date(item.timestamp*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});const detail=document.createElement('p');detail.textContent=item.details;row.append(when,title,detail);$('ev').append(row);}
  }
  renderDebug(s);updateActivity();
}
function renderDebug(s) {
  if($('debug-screen').hidden||document.hidden)return;
  setText('api-response',JSON.stringify(s,null,2));
  $('connection-detail').textContent=(s.transport||'USB serial')+(s.port?' · '+s.port:'')+' · '+(s.error|| (s.connection==='CONNECTED'?'Receiving live readings':s.connection==='SIMULATION'?'Simulated readings':'Waiting for sensor readings'))+(s.age_seconds!=null?' · Last sample '+f(s.age_seconds,1)+' s ago':'');
  $('network-debug').hidden=s.transport!=='Wi-Fi';
  const scan=s.scan||{};$('scan-phase').textContent=scan.phase||'Starting';
  $('scan-summary').textContent=`Round ${scan.round||0} · ${scan.attempted||0}/${scan.total||0} checked · Ranges: ${(scan.ranges||[]).join(', ')||'detecting'} · Ports: ${(scan.ports||[]).join(', ')||'loading'}`;
  $('scan-progress').max=Math.max(1,scan.total||0);$('scan-progress').value=scan.attempted||0;
  $('device-status').textContent=s.device_health?'ESP sensor: '+s.device_health.status:'No ESP response yet';
  $('device-response').textContent=s.device_health?JSON.stringify(s.device_health,null,2):'No device response yet';$('raw-packet').textContent=s.last_packet||'No sensor packet yet';
  const scanKey=JSON.stringify(scan.results||[]);
  if(scanKey===lastScanKey)return;
  lastScanKey=scanKey;
  const rows=$('scan-results');rows.replaceChildren();
  [...(scan.results||[])].reverse().forEach(result=>{const tr=document.createElement('tr');if(result.result==='FOUND')tr.className='scan-found';[result.url,result.result,result.ms+' ms',result.detail].forEach(value=>{const td=document.createElement('td');td.textContent=value;tr.append(td)});rows.append(tr)});
}
async function tick() {
  if(document.hidden||polling)return;
  clearTimeout(pollTimer);polling=true;
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),6000);
  pollController=controller;
  try {const response=await fetch('/api/dashboard',{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('HTTP '+response.status);renderState(await response.json());}
  catch(error){if(document.hidden)return;if(latestState){latestState={...latestState,last_known:latestState.latest||latestState.last_known,latest:null,connection:'DISCONNECTED'};}updateActivity();$('connection-detail').textContent='Cannot fetch /api/dashboard: '+error.message;}
  finally{clearTimeout(timeout);polling=false;pollController=null;if(!document.hidden)pollTimer=setTimeout(tick,2000);}
}
setInterval(()=>{if(!document.hidden&&!$('dashboard-screen').hidden&&latestState&&!isFresh()&&$('scene').dataset.state==='live')updateActivity();},1000);
let resizeTimer;addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(latestState&&!$('dashboard-screen').hidden)chart(latestState.history||[]);},100);});
async function startFrontendPreview() {
  let tariff=null;
  try{
    const response=await fetch('/static/electricity-tariff.json');if(!response.ok)throw Error('Tariff unavailable');
    tariff={...await response.json(),kind:'msedcl_first_slab'};
  }catch{ /* Keep preview usable while explicitly marking cost as unavailable. */ }
  const scenarios={off:[0,0],a:[174,0],b:[0,260],both:[174,260]};
  let selected='both',lastUpdate=performance.now();
  const now=Date.now()/1000;
  const history=Array.from({length:120},(_,i)=>{
    const [a,b]=Object.values(scenarios)[Math.floor(i/30)];
    return {timestamp:now-(119-i)*2,main_w:(a+b)*.23,branch_a_w:a*.23,branch_b_w:b*.23,residual_ma:b};
  });
  const totals={total_wh:0,a_wh:0,b_wh:0,cost_inr:0};
  for(const row of history){totals.total_wh+=row.main_w*2/3600;totals.a_wh+=row.branch_a_w*2/3600;totals.b_wh+=row.branch_b_w*2/3600;}
  $('preview-launcher').hidden=false;
  $('preview-controls').hidden=false;
  function publish(){
    if(document.hidden){lastUpdate=performance.now();return;}
    const dt=Math.max(0,Math.min(3,(performance.now()-lastUpdate)/1000));lastUpdate=performance.now();
    const [a,b]=scenarios[selected];
    const reading={main_ma:a+b,branch_a_ma:a,branch_b_ma:b,main_w:(a+b)*.23,branch_a_w:a*.23,branch_b_w:b*.23,tolerance_ma:15,timestamp:Date.now()/1000};
    totals.total_wh+=reading.main_w*dt/3600;totals.a_wh+=reading.branch_a_w*dt/3600;totals.b_wh+=reading.branch_b_w*dt/3600;totals.cost_inr=tariff?totals.total_wh/1000*tariff.rate_inr_per_kwh:null;
    history.push({...reading});if(history.length>120)history.shift();
    renderState({mode:'DEMO',connection:'SIMULATION',transport:'Frontend preview',port:null,age_seconds:0,latest:reading,last_known:null,totals:{...totals},tariff,settings:{assumed_voltage_v:230,tariff_inr_per_kwh:tariff?.rate_inr_per_kwh,peak_demand_w:85,active_current_ma:35},history:[...history],cloud:{enabled:false,ok:false,queued:0},source:'preview',error:'',scan:{phase:'Frontend preview; network scanning is disabled',results:[]},device_health:{device:'Frontend preview',status:'SIMULATED'},last_packet:'Frontend preview: '+selected,events:[{timestamp:now,kind:'info',title:'Frontend preview',details:'Sample readings for refining the interface. No device is connected.'}]});
    document.querySelectorAll('[data-preview]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.preview===selected)));
  }
  document.querySelectorAll('[data-preview]').forEach(button=>button.addEventListener('click',()=>{selected=button.dataset.preview;publish();}));
  document.querySelector('.export-link').addEventListener('click',event=>{
    event.preventDefault();
    const csv='timestamp,main_w,zone_a_w,zone_b_w\n'+history.map(row=>[row.timestamp,row.main_w,row.branch_a_w,row.branch_b_w].join(',')).join('\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const link=document.createElement('a');link.href=url;link.download='gridscope-frontend-preview.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  publish();setInterval(publish,2000);
}
if(frontendPreview)startFrontendPreview();else tick();
