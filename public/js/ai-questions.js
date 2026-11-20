(() => {
    const panel = document.querySelector('[data-ai-playground]');
    if (!panel) return;
    const form = panel.querySelector('[data-ai-generate]');
    const button = panel.querySelector('[data-ai-button]');
    const settings = panel.querySelector('[data-ai-settings]');
    const status = panel.querySelector('[data-ai-status]');
    const error = panel.querySelector('[data-ai-error]');
    const progress = panel.querySelector('[data-ai-progress]');
    const elapsed = panel.querySelector('[data-ai-elapsed]');
    const steps = [...panel.querySelectorAll('[data-ai-stage]')];
    const stages = ['preparing', 'generating', 'validating', 'complete'];
    const messages = {
        preparing: '分配八科題數並抽選 45 題…',
        generating: 'AI 正在產生題目與解析，請稍候…',
        validating: '檢查新題正確性與細節考點，並建立考卷…',
        complete: '考卷已準備好，正在開啟測驗…',
    };
    let pending = false, controller = null, currentStage = -1, timer;
    function stage(value, counts = {}) {
        const index = stages.indexOf(value);
        if (index < currentStage || index < 0) return;
        currentStage = index;
        status.textContent = value === 'generating' && Number.isInteger(counts.completed) && Number.isInteger(counts.total) &&
            counts.completed >= 0 && counts.completed <= counts.total
            ? 'AI 正在出題，已完成 ' + counts.completed + '／' + counts.total + ' 題…' : messages[value];
        if (value === 'validating' && counts.retrying)
            status.textContent = '部分新題正在重新生成，完成後會再次檢查考點與內容…';
        steps.forEach((step, i) => {
            step.dataset.state = i < index || value === 'complete' ? 'done' : i === index ? 'current' : 'waiting';
            if (i === index) step.setAttribute('aria-current', 'step');
            else step.removeAttribute('aria-current');
        });
    }
    function stopped() {
        const step = steps[currentStage];
        if (step) { step.dataset.state = 'stopped'; step.removeAttribute('aria-current'); }
    }
    async function readResult(response) {
        if (!response.ok || !response.headers?.get('content-type')?.includes('application/x-ndjson')) {
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || '目前無法產生考卷，請稍後再試。');
            return result;
        }
        if (!response.body) throw new Error('無法接收出題結果，請重新產生。');
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let buffer = '', result = null;
        const receive = line => {
            if (!line.trim()) return;
            let event;
            try { event = JSON.parse(line); } catch { throw new Error('出題訊息無法讀取，請重新產生。'); }
            if (event.type === 'stage' && event.stage !== 'complete') stage(event.stage, event);
            if (event.type === 'error') throw new Error(event.message || '出題未完成，請重新產生。');
            if (event.type === 'result') result = event;
        };
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let end;
                while ((end = buffer.indexOf('\n')) >= 0) {
                    receive(buffer.slice(0, end));
                    buffer = buffer.slice(end + 1);
                }
            }
            buffer += decoder.decode();
            if (buffer.trim()) receive(buffer);
            if (!result) throw new Error('出題連線已中斷，請重新產生。');
            return result;
        } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
        }
    }
    form.addEventListener('submit', async event => {
        if (event.defaultPrevented) return;
        event.preventDefault();
        if (pending) return;
        const body = new URLSearchParams(new FormData(form));
        pending = true;
        controller = new AbortController();
        currentStage = -1;
        button.disabled = true;
        settings.disabled = true;
        form.setAttribute('aria-busy', 'true');
        progress.hidden = false;
        elapsed.hidden = false;
        const started = Date.now();
        const updateElapsed = () => {
            const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
            elapsed.textContent = '已等候 ' + Math.floor(seconds / 60) + ' 分 ' + seconds % 60 + ' 秒';
        };
        updateElapsed();
        timer = setInterval(updateElapsed, 1000);
        stage('preparing');
        error.hidden = true;
        try {
            const response = await fetch(form.action, { method: 'POST', credentials: 'same-origin',
                headers: { Accept: 'application/x-ndjson, application/json' }, body, signal: controller.signal });
            const result = await readResult(response);
            if (result.destination !== '/exams/current') throw new Error('考卷尚未完成，請重新產生。');
            stage('complete');
            location.assign(result.destination);
        } catch (failure) {
            stopped();
            if (failure.name === 'AbortError') { status.textContent = '已停止等待，可重新產生考卷。'; return; }
            status.textContent = '本次考卷未完成。';
            error.textContent = failure instanceof TypeError ? '連線失敗，請確認網路後再試一次。' : failure.message;
            error.hidden = false;
        } finally {
            clearInterval(timer);
            updateElapsed();
            pending = false;
            button.disabled = false;
            settings.disabled = false;
            form.removeAttribute('aria-busy');
        }
    });
    window.addEventListener('pagehide', () => controller?.abort());
})();
