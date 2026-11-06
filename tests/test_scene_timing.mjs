import assert from 'node:assert/strict';
import {test} from 'node:test';
import {renderPixelRatio, advanceLevel} from '../static/scene-timing.js';

test('ordinary displays do not allocate a retina buffer', () => {
  assert.equal(renderPixelRatio(1005,736,1),1);
});
test('large retina buffers stay within the pixel budget', () => {
  const ratio=renderPixelRatio(2400,1400,3);
  assert.ok(2400*1400*ratio*ratio<=1500001);
  assert.ok(ratio<=3);
});
test('a narrow high-density screen retains antialiased detail within its cap', () => {
  assert.equal(renderPixelRatio(356,437,3),1.75);
  assert.equal(renderPixelRatio(356,437,3,true),1.5);
});
test('lighting finishes within 240ms regardless of frame cadence', () => {
  let smooth=0,slow=0;
  for(let i=0;i<15;i++)smooth=advanceLevel(smooth,1,16);
  for(let i=0;i<4;i++)slow=advanceLevel(slow,1,60);
  assert.equal(smooth,1);assert.equal(slow,1);
});
test('reversing a lighting change cannot overshoot or retain an old target', () => {
  const halfway=advanceLevel(0,1,120);
  assert.equal(halfway,.5);
  assert.equal(advanceLevel(halfway,0,120),0);
  assert.equal(advanceLevel(halfway,1,500),1);
});
test('reduced motion applies the target without intermediate frames', () => {
  assert.equal(advanceLevel(0,1,0,true),1);
  assert.equal(advanceLevel(1,0,0,true),0);
});
