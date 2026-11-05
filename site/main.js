(() => {
  // ---------------------------------------------------------------- Theme toggle
  // Follows the system until the visitor picks one; the choice is remembered when storage allows.
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

  // ---------------------------------------------------------------- Demo
  const DATA = window.NOBYPASS_DEMO || [];
  const LANG_LABEL = { php: 'PHP', ts: 'TypeScript', js: 'JavaScript', py: 'Python', java: 'Java' };
  const KEYWORDS = {
    php: 'namespace use class extends implements public private protected readonly function return new static self fn try catch throw if else foreach as array null true false',
    ts: 'import export from class extends implements public private protected readonly constructor return new async await const let function if else try catch throw type interface default null true false',
    js: 'import export from class extends return new async await const let function if else try catch throw default null true false',
    py: 'from import def class return with as try except raise if else elif for in not and or is None True False lambda pass async await',
    java: 'package import public private protected final class interface extends implements return new static void try catch throw if else null true false',
  };

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // A small single-line highlighter: comments, strings, annotations/attributes and keywords.
  // Its only purpose is readability of the fixture code (see DESIGN.md).
  const tokenizers = {};
  const tokenizer = (lang) => {
    if (tokenizers[lang]) return tokenizers[lang];
    const comment = lang === 'py' ? '#.*$' : lang === 'php' ? '\\/\\/.*$|#(?!\\[).*$|\\/\\*.*?\\*\\/' : '\\/\\/.*$|\\/\\*.*?\\*\\/';
    const strings = `'(?:\\\\.|[^'\\\\])*'|"(?:\\\\.|[^"\\\\])*"${lang === 'ts' || lang === 'js' ? '|`(?:\\\\.|[^`\\\\])*`' : ''}`;
    const annotation = lang === 'php' ? '#\\[[^\\]]*\\]' : '@[A-Za-z_][\\w.]*';
    const kw = `\\b(?:${KEYWORDS[lang].split(' ').join('|')})\\b`;
    tokenizers[lang] = new RegExp(`(?<c>${comment})|(?<s>${strings})|(?<a>${annotation})|(?<k>${kw})`, 'g');
    return tokenizers[lang];
  };
  const highlight = (line, lang) => {
    const re = tokenizer(lang);
    re.lastIndex = 0;
    let out = '';
    let last = 0;
    for (const m of line.matchAll(re)) {
      out += esc(line.slice(last, m.index));
      const cls = m.groups.c ? 'tk-c' : m.groups.s ? 'tk-s' : m.groups.a ? 'tk-a' : 'tk-k';
      out += `<span class="${cls}">${esc(m[0])}</span>`;
      last = m.index + m[0].length;
    }
    return out + esc(line.slice(last));
  };

  const tabs = document.getElementById('stack-tabs');
  const panel = document.getElementById('demo-panel');
  const codeView = document.getElementById('code-view');
  const reportView = document.getElementById('report-view');
  const verdict = document.getElementById('demo-verdict');
  const state = { stack: DATA[0] && DATA[0].id, ver: 'bad' };

  if (!DATA.length || !tabs) return wireCopy();

  DATA.forEach((d, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = `stack-tab-${d.id}`;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', 'demo-panel');
    b.dataset.stack = d.id;
    b.innerHTML = `${esc(d.label)}<span class="tab-lang">${LANG_LABEL[d.lang]}</span>`;
    b.tabIndex = i === 0 ? 0 : -1;
    tabs.appendChild(b);
  });
  const tabButtons = [...tabs.querySelectorAll('[role="tab"]')];

  const focusLine = (n) => {
    const el = codeView.querySelector(`[data-line="${n}"]`);
    if (!el) return;
    codeView.scrollTop = Math.max(0, el.offsetTop - codeView.clientHeight / 3);
    codeView.querySelectorAll('.ln.focus').forEach((x) => x.classList.remove('focus'));
    el.classList.add('focus');
  };

  const render = () => {
    const d = DATA.find((x) => x.id === state.stack);
    const v = d[state.ver];
    tabButtons.forEach((b) => {
      const on = b.dataset.stack === d.id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', `stack-tab-${d.id}`);
    document.querySelectorAll('[data-ver]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ver === state.ver)));

    document.getElementById('code-file').textContent = d.file;
    document.getElementById('code-lang').textContent = LANG_LABEL[d.lang];

    const byLine = new Map();
    v.findings.forEach((f) => byLine.set(f.line, [...(byLine.get(f.line) || []), f.rule]));
    codeView.querySelector('code').innerHTML = v.code
      .split('\n')
      .map((text, i) => {
        const n = i + 1;
        const rules = byLine.get(n);
        const tag = rules ? `<span class="flag-tag">${rules.join(' ')}</span>` : '';
        return `<span class="ln${rules ? ' flag' : ''}" data-line="${n}"><span class="n" aria-hidden="true">${n}</span><span class="t">${highlight(text, d.lang) || ' '}</span>${tag}</span>`;
      })
      .join('');
    codeView.scrollTop = 0;

    const s = v.summary;
    const parts = [];
    if (!v.findings.length && !v.others.length) {
      parts.push(`<p class="r-pass">✔ PASS: no new blocking architecture violations</p>`);
    }
    v.findings.forEach((f) => {
      parts.push(
        `<button type="button" class="finding" data-jump="${f.line}">` +
          `<span class="f-head"><span class="${f.severity === 'error' ? 'r-err' : 'r-warn'}">${f.severity === 'error' ? '✖' : '⚠'} ${f.rule} ${f.severity}</span><span class="r-loc">line ${f.line}</span></span>` +
          `<span class="f-body">${esc(f.evidence)}</span>` +
          `<span class="f-meta"><span class="r-dim">expected:</span> ${esc(f.expected)}</span>` +
          `<span class="f-meta"><span class="r-dim">fix:</span> ${esc(f.fix)}</span>` +
        `</button>`,
      );
    });
    if (v.others.length) {
      parts.push(
        `<div class="others"><p class="r-dim">Also in this fixture:</p><ul>${v.others
          .map((o) => `<li><span class="${o.severity === 'error' ? 'r-err' : 'r-warn'}">${o.rule}</span> ${esc(o.file)}${o.line ? `:${o.line}` : ''}</li>`)
          .join('')}</ul></div>`,
      );
    }
    parts.push(
      `<p class="r-sum">${s.files} files analyzed · ${s.errors} new error${s.errors === 1 ? '' : 's'} · ${s.warnings} new warning${s.warnings === 1 ? '' : 's'}</p>` +
        (s.blocking ? `<p class="r-err r-final">✖ FAIL: ${s.blocking} blocking finding${s.blocking === 1 ? '' : 's'}</p>` : `<p class="r-pass r-final">✔ PASS · exit code 0</p>`),
    );
    reportView.innerHTML = parts.join('');
    reportView.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => focusLine(b.dataset.jump)));

    verdict.className = `demo-verdict ${s.blocking ? 'is-fail' : 'is-pass'}`;
    verdict.textContent = s.blocking ? `${d.label}: FAIL, ${s.blocking} blocking` : `${d.label}: PASS`;
  };

  const select = (id, focus) => {
    state.stack = id;
    render();
    if (focus) document.getElementById(`stack-tab-${id}`).focus();
  };
  tabButtons.forEach((b) => b.addEventListener('click', () => select(b.dataset.stack, false)));
  tabs.addEventListener('keydown', (e) => {
    const i = tabButtons.findIndex((b) => b.dataset.stack === state.stack);
    let next = null;
    if (e.key === 'ArrowRight') next = (i + 1) % tabButtons.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabButtons.length) % tabButtons.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabButtons.length - 1;
    if (next === null) return;
    e.preventDefault();
    select(tabButtons[next].dataset.stack, true);
  });
  document.querySelectorAll('[data-ver]').forEach((b) =>
    b.addEventListener('click', () => {
      state.ver = b.dataset.ver;
      render();
    }),
  );
  render();
  wireCopy();

  // ---------------------------------------------------------------- Copy buttons
  // Success and failure are both shown, on the button and to screen readers.
  function wireCopy() {
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
        status.textContent = ok ? `Copied: ${text}` : `Could not copy automatically. Select the command and copy it: ${text}`;
        clearTimeout(btn._reset);
        btn._reset = setTimeout(() => {
          btn.textContent = 'Copy';
          delete btn.dataset.state;
        }, 2000);
      });
    });
  }
})();
