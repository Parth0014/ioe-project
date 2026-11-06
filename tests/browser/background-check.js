async (page) => {
  page.setDefaultTimeout(10000);
  let requests=0;
  await page.route('**/api/dashboard',async route=>{
    requests++;
    const response=await route.fetch();
    const state=await response.json();
    state.connection='CONNECTED';state.age_seconds=0;
    state.latest={timestamp:Date.now()/1000,main_ma:434,branch_a_ma:174,branch_b_ma:260,main_w:99.8,branch_a_w:40,branch_b_w:59.8,tolerance_ma:15};
    await route.fulfill({json:state});
  });
  await page.goto('http://127.0.0.1:8876/');
  await page.waitForFunction(()=>typeof energyScene!=='undefined'&&energyScene&&energyScene.getState().aLevel===1);
  await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const before=requests;
  await page.waitForTimeout(2600);
  if(requests!==before)throw new Error('Dashboard kept polling in an emulated hidden tab');
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForFunction(()=>document.querySelector('#scene').dataset.state==='live');
  await page.waitForTimeout(150);
  if(requests<=before)throw new Error('Dashboard did not resume polling');
  await page.evaluate(()=>{
    const spacer=document.createElement('div');spacer.id='test-spacer';spacer.style.height='1500px';document.body.append(spacer);spacer.scrollIntoView();
  });
  await page.waitForFunction(()=>!energyScene.getState().rendering);
  const offscreen=await page.evaluate(()=>energyScene.getState().flowFrames);
  await page.waitForTimeout(250);
  if(offscreen!==(await page.evaluate(()=>energyScene.getState().flowFrames)))throw new Error('Offscreen scene kept painting');
  await page.evaluate(()=>{document.querySelector('#test-spacer').remove();scrollTo(0,0);});
  await page.waitForFunction(()=>energyScene.getState().rendering);
  await page.unroute('**/api/dashboard');
  return {hiddenPollingStopped:true,visiblePollingResumed:true,offscreenRenderingStopped:true,visibleRenderingResumed:true};
}
