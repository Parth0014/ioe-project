import * as THREE from './vendor/three.module.min.js';

// The room is an illustrative model. Only lamp/flow activity represents telemetry.
export function createEnergyScene({onSelect}) {
  const canvas = document.getElementById('energy-canvas');
  const container = document.getElementById('scene');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true, powerPreference:'low-power'}); }
  catch { throw new Error('WebGL is unavailable'); }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, .1, 100);
  const target = new THREE.Vector3(-.3, .25, .2);
  let yaw=.57, elevation=.78, distance=17.8, targetDistance=17.8, fitDistance=17.8, zoomScale=1, selected=null, paused=false, visible=true, contextLost=false;
  let viewWidth=0, viewHeight=0, cameraDirty=true, renderedFrames=0, lastFlowFrame=0;
  let desiredA=0, desiredB=0, aLevel=0, bLevel=0, live=false, frame=0, last=0, flowTime=0;
  const world = new THREE.Group();scene.add(world);
  const unitBox = new THREE.BoxGeometry(1,1,1);
  const lineGroups = new Map();
  const palette={a:0x80d8c1,b:0xe9b77b,feed:0x98c4f0};
  const material=(color,roughness=.75,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
  const mats={base:material(0x293e32,.5,.25),trim:material(0x516955,.5,.3),floor:material(0x929583),floorB:material(0x92866f),wall:material(0x627762),dark:material(0x2d4536),sofa:material(0x718b76),cushion:material(0xacbea3),wood:material(0x7e6450),metal:material(0x374349,.4,.65),rug:material(0x567c64),leaf:material(0x587965),pot:material(0xaaa28f)};
  function box(w,h,d,x,y,z,mat,parent=world){const m=new THREE.Mesh(unitBox,mat);m.scale.set(w,h,d);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
  function cylinder(r1,r2,h,x,y,z,mat){const m=new THREE.Mesh(new THREE.CylinderGeometry(r1,r2,h,20),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;world.add(m);return m;}
  const sphereGeometries=new Map();
  function sphere(r,x,y,z,mat){if(!sphereGeometries.has(r))sphereGeometries.set(r,new THREE.SphereGeometry(r,12,8));const m=new THREE.Mesh(sphereGeometries.get(r),mat);m.position.set(x,y,z);world.add(m);return m;}
  function line(points,color,opacity=1){const key=color+':'+opacity;if(!lineGroups.has(key))lineGroups.set(key,{color,opacity,points:[]});const group=lineGroups.get(key);for(let i=1;i<points.length;i++)group.points.push(...points[i-1],...points[i]);}
  scene.add(new THREE.HemisphereLight(0xe8f2e5,0x2a3c2e,1.15));
  const sun=new THREE.DirectionalLight(0xffe7c2,1.7);sun.position.set(-4,10,5);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-9;sun.shadow.camera.right=9;sun.shadow.camera.top=8;sun.shadow.camera.bottom=-8;sun.shadow.normalBias=.045;scene.add(sun);
  const rim=new THREE.DirectionalLight(0xb8d4cb,1.2);rim.position.set(5,5,-7);scene.add(rim);
  // Contact shadow gives the plinth weight without a bitmap asset or a network request.
  const textureCanvas=document.createElement('canvas');textureCanvas.width=128;textureCanvas.height=128;
  const ctx=textureCanvas.getContext('2d');const gradient=ctx.createRadialGradient(64,64,15,64,64,64);gradient.addColorStop(0,'rgba(35,62,42,.27)');gradient.addColorStop(.6,'rgba(35,62,42,.13)');gradient.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
  const shadow=new THREE.Mesh(new THREE.PlaneGeometry(15,12),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(textureCanvas),transparent:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=-.65;scene.add(shadow);
  const glowCanvas=document.createElement('canvas');glowCanvas.width=128;glowCanvas.height=128;
  const glowContext=glowCanvas.getContext('2d'),glowGradient=glowContext.createRadialGradient(64,64,0,64,64,64);
  glowGradient.addColorStop(0,'rgba(255,255,255,1)');glowGradient.addColorStop(.4,'rgba(255,255,255,.65)');glowGradient.addColorStop(1,'rgba(255,255,255,0)');
  glowContext.fillStyle=glowGradient;glowContext.fillRect(0,0,128,128);
  const glowTexture=new THREE.CanvasTexture(glowCanvas);
  const grid=new THREE.GridHelper(24,24,0x4b6350,0x3a5040);grid.position.y=-.66;grid.material.transparent=true;grid.material.opacity=.28;scene.add(grid);
  box(10,.44,7.6,-.25,-.4,.15,mats.base);
  box(10.05,.045,7.65,-.25,-.16,.15,mats.trim);
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
  // Lamps have real point lights plus translucent floor pools.
  function lamp(x,z,color,pendant=false){
    const fixture=material(0xc9be9f,.4,.15);const bulbMat=new THREE.MeshStandardMaterial({color:0xe6dbc4,emissive:color,emissiveIntensity:0,roughness:.4});
    let height=pendant?2.28:1.8;
    if(pendant){box(.04,.04,2.6,x,2.75,-1.25,mats.metal);box(.04,.9,.04,x,2.3,-2.55,mats.metal);cylinder(.018,.018,.4,x,2.54,z,mats.metal);}
    else{cylinder(.31,.34,.05,x,.08,z,mats.metal);cylinder(.025,.025,1.55,x,.85,z,mats.metal);}
    cylinder(.21,.43,.36,x,height,z,fixture);const bulb=sphere(.15,x,height-.16,z,bulbMat);
    const light=new THREE.PointLight(color,0,5,2);light.position.set(x,height-.3,z);scene.add(light);
    const pool=new THREE.Mesh(new THREE.PlaneGeometry(2.4,2.4),new THREE.MeshBasicMaterial({color,map:glowTexture,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));pool.rotation.x=-Math.PI/2;pool.position.set(x,.075,z);world.add(pool);
    const cone=new THREE.Mesh(new THREE.ConeGeometry(.9,height-.25,40,1,true),new THREE.MeshBasicMaterial({color,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false}));cone.position.set(x,(height-.25)/2+.08,z);world.add(cone);
    return {light,bulb,pool,cone};
  }
  const lampA=lamp(-.9,1.6,palette.a),lampB=lamp(2,.05,palette.b,true);
  const feederGlow=new THREE.MeshStandardMaterial({color:0x485e6c,emissive:palette.feed,emissiveIntensity:.05,roughness:.3});
  box(.6,.95,.45,-4.65,.34,2.75,mats.dark);box(.4,.35,.025,-4.65,.51,3,feederGlow);
  for(let x=-4.79;x<-4.49;x+=.09)box(.035,.12,.03,x,.22,3,mats.trim);
  const circuitMeshes=[];
  for(const [zone,x,color] of [['a',-2.1,palette.a],['b',2.1,palette.b]]){
    const ring=new THREE.Mesh(new THREE.PlaneGeometry(4.0,5.2),new THREE.MeshBasicMaterial({color,transparent:true,opacity:0,depthWrite:false}));ring.rotation.x=-Math.PI/2;ring.position.set(x,.037,0);ring.userData.zone=zone;world.add(ring);circuitMeshes.push(ring);
    line([[x-1.94,.04,2.6],[x+1.94,.04,2.6]],color,.5);
  }
  function powerPath(points,color){
    const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)),false,'catmullrom',.05);
    const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,48,.022,6,false),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.14}));world.add(mesh);
    const particles=new THREE.InstancedMesh(new THREE.SphereGeometry(.052,8,6),new THREE.MeshBasicMaterial({color}),4);
    particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);particles.visible=false;particles.frustumCulled=false;world.add(particles);
    return {curve,mesh,particles,point:new THREE.Vector3(),matrix:new THREE.Matrix4()};
  }
  const trunk=powerPath([[-4.65,.06,3.06],[-2,.06,3.06],[.1,.06,3.06]],palette.feed);
  const pathA=powerPath([[.1,.065,3.06],[-.9,.065,3.06],[-.9,.08,1.6]],palette.a);
  const pathB=powerPath([[.1,.065,3.06],[2,.065,3.06],[2,.07,1.5],[2,.07,.05]],palette.b);

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
  const raycaster=new THREE.Raycaster();const pointer=new THREE.Vector2();
  const labels=[{el:document.getElementById('label-a'),point:new THREE.Vector3(-2.2,1.5,-.7)},{el:document.getElementById('label-b'),point:new THREE.Vector3(2.3,1.55,-1.1)}];
  function positionCamera(){camera.position.set(target.x+Math.sin(yaw)*Math.cos(elevation)*distance,target.y+Math.sin(elevation)*distance,target.z+Math.cos(yaw)*Math.cos(elevation)*distance);camera.lookAt(target);}
  const projected=new THREE.Vector3();
  function positionLabels(){
    const widths=labels.map(item=>item.el.offsetWidth);
    labels.forEach((item,index)=>{projected.copy(item.point).project(camera);const half=widths[index]/2+10;const x=Math.max(half,Math.min(viewWidth-half,(projected.x*.5+.5)*viewWidth));const y=Math.max(viewWidth<620?76:110,Math.min(viewHeight-30,(-projected.y*.5+.5)*viewHeight));item.el.style.left=Math.round(x)+'px';item.el.style.top=Math.round(y)+'px';item.el.classList.add('ready');});
  }
  function render(){if(contextLost||!visible)return;positionCamera();renderer.render(scene,camera);renderedFrames++;if(cameraDirty){positionLabels();cameraDirty=false;}}
  function fitCamera(){
    const direction=new THREE.Vector3(Math.sin(yaw)*Math.cos(elevation),Math.sin(elevation),Math.cos(yaw)*Math.cos(elevation));
    const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),direction).normalize();
    const up=new THREE.Vector3().crossVectors(direction,right).normalize();
    const tangent=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
    let required=0;
    for(const corner of framingPoints){
      required=Math.max(required,corner.dot(direction)+Math.max(Math.abs(corner.dot(right))/(tangent*camera.aspect),Math.abs(corner.dot(up))/tangent)*1.12);
    }
    fitDistance=required;targetDistance=fitDistance*zoomScale;
  }
  function resize(){const w=container.clientWidth,h=container.clientHeight;if(!w||!h||w===viewWidth&&h===viewHeight)return;viewWidth=w;viewHeight=h;const pixelRatio=Math.min(devicePixelRatio,1.5,Math.sqrt(1400000/(w*h)));renderer.setPixelRatio(Math.max(.8,pixelRatio));renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();fitCamera();distance=targetDistance;cameraDirty=true;wake();}
  const observer=new ResizeObserver(resize);observer.observe(container);
  const labelObserver=new ResizeObserver(()=>{cameraDirty=true;wake();});
  labels.forEach(item=>labelObserver.observe(item.el));
  function paintLamp(lamp,level){lamp.light.intensity=level*13;lamp.bulb.material.emissiveIntensity=level*3;lamp.pool.material.opacity=level*.34;lamp.cone.material.opacity=level*.045;}
  function paintPath(path,level){path.mesh.material.opacity=.12+level*.73;path.particles.visible=live&&level>.05;if(!path.particles.visible)return;for(let i=0;i<4;i++){path.curve.getPoint((flowTime*.18+i/4)%1,path.point);path.matrix.makeTranslation(path.point.x,path.point.y,path.point.z);path.particles.setMatrixAt(i,path.matrix);}path.particles.instanceMatrix.needsUpdate=true;}
  function animate(now){
    frame=0;if(!visible||contextLost)return;
    const cameraMoving=Math.abs(distance-targetDistance)>.002;
    const lightingMoving=Math.abs(aLevel-desiredA)>.005||Math.abs(bLevel-desiredB)>.005;
    // Idle flow needs only 30 fps. Camera gestures keep the browser's full frame rate.
    if(!cameraDirty&&!cameraMoving&&!lightingMoving&&now-lastFlowFrame<1000/30){frame=requestAnimationFrame(animate);return;}
    const dt=Math.max(0,Math.min((now-last)/1000,.05));last=now;lastFlowFrame=now;
    const easing=reducedMotion.matches?1:1-Math.exp(-dt*10);
    if(cameraMoving){distance+=(targetDistance-distance)*(reducedMotion.matches?1:1-Math.exp(-dt*20));cameraDirty=true;}else distance=targetDistance;
    aLevel=lightingMoving?aLevel+(desiredA-aLevel)*easing:desiredA;
    bLevel=lightingMoving?bLevel+(desiredB-bLevel)*easing:desiredB;
    if(!paused&&!reducedMotion.matches)flowTime+=dt;
    paintLamp(lampA,aLevel);paintLamp(lampB,bLevel);paintPath(pathA,aLevel);paintPath(pathB,bLevel);paintPath(trunk,Math.max(aLevel,bLevel));feederGlow.emissiveIntensity=live ? .75 : .05;render();
    if(cameraMoving||lightingMoving||(live&&(aLevel>.01||bLevel>.01)&&!paused&&!reducedMotion.matches))frame=requestAnimationFrame(animate);
  }
  function wake(){if(!frame&&visible&&!contextLost){last=performance.now();frame=requestAnimationFrame(animate);}}
  function setSelected(zone){selected=zone;circuitMeshes.forEach(m=>{m.material.opacity=m.userData.zone===zone ? .10 : 0;});wake();}
  function setView(view){elevation=view==='top'?1.48:.78;yaw=view==='top'?0:.57;zoomScale=1;fitCamera();distance=targetDistance;cameraDirty=true;wake();}
  const zoomByFactor=factor=>{zoomScale=THREE.MathUtils.clamp(zoomScale*factor,.55,1.8);targetDistance=fitDistance*zoomScale;wake();};
  const zoom=delta=>zoomByFactor(Math.exp(delta*.09));
  const rotate=delta=>{yaw+=delta;cameraDirty=true;wake();};
  container.addEventListener('wheel',event=>{
    if(contextLost)return;
    event.preventDefault();event.stopPropagation();
    const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?viewHeight:1);
    zoomByFactor(Math.exp(THREE.MathUtils.clamp(delta*.0015,-.3,.3)));
  },{passive:false});
  const pointers=new Map();let dragging=null,pinchDistance=0;
  function pointerGap(){const [a,b]=[...pointers.values()];return Math.hypot(a.x-b.x,a.y-b.y);}
  canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    canvas.focus({preventScroll:true});canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pointers.size===1)dragging={x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,moved:false};
    else{pinchDistance=pointerGap();if(dragging)dragging.moved=true;}
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove',event=>{
    if(!pointers.has(event.pointerId))return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pointers.size>=2){const gap=pointerGap();if(pinchDistance>0&&gap>0)zoomByFactor(pinchDistance/gap);pinchDistance=gap;return;}
    if(!dragging)return;
    const dx=event.clientX-dragging.lastX,dy=event.clientY-dragging.lastY;
    dragging.moved ||= Math.hypot(event.clientX-dragging.x,event.clientY-dragging.y)>5;
    if(dragging.moved){yaw-=dx*.007;elevation=THREE.MathUtils.clamp(elevation+dy*.004,.38,1.48);cameraDirty=true;document.getElementById('view-perspective').setAttribute('aria-pressed','false');document.getElementById('view-top').setAttribute('aria-pressed','false');}
    dragging.lastX=event.clientX;dragging.lastY=event.clientY;wake();
  });
  function endPointer(event){
    if(event.type==='pointerup'&&dragging&&!dragging.moved&&pointers.size===1){const r=canvas.getBoundingClientRect();pointer.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(circuitMeshes)[0];if(hit)onSelect(hit.object.userData.zone);}
    pointers.delete(event.pointerId);pinchDistance=0;
    const remaining=[...pointers.values()][0];
    dragging=remaining?{x:remaining.x,y:remaining.y,lastX:remaining.x,lastY:remaining.y,moved:true}:null;
    if(!pointers.size)canvas.classList.remove('dragging');
  }
  canvas.addEventListener('pointerup',endPointer);canvas.addEventListener('pointercancel',endPointer);
  canvas.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','Home'].includes(event.key)){event.preventDefault();if(event.key==='ArrowLeft')rotate(-.16);if(event.key==='ArrowRight')rotate(.16);if(['ArrowUp','+'].includes(event.key))zoom(-1);if(['ArrowDown','-'].includes(event.key))zoom(1);if(event.key==='Home')setView('perspective');}});
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();contextLost=true;cancelAnimationFrame(frame);document.dispatchEvent(new CustomEvent('scene-unavailable'));});
  let screenEnabled=!document.getElementById('dashboard-screen').hidden,intersecting=true;
  function refreshVisibility(){visible=screenEnabled&&intersecting&&!document.hidden;if(visible){resize();wake();}else{cancelAnimationFrame(frame);frame=0;}}
  const intersectionObserver=new IntersectionObserver(entries=>{intersecting=entries[0].isIntersecting;refreshVisibility();});intersectionObserver.observe(container);
  document.addEventListener('visibilitychange',refreshVisibility);
  reducedMotion.addEventListener('change',wake);
  resize();wake();
  return {
    update(reading,isLive,threshold){const a=isLive&&reading?.branch_a_ma>=threshold?1:0,b=isLive&&reading?.branch_b_ma!=null&&reading.branch_b_ma>=threshold?1:0;const changed=live!==isLive||a!==desiredA||b!==desiredB;live=isLive;desiredA=a;desiredB=b;if(changed)wake();},
    select:setSelected,view:setView,rotate,zoom,
    pause(value){paused=value;wake();},
    visibility(value){screenEnabled=value;refreshVisibility();},
    getState(){return {selected,yaw,elevation,distance,targetDistance,zoomScale,live,aLevel,bLevel,paused,reducedMotion:reducedMotion.matches,rendering:!!frame,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,pixelRatio:renderer.getPixelRatio(),renderedFrames};}
  };
}
