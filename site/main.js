(() => {
  const FILES = {
    laravel: 'app/Http/Controllers/UserController.php',
    nestjs: 'src/users/users.controller.ts',
  };
  const state = { fw: 'laravel', ver: 'bad' };

  function render() {
    for (const fw of ['laravel', 'nestjs']) {
      for (const ver of ['bad', 'good']) {
        const show = fw === state.fw && ver === state.ver;
        document.getElementById(`code-${fw}-${ver}`).hidden = !show;
        document.getElementById(`out-${fw}-${ver}`).hidden = !show;
      }
    }
    document.getElementById('code-file').textContent = FILES[state.fw];
    document.querySelectorAll('[data-fw]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.fw === state.fw)));
    document.querySelectorAll('[data-ver]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.ver === state.ver)));
  }

  document.querySelectorAll('[data-fw]').forEach((b) =>
    b.addEventListener('click', () => {
      state.fw = b.dataset.fw;
      render();
    }),
  );
  document.querySelectorAll('[data-ver]').forEach((b) =>
    b.addEventListener('click', () => {
      state.ver = b.dataset.ver;
      render();
    }),
  );

  document.querySelectorAll('.copy').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const text = btn.dataset.copy;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const t = document.createElement('textarea');
        t.value = text;
        document.body.appendChild(t);
        t.select();
        document.execCommand('copy');
        t.remove();
      }
      const label = btn.textContent;
      btn.textContent = 'Copied';
      btn.classList.add('done');
      setTimeout(() => {
        btn.textContent = label;
        btn.classList.remove('done');
      }, 1400);
    }),
  );

  render();
})();
