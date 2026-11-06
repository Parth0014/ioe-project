async (page) => {
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(()=>{
    window.modelLongTasks=[];
    new PerformanceObserver(list=>{for(const entry of list.getEntries())window.modelLongTasks.push({start:entry.startTime,duration:entry.duration});}).observe({entryTypes:['longtask']});
  });
  await page.goto('http://127.0.0.1:8876/?demo=1');
  await page.waitForFunction(()=>typeof energyScene!=='undefined' && energyScene && energyScene.getState().aLevel===1 && energyScene.getState().bLevel===1);
  const initial=await page.evaluate(()=>({state:energyScene.getState(),buffer:{width:document.querySelector('#energy-canvas').width,height:document.querySelector('#energy-canvas').height},longTasks:window.modelLongTasks}));
  await page.screenshot({path:'output/playwright/model-desktop.png'});
  const initialFrame=initial.state.renderedFrames;
  await page.waitForTimeout(1500);
  const idle=await page.evaluate(()=>energyScene.getState());
  await page.getByRole('button',{name:'Preview controls',exact:true}).click();
  const transitions=[];
  for(const [label,a,b] of [['Both off',0,0],['Zone A on',1,0],['Zone B on',0,1],['Both on',1,1]]){
    const before=await page.evaluate(()=>({start:performance.now(),state:energyScene.getState()}));
    await page.getByRole('button',{name:label,exact:true}).click();
    await page.waitForFunction(({a,b})=>energyScene.getState().aLevel===a&&energyScene.getState().bLevel===b,{a,b});
    const after=await page.evaluate(()=>({end:performance.now(),state:energyScene.getState()}));
    transitions.push({label,milliseconds:after.end-before.start,renders:after.state.renderedFrames-before.state.renderedFrames});
  }
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(500);
  await page.screenshot({path:'output/playwright/model-mobile.png'});
  const mobile=await page.evaluate(()=>({state:energyScene.getState(),buffer:{width:document.querySelector('#energy-canvas').width,height:document.querySelector('#energy-canvas').height},overflow:document.documentElement.scrollWidth>innerWidth}));
  return {initial,idleRenders:idle.renderedFrames-initialFrame,idleFlowFrames:idle.flowFrames-initial.state.flowFrames,transitions,mobile};
}
