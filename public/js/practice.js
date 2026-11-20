(() => {
  const panel=document.querySelector('[data-practice-settings]');
  if(!panel)return;
  const form=panel.querySelector('[data-practice-start]'), button=panel.querySelector('[data-practice-button]');
  const error=panel.querySelector('[data-practice-error]'), status=panel.querySelector('[data-practice-status]');
  const inputs=()=>[...panel.querySelectorAll('input[name="banks[]"]')];
  let pending=false;
  for(const action of panel.querySelectorAll('[data-practice-bank-selection]')){
    action.hidden=false;
    action.addEventListener('click',()=>{
      if(pending)return;
      const checked=action.dataset.practiceBankSelection==='all';
      for(const input of inputs())input.checked=checked;
      if(checked)error.hidden=true;
    });
  }
  form.addEventListener('submit',event=>{
    if(event.defaultPrevented)return;
    if(pending){event.preventDefault();return;}
    if(!inputs().some(input=>input.checked)){
      event.preventDefault();error.textContent='請至少選擇一個題庫。';error.hidden=false;return;
    }
    pending=true;button.disabled=true;error.hidden=true;status.textContent='正在準備考卷…';
    form.setAttribute('aria-busy','true');
  });
  window.addEventListener('pageshow',()=>{
    pending=false;button.disabled=false;status.textContent='';form.removeAttribute('aria-busy');
  });
})();
