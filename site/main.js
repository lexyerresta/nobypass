(() => {
  // Theme toggle: follows the system until the visitor picks one; the choice is remembered when storage allows.
  const root = document.documentElement;
  const toggle = document.getElementById('theme-toggle');
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const current = () => root.getAttribute('data-theme') || (media.matches ? 'dark' : 'light');
  const syncToggle = () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    toggle.querySelector('.theme-label').textContent = next === 'dark' ? 'Dark' : 'Light';
    toggle.setAttribute('aria-label', `Switch to ${next} theme`);
  };
  toggle.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try {
      localStorage.setItem('nobypass-theme', next);
    } catch {
      /* storage unavailable: the choice lasts for this page view only */
    }
    syncToggle();
  });
  media.addEventListener('change', syncToggle);
  syncToggle();

  // Demo: framework x version selects one code block and its real check output.
  const FILES = {
    laravel: 'app/Http/Controllers/UserController.php',
    nestjs: 'src/users/users.controller.ts',
  };
  const state = { fw: 'laravel', ver: 'bad' };
  const render = () => {
    for (const fw of Object.keys(FILES)) {
      for (const ver of ['bad', 'good']) {
        const show = fw === state.fw && ver === state.ver;
        document.getElementById(`code-${fw}-${ver}`).hidden = !show;
        document.getElementById(`out-${fw}-${ver}`).hidden = !show;
      }
    }
    document.getElementById('code-file').textContent = FILES[state.fw];
    document.querySelectorAll('[data-fw]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fw === state.fw)));
    document.querySelectorAll('[data-ver]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ver === state.ver)));
  };
  document.querySelectorAll('[data-fw]').forEach((b) => b.addEventListener('click', () => { state.fw = b.dataset.fw; render(); }));
  document.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => { state.ver = b.dataset.ver; render(); }));
  render();

  // Copy buttons: success and failure are both shown, on the button and to screen readers.
  const status = document.getElementById('copy-status');
  document.querySelectorAll('.copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = btn.dataset.copy;
      let ok = false;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        ok = false;
      }
      btn.dataset.state = ok ? 'ok' : 'error';
      btn.textContent = ok ? 'Copied' : 'Failed';
      status.textContent = ok
        ? `Copied: ${text}`
        : `Could not copy automatically. Select the command and copy it: ${text}`;
      clearTimeout(btn._reset);
      btn._reset = setTimeout(() => {
        btn.textContent = 'Copy';
        delete btn.dataset.state;
      }, 2000);
    });
  });
})();
