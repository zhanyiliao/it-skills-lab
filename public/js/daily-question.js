(() => {
    const form = document.querySelector('[data-daily-question-form]');
    if (!form) return;

    const dialog = document.getElementById('daily-question-login-dialog');
    const button = form.querySelector('button[type="submit"]');
    const options = form.querySelector('fieldset');
    const result = form.querySelector('[data-daily-result]');
    const error = form.querySelector('[data-daily-error]');
    const refresh = form.querySelector('[data-daily-refresh]');
    const initialLabel = button.innerHTML;
    let pending = false;
    let requestVersion = 0;
    let activeRequest = null;

    const clearFeedback = () => {
        result.replaceChildren();
        form.querySelectorAll('[data-daily-choice]').forEach(label => label.classList.remove('correct-answer'));
        error.hidden = true;
        error.textContent = '';
        refresh.hidden = true;
        button.innerHTML = initialLabel;
    };
    const resetAnswer = () => {
        requestVersion++;
        activeRequest?.abort();
        activeRequest = null;
        pending = false;
        clearFeedback();
        form.querySelectorAll('input[name="choice"]').forEach(input => { input.checked = false; });
        button.disabled = false;
        options.disabled = false;
        form.removeAttribute('aria-busy');
    };

    // Clear browser-restored form controls and feedback, including back/forward cache.
    resetAnswer();
    window.addEventListener('pageshow', resetAnswer);
    window.addEventListener('pagehide', resetAnswer);
    form.addEventListener('change', event => {
        if (event.target.matches('input[name="choice"]')) clearFeedback();
    });

    const promptLogin = () => {
        resetAnswer();
        if (typeof dialog.showModal === 'function') {
            if (!dialog.open) dialog.showModal();
        } else {
            window.location.assign(dialog.querySelector('a').href);
        }
    };

    dialog.querySelector('[data-daily-dialog-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
        const bounds = dialog.getBoundingClientRect();
        if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
    });

    if (form.dataset.requiresLogin === 'true') {
        form.addEventListener('click', event => {
            if (event.target.closest('[data-daily-choice], button[type="submit"]')) {
                event.preventDefault();
                promptLogin();
            }
        });
        form.addEventListener('keydown', event => {
            if (event.target.matches('input[name="choice"]') && [' ', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
                event.preventDefault();
                promptLogin();
            }
        });
        form.addEventListener('submit', event => {
            event.preventDefault();
            promptLogin();
        });
        return;
    }

    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (pending) return;
        const data = new FormData(form);
        const version = ++requestVersion;
        activeRequest = new AbortController();
        clearFeedback();
        pending = true;
        button.disabled = true;
        options.disabled = true;
        form.setAttribute('aria-busy', 'true');
        button.textContent = '送出中…';
        let completed = false;

        try {
            const response = await fetch(form.action, {
                method: 'POST',
                body: data,
                credentials: 'same-origin',
                headers: { Accept: 'application/json' },
                signal: activeRequest.signal,
            });
            if (version !== requestVersion) return;
            if (response.status === 401) {
                promptLogin();
                return;
            }
            if (response.status === 419 || response.status === 409) {
                refresh.hidden = false;
                throw new Error(response.status === 419
                    ? '頁面已逾時，請重新載入後再作答。'
                    : '每日一題已更新，請重新載入今天的題目再作答。');
            }
            const payload = await response.json();
            if (version !== requestVersion) return;
            if (!response.ok) {
                throw new Error(response.status === 422
                    ? Object.values(payload.errors ?? {}).flat()[0] || '請確認選項後再送出。'
                    : '目前無法送出作答，請稍後再試。');
            }
            result.innerHTML = payload.html;
            form.querySelectorAll('[data-daily-choice]').forEach(label => {
                label.classList.toggle('correct-answer', label.querySelector('input').value === payload.answer);
            });
            completed = true;
        } catch (failure) {
            if (version !== requestVersion || failure.name === 'AbortError') return;
            error.textContent = failure instanceof TypeError ? '連線失敗，請確認網路後再試一次。' : failure.message;
            error.hidden = false;
        } finally {
            if (version === requestVersion) {
                pending = false;
                activeRequest = null;
                button.disabled = false;
                options.disabled = false;
                form.removeAttribute('aria-busy');
                button.innerHTML = initialLabel;
                if (completed) button.textContent = '再次作答';
            }
        }
    });
})();
