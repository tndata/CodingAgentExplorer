(function () {
    const stored = localStorage.getItem('theme');
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    const theme = stored || (prefersLight ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', theme);

    function updateIcon(t) {
        const btn = document.getElementById('themeToggle');
        if (btn) btn.querySelector('.theme-icon').textContent = t === 'dark' ? '🌙' : '☀️';
    }

    document.addEventListener('DOMContentLoaded', function () {
        updateIcon(document.documentElement.getAttribute('data-theme'));
    });

    window.toggleTheme = function () {
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
        updateIcon(next);
    };
})();
