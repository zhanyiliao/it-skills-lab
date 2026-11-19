(() => {
  const form = document.querySelector('[data-avatar-form]');
  if (!form) return;
  const fileInput = form.querySelector('input[type=file]');
  const editor = form.querySelector('[data-avatar-editor]');
  const canvas = form.querySelector('[data-avatar-canvas]');
  const preview = form.querySelector('[data-avatar-preview]');
  const context = canvas.getContext('2d');
  const previewContext = preview.getContext('2d');
  if (!context || !previewContext) return;
  const zoom = form.querySelector('[data-avatar-zoom]');
  const zoomValue = form.querySelector('[data-avatar-zoom-value]');
  const reset = form.querySelector('[data-avatar-reset]');
  const save = form.querySelector('button[type=submit]');
  const error = form.querySelector('[data-avatar-error]');
  const coordinates = ['crop_x', 'crop_y', 'crop_size'].map(name => form.elements.namedItem(name));
  const side = canvas.width;
  let image = null, scale = 1, baseScale = 1, left = 0, top = 0, drag = null, generation = 0, pending = false;

  const showError = message => { error.textContent = message; error.hidden = !message; };
  function clampPosition() {
    left = Math.min(0, Math.max(side - image.naturalWidth * scale, left));
    top = Math.min(0, Math.max(side - image.naturalHeight * scale, top));
  }
  function crop() {
    const size = Math.min(image.naturalWidth, image.naturalHeight, Math.max(1, Math.floor(side / scale)));
    return {
      size,
      x: Math.max(0, Math.min(image.naturalWidth - size, Math.round(-left / scale))),
      y: Math.max(0, Math.min(image.naturalHeight - size, Math.round(-top / scale))),
    };
  }
  function render() {
    if (!image) return;
    clampPosition();
    const { x, y, size } = crop();
    for (const [target, drawing] of [[canvas, context], [preview, previewContext]]) {
      drawing.clearRect(0, 0, target.width, target.height);
      drawing.drawImage(image, x, y, size, size, 0, 0, target.width, target.height);
    }
    coordinates.forEach((field, index) => {
      field.value = [x, y, size][index];
      field.disabled = false;
    });
    zoomValue.textContent = Math.round(Number(zoom.value) * 100) + '%';
  }
  function resetPosition() {
    if (!image) return;
    zoom.value = '1';
    baseScale = side / Math.min(image.naturalWidth, image.naturalHeight);
    scale = baseScale;
    left = (side - image.naturalWidth * scale) / 2;
    top = (side - image.naturalHeight * scale) / 2;
    render();
  }
  fileInput.addEventListener('change', async () => {
    const version = ++generation;
    image = null; drag = null; editor.hidden = true; save.disabled = true;
    coordinates.forEach(field => { field.disabled = true; });
    showError('');
    const file = fileInput.files[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024) {
      showError('請選擇 4 MB 以內的 PNG、JPEG 或 WebP 圖片。'); return;
    }
    const url = URL.createObjectURL(file);
    try {
      const loaded = new Image();
      loaded.src = url;
      await loaded.decode();
      if (version !== generation) return;
      if (loaded.naturalWidth > 4096 || loaded.naturalHeight > 4096) {
        showError('圖片寬高不得超過 4096 像素。'); return;
      }
      image = loaded;
      editor.hidden = false;
      resetPosition();
      save.disabled = false;
    } catch {
      if (version === generation) showError('圖片無法讀取，請選擇其他圖片。');
    } finally { URL.revokeObjectURL(url); }
  });
  zoom.addEventListener('input', () => {
    if (!image || pending) return;
    const previous = scale;
    scale = baseScale * Number(zoom.value);
    left = side / 2 - (side / 2 - left) * scale / previous;
    top = side / 2 - (side / 2 - top) * scale / previous;
    render();
  });
  reset.addEventListener('click', resetPosition);
  canvas.addEventListener('pointerdown', event => {
    if (!image || pending || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    if (drag) return;
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left, top };
    canvas.classList.add('is-dragging');
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId || pending) return;
    const factor = side / canvas.getBoundingClientRect().width;
    left = drag.left + (event.clientX - drag.x) * factor;
    top = drag.top + (event.clientY - drag.y) * factor;
    render();
  });
  function stopDrag(event) {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    canvas.classList.remove('is-dragging');
  }
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);
  canvas.addEventListener('lostpointercapture', stopDrag);
  canvas.addEventListener('keydown', event => {
    if (!image || pending) return;
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? 24 : 6;
    left += direction[0] * step; top += direction[1] * step;
    render();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending) return;
    if (!image) { showError('請先選擇有效圖片，再調整裁切範圍。'); return; }
    render();
    const data = new FormData(form);
    pending = true; save.disabled = true; fileInput.disabled = true; zoom.disabled = true; reset.disabled = true;
    form.setAttribute('aria-busy', 'true');
    showError('');
    save.textContent = '儲存中…';
    try {
      const response = await fetch(form.action, { method: 'POST', body: data, headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || '頭像更新失敗，請稍後再試。');
      window.location.assign('/settings/profile');
    } catch (failure) {
      showError(failure instanceof TypeError ? '連線失敗，裁切設定已保留，請稍後再試。' : failure.message);
      save.disabled = false;
    } finally {
      pending = false; fileInput.disabled = false; zoom.disabled = false; reset.disabled = false;
      form.removeAttribute('aria-busy');
      save.textContent = '儲存頭像';
    }
  });
  save.disabled = true;
})();
