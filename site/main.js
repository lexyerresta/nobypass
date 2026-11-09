(() => {
  const root = document.documentElement;
  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motionOK = () => !reduceQuery.matches;
  reduceQuery.addEventListener('change', () => root.classList.toggle('motion', motionOK()));

  // ---------------------------------------------------------------- Theme toggle
  // Follows the system until the visitor picks one; the choice is remembered when storage allows.
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

  // Runs fn once, the first time el is mostly on screen.
  const onceVisible = (el, fn, threshold = 0.35) => {
    if (!el) return;
    if (!('IntersectionObserver' in window)) return fn();
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        fn();
      }
    }, { threshold });
    io.observe(el);
  };

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ---------------------------------------------------------------- Hero: the building
  // The elevator carries GET /users down floor by floor; then User::where() takes the chute and is
  // stopped at the barrier. It plays once when the hero is first seen (about 4.5 s) and on each press.
  const flow = document.getElementById('flow');
  if (flow) {
    const svg = flow.querySelector('svg');
    const slabs = [...svg.querySelectorAll('.slab')];
    const car = svg.querySelector('.car');
    const parcel = svg.querySelector('.parcel');
    const pktBad = svg.querySelector('.pkt-bad');
    const reveal = svg.querySelector('#bypass-reveal');
    const status = document.getElementById('flow-status');
    const revealLen = reveal.getTotalLength();
    const ROOF = 34;
    const STOPS = [134, 240, 346, 452]; // the car's top edge on each floor
    const HUES = ['--l-ctrl', '--l-svc', '--l-repo', '--l-data'];
    const MSG = {
      ok: 'The request rode down controller, service, repository, model, one floor at a time. Every step is a dependency the contract allows, so nothing is reported.',
      bypass: '<code>User::where()</code> in the controller takes the chute straight to the model and skips two floors. NoBypass reports BND002 and the pull request fails.',
    };
    let run = 0;

    const setReveal = (p) => {
      reveal.style.strokeDasharray = `${revealLen}`;
      reveal.style.strokeDashoffset = `${revealLen * (1 - p)}`;
    };
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
    // Animates t from 0 to 1 over ms; resolves false if a newer run started meanwhile.
    const tween = (ms, onStep) =>
      new Promise((resolve) => {
        const id = run;
        let start = null;
        const frame = (now) => {
          if (id !== run) return resolve(false);
          if (start === null) start = now;
          const t = Math.min(1, (now - start) / ms);
          onStep(ease(t));
          if (t < 1) requestAnimationFrame(frame);
          else resolve(true);
        };
        requestAnimationFrame(frame);
      });
    const wait = (ms) => {
      const id = run;
      return new Promise((r) => setTimeout(() => r(id === run), ms));
    };
    const carAt = (y) => car.setAttribute('transform', `translate(0 ${y.toFixed(1)})`);
    const light = (i) => {
      slabs[i].classList.add('is-lit');
      parcel.style.fill = `var(${HUES[i]})`;
    };
    // Moves along a polyline of [x, y] points.
    const slide = (el, pts, ms, onStep) => {
      const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
      const total = lens.reduce((a, b) => a + b, 0);
      return tween(ms, (p) => {
        let d = p * total;
        let i = 0;
        while (i < lens.length - 1 && d > lens[i]) d -= lens[i++];
        const f = lens[i] ? Math.min(1, d / lens[i]) : 1;
        el.setAttribute('cx', (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f).toFixed(1));
        el.setAttribute('cy', (pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f).toFixed(1));
        onStep(p);
      });
    };

    const clearOk = () => {
      slabs.forEach((s) => s.classList.remove('is-lit'));
      parcel.style.fill = '';
    };
    const reset = () => {
      clearOk();
      carAt(ROOF);
      pktBad.classList.remove('is-on', 'is-shake');
      flow.classList.remove('is-stamped');
      flow.classList.add('is-idle');
      setReveal(0);
    };
    // The end state of each run, shown at once when motion is reduced.
    const showOk = () => {
      slabs.forEach((s, i) => light(i));
      carAt(STOPS[3]);
    };
    const showBypass = () => {
      setReveal(1);
      flow.classList.remove('is-idle');
      flow.classList.add('is-stamped');
    };

    const playOk = async () => {
      let from = ROOF;
      for (let i = 0; i < STOPS.length; i += 1) {
        const to = STOPS[i];
        const start = from;
        if (!(await tween(i === 0 ? 520 : 420, (p) => carAt(start + (to - start) * p)))) return false;
        light(i);
        if (!(await wait(230))) return false;
        from = to;
      }
      return true;
    };
    const playBypass = async () => {
      pktBad.classList.add('is-on');
      flow.classList.remove('is-idle');
      const ok = await slide(pktBad, [[360, 140], [390, 140], [390, 450], [383, 450]], 1200, setReveal);
      if (!ok) return false;
      flow.classList.add('is-stamped');
      pktBad.classList.add('is-shake');
      return true;
    };

    const start = async (kind, announce) => {
      run += 1;
      reset();
      if (announce) status.innerHTML = MSG[kind];
      if (!motionOK()) {
        if (kind === 'ok') showOk();
        else showBypass();
        return;
      }
      if (kind === 'ok') await playOk();
      else if (kind === 'bypass') await playBypass();
      else if (await playOk()) await playBypass();
    };

    flow.querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', () => start(b.dataset.run, true)));
    if (motionOK()) {
      reset();
      onceVisible(svg, () => setTimeout(() => start('both', false), 300), 0.4);
    }
  }

  // ---------------------------------------------------------------- Statement stamp
  const statement = document.querySelector('.statement');
  onceVisible(statement, () => statement.classList.add('is-in'), 0.6);

  // ---------------------------------------------------------------- Layer colours
  // Every layer name is coloured by its role, the same four hues as the diagram.
  const ROLE = {
    controller: 'ctrl', route: 'ctrl', router: 'ctrl', view: 'ctrl', ui: 'ctrl',
    service: 'svc', dal: 'svc',
    repository: 'repo',
    model: 'data', entity: 'data', persistence: 'data',
  };
  const LAYER_RE = new RegExp(`\\b(${Object.keys(ROLE).join('|')})\\b`, 'g');
  const paint = (escaped) => escaped.replace(LAYER_RE, (m) => `<span class="ly ly-${ROLE[m]}">${m}</span>`);
  const chip = (name) => (ROLE[name] ? `<span class="chip ly-${ROLE[name]}">${name}</span>` : `<span class="chip chip-q">${esc(name)}</span>`);
  // "controller depends directly on model: X" or "controller performs data access: X"
  const edgeOf = (evidence) => {
    let m = /^(\w+) depends directly on (\w+)/.exec(evidence);
    if (m) return [m[1], m[2]];
    m = /^(\w+) performs data access/.exec(evidence);
    return m ? [m[1], 'data access'] : null;
  };
  // Paints only the part before the symbol, so file paths such as users.repository.ts stay plain.
  const paintEvidence = (evidence) => {
    const cut = evidence.indexOf(': ');
    if (cut < 0) return paint(esc(evidence));
    return paint(esc(evidence.slice(0, cut))) + esc(evidence.slice(cut));
  };

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
  const state = { stack: DATA[0] && DATA[0].id, ver: 'bad', seen: false };

  if (DATA.length && tabs) {
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
      const animate = state.seen && motionOK();
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
      const lines = v.code.split('\n');
      // The scan takes at most about 0.7 s, whatever the file length.
      const step = Math.min(14, Math.round(700 / lines.length));
      codeView.style.setProperty('--step', `${step}ms`);
      codeView.classList.toggle('scan', animate);
      codeView.querySelector('code').innerHTML = lines
        .map((text, i) => {
          const n = i + 1;
          const rules = byLine.get(n);
          const tag = rules ? `<span class="flag-tag">${rules.join(' ')}</span>` : '';
          return `<span class="ln${rules ? ' flag' : ''}" data-line="${n}" style="--i:${i}"><span class="n" aria-hidden="true">${n}</span><span class="t">${highlight(text, d.lang) || ' '}</span>${tag}</span>`;
        })
        .join('');
      codeView.scrollTop = 0;

      const s = v.summary;
      const parts = [];
      if (!v.findings.length && !v.others.length) {
        parts.push(`<p class="r-pass">✔ PASS: no new blocking architecture violations</p>`);
      }
      v.findings.forEach((f) => {
        const edge = edgeOf(f.evidence);
        parts.push(
          `<button type="button" class="finding" data-jump="${f.line}">` +
            `<span class="f-head"><span class="${f.severity === 'error' ? 'r-err' : 'r-warn'}">${f.severity === 'error' ? '✖' : '⚠'} ${f.rule} ${f.severity}</span><span class="r-loc">line ${f.line}</span></span>` +
            (edge ? `<span class="f-edge">${chip(edge[0])}<span class="arrow" aria-label="reaches">→</span>${chip(edge[1])}</span>` : '') +
            `<span class="f-body">${paintEvidence(f.evidence)}</span>` +
            `<span class="f-meta"><span class="r-dim">expected:</span> ${paint(esc(f.expected))}</span>` +
            `<span class="f-meta"><span class="r-dim">fix:</span> ${paint(esc(f.fix))}</span>` +
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
      reportView.classList.toggle('scan', animate);
      reportView.style.setProperty('--base', `${Math.min(700, step * lines.length) * 0.6}ms`);
      [...reportView.children].forEach((el, k) => el.style.setProperty('--k', k));
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
    // The first scan runs when the panes come into view, so the reader sees it happen.
    onceVisible(panel, () => {
      state.seen = true;
      if (motionOK()) render();
    }, 0.25);
  }

  // ---------------------------------------------------------------- Contract explorer
  // Mirrors the excerpt of .nobypass.yml on the page: allowed_direct and direct_orm_access.
  // Verdicts follow src/core/rules.ts: skipping exactly one layer is BND003, any other
  // dependency outside allowed_direct is BND001, a query in a deny_in layer is BND002.
  const explorer = document.getElementById('explorer');
  if (explorer) {
    const ORDER = ['controller', 'service', 'repository', 'model'];
    const DENY_ORM = ['controller', 'service'];
    const rows = [...explorer.querySelectorAll('.ex-row')];
    const buttons = [...explorer.querySelectorAll('.ex-btn')];
    const out = document.getElementById('explorer-out');
    const yaml = [...document.querySelectorAll('#contract-yaml .yl')];
    const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}` : xs[0]);

    const verdictFor = (from, to) => {
      const i = ORDER.indexOf(from);
      const j = ORDER.indexOf(to);
      if (i === j) return ['selected', 'v-self'];
      if (j === i + 1) return ['✔ may depend on it directly', 'v-ok'];
      if (j === i + 2) return [`✖ BND003, skips ${ORDER[i + 1]}`, 'v-bad'];
      if (j > i) return ['✖ BND001, not allowed directly', 'v-bad'];
      return ['✖ BND001, depends upward', 'v-bad'];
    };
    const sentence = (from) => {
      const i = ORDER.indexOf(from);
      const next = ORDER[i + 1];
      const skip = ORDER[i + 2];
      const far = ORDER.slice(i + 3);
      const up = ORDER.slice(0, i);
      const parts = [next ? `${from} may depend directly on ${next} only.` : `${from} may depend on no other layer.`];
      if (skip) parts.push(`A dependency on ${skip} is BND003${far.length ? ` and one on ${list(far)} is BND001` : ''}.`);
      if (up.length) parts.push(`A dependency on ${list(up)} is BND001.`);
      if (DENY_ORM.includes(from)) parts.push('A query written here is BND002.');
      else if (from === 'repository') parts.push('Queries belong here.');
      return parts.join(' ');
    };
    const show = (layer, announce) => {
      rows.forEach((r) => {
        const [text, cls] = verdictFor(layer, r.dataset.layer);
        const v = r.querySelector('.ex-verdict');
        v.textContent = text;
        v.className = `ex-verdict ${cls}`;
      });
      yaml.forEach((y) => y.classList.toggle('is-on', y.dataset.layer === layer));
      if (announce !== false) out.textContent = sentence(layer);
    };
    let picked = 'controller';
    const pick = (layer) => {
      picked = layer;
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layer === layer)));
      show(layer);
    };
    buttons.forEach((b) => b.addEventListener('click', () => pick(b.dataset.layer)));
    // Pointing at a layer in the file previews it in the explorer; leaving restores the pick.
    yaml.forEach((y) => {
      y.addEventListener('mouseenter', () => show(y.dataset.layer, false));
      y.addEventListener('mouseleave', () => show(picked, false));
    });
    pick(picked);
  }

  // ---------------------------------------------------------------- Setup rail
  // The rail fills as the reader scrolls through the six steps; reached steps fill in.
  const cmds = document.querySelector('.cmds');
  if (cmds) {
    const items = [...cmds.children];
    let queued = false;
    const update = () => {
      queued = false;
      if (!motionOK()) {
        cmds.style.setProperty('--p', 1);
        items.forEach((li) => li.classList.add('is-reached'));
        return;
      }
      const line = window.innerHeight * 0.65;
      const r = cmds.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (line - r.top) / r.height));
      cmds.style.setProperty('--p', p.toFixed(3));
      items.forEach((li) => li.classList.toggle('is-reached', li.getBoundingClientRect().top + 16 < line));
    };
    const queue = () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(update);
      }
    };
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    reduceQuery.addEventListener('change', queue);
    update();
  }

  // ---------------------------------------------------------------- Copy buttons
  // Success and failure are both shown, on the button and to screen readers.
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
})();
