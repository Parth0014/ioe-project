import * as THREE from './vendor/three.module.min.js';

// The room is an illustrative model. Only lamp/flow activity represents telemetry.
export function createEnergyScene() {
  const canvas = document.getElementById('energy-canvas');
  const container = document.getElementById('scene');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
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
  const lineGroups = new Map();
  const palette={a:0x80d8c1,b:0xe9b77b,feed:0x98c4f0};
  const material=(color,roughness=.75,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
  const mats={base:material(0x293e32,.5,.25),trim:material(0x516955,.5,.3),floor:material(0x929583),floorB:material(0x92866f),wall:material(0xb1b7a4),dark:material(0x2d4536),sofa:material(0x718b76),cushion:material(0xacbea3),wood:material(0x7e6450),metal:material(0x374349,.4,.65),rug:material(0x567c64),leaf:material(0x587965),pot:material(0xaaa28f)};
  function box(w,h,d,x,y,z,mat,parent=world){const m=new THREE.Mesh(unitBox,mat);m.scale.set(w,h,d);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
  function cylinder(r1,r2,h,x,y,z,mat){const m=new THREE.Mesh(new THREE.CylinderGeometry(r1,r2,h,20),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;world.add(m);return m;}
  const sphereGeometries=new Map();
  function sphere(r,x,y,z,mat){if(!sphereGeometries.has(r))sphereGeometries.set(r,new THREE.SphereGeometry(r,12,8));const m=new THREE.Mesh(sphereGeometries.get(r),mat);m.position.set(x,y,z);world.add(m);return m;}
  function line(points,color,opacity=1){const key=color+':'+opacity;if(!lineGroups.has(key))lineGroups.set(key,{color,opacity,points:[]});const group=lineGroups.get(key);for(let i=1;i<points.length;i++)group.points.push(...points[i-1],...points[i]);}
  scene.add(new THREE.HemisphereLight(0xe8f2e5,0x2a3c2e,.23));
  const sun=new THREE.DirectionalLight(0xffe7c2,.38);sun.position.set(-4,10,5);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-9;sun.shadow.camera.right=9;sun.shadow.camera.top=8;sun.shadow.camera.bottom=-8;sun.shadow.normalBias=.045;sun.shadow.autoUpdate=false;sun.shadow.needsUpdate=true;scene.add(sun);
  const rim=new THREE.DirectionalLight(0xb8d4cb,.35);rim.position.set(5,5,-7);scene.add(rim);
  // Contact shadow gives the plinth weight without a bitmap asset or a network request.
  const textureCanvas=document.createElement('canvas');textureCanvas.width=128;textureCanvas.height=128;
  const ctx=textureCanvas.getContext('2d');const gradient=ctx.createRadialGradient(64,64,15,64,64,64);gradient.addColorStop(0,'rgba(35,62,42,.27)');gradient.addColorStop(.6,'rgba(35,62,42,.13)');gradient.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
  const shadow=new THREE.Mesh(new THREE.PlaneGeometry(15,12),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(textureCanvas),transparent:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=-.65;scene.add(shadow);
  const glowCanvas=document.createElement('canvas');glowCanvas.width=128;glowCanvas.height=128;
  const glowContext=glowCanvas.getContext('2d'),glowGradient=glowContext.createRadialGradient(64,64,0,64,64,64);
  glowGradient.addColorStop(0,'rgba(255,255,255,1)');glowGradient.addColorStop(.4,'rgba(255,255,255,.65)');glowGradient.addColorStop(1,'rgba(255,255,255,0)');
  glowContext.fillStyle=glowGradient;glowContext.fillRect(0,0,128,128);
  const glowTexture=new THREE.CanvasTexture(glowCanvas);
  box(10,.44,6.7,-.25,-.4,.15,mats.base);
  box(10.05,.045,6.75,-.25,-.16,.15,mats.trim);
  box(8.4,.13,5.6,0,-.07,0,mats.floor);
  box(4.08,.025,5.3,2.05,.012,0,mats.floorB);
  for(let x=-3.9;x<=4;x+=.48) line([[x,.026,-2.65],[x,.026,2.65]],0x7b7c75,.4);
  // Open-front walls leave both circuits visible from the main perspective.
  box(8.5,1.85,.16,0,.91,-2.75,mats.wall);
  box(.16,1.85,5.55,-4.2,.91,0,mats.wall);
  box(.16,.48,5.55,4.2,.23,0,mats.wall);
  box(.15,1.32,1.65,0,.65,-1.98,mats.wall);
  box(8.54,.07,.22,0,1.86,-2.75,mats.trim);
  box(.22,.07,5.6,-4.2,1.86,0,mats.trim);
  // Recessed windows, slatted panels and a small framed print.
  const windowMat=material(0x8aabb0,.25,.4);
  for(const x of [-2.3,2.2]){
    box(2,.95,.06,x,1.15,-2.65,mats.dark);box(1.82,.79,.035,x,1.15,-2.61,windowMat);
    box(.035,.82,.05,x,1.15,-2.57,mats.trim);box(1.85,.035,.05,x,1.15,-2.57,mats.trim);
    box(2.12,.08,.28,x,.66,-2.6,mats.floor);
  }
  for(let x=.4;x<.9;x+=.12) box(.045,1.7,.08,x,.89,-2.62,mats.wood);
  box(.07,.75,.72,-4.08,1.2,.65,mats.dark);box(.03,.62,.59,-4.03,1.2,.65,mats.floor);
  // Zone A: lounge furniture provides scale; it does not represent extra loads.
  box(2.85,.025,2.5,-2,.05,.45,mats.rug);
  box(2.65,.3,.95,-2.2,.32,-1.45,mats.sofa);
  box(2.7,.55,.2,-2.2,.61,-1.87,mats.sofa);
  for(const x of [-3.46,-.94]) box(.22,.48,1.05,x,.49,-1.43,mats.sofa);
  for(const x of [-2.85,-1.58]){box(1.13,.14,.76,x,.53,-1.4,mats.cushion);const cushion=box(.65,.34,.13,x,.78,-1.7,mats.sofa);cushion.rotation.x=-.18;}
  cylinder(.68,.68,.1,-2,.52,.35,mats.wood);
  cylinder(.3,.38,.44,-2,.27,.35,mats.dark);
  box(.33,.05,.24,-2.08,.6,.32,mats.floor);box(.24,.04,.19,-1.98,.645,.35,mats.sofa);
  cylinder(.09,.065,.16,-2.32,.65,.18,mats.pot);
  // Zone B: a table and chairs under the second lamp.
  box(2.65,.025,2.45,2,.05,.1,material(0x8a806e));
  box(1.72,.11,1.0,2,.83,.05,mats.wood);
  for(const x of [1.35,2.65])for(const z of [-.3,.4]) box(.07,.78,.07,x,.4,z,mats.dark);
  for(const z of [-.92,1.02])for(const x of [1.5,2.5]){
    box(.55,.11,.51,x,.46,z,mats.sofa);box(.55,.5,.08,x,.72,z+(z<0?-.23:.23),mats.sofa);
    for(const dx of [-.2,.2])for(const dz of [-.18,.18])box(.035,.41,.035,x+dx,.2,z+dz,mats.dark);
  }
  cylinder(.13,.1,.28,2,.99,.05,mats.pot);
  function plant(x,z,scale=1){cylinder(.23*scale,.17*scale,.4*scale,x,.2*scale,z,mats.pot);for(let i=0;i<7;i++){const angle=i*2.4;const leaf=sphere(.2*scale,x+Math.cos(angle)*.18*scale,.55*scale+(i%3)*.12*scale,z+Math.sin(angle)*.18*scale,mats.leaf);leaf.scale.set(.7,1.65,.55);leaf.rotation.z=Math.cos(angle)*.5;}}
  plant(3.5,-1.85,1.1);plant(-3.55,1.8,.85);
  // Warm fixture lighting plus a local fill approximates reflected room light.
  // Only fixture shadows are cached; indirect fill stays soft and shadow-free.
  function lamp(x,z,color,pendant=false){
    const warmColor=pendant?0xffdfad:0xffe8c4;
    const fixture=material(0xc9be9f,.7,.05);
    const bulbMat=new THREE.MeshStandardMaterial({color:0xfff2d2,emissive:warmColor,emissiveIntensity:0,roughness:.5});
    const height=pendant?2.28:1.8;
    if(pendant){box(.04,.04,2.6,x,2.75,-1.25,mats.metal);box(.04,.9,.04,x,2.3,-2.55,mats.metal);cylinder(.018,.018,.4,x,2.54,z,mats.metal);}
    else{cylinder(.31,.34,.05,x,.08,z,mats.metal);cylinder(.025,.025,1.55,x,.85,z,mats.metal);}
    cylinder(.21,.43,.36,x,height,z,fixture);
    const bulb=sphere(.13,x,height-.2,z,bulbMat);
    const light=new THREE.PointLight(warmColor,0,7,2);
    light.position.set(x,height-.31,z);light.castShadow=true;
    light.shadow.mapSize.set(1024,1024);light.shadow.camera.near=.08;light.shadow.camera.far=7;
    light.shadow.normalBias=.025;light.shadow.bias=-.0003;light.shadow.radius=2;
    light.shadow.autoUpdate=false;
    scene.add(light);
    const roomX=x<0?-2.15:2.15;
    const bounce=new THREE.PointLight(warmColor,0,4.2,2);
    bounce.position.set(roomX,1.25,-1.05);scene.add(bounce);
    const halo=new THREE.Sprite(new THREE.SpriteMaterial({color:warmColor,map:glowTexture,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));
    halo.position.set(x,height-.21,z);halo.scale.set(.65,.65,1);world.add(halo);
    return {light,bounce,bulb,halo,shadowReady:false};
  }
  const lampA=lamp(-.9,1.6,palette.a),lampB=lamp(2,.05,palette.b,true);
  const feederGlow=new THREE.MeshStandardMaterial({color:0x485e6c,emissive:palette.feed,emissiveIntensity:.05,roughness:.3});
  box(.6,.95,.45,-4.65,.34,2.75,mats.dark);box(.4,.35,.025,-4.65,.51,3,feederGlow);
  for(let x=-4.79;x<-4.49;x+=.09)box(.035,.12,.03,x,.22,3,mats.trim);
  function powerPath(points,color){
    // Straight segments keep the flow on the cable, without spline overshoot at bends.
    const vertices=points.map(p=>new THREE.Vector3(...p));
    const curve=new THREE.CurvePath();
    for(let i=1;i<vertices.length;i++)curve.add(new THREE.LineCurve3(vertices[i-1],vertices[i]));
    const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,48,.027,6,false),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.08}));world.add(mesh);
    const glow=new THREE.Mesh(new THREE.TubeGeometry(curve,48,.07,6,false),new THREE.MeshBasicMaterial({color,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));world.add(glow);
    return {curve,mesh,glow,color,level:0};
  }
  const trunk=powerPath([[-4.65,.065,3.06],[-.9,.065,3.06]],palette.feed);
  const pathA=powerPath([[-.9,.065,3.06],[-.9,.08,1.6]],palette.a);
  const pathB=powerPath([[-.9,.065,3.06],[2,.065,3.06],[2,.07,1.5],[2,.07,.05]],palette.b);

  // Static furniture shares geometry and material; one draw call handles each batch.
  const batches=new Map();
  for(const mesh of [...world.children]){
    if(mesh.geometry!==unitBox && mesh.material!==mats.leaf)continue;
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
  for(const group of lineGroups.values()){
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(group.points,3));
    world.add(new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:group.color,transparent:group.opacity<1,opacity:group.opacity})));
  }
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
  const zoneLabels=[['a','Zone A',-4.2,.8,.4],['b','Zone B',4.2,.25,.4]].map(([key,label,x,y,z])=>{
    const group=document.createElementNS(svgNamespace,'g');group.classList.add('zone-callout','callout-'+key);
    const line=document.createElementNS(svgNamespace,'path'),dot=document.createElementNS(svgNamespace,'circle'),text=document.createElementNS(svgNamespace,'text');
    dot.setAttribute('r','2');text.textContent=label;group.append(line,dot,text);callouts.append(group);
    return {key,group,line,dot,text,anchor:new THREE.Vector3(x,y,z)};
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
        point=project(new THREE.Vector3(label.key==='a'?-2.3:2.2,1.86,-2.75));
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
    const moving=aLevel!==desiredA||bLevel!==desiredB;
    // Supersample the final image, which stays cached while flow animates.
    // Lighting transitions use fewer pixels, then receive one crisp final render.
    const ratio=moving
      ?Math.min(displayPixelRatio,1.5,Math.sqrt(1400000/(viewWidth*viewHeight)))
      :Math.min(Math.max(displayPixelRatio,2),2.5,Math.sqrt(6000000/(viewWidth*viewHeight)));
    if(Math.abs(renderer.getPixelRatio()-ratio)>.001)renderer.setPixelRatio(ratio);
    renderer.render(scene,camera);renderedFrames++;cameraDirty=false;
  }
  function resize(){
    const w=container.clientWidth,h=container.clientHeight;if(!w||!h||w===viewWidth&&h===viewHeight&&displayPixelRatio===devicePixelRatio)return;
    viewWidth=w;viewHeight=h;displayPixelRatio=devicePixelRatio;
    renderer.setSize(w,h,false);fitCamera();fitFlow();fitCallouts();cameraDirty=true;wake();
  }
  const observer=new ResizeObserver(resize);observer.observe(container);
  addEventListener('resize',resize);
  function paintLamp(lamp,level){
    lamp.light.intensity=level*15;lamp.bounce.intensity=level*10;
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
    if(!cameraDirty&&elapsed<1000/60){frame=requestAnimationFrame(animate);return;}
    lastFlowFrame=now-elapsed%(1000/60);
    const dt=Math.max(0,Math.min((now-last)/1000,.05));last=now;
    let lightingMoving=aLevel!==desiredA||bLevel!==desiredB;
    if(cameraDirty||lightingMoving&&(reducedMotion.matches||now-lastLightingFrame>=1000/30)){
      const step=reducedMotion.matches?1:Math.min(1,(now-lastLightingFrame)/350);lastLightingFrame=now;
      aLevel+=Math.sign(desiredA-aLevel)*Math.min(Math.abs(desiredA-aLevel),step);
      bLevel+=Math.sign(desiredB-bLevel)*Math.min(Math.abs(desiredB-bLevel),step);
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
    pause(value){paused=value;wake();},
    visibility(value){screenEnabled=value;refreshVisibility();},
    getState(){return {yaw,elevation,cameraFixed:true,viewWidth,viewHeight,modelBounds,frustum:{left:camera.left,right:camera.right,top:camera.top,bottom:camera.bottom},live,aLevel,bLevel,paused,reducedMotion:reducedMotion.matches,rendering:!!frame,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,pixelRatio:renderer.getPixelRatio(),renderedFrames,flowFrames,flowParticles:{feeder:trunk.particleCount,a:pathA.particleCount,b:pathB.particleCount}};}
  };
}
