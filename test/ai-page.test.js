import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/js/ai-questions.js', import.meta.url), 'utf8');
class Element {
  constructor() { this.attributes = {}; this.dataset = {}; this.textContent = ''; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
}
function page(fetch, { banks = ['programming', 'ai-applications'], formal = false } = {}) {
  const selectors = new Map(['generate', 'button', 'settings', 'status', 'error', 'progress', 'elapsed'].map(key => ['[data-ai-' + key + ']', new Element()]));
  const steps = ['preparing', 'generating', 'validating', 'complete'].map(stage => { const item = new Element(); item.dataset.aiStage = stage; return item; });
  const panel = new Element(), events = new Map(), listeners = new Map(), timers = new Map(), destinations = [];
  let clock = 1000, timerId = 0;
  const bankInputs = ['computer-science','internet-introduction','network-security','information-ethics','office-applications','programming','project-management','ai-applications']
    .map(value => ({ value, checked: banks.includes(value) }));
  const selectionActions = ['all', 'none'].map(value => {
    const action = new Element(); action.dataset.aiBankSelection = value;
    action.addEventListener = (name, handler) => { if (name === 'click') action.click = handler; };
    return action;
  });
  selectors.get('[data-ai-settings]').querySelectorAll = () => bankInputs;
  panel.dataset.aiMode = formal ? 'formal' : '';
  panel.querySelector = key => selectors.get(key);
  panel.querySelectorAll = selector => selector === '[data-ai-stage]' ? steps : selector === '[data-ai-bank-selection]' ? selectionActions : [];
  const form = selectors.get('[data-ai-generate]');
  form.action = formal ? '/exams/formal/start' : '/exams/ai/start'; form.addEventListener = (name, fn) => listeners.set(name, fn);
  vm.runInNewContext(source, {
    document: { querySelector: () => panel }, window: { addEventListener: (name, fn) => events.set(name, fn) },
    location: { assign: destination => destinations.push(destination) },
    FormData: class { *[Symbol.iterator]() { yield ['_token', 'csrf']; yield ['amount', '10']; for (const bank of bankInputs.filter(input => input.checked)) yield ['banks[]', bank.value]; } },
    URLSearchParams, AbortController, TextDecoder, fetch, Date: { now: () => clock },
    setInterval: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearInterval: id => timers.delete(id),
  });
  return { selectors, steps, events, timers, destinations, banks: bankInputs, selectAll: () => selectionActions[0].click(), clearAll: () => selectionActions[1].click(), advance(ms) { clock += ms; for (const callback of timers.values()) callback(); },
    submit: (extra = {}) => listeners.get('submit')({ defaultPrevented: false, preventDefault() {}, ...extra }) };
}
function stream() {
  let controller;
  return {
    response: { ok: true, headers: { get: () => 'application/x-ndjson' }, body: new ReadableStream({ start(value) { controller = value; } }) },
    send(value) { controller.enqueue(typeof value === 'string' ? new TextEncoder().encode(value) : value); },
    end() { controller.close(); },
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('AI start sends selected settings and opens the paper without previewing answers', async () => {
  const p = page(async (url, options) => {
    assert.equal(url, '/exams/ai/start');
    assert.equal(options.body.get('_token'), 'csrf');
    assert.equal(options.body.get('amount'), '10');
    assert.deepEqual(options.body.getAll('banks[]'), ['programming', 'ai-applications']);
    return { ok: true, json: async () => ({ destination: '/exams/current' }) };
  });
  await p.submit();
  assert.deepEqual(p.destinations, ['/exams/current']);
  assert.equal(p.steps[3].dataset.state, 'done');
  assert.equal(p.timers.size, 0);
});
test('a cancelled replacement confirmation or empty bank selection does not start generation', async () => {
  let calls = 0;
  const canceled = page(async () => { calls++; });
  await canceled.submit({ defaultPrevented: true });
  assert.equal(calls, 0);
  const empty = page(async () => { calls++; }, { banks: [] });
  await empty.submit();
  assert.equal(calls, 0);
  assert.equal(empty.selectors.get('[data-ai-error]').hidden, false);
});
test('bulk selection updates all eight banks without submitting and restores empty-selection feedback', async () => {
  let calls = 0;
  const p = page(async () => { calls++; }, { banks: [] });
  await p.submit();
  assert.equal(p.selectors.get('[data-ai-error]').hidden, false);
  p.selectAll();
  assert.equal(p.banks.filter(input => input.checked).length, 8);
  assert.equal(p.selectors.get('[data-ai-error]').hidden, true);
  p.banks[0].checked = false;
  p.selectAll();
  assert.ok(p.banks.every(input => input.checked));
  p.clearAll();
  assert.ok(p.banks.every(input => !input.checked));
  await p.submit();
  assert.equal(p.selectors.get('[data-ai-error]').hidden, false);
  assert.equal(calls, 0);
});

test('streamed batch counts update immediately while elapsed time alone does not advance the stage', async () => {
  const connection = stream(), p = page(async () => connection.response), pending = p.submit();
  await tick();
  connection.send('{"type":"stage","stage":"gener');
  await tick(); assert.equal(p.steps[0].dataset.state, 'current');
  connection.send('ating","completed":5,"total":10}\n{"type":"heartbeat"}\n');
  await tick();
  assert.match(p.selectors.get('[data-ai-status]').textContent, /5／10/);
  p.advance(64000);
  assert.equal(p.selectors.get('[data-ai-elapsed]').textContent, '已等候 1 分 4 秒');
  assert.equal(p.steps[1].dataset.state, 'current'); assert.equal(p.steps[2].dataset.state, 'waiting');
  connection.send('{"type":"stage","stage":"validating","completed":10,"total":10}\n');
  await tick(); assert.equal(p.steps[2].dataset.state, 'current');
  connection.send('{"type":"result","destination":"/exams/current"}\n'); connection.end(); await pending;
  assert.deepEqual(p.destinations, ['/exams/current']); assert.equal(p.timers.size, 0);
});
test('UTF-8 stream errors enable retry without opening an incomplete paper', async () => {
  const connection = stream(), p = page(async () => connection.response), pending = p.submit();
  connection.send('{"type":"stage","stage":"generating"}\n');
  const bytes = new TextEncoder().encode('{"type":"error","message":"等候逾時，請重新產生。"}\n');
  const cut = bytes.findIndex(value => value >= 128) + 1;
  connection.send(bytes.slice(0, cut)); await tick(); connection.send(bytes.slice(cut)); connection.end(); await pending;
  assert.equal(p.steps[1].dataset.state, 'stopped');
  assert.equal(p.selectors.get('[data-ai-error]').textContent, '等候逾時，請重新產生。');
  assert.equal(p.selectors.get('[data-ai-settings]').disabled, false);
  assert.deepEqual(p.destinations, []); assert.equal(p.timers.size, 0);
});
test('interrupted streams cannot open a paper or report success', async () => {
  const connection = stream(), p = page(async () => connection.response), pending = p.submit();
  connection.send('{"type":"stage","stage":"generating"}\n'); connection.end(); await pending;
  assert.equal(p.steps[3].dataset.state, 'waiting');
  assert.match(p.selectors.get('[data-ai-error]').textContent, /連線已中斷/);
  assert.deepEqual(p.destinations, []); assert.equal(p.timers.size, 0);
});
test('duplicate clicks send one request; leaving cancels and releases disabled controls', async () => {
  let calls = 0, signal;
  const p = page((url, options) => new Promise((resolve, reject) => {
    calls++; signal = options.signal;
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  }));
  const pending = p.submit(); await p.submit();
  assert.equal(calls, 1); assert.equal(p.selectors.get('[data-ai-settings]').disabled, true);
  const selected = p.banks.filter(input => input.checked).map(input => input.value);
  p.clearAll(); p.selectAll();
  assert.deepEqual(p.banks.filter(input => input.checked).map(input => input.value), selected);
  p.events.get('pagehide')(); await pending;
  assert.equal(signal.aborted, true);
  assert.equal(p.selectors.get('[data-ai-settings]').disabled, false);
  assert.equal(p.timers.size, 0); assert.deepEqual(p.destinations, []);
});

test('formal progress keeps content review visible while a rejected batch is regenerated',async()=>{
  const connection=stream(),p=page(async(url)=>{assert.equal(url,'/exams/formal/start');return connection.response;},{formal:true});
  const pending=p.submit();await tick();
  connection.send(JSON.stringify({type:'stage',stage:'generating',completed:20,total:20})+'\n');await tick();
  assert.match(p.selectors.get('[data-ai-status]').textContent,/20／20/);
  connection.send(JSON.stringify({type:'stage',stage:'validating',retrying:true})+'\n');await tick();
  assert.match(p.selectors.get('[data-ai-status]').textContent,/重新生成/);
  assert.equal(p.steps[2].dataset.state,'current');
  connection.send(JSON.stringify({type:'result',destination:'/exams/current'})+'\n');connection.end();await pending;
  assert.deepEqual(p.destinations,['/exams/current']);assert.equal(p.timers.size,0);
});
