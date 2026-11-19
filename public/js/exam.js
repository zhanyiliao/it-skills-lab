(() => {
    const form = document.querySelector('[data-exam-form]');
    if (!form) return;
    const questions = [...form.querySelectorAll('[data-exam-question]')];
    const counter = form.querySelector('[data-exam-count]');
    const progress = form.querySelector('[data-exam-progress]');
    const status = form.querySelector('[data-exam-save-status]');
    const nonce = form.elements._exam.value;
    // Retain the existing storage key to recover unsent answers after the rebrand.
    const cacheKey = 'itmock.exam.' + nonce;
    let sequence = Number(form.dataset.examSequence);
    let leaving = false, saving = false, pending = false, debounce;
    function answers() {
        return Object.fromEntries(questions.map(question => {
            const key = 'Q' + question.dataset.examQuestion;
            return [key, form.querySelector('input[name="' + key + '"]:checked')?.value ?? 'N'];
        }));
    }
    function cache() {
        try { sessionStorage.setItem(cacheKey, JSON.stringify({ sequence, answers: answers() })); } catch {}
    }
    try {
        const saved = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
        if (saved && Number.isSafeInteger(saved.sequence) && saved.sequence > sequence) {
            for (const [key, value] of Object.entries(saved.answers)) {
                if (!/^Q\d+$/.test(key) || !['A','B','C','D','N'].includes(value)) continue;
                for (const input of form.querySelectorAll('input[name="' + key + '"]')) input.checked = input.value === value;
            }
            sequence = saved.sequence;
        }
    } catch {}
    function updateProgress() {
        let answered = 0;
        for (const question of questions) {
            const selected = !!question.querySelector('input[type=radio]:checked');
            const link = form.querySelector('[data-exam-link="' + question.dataset.examQuestion + '"]');
            link.classList.toggle('is-answered', selected);
            link.setAttribute('aria-label', '第 ' + question.dataset.examQuestion + ' 題，' + (selected ? '已作答' : '未作答'));
            if (selected) answered++;
        }
        counter.textContent = answered + ' / ' + questions.length;
        progress.value = answered;
    }
    function payload() {
        sequence++;
        cache();
        return new URLSearchParams({
            _token: form.elements._token.value, _exam: nonce, _page: form.elements._page.value,
            _sequence: String(sequence), visibility: document.hidden ? 'hidden' : 'visible', ...answers(),
        });
    }
    function forget() { try { sessionStorage.removeItem(cacheKey); } catch {} }
    async function send(url, body) {
        const response = await fetch(url, { method: 'POST', credentials: 'same-origin',
            headers: { Accept: 'application/json' }, body });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || '作答保存失敗。');
        return result;
    }
    async function flush() {
        if (leaving) return;
        if (saving) { pending = true; return; }
        saving = true; pending = false;
        status.textContent = '正在保存作答…';
        try {
            const result = await send('/exams/save', payload());
            if (result.finished) {
                forget();
                if (!leaving) { leaving = true; location.assign(result.destination); }
            } else status.textContent = '已保存作答。';
        } catch (error) {
            status.textContent = error.message + ' 請保持此頁，確認連線後再試。';
        } finally {
            saving = false;
            if (pending && !leaving) void flush();
        }
    }
    function beacon(url, visibility = null) {
        const body = payload();
        if (visibility) body.set('visibility', visibility);
        if (!navigator.sendBeacon?.(url, body)) {
            fetch(url, { method: 'POST', credentials: 'same-origin', body, keepalive: true }).catch(() => {});
        }
    }
    form.addEventListener('change', () => {
        updateProgress();
        sequence++; cache();
        clearTimeout(debounce);
        debounce = setTimeout(() => { void flush(); }, 150);
    });
    form.addEventListener('submit', () => {
        cache();
        leaving = true;
        clearTimeout(debounce);
    });
    document.addEventListener('click', async event => {
        const anchor = event.target.closest?.('a[href]');
        if (!anchor || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey ||
            event.shiftKey || event.altKey || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
        const target = new URL(anchor.href, location.href);
        if (!['http:','https:'].includes(target.protocol) ||
            (target.origin === location.origin && target.pathname === location.pathname && target.search === location.search)) return;
        event.preventDefault();
        if (leaving) return;
        // A native dialog pauses JavaScript; protect the draft from heartbeat expiry.
        beacon('/exams/save', 'hidden');
        if (!window.confirm('離開測驗頁面將自動交卷，未作答的題目會以答錯計。確定要離開嗎？')) {
            void flush();
            return;
        }
        leaving = true; clearTimeout(debounce);
        status.textContent = '正在交卷…';
        try {
            await send('/exams/abandon', payload());
            forget();
            location.assign(target.href);
        } catch (error) {
            leaving = false;
            status.textContent = '交卷尚未完成：' + error.message;
        }
    });
    document.addEventListener('visibilitychange', () => {
        if (leaving) return;
        if (document.hidden) beacon('/exams/save');
        else void flush();
    });
    window.addEventListener('beforeunload', event => {
        if (leaving) return;
        beacon('/exams/save', 'hidden');
        event.preventDefault();
        event.returnValue = true;
        // Runs when the user cancels the browser dialog; unload itself submits nothing.
        setTimeout(() => { if (!leaving) void flush(); }, 0);
    });
    window.addEventListener('pagehide', () => {
        if (!leaving) beacon('/exams/depart');
    });
    window.addEventListener('pageshow', event => {
        if (event.persisted) { leaving = true; location.reload(); return; }
        updateProgress();
    });
    window.addEventListener('online', () => { void flush(); });
    setInterval(() => { if (!document.hidden) void flush(); }, 15000);
    updateProgress();
    [counter, progress, form.querySelector('[data-exam-key]')].forEach(element => { element.hidden = false; });
    void flush();
})();
