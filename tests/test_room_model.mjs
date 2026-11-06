import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../static/vendor/three.module.min.js';
import {buildRoomModel} from '../static/room-model.js';

test('reference composition contains the two furnished rooms and central doorway',()=>{
  const world=new THREE.Group();
  const room=buildRoomModel(THREE,world,new THREE.BoxGeometry(1,1,1));
  for(const name of ['living-sofa','living-tv','dining-table','dining-bookcase','doorway-lintel']){
    assert.ok(world.getObjectByName(name),name);
  }
  const bounds=new THREE.Box3().setFromObject(world);
  assert.ok(bounds.min.x<=-6.1&&bounds.max.x>=6.1);
  assert.ok(bounds.max.y>=3);
  assert.equal(room.lamps.a.x,-1);
  assert.equal(room.lamps.b.x,3.3);
  assert.equal(room.callouts.a.top[0],-3);
  assert.equal(room.callouts.b.top[0],3);
});

test('many furniture parts reuse a small geometry and material set',()=>{
  const world=new THREE.Group();
  buildRoomModel(THREE,world,new THREE.BoxGeometry(1,1,1));
  const meshes=world.children.filter(object=>object.isMesh);
  assert.ok(meshes.length>80);
  assert.ok(new Set(meshes.map(mesh=>mesh.geometry)).size<=4);
  assert.ok(new Set(meshes.map(mesh=>mesh.material)).size<=24);
});
