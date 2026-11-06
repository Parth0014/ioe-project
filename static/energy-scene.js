import * as THREE from './vendor/three.module.min.js';
import {renderPixelRatio,advanceLevel} from './scene-timing.js';
import {buildRoomModel} from './room-model.js';

// The room is an illustrative model. Only lamp/flow activity represents telemetry.
export function createEnergyScene() {
  const canvas = document.getElementById('energy-canvas');
  const container = document.getElementById('scene');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const lowPower=(navigator.deviceMemory||8)<=4||(navigator.hardwareConcurrency||8)<=4;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true, powerPreference:'low-power'}); }
  catch { throw new Error('WebGL is unavailable'); }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1,1,1,-1,.1,100);
  const target = new THREE.Vector3(-.3, .25, .2);
  const yaw=0,elevation=Math.PI/4,distance=20;
  let paused=false,visible=true,contextLost=false;
  let viewWidth=0, viewHeight=0, displayPixelRatio=devicePixelRatio, cameraDirty=true, renderedFrames=0, flowFrames=0, lastLightingFrame=0, lastFlowFrame=0;
  let desiredA=0, desiredB=0, aLevel=0, bLevel=0, live=false, frame=0, last=0, flowTime=0;
  const world = new THREE.Group();scene.add(world);
  const unitBox = new THREE.BoxGeometry(1,1,1);
  const palette={a:0x80d8c1,b:0xe9b77b,feed:0x98c4f0};
  const room=buildRoomModel(THREE,world,unitBox);
  const mats=room.materials;
  function box(w,h,d,x,y,z,mat,parent=world){const m=new THREE.Mesh(unitBox,mat);m.scale.set(w,h,d);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
  function cylinder(r1,r2,h,x,y,z,mat){const m=new THREE.Mesh(new THREE.CylinderGeometry(r1,r2,h,20),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;world.add(m);return m;}
  const sphereGeometries=new Map();
  function sphere(r,x,y,z,mat){if(!sphereGeometries.has(r))sphereGeometries.set(r,new THREE.SphereGeometry(r,12,8));const m=new THREE.Mesh(sphereGeometries.get(r),mat);m.position.set(x,y,z);world.add(m);return m;}
  scene.add(new THREE.HemisphereLight(0x9fb8c8,0x1b2a22,.35));
  const sun=new THREE.DirectionalLight(0xffe7c2,.38);sun.position.set(-4,10,5);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-9;sun.shadow.camera.right=9;sun.shadow.camera.top=8;sun.shadow.camera.bottom=-8;sun.shadow.normalBias=.045;sun.shadow.autoUpdate=false;sun.shadow.needsUpdate=true;scene.add(sun);
  const rim=new THREE.DirectionalLight(0xb8d4cb,.35);rim.position.set(5,5,-7);scene.add(rim);
  // Contact shadow gives the plinth weight without a bitmap asset or a network request.
  const textureCanvas=document.createElement('canvas');textureCanvas.width=128;textureCanvas.height=128;
  const ctx=textureCanvas.getContext('2d');const gradient=ctx.createRadialGradient(64,64,15,64,64,64);gradient.addColorStop(0,'rgba(35,62,42,.27)');gradient.addColorStop(.6,'rgba(35,62,42,.13)');gradient.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
  const shadow=new THREE.Mesh(new THREE.PlaneGeometry(17,12),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(textureCanvas),transparent:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=-.65;scene.add(shadow);
  const glowCanvas=document.createElement('canvas');glowCanvas.width=128;glowCanvas.height=128;
  const glowContext=glowCanvas.getContext('2d'),glowGradient=glowContext.createRadialGradient(64,64,0,64,64,64);
  glowGradient.addColorStop(0,'rgba(255,255,255,1)');glowGradient.addColorStop(.4,'rgba(255,255,255,.65)');glowGradient.addColorStop(1,'rgba(255,255,255,0)');
  glowContext.fillStyle=glowGradient;glowContext.fillRect(0,0,128,128);
  const glowTexture=new THREE.CanvasTexture(glowCanvas);
  // Warm fixture lighting plus a local fill approximates reflected room light.
  // Only fixture shadows are cached; indirect fill stays soft and shadow-free.
  function lamp(spec){
    const {x,z,height,warmColor}=spec;
    const shadeMat=new THREE.MeshStandardMaterial({color:0x222222,emissive:warmColor,emissiveIntensity:0,roughness:.5});
    const shade=cylinder(...spec.shade,x,height,z,shadeMat);
    const bulbMat=new THREE.MeshStandardMaterial({color:0xfff2d2,emissive:warmColor,emissiveIntensity:0,roughness:.5});
    const bottom=height-spec.shade[2]/2;
    const bulb=sphere(.09,x,bottom-.015,z,bulbMat);
    shade.userData.dynamic=true;bulb.userData.dynamic=true;
    const light=new THREE.SpotLight(warmColor,0,10,.95,.6,2);
    light.position.set(x,bottom-.06,z);light.target.position.set(spec.target[0],0,spec.target[1]);scene.add(light.target);
    light.castShadow=true;light.shadow.mapSize.set(512,512);
    light.shadow.camera.near=.08;light.shadow.camera.far=10;
    light.shadow.normalBias=.02;light.shadow.bias=-.00015;light.shadow.radius=2;light.shadow.autoUpdate=false;scene.add(light);
    const bounce=new THREE.PointLight(warmColor,0,6,2);
    bounce.position.set(...spec.fill);scene.add(bounce);
    const halo=new THREE.Sprite(new THREE.SpriteMaterial({color:warmColor,map:glowTexture,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));
    halo.position.set(x,bottom-.02,z);halo.scale.set(.65,.65,1);world.add(halo);
    return {light,bounce,bulb,shade,halo,shadowReady:false};
  }
  const lampA=lamp(room.lamps.a),lampB=lamp(room.lamps.b);
  const feederGlow=new THREE.MeshStandardMaterial({color:0x485e6c,emissive:palette.feed,emissiveIntensity:.05,roughness:.3});
  box(.6,.95,.45,-6.65,.34,3.05,mats.dark);box(.4,.35,.025,-6.65,.51,3.3,feederGlow);
  for(let x=-6.79;x<-6.49;x+=.09)box(.035,.12,.03,x,.22,3.3,mats.trim);
  function powerPath(points,color){
    // Straight segments keep the flow on the cable, without spline overshoot at bends.
    const vertices=points.map(p=>new THREE.Vector3(...p));
    const curve=new THREE.CurvePath();
    for(let i=1;i<vertices.length;i++)curve.add(new THREE.LineCurve3(vertices[i-1],vertices[i]));
    const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,48,.027,6,false),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.08}));world.add(mesh);
    const glow=new THREE.Mesh(new THREE.TubeGeometry(curve,48,.07,6,false),new THREE.MeshBasicMaterial({color,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));world.add(glow);
    return {curve,mesh,glow,color,level:0};
  }
  const trunk=powerPath(room.circuits.trunk,palette.feed);
  const pathA=powerPath(room.circuits.a,palette.a);
  const pathB=powerPath(room.circuits.b,palette.b);

  // Static furniture shares geometry and material; one draw call handles each batch.
  const batches=new Map();
  for(const mesh of [...world.children]){
    if(!mesh.isMesh||mesh.userData.dynamic)continue;
    const key=mesh.geometry.uuid+':'+mesh.material.uuid;
    if(!batches.has(key))batches.set(key,[]);
    batches.get(key).push(mesh);
  }
  for(const meshes of batches.values()){
    if(meshes.length<2)continue;
    const batch=new THREE.InstancedMesh(meshes[0].geometry,meshes[0].material,meshes.length);
    batch.castShadow=meshes[0].castShadow;batch.receiveShadow=meshes[0].receiveShadow;
    meshes.forEach((mesh,index)=>{mesh.updateMatrix();batch.setMatrixAt(index,mesh.matrix);world.remove(mesh);});
    batch.instanceMatrix.needsUpdate=true;batch.computeBoundingSphere();world.add(batch);
  }
  // Only light/material values change; furniture transforms stay fixed.
  scene.traverse(object=>{object.updateMatrix();object.matrixAutoUpdate=false;});
  renderer.shadowMap.needsUpdate=true;
  // Cache the actual object bounds once, rather than framing empty corners above the room.
  const framingPoints=[];world.updateMatrixWorld(true);
  const instanceMatrix=new THREE.Matrix4(),combinedMatrix=new THREE.Matrix4();
  for(const object of world.children){
    if(!object.isMesh)continue;
    object.geometry.computeBoundingBox();const bounds=object.geometry.boundingBox;
    const count=object.isInstancedMesh?object.count:1;
    for(let index=0;index<count;index++){
      if(object.isInstancedMesh){object.getMatrixAt(index,instanceMatrix);combinedMatrix.multiplyMatrices(object.matrixWorld,instanceMatrix);}
      else combinedMatrix.copy(object.matrixWorld);
      for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])framingPoints.push(new THREE.Vector3(x,y,z).applyMatrix4(combinedMatrix).sub(target));
    }
  }
  const direction=new THREE.Vector3(Math.sin(yaw)*Math.cos(elevation),Math.sin(elevation),Math.cos(yaw)*Math.cos(elevation));
  const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),direction).normalize();
  const up=new THREE.Vector3().crossVectors(direction,right).normalize();
  camera.position.copy(target).addScaledVector(direction,distance);camera.lookAt(target);
  camera.updateMatrixWorld();
  // The room and camera are static. Animate only the small flow layer, leaving the
  // expensive lit WebGL image untouched between lighting changes and resizes.
  const flowCanvas=document.createElement('canvas');flowCanvas.className='energy-flow';flowCanvas.setAttribute('aria-hidden','true');
  const flowContext=flowCanvas.getContext('2d');
  container.append(flowCanvas);
  const svgNamespace='http://www.w3.org/2000/svg';
  const callouts=document.createElementNS(svgNamespace,'svg');callouts.classList.add('zone-callouts');
  callouts.setAttribute('role','img');callouts.setAttribute('aria-label','Active lighting zones');
  const zoneLabels=['a','b'].map(key=>{
    const label=key==='a'?'Zone A':'Zone B';
    const group=document.createElementNS(svgNamespace,'g');group.classList.add('zone-callout','callout-'+key);
    const line=document.createElementNS(svgNamespace,'path'),dot=document.createElementNS(svgNamespace,'circle'),text=document.createElementNS(svgNamespace,'text');
    dot.setAttribute('r','2');text.textContent=label;group.append(line,dot,text);callouts.append(group);
    return {key,group,line,dot,text,anchor:new THREE.Vector3(...room.callouts[key].anchor),topAnchor:new THREE.Vector3(...room.callouts[key].top)};
  });
  container.append(callouts);
  const paths=[trunk,pathA,pathB],sampleCount=128;
  const occluders=world.children.filter(object=>object.isMesh&&!paths.some(path=>object===path.mesh||object===path.glow));
  const raycaster=new THREE.Raycaster(),rayDirection=direction.clone().negate(),rayOrigin=new THREE.Vector3();
  const hits=[];
  for(const path of paths){
    path.length=path.curve.getLength();
    path.samples=[];path.projected=new Float32Array((sampleCount+1)*2);path.unobstructed=new Uint8Array(sampleCount+1);
    for(let i=0;i<=sampleCount;i++){
      const point=path.curve.getPoint(i/sampleCount);path.samples.push(point);
      rayOrigin.copy(point).addScaledVector(direction,30);raycaster.set(rayOrigin,rayDirection);raycaster.far=29.92;
      hits.length=0;raycaster.intersectObjects(occluders,false,hits);path.unobstructed[i]=hits.length===0?1:0;
    }
    const sprite=document.createElement('canvas');sprite.width=32;sprite.height=32;
    const context=sprite.getContext('2d'),color=new THREE.Color(path.color).lerp(new THREE.Color(0xffffff),.65).getStyle();
    const glow=context.createRadialGradient(16,16,3,16,16,16);glow.addColorStop(0,color);glow.addColorStop(1,'rgba(255,255,255,0)');
    context.globalAlpha=.25;context.fillStyle=glow;context.fillRect(0,0,32,32);context.globalAlpha=1;context.fillStyle=color;context.beginPath();context.arc(16,16,6,0,Math.PI*2);context.fill();path.sprite=sprite;
  }
  let flowLeft=0,flowTop=0,flowWidth=0,flowHeight=0,particleSize=0;
  const projectedPoint=new THREE.Vector3();
  function fitFlow(){
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const path of paths)for(let i=0;i<=sampleCount;i++){
      projectedPoint.copy(path.samples[i]).project(camera);
      const x=(projectedPoint.x+1)*viewWidth/2,y=(1-projectedPoint.y)*viewHeight/2;
      path.projected[i*2]=x;path.projected[i*2+1]=y;
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
    }
    particleSize=Math.max(5,viewHeight/(camera.top-camera.bottom)*.26);
    for(const path of paths){
      let projectedLength=0;
      for(let i=1;i<=sampleCount;i++)projectedLength+=Math.hypot(path.projected[i*2]-path.projected[(i-1)*2],path.projected[i*2+1]-path.projected[(i-1)*2+1]);
      // A short branch gets one pulse; longer cables get evenly spaced pulses.
      path.particleCount=Math.max(1,Math.min(Math.floor(path.length/1.2),Math.floor(projectedLength/Math.max(40,particleSize*3))));
    }
    flowLeft=Math.floor(minX-particleSize);flowTop=Math.floor(minY-particleSize);
    flowWidth=Math.ceil(maxX-flowLeft+particleSize);flowHeight=Math.ceil(maxY-flowTop+particleSize);
    const ratio=Math.min(devicePixelRatio,1.5);
    flowCanvas.width=Math.ceil(flowWidth*ratio);flowCanvas.height=Math.ceil(flowHeight*ratio);
    Object.assign(flowCanvas.style,{left:flowLeft+'px',top:flowTop+'px',width:flowWidth+'px',height:flowHeight+'px'});
    flowContext.setTransform(ratio,0,0,ratio,0,0);
  }
  function drawFlow(){
    flowContext.clearRect(0,0,flowWidth,flowHeight);
    if(live)for(const path of paths){
      if(path.level<=.05)continue;
      flowContext.globalAlpha=path.level;
      for(let i=0;i<path.particleCount;i++){
        const progress=((flowTime*.75/path.length+i/path.particleCount)%1)*sampleCount,index=Math.floor(progress),mix=progress-index;
        if(!path.unobstructed[Math.round(progress)])continue;
        const x=path.projected[index*2]*(1-mix)+path.projected[(index+1)*2]*mix-flowLeft;
        const y=path.projected[index*2+1]*(1-mix)+path.projected[(index+1)*2+1]*mix-flowTop;
        flowContext.drawImage(path.sprite,x-particleSize/2,y-particleSize/2,particleSize,particleSize);
      }
    }
    flowContext.globalAlpha=1;flowFrames++;
  }
  let modelBounds=null;
  function fitCallouts(){
    callouts.setAttribute('viewBox',`0 0 ${viewWidth} ${viewHeight}`);
    const project=point=>{const p=point.clone().project(camera);return {x:(p.x+1)*viewWidth/2,y:(1-p.y)*viewHeight/2};};
    const top=(camera.top-modelBounds.maxY)/(camera.top-camera.bottom)*viewHeight;
    const left=(modelBounds.minX-camera.left)/(camera.right-camera.left)*viewWidth;
    const right=(modelBounds.maxX-camera.left)/(camera.right-camera.left)*viewWidth;
    for(const label of zoneLabels){
      let point,x,y,d;
      if(viewWidth>=700){
        point=project(label.anchor);
        const isA=label.key==='a';x=isA?left-13:right+13;y=point.y-10;
        label.text.setAttribute('text-anchor',isA?'end':'start');
        const startX=x+(isA?3:-3),elbowX=isA?point.x-12:point.x+12;
        d=`M ${startX} ${y+5} H ${elbowX} L ${point.x} ${point.y}`;
      }else{
        point=project(label.topAnchor);
        x=point.x;y=Math.max(18,top-13);label.text.setAttribute('text-anchor','middle');
        d=`M ${x} ${y+7} V ${point.y-9} L ${point.x} ${point.y}`;
      }
      label.text.setAttribute('x',x);label.text.setAttribute('y',y);
      label.line.setAttribute('d',d);label.dot.setAttribute('cx',point.x);label.dot.setAttribute('cy',point.y);
    }
  }
  function fitCamera(){
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(const point of framingPoints){const x=point.dot(right),y=point.dot(up);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
    const aspect=viewWidth/viewHeight,padding=1.055,sideSpace=viewWidth>=700?140:0,topSpace=viewWidth<700?34:0;
    const halfHeight=Math.max((maxY-minY)/2*viewHeight/(viewHeight-topSpace),(maxX-minX)/2/aspect*viewWidth/(viewWidth-sideSpace))*padding;
    const centerX=(minX+maxX)/2,centerY=(minY+maxY)/2+halfHeight*topSpace/viewHeight;
    camera.left=centerX-halfHeight*aspect;camera.right=centerX+halfHeight*aspect;
    camera.top=centerY+halfHeight;camera.bottom=centerY-halfHeight;camera.updateProjectionMatrix();
    modelBounds={minX,maxX,minY,maxY};
  }
  function render(){
    if(contextLost||!visible)return;
    renderer.render(scene,camera);renderedFrames++;cameraDirty=false;
  }
  function resize(){
    const w=container.clientWidth,h=container.clientHeight;if(!w||!h||w===viewWidth&&h===viewHeight&&displayPixelRatio===devicePixelRatio)return;
    viewWidth=w;viewHeight=h;displayPixelRatio=devicePixelRatio;
    renderer.setDrawingBufferSize(w,h,renderPixelRatio(w,h,displayPixelRatio,lowPower));
    fitCamera();fitFlow();fitCallouts();cameraDirty=true;wake();
  }
  const observer=new ResizeObserver(resize);observer.observe(container);
  addEventListener('resize',resize);
  function paintLamp(lamp,level){
    lamp.light.intensity=level*24;lamp.bounce.intensity=level*14;
    lamp.shade.material.emissiveIntensity=level*.45;
    lamp.bulb.material.emissiveIntensity=level*3.2;lamp.halo.material.opacity=level*.5;lamp.halo.visible=level>.005;
    if(level>0&&!lamp.shadowReady){lamp.light.shadow.needsUpdate=true;renderer.shadowMap.needsUpdate=true;lamp.shadowReady=true;}
  }
  function paintPath(path,level){
    path.level=level;
    path.mesh.material.opacity=.07+level*.78;path.glow.material.opacity=level*.11;path.glow.visible=level>.005;
  }
  function animate(now){
    frame=0;if(!visible||contextLost)return;
    const elapsed=now-lastFlowFrame;
    if(!cameraDirty&&elapsed<1000/30){frame=requestAnimationFrame(animate);return;}
    lastFlowFrame=now-elapsed%(1000/30);
    const dt=Math.max(0,Math.min((now-last)/1000,.05));last=now;
    let lightingMoving=aLevel!==desiredA||bLevel!==desiredB;
    if(cameraDirty||lightingMoving&&(reducedMotion.matches||now-lastLightingFrame>=1000/24)){
      const elapsedLight=now-lastLightingFrame;lastLightingFrame=now;
      aLevel=advanceLevel(aLevel,desiredA,elapsedLight,reducedMotion.matches);
      bLevel=advanceLevel(bLevel,desiredB,elapsedLight,reducedMotion.matches);
      paintLamp(lampA,aLevel);paintLamp(lampB,bLevel);paintPath(pathA,aLevel);paintPath(pathB,bLevel);paintPath(trunk,Math.max(aLevel,bLevel));
      feederGlow.emissiveIntensity=live ? .6 : .05;render();
      lightingMoving=aLevel!==desiredA||bLevel!==desiredB;
    }
    if(!paused&&!reducedMotion.matches)flowTime+=dt;
    drawFlow();
    if(lightingMoving||(live&&(aLevel>.01||bLevel>.01)&&!paused&&!reducedMotion.matches))frame=requestAnimationFrame(animate);
  }
  function wake(){if(!frame&&visible&&!contextLost){last=performance.now();frame=requestAnimationFrame(animate);}}
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();contextLost=true;cancelAnimationFrame(frame);frame=0;flowCanvas.hidden=true;callouts.hidden=true;callouts.style.display='none';document.dispatchEvent(new CustomEvent('scene-unavailable'));});
  let screenEnabled=!document.getElementById('dashboard-screen').hidden,intersecting=true;
  function refreshVisibility(){visible=screenEnabled&&intersecting&&!document.hidden;if(visible){resize();wake();}else{cancelAnimationFrame(frame);frame=0;}}
  const intersectionObserver=new IntersectionObserver(entries=>{intersecting=entries[0].isIntersecting;refreshVisibility();});intersectionObserver.observe(container);
  document.addEventListener('visibilitychange',refreshVisibility);
  reducedMotion.addEventListener('change',wake);
  resize();wake();
  return {
    update(reading,isLive,threshold){const a=isLive&&reading?.branch_a_ma>=threshold?1:0,b=isLive&&reading?.branch_b_ma!=null&&reading.branch_b_ma>=threshold?1:0;const changed=live!==isLive||a!==desiredA||b!==desiredB;cameraDirty=cameraDirty||live!==isLive;live=isLive;desiredA=a;desiredB=b;if(changed){lastLightingFrame=performance.now();wake();}},
    pause(value){if(paused!==value){paused=value;wake();}},
    visibility(value){screenEnabled=value;refreshVisibility();},
    getState(){return {model:room.model,cameraType:camera.type,yaw,elevation,cameraFixed:true,viewWidth,viewHeight,modelBounds,frustum:{left:camera.left,right:camera.right,top:camera.top,bottom:camera.bottom},live,aLevel,bLevel,paused,reducedMotion:reducedMotion.matches,rendering:!!frame,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,pixelRatio:renderer.getPixelRatio(),renderedFrames,flowFrames,shadowPixels:[sun,lampA.light,lampB.light].reduce((sum,light)=>sum+light.shadow.mapSize.x*light.shadow.mapSize.y,0),flowFps:30,flowParticles:{feeder:trunk.particleCount,a:pathA.particleCount,b:pathB.particleCount}};}
  };
}
