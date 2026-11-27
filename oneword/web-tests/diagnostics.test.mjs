import test from 'node:test';
import assert from 'node:assert/strict';
import {pageFixture} from './helpers/frontend-fixture.mjs';

function classroom() {
  return {
    code: 'ABCDEF', revision: 60, title: 'Private room title', mode: 'live', points: 10,
    usage: {calls: 6, input: 100, output: 10}, serverTime: Date.now(),
    round: {id: 'six', number: 6, phase: 'closed', submitted: 6, judged: 6, pending: 0, unresolved: 3},
    automation: {enabled: true, status: 'paused', pauseReason: 'judging', totalQuestions: 8},
    players: Array.from({length: 10}, (_, i) => ({
      id: `private-player-${i}`, studentId: String(1410701 + i), name: `Private name ${i}`,
      score: 0, submitted: i < 6, judgeStatus: i < 6 ? 'done' : i < 9 ? 'upload-error' : 'waiting',
      error: i >= 6 && i < 9 ? '圖片保存未完成，請原平板重試 Private service response' : '',
      imageUrl: 'data:image/png;base64,PRIVATE'
    }))
  };
}

const stateResponse = room => ({status: 200, body: {
  version: '2.12.1', features: {roomManagement: true, autoSequence: true, batchJudging: true},
  settings: {configured: true, concurrency: 2}, room
}});

async function poll(fixture) {
  const timer = fixture.timeouts.findLast(t => !t.cancelled && [1500, 3500].includes(t.delay));
  assert.ok(timer);
  timer.cancelled = true;
  await timer.fn();
}

async function download(fixture) {
  const calls = fixture.calls.length;
  fixture.get('diagnostics-download').onclick();
  assert.equal(fixture.calls.length, calls, 'download works without a GAS request');
  const file = fixture.downloads.at(-1);
  assert.match(file.filename, /^oneword-diagnostics-.*\.json$/);
  const raw = await file.blob.text();
  assert.doesNotMatch(raw, /ABCDEF|141070[1-9]|private-player|Private|data:image|test-teacher/);
  return JSON.parse(raw);
}

test('the teacher can export a paused sixth question offline and retain it after revealing, advancing and refreshing', async () => {
  let room = classroom(), offline = false;
  const respond = async url => {
    if (url.endsWith('/reveal')) {
      room = {...room, revision: 61, round: {...room.round, phase: 'revealed'}, automation: {...room.automation, status: 'running', pauseReason: null}};
      return {status: 200, body: {room}};
    }
    assert.equal(url, '/api/admin/state');
    if (offline) return {status: 503, body: {error: 'GAS 回應逾時 Private service response'}};
    return stateResponse(room);
  };
  const f = await pageFixture('teacher', respond);
  assert.equal(f.get('diagnostics-download').hidden, false);
  assert.match(f.get('teacher-players').innerHTML, /S07/);
  offline = true;
  await poll(f);
  await poll(f);
  let report = await download(f);
  assert.deepEqual(report.versions, {web: '2.13.0', gas: '2.12.1'});
  const sixth = report.rounds[0];
  assert.equal(sixth.number, 6);
  assert.equal(sixth.current.pauseReason, 'judging');
  assert.deepEqual(sixth.current.counts, {participants: 10, submitted: 6, judged: 6, pending: 0, unresolved: 3});
  assert.equal(report.events.filter(event => event.type === 'answer-issue').length, 3);
  assert.equal(report.events.filter(event => event.type === 'request-error').length, 1);

  offline = false;
  await f.get('reveal-button').onclick();
  room = {...room, revision: 62, round: {id: 'seven', number: 7, phase: 'writing', pending: 0, submitted: 0, judged: 0}};
  await poll(f);
  const reopened = await pageFixture('teacher', async () => ({status: 401, body: {error: '教師登入已失效'}}), {sessionStore: f.sessionStore});
  assert.equal(reopened.get('teacher-app').hidden, true);
  assert.equal(reopened.get('diagnostics-download').hidden, false);
  report = await download(reopened);
  assert.deepEqual(report.rounds.map(item => item.number), [6, 7]);
  assert.ok(report.rounds[0].phases.revealed);
  assert.ok(report.events.some(event => event.type === 'round-status' && event.round === 6 && event.automation === 'paused'));
  assert.ok(report.events.some(event => event.type === 'request-recovered' && event.channel === 'state'));
  assert.ok(report.events.some(event => event.type === 'teacher-action' && event.action === 'skip-unjudged' && event.outcome === 'completed'));
});

test('teacher grading request errors and recovery appear in the same room report', async () => {
  const room = classroom();
  room.round.pending = 1;
  let calls = 0;
  const f = await pageFixture('teacher', async () => stateResponse(room), {workerRun: async () => {
    if (++calls === 1) throw Object.assign(new Error('GAS 回應逾時 Private service response'), {status: 503});
    return {idle: true};
  }});
  await poll(f);
  await new Promise(resolve => setImmediate(resolve));
  const report = await download(f);
  assert.ok(report.events.some(event => event.channel === 'grading' && event.type === 'request-error' && event.round === 6));
  assert.ok(report.events.some(event => event.channel === 'grading' && event.type === 'request-recovered' && event.round === 6));
});
