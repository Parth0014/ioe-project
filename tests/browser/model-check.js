async (page) => {
  page.setDefaultTimeout(8000);
  let step='startup';
  try {
  const failures=[];
  page.on('pageerror',error=>failures.push(error.message));
  const assert=(condition,message)=>{if(!condition)throw new Error(message);};
  await page.setViewportSize({width:1440,height:900});
  await page.goto('http://127.0.0.1:8876/?demo=1');
  await page.waitForFunction(()=>typeof energyScene!=='undefined'&&energyScene&&energyScene.getState().aLevel===1&&energyScene.getState().bLevel===1);
  const model=await page.evaluate(()=>energyScene.getState());
  assert(model.model==='gridscope-rooms','Replacement room model was not loaded');
  assert(model.cameraType==='OrthographicCamera'&&model.yaw===0&&model.elevation===Math.PI/4,'Fixed view settings changed');
  assert(model.drawCalls<40&&model.triangles<6500,'Room exceeded the tested rendering budget');
  const canvas=await page.locator('#energy-canvas').boundingBox();
  await page.mouse.move(canvas.x+canvas.width*.5,canvas.y+canvas.height*.5);
  await page.mouse.down();await page.mouse.move(canvas.x+canvas.width*.6,canvas.y+canvas.height*.6);await page.mouse.up();
  await page.locator('#energy-canvas').dispatchEvent('wheel',{deltaY:200});
  const fixed=await page.evaluate(()=>energyScene.getState());
  assert(fixed.yaw===model.yaw&&fixed.elevation===model.elevation&&JSON.stringify(fixed.frustum)===JSON.stringify(model.frustum),'Reference orbit/zoom controls leaked into the fixed view');
  await page.getByRole('button',{name:'Preview controls',exact:true}).click();
  for(const [label,a,b] of [['Both off',0,0],['Zone A on',1,0],['Zone B on',0,1],['Both on',1,1]]){
    await page.getByRole('button',{name:label,exact:true}).click();
    await page.waitForFunction(({a,b})=>energyScene.getState().aLevel===a&&energyScene.getState().bLevel===b,{a,b});
    const state=await page.evaluate(()=>energyScene.getState());
    assert(state.pixelRatio===1,'Lighting change reallocated a larger buffer');
    const actual=await page.locator('#scene').evaluate(el=>({a:el.dataset.activeA,b:el.dataset.activeB}));
    assert(actual.a===String(!!a)&&actual.b===String(!!b),'Circuit labels do not match activity');
    await page.locator('#scene').screenshot({path:`output/playwright/room-${a}-${b}.png`});
  }
  // Reverse targets before either transition settles.
  step='rapid reversal';
  await page.getByRole('button',{name:'Both off',exact:true}).click();
  await page.getByRole('button',{name:'Zone A on',exact:true}).click();
  await page.getByRole('button',{name:'Zone B on',exact:true}).click();
  await page.getByRole('button',{name:'Both on',exact:true}).click();
  await page.waitForFunction(()=>energyScene.getState().aLevel===1&&energyScene.getState().bLevel===1);
  await page.getByRole('button',{name:'Pause flow',exact:true}).click();
  step='pause';
  await page.waitForFunction(()=>!energyScene.getState().rendering);
  const paused=await page.evaluate(()=>energyScene.getState());
  await page.waitForTimeout(350);
  const still=await page.evaluate(()=>energyScene.getState());
  assert(still.flowFrames===paused.flowFrames&&still.renderedFrames===paused.renderedFrames,'Paused scene kept repainting');
  await page.getByRole('button',{name:'Resume flow',exact:true}).click();
  await page.keyboard.press('Escape');
  await page.getByRole('link',{name:'Debugging',exact:true}).click();
  step='debug view';
  await page.waitForFunction(()=>!energyScene.getState().rendering);
  const debug=await page.evaluate(()=>energyScene.getState());
  await page.waitForTimeout(350);
  assert((await page.evaluate(()=>energyScene.getState().flowFrames))===debug.flowFrames,'Hidden dashboard still animated');
  await page.getByRole('link',{name:'Dashboard',exact:true}).click();
  step='return to dashboard';
  await page.waitForFunction(()=>energyScene.getState().rendering);
  await page.emulateMedia({reducedMotion:'reduce'});
  step='reduced motion';
  await page.waitForFunction(()=>energyScene.getState().reducedMotion&&!energyScene.getState().rendering);
  await page.emulateMedia({reducedMotion:'no-preference'});
  // Returning from a background tab must preserve elapsed packet age.
  step='background tab';
  await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hidden=await page.evaluate(()=>energyScene.getState());
  await page.waitForTimeout(4500);
  assert((await page.evaluate(()=>energyScene.getState().flowFrames))===hidden.flowFrames,'Background scene still animated');
  await page.evaluate(()=>{
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  step='stale return';
  await page.waitForFunction(()=>document.querySelector('#scene').dataset.state==='stale');
  step='stale lamps';
  await page.waitForFunction(()=>energyScene.getState().aLevel===0&&energyScene.getState().bLevel===0);
  await page.waitForFunction(()=>document.querySelector('#scene').dataset.state==='live');
  step='retina phone';
  const retina=await page.context().browser().newContext({viewport:{width:390,height:844},deviceScaleFactor:2});
  try{
    const phone=await retina.newPage();
    await phone.goto('http://127.0.0.1:8876/?demo=1');
    await phone.waitForFunction(()=>typeof energyScene!=='undefined'&&energyScene&&energyScene.getState().aLevel===1);
    const state=await phone.evaluate(()=>({scene:energyScene.getState(),overflow:document.documentElement.scrollWidth>innerWidth}));
    assert(!state.overflow,'Phone layout overflowed');
    assert(state.scene.pixelRatio<=1.75,'Phone drawing buffer exceeded its density cap');
    assert(state.scene.modelBounds.minX>state.scene.frustum.left&&state.scene.modelBounds.maxX<state.scene.frustum.right,'Phone model was cropped horizontally');
    assert(state.scene.modelBounds.minY>state.scene.frustum.bottom&&state.scene.modelBounds.maxY<state.scene.frustum.top,'Phone model was cropped vertically');
    await phone.screenshot({path:'output/playwright/model-phone-retina.png'});
  }finally{await retina.close();}
  await page.goto('http://127.0.0.1:8876/?demo=1');
  step='unchanged chart';
  await page.waitForFunction(()=>typeof energyScene!=='undefined'&&energyScene&&energyScene.getState().aLevel===1);
  await page.locator('.trend-panel').scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>document.querySelector('#chart path'));
  const stableChart=await page.evaluate(()=>{
    const first=document.querySelector('#chart path');
    chart(latestState.history);chart(latestState.history);
    return first===document.querySelector('#chart path');
  });
  assert(stableChart,'Unchanged chart rebuilt its DOM');
  assert(failures.length===0,'Browser error: '+failures.join('; '));
  return {allLightingStates:true,rapidReversal:true,pauseStopsFrames:true,debugStopsFrames:true,reducedMotion:true,hiddenStopsFrames:true,staleOnReturn:true,retinaPhone:true,stableChart:true,pageErrors:failures};
  }catch(error){throw new Error(step+': '+error.message);}
}
