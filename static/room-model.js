// Living/dining composition adapted from the supplied gridscope-rooms.html.
// The application owns the camera, lighting lifecycle and telemetry controls.
export function buildRoomModel(THREE,world,unitBox){
  const material=(color,roughness=.8,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
  const materials={
    base:material(0x293e32,.5,.25),trim:material(0x516955,.5,.3),
    wood:material(0x9a6b45,.6),dark:material(0x1c1c1c,.5),
    sage:material(0x7f9a82),cream:material(0xe6dcc8),
    sofa:material(0x4f6b5a,.95),cushion:material(0x86a58f,.95),
    chair:material(0xc9a36a,.7),leaf:material(0x3f7a4a,.9),pot:material(0xb86b45),
    floorA:material(0x8a6a4a,.55),floorB:material(0xcdb58a,.55),
    rugA:material(0x3f6b55,1),rugB:material(0x7a5a3a,1),tv:material(0x0b0b0b,.3),
  };
  const glass=new THREE.MeshStandardMaterial({color:0x1a2f3d,emissive:0x2a5470,emissiveIntensity:.35,roughness:.2});
  const bookMaterials=[0xb04a3a,0x3a6ab0,0xd0a030,0x4a8a5a,0x8a4a8a].map(color=>material(color));
  const cylinderGeometries=new Map();
  const foliage=new THREE.IcosahedronGeometry(1,1);
  function box(w,h,d,mat,x,y,z,name=''){
    const mesh=new THREE.Mesh(unitBox,mat);
    mesh.scale.set(w,h,d);mesh.position.set(x,y,z);mesh.name=name;
    mesh.castShadow=true;mesh.receiveShadow=true;world.add(mesh);return mesh;
  }
  function cylinder(rt,rb,h,mat,x,y,z){
    const ratio=rt/rb;
    if(!cylinderGeometries.has(ratio))cylinderGeometries.set(ratio,new THREE.CylinderGeometry(ratio,1,1,18));
    const mesh=new THREE.Mesh(cylinderGeometries.get(ratio),mat);
    mesh.scale.set(rb,h,rb);mesh.position.set(x,y,z);
    mesh.castShadow=true;mesh.receiveShadow=true;world.add(mesh);return mesh;
  }
  function leaf(radius,x,y,z){
    const mesh=new THREE.Mesh(foliage,materials.leaf);
    mesh.scale.setScalar(radius);mesh.position.set(x,y,z);mesh.castShadow=true;world.add(mesh);
  }
  function legs(x,z,w,d,h,t,mat){
    for(const a of [-1,1])for(const b of [-1,1])box(t,h,t,mat,x+a*(w/2-t/2),h/2,z+b*(d/2-t/2));
  }
  function plant(x,z){
    cylinder(.22,.17,.4,materials.pot,x,.2,z);
    leaf(.3,x,.75,z);leaf(.22,x+.15,1.05,z+.05);leaf(.2,x-.15,.95,z-.1);
  }
  const {wood,dark,sage,cream,sofa,cushion,chair}=materials;
  box(13.8,.44,7.7,materials.base,0,-.4,.15,'room-plinth');
  box(13.85,.045,7.75,materials.trim,0,-.16,.15);
  box(6,.2,6,materials.floorA,-3,-.1,0,'living-floor');
  box(6,.2,6,materials.floorB,3,-.1,0,'dining-floor');
  box(6,3,.2,sage,-3,1.5,-3.1);
  box(6,3,.2,cream,3,1.5,-3.1);
  box(.2,3,6,sage,-6.1,1.5,0);
  box(.2,3,6,cream,6.1,1.5,0);
  box(.2,3,2.1,cream,0,1.5,-1.95);
  box(.2,3,2.1,cream,0,1.5,1.95);
  box(.2,.7,1.8,cream,0,2.65,0,'doorway-lintel');
  for(const x of [-3,3]){
    box(2,1.3,.06,dark,x,1.75,-2.97);
    box(1.8,1.1,.05,glass,x,1.75,-2.93);
    box(.05,1.1,.06,dark,x,1.75,-2.89);
  }
  // Zone A: living room, with the supplied rectangular table and TV console.
  box(3,.02,2.2,materials.rugA,-3,.01,.4);
  box(2.4,.45,.9,sofa,-3,.25,-2.3,'living-sofa');
  box(2.4,.55,.2,sofa,-3,.72,-2.68);
  for(const x of [-4.3,-1.7])box(.2,.65,.9,sofa,x,.32,-2.3);
  for(const x of [-3.5,-2.5])box(1,.14,.65,cushion,x,.55,-2.25);
  box(1.3,.08,.7,wood,-3,.4,.1);legs(-3,.1,1.3,.7,.36,.06,wood);
  // Face the TV into the existing fixed view instead of leaving it edge-on.
  box(1.5,.5,.45,wood,-5.1,.25,.2);
  box(.09,.12,.09,dark,-5.1,.56,.2);
  box(1.5,.85,.06,materials.tv,-5.1,1,.2,'living-tv');
  plant(-5.3,-2.4);
  cylinder(.03,.03,1.6,dark,-1,.8,-2.2);
  cylinder(.25,.25,.04,dark,-1,.02,-2.2);
  // Zone B: four dining chairs, a sideboard and an open, shared-material bookcase.
  box(3.4,.02,2.4,materials.rugB,3.3,.01,0);
  box(2,.08,1,wood,3.3,.8,0,'dining-table');legs(3.3,0,2,1,.76,.07,wood);
  for(const x of [2.7,3.9])for(const side of [-1,1]){
    box(.5,.08,.5,chair,x,.5,side*.85);legs(x,side*.85,.5,.5,.46,.05,chair);
    box(.5,.5,.06,chair,x,.8,side*1.1);
  }
  // Open shelves and front-facing books read clearly from the fixed camera.
  box(1.45,2,.05,wood,5,1,-2.95,'dining-bookcase');
  for(const x of [4.3,5.7])box(.06,2,.35,wood,x,1,-2.78);
  for(const y of [.04,.64,1.24,1.94])box(1.45,.06,.35,wood,5,y,-2.78);
  for(let row=0;row<3;row++)for(let i=0;i<5;i++)box(.16,.28,.18,bookMaterials[i],4.5+i*.23+row*.02,.25+row*.6,-2.78);
  box(1.6,.7,.45,wood,2.8,.35,-2.7);
  plant(5.3,2.4);
  cylinder(.012,.012,.9,dark,3.3,2.65,0);

  return {materials,model:'gridscope-rooms',
    lamps:{
      a:{x:-1,z:-2.2,height:1.72,shade:[.16,.3,.35],warmColor:0xffc27a,target:[-2.6,-.9],fill:[-3,1.4,-.8]},
      b:{x:3.3,z:0,height:2.05,shade:[.12,.45,.3],warmColor:0xffe0b0,target:[3.3,0],fill:[3,1.4,-1]},
    },
    callouts:{a:{anchor:[-6.1,1.2,.4],top:[-3,3,-3.1]},b:{anchor:[6.1,1.2,.4],top:[3,3,-3.1]}},
    circuits:{trunk:[[-6.65,.065,3.4],[-1,.065,3.4]],a:[[-1,.065,3.4],[-1,.08,-2.2]],b:[[-1,.065,3.4],[3.3,.065,3.4],[3.3,.07,0]]},
  };
}
