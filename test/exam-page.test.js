import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=['interface','exam'].map(name=>fs.readFileSync(new URL('../public/js/'+name+'.js',import.meta.url),'utf8')).join('\n');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function page(cached=null, config={}) {
  const listeners=new Map(),formListeners=new Map(),requests=[],beacons=[],destinations=[],confirms=[],guardListeners=new Map();
  const radios=['A','B','C','D'].map(value=>({value,checked:false}));
  const counter={},progress={},status={},key={},link={classList:{toggle(){}},setAttribute(){}};
  const question={dataset:{examQuestion:'1'},querySelector:()=>radios.find(r=>r.checked)};
  const form={
    elements:{_token:{value:'csrf'},_exam:{value:'nonce'},_page:{value:'document'}},
    dataset:{examSequence:'0'},querySelectorAll(selector){
      if(selector==='[data-exam-question]')return [question];
      if(selector==='input[name="Q1"]')return radios;
      return [];
    },
    querySelector(selector){
      if(selector==='[data-exam-count]')return counter;
      if(selector==='[data-exam-progress]')return progress;
      if(selector==='[data-exam-save-status]')return status;
      if(selector==='[data-exam-key]')return key;
      if(selector.startsWith('[data-exam-link='))return link;
      if(selector==='input[name="Q1"]:checked')return radios.find(r=>r.checked);
      return null;
    },
    addEventListener(type,fn){formListeners.set(type,fn);},
  };
  const on=(type,fn)=>{const list=listeners.get(type)||[];list.push(fn);listeners.set(type,list);};
  const guarded={dataset:{confirmExamEnd:'未答題算錯，確定要繼續嗎？'},addEventListener:(type,fn)=>guardListeners.set(type,fn)};
  const document={hidden:false,querySelector:()=>config.noExam?null:form,
    querySelectorAll:selector=>selector==='[data-confirm-exam-end]'&&config.guarded?[guarded]:[],addEventListener:on};
  const location={href:'http://localhost/exams/current',origin:'http://localhost',pathname:'/exams/current',search:'',
    assign:url=>destinations.push(url),reload:()=>destinations.push('reload')};
  const cache=new Map(cached?[['itmock.exam.nonce',JSON.stringify(cached)]]:[]);
  const context={document,window:{addEventListener:on,confirm:message=>{confirms.push(message);return config.confirm!==false;}},location,URL,URLSearchParams,
    sessionStorage:{getItem:k=>cache.get(k),setItem:(k,v)=>cache.set(k,v),removeItem:k=>cache.delete(k)},
    navigator:{sendBeacon:(url,body)=>{beacons.push({url,body});return true;}},
    fetch:async(url,opts)=>{requests.push({url,body:opts.body});return {ok:true,json:async()=>url==='/exams/abandon'?{finished:true,destination:'/results/latest?record=1'}:{saved:true}};},
    setInterval:()=>1,setTimeout:()=>2,clearTimeout(){},
  };
  vm.runInNewContext(source,context);
  await tick();
  return {form,formListeners,guardListeners,document,radios,requests,beacons,destinations,confirms,counter,cache,
    async fire(type,event={}){for(const fn of listeners.get(type)||[])await fn(event);await tick();}};
}
test('refresh restores unsent answers for the same paper before the first autosave',async()=>{
  const p=await page({sequence:3,answers:{Q1:'C'}});
  assert.equal(p.radios.find(r=>r.checked).value,'C');
  assert.equal(p.requests[0].body.get('Q1'),'C');
  assert.equal(p.requests[0].body.get('_page'),'document');
  assert.ok(Number(p.requests[0].body.get('_sequence'))>3);
  assert.equal(p.counter.textContent,'1 / 1');
});
test('switching tabs saves visibility without notifying departure; pagehide notifies departure',async()=>{
  const p=await page();
  p.document.hidden=true;
  await p.fire('visibilitychange');
  assert.deepEqual(p.beacons.map(b=>b.url),['/exams/save']);
  assert.equal(p.beacons[0].body.get('visibility'),'hidden');
  await p.fire('pagehide');
  assert.deepEqual(p.beacons.map(b=>b.url),['/exams/save','/exams/depart']);
});
test('in-page question jumps and new-tab links do not submit; leaving waits for automatic submission',async()=>{
  const p=await page();
  const click=(href,extra={})=>({button:0,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},
    target:{closest:()=>({href,target:'',hasAttribute:()=>false})},...extra});
  await p.fire('click',click('http://localhost/exams/current#exam-question-1'));
  await p.fire('click',click('http://localhost/leaderboard',{ctrlKey:true}));
  assert.ok(!p.requests.some(r=>r.url==='/exams/abandon'));
  p.radios[0].checked=true;
  await p.fire('click',click('http://localhost/leaderboard'));
  assert.equal(p.requests.at(-1).url,'/exams/abandon');
  assert.equal(p.requests.at(-1).body.get('Q1'),'A');
  assert.deepEqual(p.destinations,['http://localhost/leaderboard']);
  assert.equal(p.confirms.length,1);
  const beaconsBefore=p.beacons.length;
  await p.fire('pagehide');
  assert.equal(p.beacons.length,beaconsBefore);
});
test('manual submit avoids a second departure request and bfcache revisits revalidate with the server',async()=>{
  const p=await page();
  p.formListeners.get('submit')();
  await p.fire('pagehide');
  assert.equal(p.beacons.length,0);
  const returned=await page();
  await returned.fire('pageshow',{persisted:true});
  assert.deepEqual(returned.destinations,['reload']);
});

test('canceling the exit prompt keeps the paper open without submitting or navigating',async()=>{
  const p=await page(null,{confirm:false});
  const event={button:0,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},
    target:{closest:()=>({href:'http://localhost/logout',target:'',hasAttribute:()=>false})}};
  p.radios[1].checked=true;
  await p.fire('click',event);
  assert.equal(p.confirms.length,1);
  assert.match(p.confirms[0],/自動交卷/);
  assert.ok(!p.requests.some(r=>r.url==='/exams/abandon'));
  assert.equal(p.destinations.length,0);
  assert.equal(p.radios[1].checked,true);
  assert.equal(p.requests.at(-1).url,'/exams/save');
  assert.equal(p.requests.at(-1).body.get('visibility'),'visible');
});
test('browser departure requests a native prompt without committing an exam during beforeunload',async()=>{
  const p=await page();
  let prevented=false;const event={preventDefault(){prevented=true;}};
  await p.fire('beforeunload',event);
  assert.equal(prevented,true);assert.equal(event.returnValue,true);
  assert.ok(p.beacons.every(b=>b.url==='/exams/save'));
  assert.equal(p.beacons.at(-1).body.get('visibility'),'hidden');
  assert.ok(!p.requests.some(r=>r.url==='/exams/abandon'));
  p.formListeners.get('submit')();
  let duplicate=false;await p.fire('beforeunload',{preventDefault(){duplicate=true;}});
  assert.equal(duplicate,false);
});
test('confirmed in-app exit does not trigger a second browser prompt',async()=>{
  const p=await page();
  await p.fire('click',{button:0,defaultPrevented:false,preventDefault(){},
    target:{closest:()=>({href:'http://localhost/exams',target:'',hasAttribute:()=>false})}});
  let duplicate=false;await p.fire('beforeunload',{preventDefault(){duplicate=true;}});
  assert.equal(p.confirms.length,1);assert.equal(duplicate,false);
});
test('restart and logout forms require confirmation only when a pending paper is indicated',async()=>{
  const canceled=await page(null,{noExam:true,guarded:true,confirm:false});
  let blocked=false;canceled.guardListeners.get('submit')({preventDefault(){blocked=true;}});
  assert.equal(blocked,true);assert.equal(canceled.confirms.length,1);
  assert.equal(canceled.requests.length,0);
  const accepted=await page(null,{noExam:true,guarded:true});
  let prevented=false;accepted.guardListeners.get('submit')({preventDefault(){prevented=true;}});
  assert.equal(prevented,false);assert.equal(accepted.confirms.length,1);
});
