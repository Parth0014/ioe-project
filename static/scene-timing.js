// A stable drawing buffer prevents sharp/soft jumps during lighting changes.
export function renderPixelRatio(width,height,pixelRatio=1,lowPower=false){
  const budget=lowPower?800000:1500000;
  return Math.min(pixelRatio,lowPower?1.5:1.75,Math.sqrt(budget/Math.max(1,width*height)));
}

export function advanceLevel(current,target,elapsedMs,reducedMotion=false){
  if(reducedMotion)return target;
  const step=Math.max(0,elapsedMs)/240;
  const distance=Math.abs(target-current);
  return distance<=step+1e-8?target:current+Math.sign(target-current)*step;
}
