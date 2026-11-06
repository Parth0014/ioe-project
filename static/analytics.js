(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const hosted = document.body.dataset.hosted === 'true';
  const query = new URLSearchParams(location.search);
  const staticPreview=location.pathname.includes('/templates/');
  const frontendPreview=!hosted&&(staticPreview||query.get('demo')==='1');
  let range = ['24h', '7d', '30d'].includes(query.get('range')) ? query.get('range') : '24h';
  const defaultMode=frontendPreview?'DEMO':['LIVE','DEMO'].includes(document.body.dataset.mode)?document.body.dataset.mode:'LIVE';
  let mode = ['LIVE', 'DEMO'].includes(query.get('mode')) ? query.get('mode') : defaultMode;
  $('nav-local-dashboard').hidden=hosted;
  $('signout').hidden=!hosted;
  $('local-context').hidden=hosted;
  if(hosted)$('app-context').textContent='Cloud dashboard';
  if(frontendPreview){
    $('preview-note').hidden=false;
    $('local-context').textContent='Frontend preview';
    $('nav-local-dashboard').href=staticPreview?'/templates/index.html':'/?demo=1';
    $('nav-usage').href=staticPreview?'/templates/analytics.html?demo=1':'/analytics?demo=1';
    $('analytics-brand').href=$('nav-usage').href;
  }
  let current = null, controller = null, loading = false;
  let lastChartKey='',lastBucketsKey='',lastEventsKey='';
  const number = (value, digits = 2) => value == null ? '—' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(value);
  const date = (ts, options = {}) => ts == null ? 'Not recorded yet' : new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', ...options }).format(new Date(ts * 1000));
  const energy = value => value >= 1000 ? `${number(value / 1000, 3)} kWh` : `${number(value, 3)} Wh`;
  const text = (id, value) => { if($(id).textContent!==value)$(id).textContent=value; };
  const svgNS = 'http://www.w3.org/2000/svg';
  function svgNode(tag, attributes = {}, content) {
    const node = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    if (content != null) node.textContent = content;
    return node;
  }
  function drawChart(data) {
    const width = Math.max(300, $('chart').clientWidth), height = Math.max(185, $('chart').clientHeight);
    const key=width+':'+height+':'+JSON.stringify(data.buckets);
    if(key===lastChartKey)return;
    lastChartKey=key;
    const left = 45, right = 8, top = 12, bottom = 34, innerW = width - left - right, innerH = height - top - bottom;
    const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true' });
    const max = Math.max(...data.buckets.map(b => b.energy_wh || 0));
    const ceiling = max > 0 ? max * 1.15 : 1;
    for (let i = 0; i <= 3; i++) {
      const y = top + innerH * i / 3;
      svg.append(svgNode('line', { x1: left, x2: width-right, y1: y, y2: y, class: 'grid' }));
      svg.append(svgNode('text', { x: left-8, y: y+4, 'text-anchor': 'end' }, number(ceiling * (1-i/3), ceiling < 1 ? 3 : 1)));
    }
    const step = innerW / data.buckets.length;
    data.buckets.forEach((b, i) => {
      const x = left + i * step;
      const label = date(b.timestamp);
      if (b.energy_wh == null) {
        const mark = svgNode('line', { x1: x+step*.3, x2: x+step*.7, y1: top+innerH-3, y2: top+innerH-3, class: 'gap' });
        mark.append(svgNode('title', {}, `${label} IST: no readings`)); svg.append(mark);
      } else {
        const h = Math.max(b.energy_wh > 0 ? 2 : 1, b.energy_wh / ceiling * innerH);
        const bar = svgNode('rect', { x: x+step*.18, y: top+innerH-h, width: Math.max(1,step*.64), height: h, rx: 2, class: 'bar' });
        bar.append(svgNode('title', {}, `${label} IST: ${number(b.energy_wh, 4)} Wh · ${number(b.samples, 0)} samples`)); svg.append(bar);
      }
      const interval = Math.ceil(data.buckets.length / (width < 400 ? 4 : 6));
      if (i % interval === 0) {
        const short = new Intl.DateTimeFormat('en-IN', data.bucket_seconds === 3600 ? { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false } : { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }).format(new Date(b.timestamp*1000));
        svg.append(svgNode('text', { x: x+step/2, y: height-7, 'text-anchor': 'middle' }, short));
      }
    });
    $('chart').replaceChildren(svg);
    $('chart').setAttribute('aria-label', `${energy(data.summary.energy_wh)} recorded across ${data.buckets.length} intervals. ${data.buckets.filter(b => !b.samples).length} intervals have no readings. A data table follows below.`);
  }
  function render(data) {
    current = data;
    const s = data.summary, cloud = data.cloud || {}, latest = data.latest;
    $('report').hidden = false;
    $('empty').hidden = s.samples > 0;
    $('demo-note').hidden = mode !== 'DEMO'||frontendPreview;
    text('energy', number(s.energy_wh >= 1000 ? s.energy_wh/1000 : s.energy_wh, 3));
    text('energy-unit', s.energy_wh >= 1000 ? 'kWh' : 'Wh');
    text('cost', `₹${number(s.cost_inr, s.cost_inr < 1 ? 4 : 2)}`);
    text('rate', `₹${number(s.rate_inr_per_kwh, 2)}/kWh · current flat rate`);
    text('peak', number(s.peak_w, 1));
    text('average', `Average recorded demand ${number(s.average_w, 1)} W`);
    text('coverage', number(s.coverage_percent, 1));
    text('duration', `${number(s.recorded_seconds/3600, 2)} hours recorded · ${number(s.samples, 0)} samples`);
    text('comparison', s.change_percent == null ? 'No earlier recorded total to compare' : `${s.change_percent >= 0 ? '+' : ''}${number(s.change_percent, 1)}% recorded energy vs previous period`);
    for (const zone of ['a', 'b']) {
      const wh = s[`${zone}_wh`], share = s.energy_wh > 0 ? wh/s.energy_wh*100 : 0;
      text(`zone-${zone}`, energy(wh));
      $(`share-${zone}`).value = Math.min(100, Math.max(0, share));
      text(`percent-${zone}`, s.energy_wh > 0 ? `${number(share, 1)}% of recorded feeder energy` : 'No recorded feeder energy yet');
    }
    text('split-note', s.a_wh+s.b_wh > s.energy_wh*1.02 && s.energy_wh > 0 ? 'Circuit estimates exceed feeder energy. Review sensor disagreement events and calibration.' : 'Shares use recorded feeder energy. Zone B is inferred from the two sensors.');
    const age = latest ? Math.max(0, Date.now()/1000-latest.ts) : Infinity;
    const fresh = age <= 10;
    text('status', `${frontendPreview ? 'Frontend preview' : hosted ? 'Cloud history' : 'Local history'} · ${mode === 'DEMO' ? 'Demo readings' : 'Real sensor readings'} · ${fresh ? 'Readings arriving' : latest ? 'Gateway readings are stale' : 'Waiting for first reading'}`);
    $('status-dot').classList.toggle('fresh', fresh);
    text('refreshed', `Updated ${date(data.generated_at || data.end, { day: undefined, month: undefined })} IST`);
    text('last-reading', latest ? `${date(latest.ts)} IST${fresh ? '' : ' · stale'}` : 'No saved readings');
    text('last-power', latest ? `${number(latest.main_w, 1)} W${fresh ? '' : ' · last known'}` : '—');
    text('source', frontendPreview?'Browser sample data':hosted?'MongoDB Atlas':'Local SQLite');
    text('cloud-state', hosted ? (cloud.heartbeat && Date.now()/1000-cloud.heartbeat < 30 ? 'Gateway connected recently' : 'Gateway heartbeat is stale') : !cloud.enabled ? 'Not configured · saved locally' : cloud.ok ? `${number(cloud.queued, 0)} rows pending upload` : 'Retrying · saved locally');
    text('previous-coverage', `${number(s.previous_coverage_percent, 1)}%`);
    text('quality-note', `${s.coverage_percent < 95 ? 'This period has gaps. Totals include recorded energy only. ' : ''}Comparisons depend on recording coverage.${s.counter_resets ? ` ${s.counter_resets} counter reset(s) excluded from energy deltas.` : ''}`);
    text('gateway-details', `Gateway ID: ${data.device_id}${data.device_name ? ` · ${data.device_name}` : ''}${!hosted ? ` · ${number(cloud.queued, 0)} saved rows awaiting sync${cloud.last_success ? ` · Last sync ${date(cloud.last_success)} IST` : ''}` : ''}`);
    text('bucket-label', `${data.bucket_seconds === 3600 ? 'Hourly' : 'Daily'} · IST`);
    text('chart-caption', `Energy in Wh · ${date(data.start)} to ${date(data.end)} IST. Edge intervals may be partial. Empty intervals are gaps in recording.`);
    const bucketsKey=JSON.stringify(data.buckets);
    if(bucketsKey!==lastBucketsKey){
      lastBucketsKey=bucketsKey;
      const rows = data.buckets.map(b => {
        const tr = document.createElement('tr');
        [date(b.timestamp), number(b.energy_wh, 4), number(b.a_wh, 4), number(b.b_wh, 4), number(b.samples, 0)].forEach(value => { const td = document.createElement('td'); td.textContent=value; tr.append(td); });
        return tr;
      });
      $('table-body').replaceChildren(...rows);
    }
    const eventsKey=JSON.stringify(data.events||[]);
    if(eventsKey!==lastEventsKey){
      lastEventsKey=eventsKey;
      const events = (data.events || []).map(event => {
        const li = document.createElement('li'), time = document.createElement('time'), body = document.createElement('div'), title = document.createElement('strong'), details = document.createElement('p');
        time.dateTime = new Date(event.ts*1000).toISOString(); time.textContent = `${date(event.ts)} IST`;
        title.textContent=event.title; details.textContent=event.details; body.append(title,details); li.append(time,body); return li;
      });
      $('events').replaceChildren(...events); $('no-events').hidden=events.length>0;
    }
    const reference = data.tariff?.source_url;
    $('tariff-link').hidden=true;
    if (typeof reference === 'string' && reference.startsWith('https://')) { $('tariff-link').href=reference; $('tariff-link').hidden=false; }
    $('export').disabled = false;
    drawChart(data);
  }
  async function load(clear = false) {
    if (controller) controller.abort();
    const active = new AbortController(); controller=active; loading=true;
    const timeout = setTimeout(() => active.abort(), 55000);
    $('refresh').disabled=true; $('refresh').textContent='Refreshing…'; $('error').hidden=true;
    if (clear) { current=null; $('report').hidden=true; $('empty').hidden=true; $('export').disabled=true; text('status','Loading recorded usage…'); }
    try {
      if(frontendPreview){
        const {previewReport}=await import('/static/analytics-preview.js');
        render(previewReport(range,mode));
        return;
      }
      const response = await fetch(`/api/analytics?range=${range}&mode=${mode}`, { signal:active.signal, cache:'no-store' });
      if (response.status===401 && hosted) { location.assign('/login'); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Usage could not be loaded. Try again.');
      render(data);
    } catch (error) {
      if (controller!==active) return;
      text('error-text', error.name==='AbortError' ? 'Loading timed out. Check your connection and try again.' : error.message);
      $('error').hidden=false; text('status', current && !clear ? 'Refresh failed · showing previously loaded data' : 'Recorded usage is unavailable');
      $('status-dot').classList.remove('fresh');
    } finally {
      clearTimeout(timeout);
      if (controller===active) { controller=null; loading=false; $('refresh').disabled=false; $('refresh').textContent='Refresh data'; }
    }
  }
  function updateFilters() {
    range = document.querySelector('input[name=range]:checked').value; mode=$('mode').value;
    const url=new URL(location.href); url.searchParams.set('range',range); url.searchParams.set('mode',mode); history.replaceState(null,'',url);
    $('demo-note').hidden=mode!=='DEMO'||frontendPreview; load(true);
  }
  document.querySelector(`input[name=range][value="${range}"]`).checked=true; $('mode').value=mode;
  document.querySelectorAll('input[name=range]').forEach(input => input.addEventListener('change',updateFilters));
  $('mode').addEventListener('change',updateFilters); $('refresh').addEventListener('click',()=>load()); $('retry').addEventListener('click',()=>load(!current));
  $('export').addEventListener('click', () => {
    if (!current) return;
    const lines=[['interval_utc','interval_ist','feeder_wh','zone_a_wh','zone_b_wh','samples','recorded_seconds','mode']];
    for (const b of current.buckets) lines.push([new Date(b.timestamp*1000).toISOString(),date(b.timestamp),b.energy_wh??'',b.a_wh??'',b.b_wh??'',b.samples,b.recorded_seconds,current.mode]);
    const csv=lines.map(row=>row.map(value=>`"${String(value).replaceAll('"','""')}"`).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})), link=document.createElement('a');
    link.href=url; link.download=`gridscope-${current.mode.toLowerCase()}-${range}.csv`; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  let sizeFrame;
  new ResizeObserver(()=>{ cancelAnimationFrame(sizeFrame); sizeFrame=requestAnimationFrame(()=>{if(current&&!$('report').hidden)drawChart(current);}); }).observe($('chart'));
  setInterval(()=>{if(!document.hidden&&!loading)load();},30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!loading)load();});
  load(true);
})();
