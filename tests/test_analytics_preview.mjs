import {test} from 'node:test';
import assert from 'node:assert/strict';
import {previewReport} from '../static/analytics-preview.js';

test('preview summaries equal the simulated interval totals for every range',()=>{
  for(const range of ['24h','7d','30d']){
    const report=previewReport(range,'DEMO',1793516400);
    assert.equal(report.source,'preview');
    assert.equal(report.mode,'DEMO');
    assert.ok(report.summary.energy_wh>0);
    assert.equal(report.summary.energy_wh,report.buckets.reduce((sum,b)=>sum+(b.energy_wh||0),0));
    assert.ok(report.summary.coverage_percent<=100);
    assert.equal(report.cloud.enabled,false);
  }
});

test('preview never fabricates real sensor history',()=>{
  const report=previewReport('24h','LIVE',1793516400);
  assert.equal(report.latest,null);
  assert.equal(report.summary.samples,0);
  assert.equal(report.summary.energy_wh,0);
  assert.equal(report.events.length,0);
  assert.ok(report.buckets.every(b=>b.energy_wh===null));
});
