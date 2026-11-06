// Used only by explicitly labelled frontend previews. No API or database writes.
export function previewReport(range,mode,now=Date.now()/1000){
  const [duration,interval]=({ '24h':[86400,3600], '7d':[604800,86400], '30d':[2592000,86400] })[range];
  const start=now-duration,first=Math.floor((start+19800)/interval)*interval-19800;
  const buckets=[];
  for(let ts=first,index=0;ts<now;ts+=interval,index++){
    const recorded=mode==='DEMO'&&index%7!==0;
    const seconds=recorded?Math.min(interval/2,Math.max(0,Math.min(ts+interval,now)-Math.max(ts,start))):0;
    const power=30+(index%6)*7;
    const wh=power*seconds/3600;
    buckets.push({timestamp:ts,energy_wh:recorded?wh:null,a_wh:recorded?wh*.6:null,b_wh:recorded?wh*.4:null,samples:recorded?Math.floor(seconds)+1:0,recorded_seconds:seconds});
  }
  const energy=buckets.reduce((sum,b)=>sum+(b.energy_wh||0),0);
  const seconds=buckets.reduce((sum,b)=>sum+b.recorded_seconds,0);
  const samples=buckets.reduce((sum,b)=>sum+b.samples,0);
  return {source:'preview',mode,device_id:'frontend-preview',start,end:now,timezone:'Asia/Kolkata',bucket_seconds:interval,buckets,
    cloud:{enabled:false,ok:false,queued:0},
    latest:mode==='DEMO'?{ts:now,main_w:58,a_w:34.8,b_w:23.2}:null,
    events:mode==='DEMO'?[{ts:now,kind:'info',title:'Frontend preview',details:'Simulated usage for checking this page. No sensor or database is connected.'}]:[],
    summary:{energy_wh:energy,a_wh:energy*.6,b_wh:energy*.4,cost_inr:energy/1000*5.56,rate_inr_per_kwh:5.56,
      peak_w:samples?65:null,average_w:seconds?energy*3600/seconds:null,samples,recorded_seconds:seconds,coverage_percent:seconds/duration*100,
      previous_energy_wh:null,change_percent:null,previous_coverage_percent:0,counter_resets:0}
  };
}
