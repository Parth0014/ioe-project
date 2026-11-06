async (page)=>{
  page.setDefaultTimeout(10000);
  await page.goto('http://127.0.0.1:8876/?demo=1');
  await page.waitForFunction(()=>typeof energyScene!=='undefined'&&energyScene&&energyScene.getState().aLevel===1);
  const results=[];
  for(const [width,height] of [[768,1024],[1024,768],[1920,1080]]){
    await page.setViewportSize({width,height});
    await page.waitForTimeout(150);
    const state=await page.evaluate(()=>energyScene.getState());
    const b=state.modelBounds,f=state.frustum;
    if(!(b.minX>f.left&&b.maxX<f.right&&b.minY>f.bottom&&b.maxY<f.top))throw new Error(`Model cropped at ${width}x${height}`);
    if(state.yaw!==0||state.elevation!==Math.PI/4)throw new Error('Camera angle changed on resize');
    results.push({width,height,modelFramed:true,bufferPixels:state.viewWidth*state.viewHeight*state.pixelRatio**2});
  }
  return results;
}
