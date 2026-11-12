"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const KEY = "quizApp.v2";
  const ADVANCE_MS = 2000;
  const LETTERS = ["A", "B", "C", "D", "E"];

  /* ---------- данные ---------- */
  const ALL = TOPICS.flatMap((t, ti) =>
    t.questions.map((q, qi) => ({ ...q, id: `${ti}-${qi}`, ti, topic: t.title }))
  );
  const BY_ID = new Map(ALL.map(q => [q.id, q]));

  const ICONS = ["🌐", "🖥️", "⚙️", "🧩"];
  const COLORS = ["#38bdf8", "#a78bfa", "#fbbf24", "#34d399"];
  const MODES = [
    ...TOPICS.map((t, i) => ({ key: "t" + i, title: t.title, icon: ICONS[i] || "📘", color: COLORS[i] || "#6c8cff" })),
    { key: "all", title: "Все тесты", icon: "📚", color: "#6c8cff", accent: true },
    { key: "mistakes", title: "Работа над ошибками", icon: "🎯", color: "#f87171", mistake: true }
  ];
  const MODE = Object.fromEntries(MODES.map(m => [m.key, m]));

  /* ---------- хранилище ---------- */
  function load() {
    const s = { mistakes: [], best: {}, sessions: {}, shuffleQ: false, qstats: {}, history: [], known: [], testsDone: 0 };
    try { Object.assign(s, JSON.parse(localStorage.getItem(KEY))); } catch {}
    if (!s.migrated) {
      try {
        const old = JSON.parse(localStorage.getItem("quizMistakes"));
        if (Array.isArray(old)) s.mistakes = [...new Set([...s.mistakes, ...old])];
      } catch {}
      s.migrated = true;
    }
    s.mistakes = s.mistakes.filter(id => BY_ID.has(id));
    s.known = s.known.filter(id => BY_ID.has(id));
    return s;
  }
  const store = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch {} };

  /* ---------- утилиты ---------- */
  const shuffle = a => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const plural = n => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return "вопрос";
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "вопроса";
    return "вопросов";
  };
  const idsFor = key =>
    key === "all" ? ALL.map(q => q.id)
    : key === "mistakes" ? store.mistakes.slice()
    : ALL.filter(q => q.ti === +key.slice(1)).map(q => q.id);

  /* ---------- элементы ---------- */
  const screens = { home: $("homeScreen"), quiz: $("quizScreen"), result: $("resultScreen"), stats: $("statsScreen"), flash: $("flashScreen") };
  const menu = $("menu"), numbers = $("numbers"), opts = $("options"), timerEl = $("timer");
  timerEl.style.setProperty("--ms", ADVANCE_MS + "ms");

  /* ---------- состояние ---------- */
  let S = null;          // текущая сессия {mode, ids, perm, picks, cur}
  let timer = null;

  const isRight = id => {
    const p = S.picks[id];
    return p !== undefined && S.perm[id][p] === BY_ID.get(id).a;
  };
  const correctCount = () => S.ids.reduce((n, id) => n + (isRight(id) ? 1 : 0), 0);
  const answeredCount = () => Object.keys(S.picks).length;
  const persist = () => { if (S.mode !== "mistakes") store.sessions[S.mode] = S; save(); };

  /* ---------- экраны / история ---------- */
  function show(name) {
    Object.entries(screens).forEach(([k, el]) => el.classList.toggle("active", k === name));
    window.scrollTo(0, 0);
    if (name === "home") updateHome();
  }
  function push(name) {
    try {
      if (history.state && history.state.v) history.replaceState({ v: name }, "");
      else history.pushState({ v: name }, "");
    } catch {}
    show(name);
  }
  function goHome() {
    clearTimeout(timer);
    if (history.state && history.state.v) history.back();
    else show("home");
  }
  window.addEventListener("popstate", () => { clearTimeout(timer); show("home"); });

  /* ---------- главный экран ---------- */
  function buildMenu() {
    menu.innerHTML = "";
    MODES.forEach(m => {
      const row = document.createElement("div");
      row.className = "menu-item";
      row.innerHTML = `
        <button class="menu-btn${m.accent ? " accent" : ""}${m.mistake ? " mistake" : ""}" data-mode="${m.key}" style="--c:${m.color}">
          <span class="menu-icon">${m.icon}</span>
          <span class="menu-text"><strong>${m.title}</strong><small></small></span>
          <span class="arrow">→</span>
          <span class="mini"><i></i></span>
        </button>
        <button class="reset-btn" data-reset="${m.key}" aria-label="Начать заново" hidden>↻</button>`;
      menu.appendChild(row);
    });
  }

  function updateHome() {
    updateTools();
    menu.querySelectorAll("[data-mode]").forEach(btn => {
      const key = btn.dataset.mode;
      const sub = btn.querySelector("small");
      const bar = btn.querySelector(".mini i");
      const reset = menu.querySelector(`[data-reset="${key}"]`);
      if (key === "mistakes") {
        const n = store.mistakes.length;
        btn.disabled = n === 0;
        sub.textContent = n ? `${n} ${plural(n)} для повторения` : "Пока нет ошибок";
        bar.style.width = "0";
        reset.hidden = true;
        return;
      }
      const total = idsFor(key).length;
      const s = store.sessions[key];
      const done = s ? Object.keys(s.picks).length : 0;
      const best = store.best[key];
      sub.textContent = done ? `Продолжить · ${done} / ${total}`
        : best ? `${total} ${plural(total)} · лучший ${best.c} / ${best.t}`
        : `${total} ${plural(total)}`;
      bar.style.width = (done / total * 100) + "%";
      reset.hidden = !done;
    });
  }

  /* ---------- запуск теста ---------- */
  function validSession(s) {
    return s && Array.isArray(s.ids) && s.ids.length &&
      s.ids.every(id => BY_ID.has(id) && s.perm && s.perm[id] && s.perm[id].length === BY_ID.get(id).o.length);
  }
  function newSession(mode) {
    let ids = idsFor(mode);
    if (!ids.length) return null;
    if (store.shuffleQ || mode === "mistakes") shuffle(ids);
    const perm = {};
    ids.forEach(id => { perm[id] = shuffle(BY_ID.get(id).o.map((_, i) => i)); });
    return { mode, ids, perm, picks: {}, cur: 0 };
  }
  function start(mode, fresh = false) {
    let s = !fresh && mode !== "mistakes" ? store.sessions[mode] : null;
    if (!validSession(s)) s = newSession(mode);
    if (!s) { goHome(); return; }
    S = s;
    persist();
    $("quizTitle").textContent = MODE[mode].title;
    buildNumbers();
    render();
    push("quiz");
  }

  /* ---------- экран теста ---------- */
  function buildNumbers() {
    numbers.innerHTML = "";
    S.ids.forEach((_, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "num-btn";
      b.textContent = i + 1;
      b.addEventListener("click", () => go(i));
      numbers.appendChild(b);
    });
  }

  function updateNumbers() {
    [...numbers.children].forEach((b, i) => {
      const id = S.ids[i];
      b.classList.toggle("current", i === S.cur);
      b.classList.toggle("correct", S.picks[id] !== undefined && isRight(id));
      b.classList.toggle("wrong", S.picks[id] !== undefined && !isRight(id));
    });
    const b = numbers.children[S.cur];
    if (b) numbers.scrollTo({ left: b.offsetLeft - numbers.clientWidth / 2 + b.offsetWidth / 2, behavior: "smooth" });
  }

  function updateHeader() {
    const total = S.ids.length;
    $("quizProgress").textContent = `Вопрос ${S.cur + 1} из ${total} · отвечено ${answeredCount()}`;
    $("scoreChip").textContent = `${correctCount()} / ${total}`;
    $("progressBar").style.width = (answeredCount() / total * 100) + "%";
  }

  function stopBar() { timerEl.classList.remove("run"); }
  function startBar() {
    timerEl.classList.remove("run");
    void timerEl.offsetWidth;
    timerEl.classList.add("run");
  }

  function paint(q, pickDi) {
    const id = q.id;
    [...opts.children].forEach((b, di) => {
      const ok = S.perm[id][di] === q.a;
      b.disabled = true;
      b.classList.add(ok ? "correct" : "wrong");
      const mark = b.querySelector(".mark");
      if (di === pickDi) {
        b.classList.add("picked");
        mark.textContent = ok ? "✓" : "✕";
      } else if (ok) {
        mark.textContent = "✓";
      }
    });
  }

  function render() {
    clearTimeout(timer);
    stopBar();
    const id = S.ids[S.cur];
    const q = BY_ID.get(id);
    $("topicTag").textContent = q.topic;
    $("questionText").textContent = q.q;
    opts.innerHTML = "";
    S.perm[id].forEach((orig, di) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "option";
      const letter = document.createElement("span");
      letter.className = "letter";
      letter.textContent = LETTERS[di];
      const text = document.createElement("span");
      text.className = "text";
      text.textContent = q.o[orig];
      const mark = document.createElement("span");
      mark.className = "mark";
      b.append(letter, text, mark);
      b.addEventListener("click", () => answer(di));
      opts.appendChild(b);
    });
    if (S.picks[id] !== undefined) paint(q, S.picks[id]);
    updateHeader();
    updateNumbers();
  }

  function go(i) {
    S.cur = (i + S.ids.length) % S.ids.length;
    persist();
    render();
  }

  function answer(di) {
    const id = S.ids[S.cur];
    if (S.picks[id] !== undefined) return;
    const q = BY_ID.get(id);
    S.picks[id] = di;
    const ok = S.perm[id][di] === q.a;
    const st = store.qstats[id] || (store.qstats[id] = { r: 0, w: 0 });
    if (ok) st.r++; else st.w++;
    if (ok) {
      store.mistakes = store.mistakes.filter(x => x !== id);
    } else {
      if (!store.mistakes.includes(id)) store.mistakes.push(id);
      if (navigator.vibrate) navigator.vibrate(30);
    }
    persist();
    paint(q, di);
    updateHeader();
    updateNumbers();
    startBar();
    const from = S.cur;
    timer = setTimeout(() => next(from), ADVANCE_MS);
  }

  // следующий неотвеченный вопрос по кругу; если таких нет — завершаем тест
  function next(from) {
    const n = S.ids.length;
    for (let k = 1; k <= n; k++) {
      const i = (from + k) % n;
      if (S.picks[S.ids[i]] === undefined) { go(i); return; }
    }
    finish();
  }

  /* ---------- результат ---------- */
  function finish() {
    clearTimeout(timer);
    const total = S.ids.length;
    const c = correctCount();
    const pct = Math.round(c / total * 100);
    if (S.mode !== "mistakes") {
      const b = store.best[S.mode];
      if (!b || c / total > b.c / b.t) store.best[S.mode] = { c, t: total };
      delete store.sessions[S.mode];
    }
    store.history.push({ m: S.mode, c, t: total, d: Date.now() });
    store.history = store.history.slice(-50);
    store.testsDone++;
    save();

    $("resultIcon").textContent = pct >= 80 ? "🎉" : pct >= 50 ? "👍" : "💪";
    $("resultTitle").textContent = "Тест завершён";
    $("resultScore").textContent = `${c} из ${total}`;
    $("resultText").textContent =
      pct === 100 ? "Идеально! Все ответы правильные."
      : pct >= 80 ? "Отличный результат!"
      : pct >= 50 ? "Хороший результат, но есть что повторить."
      : "Стоит повторить материал и пройти тест снова.";

    const n = store.mistakes.length;
    const mb = $("mistakesResultBtn");
    mb.disabled = n === 0;
    mb.textContent = n ? `🎯 Работа над ошибками (${n})` : "🎯 Ошибок нет";

    const ring = $("ringFg");
    const C = 2 * Math.PI * 52;
    ring.style.strokeDasharray = C;
    ring.style.strokeDashoffset = C;
    push("result");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      ring.style.strokeDashoffset = C * (1 - pct / 100);
    }));
  }

  /* ---------- статистика и флэш-карточки ---------- */
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function totals() {
    let r = 0, w = 0;
    Object.values(store.qstats).forEach(x => { r += x.r; w += x.w; });
    return { r, w, n: r + w, acc: r + w ? Math.round(r / (r + w) * 100) : 0 };
  }

  function updateTools() {
    const t = totals();
    $("flashSub").textContent = `выучено ${store.known.length} / ${ALL.length}`;
    $("statsSub").textContent = t.n ? `точность ${t.acc}%` : "пока пусто";
  }

  function renderStats() {
    const t = totals();
    const qs = store.qstats;

    const topics = TOPICS.map((tp, ti) => {
      let r = 0, w = 0;
      tp.questions.forEach((_, qi) => { const x = qs[`${ti}-${qi}`]; if (x) { r += x.r; w += x.w; } });
      const p = r + w ? Math.round(r / (r + w) * 100) : 0;
      return `<div class="st-row">
        <div class="st-top"><span>${ICONS[ti] || "📘"} ${esc(tp.title)}</span><b>${r + w ? p + "%" : "—"}</b></div>
        <div class="st-bar"><i style="width:${p}%;background:${COLORS[ti] || "#6c8cff"}"></i></div>
      </div>`;
    }).join("");

    const worst = Object.entries(qs)
      .filter(([id, x]) => x.w > 0 && BY_ID.has(id))
      .sort((a, b) => b[1].w - a[1].w)
      .slice(0, 5)
      .map(([id, x]) => `<div class="st-item"><span>${esc(BY_ID.get(id).q)}</span><b class="cnt">×${x.w}</b></div>`)
      .join("");

    const last = store.history.slice(-5).reverse().map(h => {
      const m = MODE[h.m];
      const date = new Date(h.d).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
      return `<div class="st-item">
        <span>${esc(m ? m.title : h.m)}<br><small class="st-date">${date}</small></span>
        <b>${h.c} / ${h.t} · ${Math.round(h.c / h.t * 100)}%</b>
      </div>`;
    }).join("");

    $("statsBody").innerHTML = `
      <div class="st-cards">
        <div class="st-card"><b>${t.n}</b><span>ответов</span></div>
        <div class="st-card"><b>${t.n ? t.acc + "%" : "—"}</b><span>точность</span></div>
        <div class="st-card"><b>${store.testsDone}</b><span>тестов</span></div>
      </div>
      <div class="st-block"><h3>По темам</h3>${topics}</div>
      <div class="st-block"><h3>Чаще всего ошибки</h3>${worst || '<p class="st-empty">Ошибок пока нет</p>'}</div>
      <div class="st-block"><h3>Последние тесты</h3>${last || '<p class="st-empty">Пока нет пройденных тестов</p>'}</div>
      <button class="secondary-btn" id="statsReset">Сбросить статистику</button>`;
  }

  $("statsBody").addEventListener("click", e => {
    if (e.target.id !== "statsReset") return;
    if (!confirm("Сбросить всю статистику и лучшие результаты?")) return;
    store.qstats = {}; store.history = []; store.testsDone = 0; store.best = {};
    save();
    renderStats();
  });
  $("statsBtn").addEventListener("click", () => { renderStats(); push("stats"); });

  /* флэш-карточки */
  const F = { scope: "all", queue: [], total: 0 };
  const flashIds = scope =>
    scope === "mistakes" ? store.mistakes.slice()
    : scope === "all" ? ALL.map(q => q.id)
    : ALL.filter(q => q.ti === +scope.slice(1)).map(q => q.id);

  function flashChips() {
    const items = [
      { k: "all", t: "Все" },
      ...TOPICS.map((tp, i) => ({ k: "t" + i, t: (ICONS[i] || "📘") + " " + tp.title })),
      { k: "mistakes", t: `🎯 Ошибки (${store.mistakes.length})` }
    ];
    $("flashChips").innerHTML = items
      .map(i => `<button class="chip${i.k === F.scope ? " active" : ""}" data-k="${i.k}">${esc(i.t)}</button>`)
      .join("");
  }

  function flashStart(scope) {
    F.scope = scope;
    const ids = flashIds(scope);
    F.total = ids.length;
    F.queue = shuffle(scope === "mistakes" ? ids : ids.filter(id => !store.known.includes(id)));
    flashChips();
    flashRender();
  }

  function flashRender() {
    const done = F.total - F.queue.length;
    const empty = F.queue.length === 0;
    $("flashChip").textContent = `${done} / ${F.total}`;
    $("flashBar").style.width = (F.total ? done / F.total * 100 : 0) + "%";
    $("flashInfo").textContent = empty ? "" : `Осталось ${F.queue.length}`;
    $("flip").hidden = empty;
    $("flashActions").hidden = empty;
    $("flashDone").hidden = !empty;
    if (empty) {
      $("flashDoneText").textContent = F.total ? "Все карточки выучены!" : "В этой колоде пока нет карточек";
      $("flashReset").hidden = !F.total;
      return;
    }
    const q = BY_ID.get(F.queue[0]);
    const inner = $("flipInner");
    inner.classList.add("noanim");
    inner.classList.remove("flipped");
    void inner.offsetWidth;
    inner.classList.remove("noanim");
    $("flashQ").textContent = q.q;
    $("flashA").textContent = q.o[q.a];
  }

  $("flashBtn").addEventListener("click", () => { flashStart(F.scope); push("flash"); });
  $("flashChips").addEventListener("click", e => {
    const b = e.target.closest("[data-k]");
    if (b) flashStart(b.dataset.k);
  });
  $("flip").addEventListener("click", () => $("flipInner").classList.toggle("flipped"));
  $("knowBtn").addEventListener("click", () => {
    const id = F.queue.shift();
    if (id && !store.known.includes(id)) store.known.push(id);
    save();
    flashRender();
  });
  $("againBtn").addEventListener("click", () => {
    if (F.queue.length) F.queue.push(F.queue.shift());
    flashRender();
  });
  $("flashReset").addEventListener("click", () => {
    const ids = new Set(flashIds(F.scope));
    store.known = store.known.filter(id => !ids.has(id));
    save();
    flashStart(F.scope);
  });
  document.querySelectorAll("[data-home]").forEach(b => b.addEventListener("click", goHome));
  document.addEventListener("keydown", e => {
    if (!screens.flash.classList.contains("active") || F.queue.length === 0) return;
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); $("flip").click(); }
    else if (e.key === "ArrowRight") $("knowBtn").click();
    else if (e.key === "ArrowLeft") $("againBtn").click();
  });

  /* ---------- события ---------- */
  menu.addEventListener("click", e => {
    const reset = e.target.closest("[data-reset]");
    if (reset) {
      if (confirm("Начать этот тест заново? Текущий прогресс будет сброшен.")) start(reset.dataset.reset, true);
      return;
    }
    const btn = e.target.closest("[data-mode]");
    if (btn && !btn.disabled) start(btn.dataset.mode);
  });

  $("shuffleQ").checked = !!store.shuffleQ;
  $("shuffleQ").addEventListener("change", e => { store.shuffleQ = e.target.checked; save(); });

  $("backBtn").addEventListener("click", goHome);
  $("homeBtn").addEventListener("click", goHome);
  $("prevBtn").addEventListener("click", () => go(S.cur - 1));
  $("nextBtn").addEventListener("click", () => go(S.cur + 1));
  $("mistakesResultBtn").addEventListener("click", () => start("mistakes", true));
  $("retryBtn").addEventListener("click", () => start(S.mode, true));

  document.addEventListener("keydown", e => {
    if (!screens.quiz.classList.contains("active")) return;
    if (e.key === "ArrowRight") return go(S.cur + 1);
    if (e.key === "ArrowLeft") return go(S.cur - 1);
    const d = /^[1-5]$/.test(e.key) ? +e.key - 1 : LETTERS.indexOf(e.key.toUpperCase());
    if (d >= 0 && opts.children[d]) opts.children[d].click();
  });

  // свайп влево/вправо — переход между вопросами
  let tx = 0, ty = 0;
  const card = $("card");
  card.addEventListener("touchstart", e => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
  card.addEventListener("touchend", e => {
    const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) go(S.cur + (dx < 0 ? 1 : -1));
  }, { passive: true });

  /* ---------- старт ---------- */
  buildMenu();
  updateHome();

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();