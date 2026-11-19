(() => {
    const menus = [...document.querySelectorAll('.site-dropdown')];
    for (const menu of menus) {
        menu.addEventListener('toggle', () => {
            if (menu.open) menus.forEach(other => { if (other !== menu) other.open = false; });
        });
    }
    document.addEventListener('click', event => {
        menus.forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
    });
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        menus.forEach(menu => {
            if (!menu.open) return;
            const containedFocus = menu.contains(document.activeElement);
            menu.open = false;
            if (containedFocus) menu.querySelector('summary').focus();
        });
    });
    for (const guarded of document.querySelectorAll('[data-confirm-exam-end]')) {
        guarded.addEventListener('submit', event => {
            const message = guarded.dataset.confirmExamEnd;
            if (message && !window.confirm(message)) event.preventDefault();
        });
    }
})();
