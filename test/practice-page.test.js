import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/js/practice.js',import.meta.url),'utf8');
function page(){
  const events=new Map(),inputs=Array.from({length:8},()=>({checked:true})),actions=['all','none'].map(value=>({
    dataset:{aiBankSelection:value},hidden:true,addEventListener(name,handler){this.click=handler;},
  }));
  const form={attributes:{},addEventListener(name,handler){this.submit=handler;},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];}};
  const button={disabled:false},error={hidden:true},status={textContent:''};
  const selectors=new Map([['[data-practice-start]',form],['[data-ai-button]',button],['[data-ai-error]',error],['[data-ai-status]',status]]);
  const panel={querySelector:s=>selectors.get(s),querySelectorAll:s=>s==='[data-ai-bank-selection]'?actions:inputs};
  vm.runInNewContext(source,{document:{querySelector:()=>panel},window:{addEventListener:(name,handler)=>events.set(name,handler)}});
  return {form,button,error,status,inputs,actions,events,submit(extra={}){const event={defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...extra};form.submit(event);return event;}};
}
test('database practice bulk selection blocks an empty request and preserves native form fields',()=>{
  const p=page();p.actions[1].click();assert.ok(p.inputs.every(input=>!input.checked));
  assert.equal(p.submit().defaultPrevented,true);assert.equal(p.error.hidden,false);
  p.actions[0].click();assert.ok(p.inputs.every(input=>input.checked));assert.equal(p.error.hidden,true);
  assert.equal(p.submit().defaultPrevented,false);assert.equal(p.button.disabled,true);
  assert.ok(p.inputs.every(input=>!input.disabled));assert.equal(p.form.attributes['aria-busy'],'true');
  assert.equal(p.submit().defaultPrevented,true);
  p.events.get('pageshow')();assert.equal(p.button.disabled,false);assert.equal(p.submit().defaultPrevented,false);
});
test('cancelled replacement confirmation leaves database practice ready to submit',()=>{
  const p=page();p.submit({defaultPrevented:true});assert.equal(p.button.disabled,false);
  assert.equal(p.status.textContent,'');assert.equal(p.submit().defaultPrevented,false);
});
