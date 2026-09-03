(function () {
  const data = window.UMA_DATA;
  const S = window.UmaSolver;
  const I = window.I18N;
  const t = I.t;
  const index = S.createIndex(data);
  const STORAGE_KEY = "updb-state-v1";
  const MAX_DECK = S.DECK_SIZE;
  const $ = (id) => document.getElementById(id);

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === "class") el.className = value;
        else if (key === "dataset") Object.assign(el.dataset, value);
        else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
        else if (key === "hidden") el.hidden = Boolean(value);
        else if (value === true) el.setAttribute(key, "");
        else el.setAttribute(key, value);
      }
    }
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  function defaultTypeMin() {
    const mins = {};
    for (const type of S.TYPES) mins[type] = 0;
    mins.speed = 1;
    return mins;
  }

  function defaultState() {
    return {
      lang: /^ru\b/i.test(navigator.language || "") ? "ru" : "en",
      targetId: 0,
      targetAwakening: 5,
      targetDeck: [],
      wanted: [],
      weightMode: "balanced",
      parentId: 0,
      parentAwakening: 5,
      typeMin: defaultTypeMin(),
      notOwned: [],
      notOwnedCharas: [],
      firstParentId: 0,
      grandparents: [],
      traineeScenario: "ura",
      parentScenario: "auto",
      fillDeck: false,
      preferHintOdds: false,
      preferHintLevel: false,
      limitBreaks: {},
      viewParentId: 0,
    };
  }

  function sanitize(raw) {
    const base = defaultState();
    const src = raw && typeof raw === "object" ? raw : {};
    const out = Object.assign({}, base);
    out.lang = I.languages.includes(src.lang) ? src.lang : base.lang;
    out.targetId = index.charaById.has(Number(src.targetId)) ? Number(src.targetId) : 0;
    out.parentId = index.charaById.has(Number(src.parentId)) ? Number(src.parentId) : 0;
    out.viewParentId = index.charaById.has(Number(src.viewParentId)) ? Number(src.viewParentId) : 0;
    out.targetAwakening = clampInt(src.targetAwakening, 1, 5, 5);
    out.parentAwakening = clampInt(src.parentAwakening, 1, 5, 5);
    out.weightMode = ["balanced", "strict", "count"].includes(src.weightMode) ? src.weightMode : "balanced";
    out.targetDeck = uniqueIds(src.targetDeck, index.cardById).slice(0, MAX_DECK);
    out.wanted = uniqueIds(src.wanted, index.skillById).slice(0, S.MAX_WANTED);
    out.notOwned = uniqueIds(src.notOwned, index.cardById);
    out.notOwnedCharas = uniqueIds(src.notOwnedCharas, index.charaById);
    out.firstParentId = index.charaById.has(Number(src.firstParentId)) ? Number(src.firstParentId) : 0;
    out.grandparents = uniqueIds(src.grandparents, index.charaById).slice(0, 2);
    const scenarioIds = (data.scenarios || []).map((sc) => sc.id);
    out.traineeScenario = scenarioIds.includes(src.traineeScenario) ? src.traineeScenario : scenarioIds[0] || "ura";
    out.parentScenario = src.parentScenario === "auto" || scenarioIds.includes(src.parentScenario) ? src.parentScenario : "auto";
    for (const flag of ["fillDeck", "preferHintOdds", "preferHintLevel"]) out[flag] = src[flag] === true;
    if (src.preferHintFreq === true) out.preferHintOdds = true;
    out.limitBreaks = {};
    if (src.limitBreaks && typeof src.limitBreaks === "object") {
      for (const [rawId, rawValue] of Object.entries(src.limitBreaks)) {
        const id = Number(rawId);
        const value = clampInt(rawValue, 0, S.MAX_LIMIT_BREAK, S.MAX_LIMIT_BREAK);
        if (index.cardById.has(id) && value < S.MAX_LIMIT_BREAK) out.limitBreaks[id] = value;
      }
    }
    out.typeMin = defaultTypeMin();
    if (src.typeMin && typeof src.typeMin === "object") {
      let total = 0;
      for (const type of S.TYPES) {
        const value = clampInt(src.typeMin[type], 0, MAX_DECK, 0);
        out.typeMin[type] = Math.min(value, MAX_DECK - total);
        total += out.typeMin[type];
      }
    }
    return out;
  }

  function clampInt(value, min, max, fallback) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function uniqueIds(list, map) {
    const out = [];
    for (const raw of Array.isArray(list) ? list : []) {
      const id = Number(raw);
      if (map.has(id) && !out.includes(id)) out.push(id);
    }
    return out;
  }

  function encodeState(st) {
    const payload = Object.assign({}, st);
    delete payload.lang;
    delete payload.viewParentId;
    const json = JSON.stringify(payload);
    return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function decodeState(text) {
    try {
      const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
      const json = decodeURIComponent(escape(atob(b64)));
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  function loadState() {
    let stored = null;
    try {
      stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch {
      stored = null;
    }
    const shared = new URLSearchParams(location.hash.replace(/^#/, "")).get("s");
    if (shared) {
      const decoded = decodeState(shared);
      if (decoded) {
        const merged = Object.assign({}, stored || {}, decoded, { lang: stored && stored.lang });
        history.replaceState(null, "", location.pathname + location.search);
        return sanitize(merged);
      }
    }
    return sanitize(stored);
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      return;
    }
  }

  let state = loadState();
  let lastResult = null;
  let computeTimer = 0;

  const cardImg = (id) => `img/card/${id}.webp`;
  const charaImg = (id) => `img/chara/${id}.webp`;
  const skillImg = (skill) => `img/skill/${skill.icon || 20011}.webp`;
  const cardLabel = (card) => `${card.chara} ${card.title}`;
  const charaLabel = (chara) => `${chara.name} ${chara.title}`;
  const isGold = (skill) => S.isGoldSkill(skill);
  const isInheritedUnique = (skill) => skill.id >= 900000;
  const isInheritable = (skill) => S.isInheritableSkill(skill);
  const fallbackOf = (skill) => (isInheritable(skill) ? null : index.skillById.get(S.inheritableFallback(index, skill.id)) || null);
  const scenarioById = (id) => (data.scenarios || []).find((sc) => sc.id === id) || null;
  const scenarioName = (id) => (scenarioById(id) || {}).name || id || "";
  const charaByCharaId = (charaId) => data.charas.find((c) => c.charaId === charaId) || null;

  const limitBreakOf = (cardId) => S.limitBreakOf(state.limitBreaks, cardId);
  const cardLevel = (card, limitBreak) => ((data.levels || {})[card.rar] || [])[limitBreak] || 0;
  const round1 = (value) => (Math.round(value * 10) / 10).toFixed(1);

  function hintBadges(card, limitBreak) {
    const pool = S.hintPool(card);
    if (!pool) return [];
    const badges = [
      h(
        "span",
        { class: "badge badge-hint", title: t("card.oddsTitle", { f: S.hintStat(card, "hf", limitBreak), pool, n: round1(S.hintOdds(card, limitBreak)) }) },
        t("card.odds", { n: round1(S.hintOdds(card, limitBreak)) })
      ),
    ];
    if (state.preferHintLevel) badges.push(h("span", { class: "badge badge-hint", title: t("card.hintLevelTitle") }, t("card.hintLevel", { n: S.hintStat(card, "hl", limitBreak) })));
    return badges;
  }

  function limitBreakLabel(card, limitBreak) {
    const level = cardLevel(card, limitBreak);
    const name = limitBreak >= S.MAX_LIMIT_BREAK ? t("card.mlb") : t("card.lb", { n: limitBreak });
    return level ? `${name} · Lv ${level}` : name;
  }

  function setLimitBreak(cardId, limitBreak) {
    update(() => {
      if (limitBreak >= S.MAX_LIMIT_BREAK) delete state.limitBreaks[cardId];
      else state.limitBreaks[cardId] = limitBreak;
    }, { keepView: true });
  }

  function limitBreakSelect(card) {
    const current = limitBreakOf(card.id);
    const select = h(
      "select",
      { class: "lb-select", title: t("card.lbTitle"), onchange: (e) => setLimitBreak(card.id, clampInt(e.target.value, 0, S.MAX_LIMIT_BREAK, S.MAX_LIMIT_BREAK)) },
      Array.from({ length: S.MAX_LIMIT_BREAK + 1 }, (_, lb) => h("option", { value: String(lb) }, limitBreakLabel(card, lb)))
    );
    select.value = String(current);
    return select;
  }

  function skillSources(id) {
    const cards = new Set([...(index.skillCards.get(id) || []), ...(index.skillCardEvents.get(id) || [])]);
    const charas = new Set([...(index.skillCharas.get(id) || []), ...(index.skillCharaEvents.get(id) || [])]);
    const scenarios = index.skillScenarios.get(id) || [];
    return { cards: cards.size, charas: charas.size, scenarios, cardEvents: (index.skillCardEvents.get(id) || []).length, charaEvents: (index.skillCharaEvents.get(id) || []).length };
  }

  function scenarioNames(ids) {
    return ids.map(scenarioName).join(", ");
  }

  function sourceBadges(id) {
    const { cards, charas, scenarios } = skillSources(id);
    const badges = [];
    if (!cards && !charas && !scenarios.length) badges.push(h("span", { class: "badge badge-danger" }, t("skill.sources.none")));
    else {
      if (cards) badges.push(h("span", { class: "badge badge-source" }, t("skill.sources.cards", { n: cards })));
      if (charas) badges.push(h("span", { class: "badge badge-source" }, t("skill.sources.charas", { n: charas })));
      if (!cards && charas) badges.push(h("span", { class: "badge badge-source" }, t("skill.sources.parentOnly")));
      if (cards && !charas) badges.push(h("span", { class: "badge badge-source" }, t("skill.sources.cardOnly")));
      if (scenarios.length) badges.push(h("span", { class: "badge badge-scenario" }, t("skill.sources.scenario", { names: scenarioNames(scenarios) })));
    }
    return badges;
  }

  function sourceText(id) {
    const { cards, charas, scenarios } = skillSources(id);
    if (!cards && !charas && !scenarios.length) return t("skill.sources.none");
    const parts = [];
    if (cards) parts.push(t("skill.sources.cards", { n: cards }));
    if (charas) parts.push(t("skill.sources.charas", { n: charas }));
    if (!cards && charas) parts.unshift(t("skill.sources.parentOnly"));
    if (cards && !charas) parts.unshift(t("skill.sources.cardOnly"));
    if (scenarios.length) parts.push(t("skill.sources.scenario", { names: scenarioNames(scenarios) }));
    return parts.join(" · ");
  }

  function parentEventText(entry) {
    if (!entry.event) return t("deck.fromParentEvent");
    return t(entry.secret ? "deck.fromParentSecret" : "deck.fromParentEventNamed", { event: entry.event });
  }

  function howText(origin, scenarioId) {
    if (!origin) return scenarioName(scenarioId);
    const teammate = origin.teammate ? charaByCharaId(origin.teammate) : null;
    const card = origin.card ? index.cardById.get(origin.card) : null;
    let text = t(`scenario.how.${origin.how}`, { name: teammate ? teammate.name : "" });
    if (origin.option) text += `: ${origin.option}`;
    if (origin.note) text += ` (${origin.note})`;
    if (card) text += ` · ${t("scenario.viaCard", { card: card.chara })}`;
    return text;
  }

  function skillIcon(id, extraTitle, extraClass) {
    const skill = index.skillById.get(id);
    if (!skill) return null;
    const title = skill.name + (extraTitle ? ` · ${extraTitle}` : "") + (skill.desc ? `\n${skill.desc}` : "");
    return h("img", { class: extraClass || null, src: skillImg(skill), alt: skill.name, title, loading: "lazy" });
  }

  function skillNameNode(skill) {
    return h("span", { class: "name" + (isGold(skill) ? " gold" : ""), title: skill.desc || "" }, skill.name);
  }

  function createPicker({ mount, placeholderKey, getItems, onSelect, limit = 40 }) {
    const input = h("input", { class: "picker-input", type: "search", autocomplete: "off", spellcheck: "false", placeholder: t(placeholderKey) });
    const list = h("div", { class: "picker-list", hidden: true });
    mount.replaceChildren(input, list);
    let items = [];
    let active = -1;

    function render() {
      const query = input.value.trim().toLowerCase();
      const words = query.split(/\s+/).filter(Boolean);
      items = getItems()
        .filter((item) => words.every((w) => item.search.includes(w)))
        .slice(0, limit);
      list.replaceChildren(
        ...items.map((item, i) =>
          h(
            "div",
            {
              class: "picker-item" + (i === active ? " active" : ""),
              onmousedown: (e) => {
                e.preventDefault();
                choose(item);
              },
            },
            item.img ? h("img", { src: item.img, alt: "", loading: "lazy", class: item.imgClass || "" }) : null,
            h("div", { class: "picker-text" }, h("div", { class: "picker-label" }, item.label), item.sub ? h("div", { class: "picker-sub" }, item.sub) : null),
            item.badge ? h("span", { class: "badge " + (item.badgeClass || "") }, item.badge) : null
          )
        )
      );
      if (!items.length) list.append(h("div", { class: "picker-empty" }, t("picker.empty")));
    }

    function open() {
      render();
      list.hidden = false;
    }

    function close() {
      list.hidden = true;
      active = -1;
    }

    function choose(item) {
      input.value = "";
      close();
      onSelect(item);
    }

    input.addEventListener("input", () => {
      active = -1;
      open();
    });
    input.addEventListener("focus", open);
    input.addEventListener("blur", () => setTimeout(close, 120));
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (list.hidden) open();
        active = Math.min(items.length - 1, active + 1);
        render();
        scrollActive();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        active = Math.max(0, active - 1);
        render();
        scrollActive();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = items[active >= 0 ? active : 0];
        if (item) choose(item);
      } else if (e.key === "Escape") {
        close();
      }
    });

    function scrollActive() {
      const el = list.children[active];
      if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
    }

    return {
      refresh() {
        input.placeholder = t(placeholderKey);
        if (!list.hidden) render();
      },
    };
  }

  const targetCharaId = () => (index.charaById.get(state.targetId) || {}).charaId || 0;
  const grandCharaIds = () => state.grandparents.map((id) => index.charaById.get(id).charaId);

  const grandItems = () =>
    data.charas
      .filter((c) => !grandCharaIds().includes(c.charaId))
      .map((c) => ({
        id: c.id,
        label: c.name,
        sub: c.title,
        img: charaImg(c.id),
        search: `${c.name} ${c.title}`.toLowerCase(),
      }));

  const charaItems = (forParent) =>
    data.charas
      .filter((c) => !forParent || c.charaId !== targetCharaId())
      .map((c) => ({
        id: c.id,
        label: c.name,
        sub: c.title,
        img: charaImg(c.id),
        search: `${c.name} ${c.title}`.toLowerCase(),
        badge: forParent && state.notOwnedCharas.includes(c.id) ? t("notOwned.badge") : null,
        badgeClass: "badge-warn",
      }));

  const cardItems = () =>
    data.cards
      .filter((c) => !state.targetDeck.includes(c.id) && c.charaId !== targetCharaId() && !state.targetDeck.some((id) => index.cardById.get(id).charaId === c.charaId))
      .slice()
      .sort((a, b) => b.rar - a.rar || a.chara.localeCompare(b.chara) || a.id - b.id)
      .map((c) => ({
        id: c.id,
        label: cardLabel(c),
        sub: `${t(`rarity.${c.rar}`)} · ${t(`type.${c.type}`)}`,
        img: cardImg(c.id),
        imgClass: "thumb-card",
        search: `${c.chara} ${c.title} ${t(`rarity.${c.rar}`)} ${t(`type.${c.type}`)} ${c.type}`.toLowerCase(),
      }));

  function upperInWanted(id) {
    let cur = index.upper.get(id);
    while (cur !== undefined) {
      if (state.wanted.includes(cur)) return true;
      cur = index.upper.get(cur);
    }
    return false;
  }

  const skillItems = () =>
    data.skills
      .filter((s) => s.id >= 200000 && s.id % 10 !== 3 && !state.wanted.includes(s.id) && !upperInWanted(s.id) && (() => { const src = skillSources(s.id); return src.cards + src.charas + src.scenarios.length > 0; })())
      .map((s) => {
        const tags = [s.cat];
        const white = fallbackOf(s);
        if (!isInheritable(s)) tags.push(white ? t(isGold(s) ? "skill.goldWarn" : "skill.notInheritable", { name: white.name }) : t("skill.noInheritable"));
        if (isInheritedUnique(s)) tags.push(t("skill.unique"));
        return {
          id: s.id,
          label: s.name,
          sub: `${tags.join(" · ")} · ${sourceText(s.id)}`,
          img: skillImg(s),
          search: `${s.name} ${s.cat}`.toLowerCase(),
          badge: isGold(s) ? t("skill.gold") : null,
          badgeClass: "badge-gold",
        };
      });

  const pickers = {};

  function buildPickers() {
    pickers.target = createPicker({
      mount: $("target-picker"),
      placeholderKey: "target.pick",
      getItems: () => charaItems(false),
      onSelect: (item) => update(() => {
        state.targetId = item.id;
      }),
    });
    pickers.deck = createPicker({
      mount: $("target-deck-picker"),
      placeholderKey: "target.addCard",
      getItems: cardItems,
      onSelect: (item) => update(() => {
        if (state.targetDeck.length < MAX_DECK && !state.targetDeck.includes(item.id)) state.targetDeck.push(item.id);
      }),
    });
    pickers.wanted = createPicker({
      mount: $("wanted-picker"),
      placeholderKey: "wanted.pick",
      getItems: skillItems,
      onSelect: (item) => update(() => {
        if (state.wanted.length < S.MAX_WANTED && !state.wanted.includes(item.id)) state.wanted.push(item.id);
      }),
    });
    pickers.parent = createPicker({
      mount: $("parent-picker"),
      placeholderKey: "parent.pick",
      getItems: () => charaItems(true),
      onSelect: (item) => update(() => {
        state.parentId = item.id;
      }),
    });
    pickers.grand = createPicker({
      mount: $("grandparent-picker"),
      placeholderKey: "grand.pick",
      getItems: grandItems,
      onSelect: (item) => addGrandparent(item.id),
    });
  }

  function addGrandparent(charaCardId) {
    const chara = index.charaById.get(charaCardId);
    if (!chara || state.grandparents.length >= 2 || grandCharaIds().includes(chara.charaId)) return;
    update(() => {
      state.grandparents.push(charaCardId);
    });
  }

  function renderGrandparents() {
    $("grandparents").replaceChildren(
      ...state.grandparents.map((id) => {
        const chara = index.charaById.get(id);
        return h(
          "span",
          { class: "chip" },
          h("img", { class: "chibi", src: charaImg(chara.id), alt: "" }),
          h("span", { class: "chip-text" }, chara.name, h("span", { class: "chip-sub" }, chara.title)),
          h("button", { type: "button", class: "icon-btn danger", title: t("action.reset"), onclick: () => update(() => {
            state.grandparents = state.grandparents.filter((x) => x !== id);
          }) }, "✕")
        );
      })
    );
    $("grandparent-picker").hidden = state.grandparents.length >= 2;
  }

  function normalizeState() {
    const charaId = targetCharaId();
    if (!charaId) return;
    state.targetDeck = state.targetDeck.filter((id) => index.cardById.get(id).charaId !== charaId);
    const parent = index.charaById.get(state.parentId);
    if (parent && parent.charaId === charaId) state.parentId = 0;
    const first = index.charaById.get(state.firstParentId);
    if (first && first.charaId === charaId) state.firstParentId = 0;
    const parentChara = index.charaById.get(state.parentId);
    if (parentChara && grandCharaIds().includes(parentChara.charaId)) state.parentId = 0;
  }

  function firstParentCharaIds() {
    const first = index.charaById.get(state.firstParentId);
    return first ? [first.charaId] : [];
  }

  function update(mutator, options) {
    mutator();
    normalizeState();
    if (!(options && options.keepView)) state.viewParentId = 0;
    saveState();
    renderInputs();
    scheduleCompute();
  }

  function renderSelectedChara(mount, charaId, emptyLabel, onClear) {
    const chara = index.charaById.get(charaId);
    if (!chara) {
      mount.replaceChildren(...(emptyLabel ? [h("span", { class: "badge" }, emptyLabel)] : []));
      return;
    }
    mount.replaceChildren(
      h("img", { src: charaImg(chara.id), alt: "" }),
      h("div", null, h("div", { class: "name" }, chara.name), h("div", { class: "title" }, chara.title)),
      h("span", { class: "spacer" }),
      h("button", { type: "button", class: "icon-btn danger", title: t("action.reset"), onclick: onClear }, "✕")
    );
  }

  function renderTarget() {
    renderSelectedChara($("target-selected"), state.targetId, null, () => update(() => {
      state.targetId = 0;
    }));
    $("target-awakening").value = String(state.targetAwakening);
    $("target-deck").replaceChildren(
      ...state.targetDeck.map((id) => {
        const card = index.cardById.get(id);
        return h(
          "span",
          { class: `chip type-${card.type}` },
          h("img", { src: cardImg(card.id), alt: "" }),
          h("span", { class: "chip-text" }, card.chara, h("span", { class: "chip-sub" }, `${card.title} · ${t(`rarity.${card.rar}`)} · ${t(`type.short.${card.type}`)}`)),
          h("button", { type: "button", class: "icon-btn danger", title: t("action.reset"), onclick: () => update(() => {
            state.targetDeck = state.targetDeck.filter((x) => x !== id);
          }) }, "✕")
        );
      })
    );
    $("target-deck-picker").hidden = state.targetDeck.length >= MAX_DECK;
  }

  let dragIndex = -1;

  function moveWanted(from, to) {
    if (from === to || from < 0 || to < 0 || from >= state.wanted.length || to >= state.wanted.length) return;
    update(() => {
      const [item] = state.wanted.splice(from, 1);
      state.wanted.splice(to, 0, item);
    });
  }

  function excludedText(entry) {
    const card = entry.card ? index.cardById.get(entry.card) : null;
    const params = { card: card ? card.chara : "", event: entry.event || "", n: (entry.optionIndex || 0) + 1, scenario: scenarioName(entry.scenario), how: entry.how ? howText(entry, entry.scenario) : "" };
    if (entry.reason === "targetEvent" && entry.event) return t(entry.secret ? "results.excluded.targetSecret" : "results.excluded.targetEventNamed", params);
    if (entry.reason === "fallbackCovered") params.name = index.skillById.get(entry.white) ? index.skillById.get(entry.white).name : "";
    if (entry.reason === "duplicate") params.name = index.skillById.get(entry.mergedWith) ? index.skillById.get(entry.mergedWith).name : "";
    return t(`results.excluded.${entry.reason}`, params);
  }

  function wantedStatus(id) {
    if (!lastResult) return null;
    const excluded = lastResult.excluded.find((e) => e.id === id);
    if (excluded) {
      const impossible = excluded.reason === "fallbackCovered" || excluded.reason === "notInheritable";
      if (excluded.reason === "duplicate") {
        const other = index.skillById.get(excluded.mergedWith);
        return h("span", { class: "badge badge-warn", title: excludedText(excluded) }, t("wanted.status.duplicate", { name: other ? other.name : "" }));
      }
      return h("span", { class: "badge " + (impossible ? "badge-danger" : "badge-ok"), title: excludedText(excluded) }, impossible ? t("wanted.status.impossible") : t("wanted.status.covered"));
    }
    const info = lastResult.effectiveInfo.find((e) => e.fallbackOf === id);
    if (info) {
      const white = index.skillById.get(info.id);
      return h("span", { class: "badge badge-warn", title: t(isGold(index.skillById.get(id)) ? "skill.goldWarn" : "skill.notInheritable", { name: white.name }) }, t("wanted.status.fallback", { name: white.name }));
    }
    if (lastResult.unobtainable.includes(id)) return h("span", { class: "badge badge-danger" }, t("wanted.status.impossible"));
    return null;
  }

  function renderWanted() {
    const list = $("wanted-list");
    if (!state.wanted.length) {
      list.replaceChildren(h("li", { class: "wanted-empty" }, t("wanted.empty")));
      return;
    }
    list.replaceChildren(
      ...state.wanted.map((id, i) => {
        const skill = index.skillById.get(id);
        const white = fallbackOf(skill);
        const meta = [h("span", { class: "badge" }, skill.cat)];
        if (isGold(skill)) meta.push(h("span", { class: "badge badge-gold", title: white ? t("skill.goldWarn", { name: white.name }) : t("skill.noInheritable") }, t("skill.gold")));
        else if (!isInheritable(skill)) meta.push(h("span", { class: "badge badge-warn", title: white ? t("skill.notInheritable", { name: white.name }) : t("skill.noInheritable") }, t("skill.notInheritableShort")));
        if (isInheritedUnique(skill)) meta.push(h("span", { class: "badge badge-gold" }, t("skill.unique")));
        meta.push(...sourceBadges(id));
        const status = wantedStatus(id);
        if (status) meta.push(status);
        return h(
          "li",
          {
            class: "wanted-item",
            draggable: "true",
            ondragstart: (e) => {
              dragIndex = i;
              e.currentTarget.classList.add("dragging");
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", String(i));
            },
            ondragend: (e) => {
              e.currentTarget.classList.remove("dragging");
              for (const el of list.querySelectorAll(".drop-target")) el.classList.remove("drop-target");
            },
            ondragover: (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              e.currentTarget.classList.add("drop-target");
            },
            ondragleave: (e) => e.currentTarget.classList.remove("drop-target"),
            ondrop: (e) => {
              e.preventDefault();
              const from = dragIndex >= 0 ? dragIndex : Number(e.dataTransfer.getData("text/plain"));
              dragIndex = -1;
              moveWanted(from, i);
            },
          },
          h("span", { class: "rank" }, i + 1),
          h("img", { src: skillImg(skill), alt: "" }),
          h("div", { class: "skill-name" + (isGold(skill) ? " gold" : "") }, skillNameNode(skill), h("span", { class: "skill-meta" }, meta)),
          h(
            "div",
            { class: "controls" },
            h("button", { type: "button", class: "icon-btn", disabled: i === 0, onclick: () => moveWanted(i, i - 1) }, "↑"),
            h("button", { type: "button", class: "icon-btn", disabled: i === state.wanted.length - 1, onclick: () => moveWanted(i, i + 1) }, "↓"),
            h("button", { type: "button", class: "icon-btn danger", onclick: () => update(() => {
              state.wanted = state.wanted.filter((x) => x !== id);
            }) }, "✕")
          )
        );
      })
    );
  }

  function renderWeightMode() {
    const modes = ["balanced", "strict", "count"];
    $("weight-mode").replaceChildren(
      ...modes.map((mode) =>
        h("button", { type: "button", class: "btn btn-ghost" + (state.weightMode === mode ? " active" : ""), onclick: () => update(() => {
          state.weightMode = mode;
        }) }, t(`wanted.mode.${mode}`))
      )
    );
    $("weight-mode-hint").textContent = t(`wanted.mode.${state.weightMode}Hint`);
  }

  function renderParent() {
    renderSelectedChara($("parent-selected"), state.parentId, t("parent.auto"), () => update(() => {
      state.parentId = 0;
    }));
    $("parent-awakening").value = String(state.parentAwakening);
  }

  function renderRulesNotice(result) {
    return result.manualIgnored ? h("div", { class: "notice warn" }, t("parent.sameAsTrainee")) : null;
  }

  function buildTypeMins() {
    const grid = $("type-mins");
    grid.replaceChildren(
      ...S.TYPES.map((type) =>
        h(
          "label",
          { class: `type-row type-${type}` },
          h("span", { dataset: { typeLabel: type } }, h("i", { class: "type-dot" }), t(`type.${type}`)),
          h("input", {
            type: "number",
            min: "0",
            max: String(MAX_DECK),
            dataset: { type },
            onchange: (e) => {
              const others = S.TYPES.filter((x) => x !== type).reduce((sum, x) => sum + state.typeMin[x], 0);
              const value = clampInt(e.target.value, 0, Math.max(0, MAX_DECK - others), 0);
              if (value === state.typeMin[type]) {
                e.target.value = String(value);
                return;
              }
              update(() => {
                state.typeMin[type] = value;
              });
            },
          })
        )
      )
    );
  }

  const DECK_OPTIONS = ["fillDeck", "preferHintOdds", "preferHintLevel"];
  const DECK_OPTION_KEYS = { fillDeck: "fill", preferHintOdds: "hintOdds", preferHintLevel: "hintLevel" };

  function buildDeckOptions() {
    $("deck-options").replaceChildren(
      ...DECK_OPTIONS.map((flag) =>
        h(
          "label",
          { class: "toggle-row" },
          h("input", { type: "checkbox", dataset: { flag }, onchange: (e) => {
            const checked = e.target.checked;
            update(() => {
              state[flag] = checked;
            });
          } }),
          h("span", { class: "toggle-mark" }),
          h("span", { class: "toggle-text" }, h("span", { dataset: { flagLabel: flag } }), h("small", { dataset: { flagHint: flag } }))
        )
      )
    );
  }

  function renderDeckOptions() {
    const mount = $("deck-options");
    for (const input of mount.querySelectorAll("input[data-flag]")) input.checked = Boolean(state[input.dataset.flag]);
    for (const span of mount.querySelectorAll("[data-flag-label]")) span.textContent = t(`deckOpts.${DECK_OPTION_KEYS[span.dataset.flagLabel]}`);
    for (const span of mount.querySelectorAll("[data-flag-hint]")) span.textContent = t(`deckOpts.${DECK_OPTION_KEYS[span.dataset.flagHint]}Hint`);
  }

  function renderTypeMins() {
    for (const input of $("type-mins").querySelectorAll("input[data-type]")) input.value = String(state.typeMin[input.dataset.type]);
    for (const span of $("type-mins").querySelectorAll("[data-type-label]")) span.lastChild.textContent = t(`type.${span.dataset.typeLabel}`);
    const total = S.TYPES.reduce((sum, x) => sum + state.typeMin[x], 0);
    $("type-total").textContent = t("types.reserved", { n: total });
  }

  function renderAwakeningSelects() {
    for (const id of ["target-awakening", "parent-awakening"]) {
      const select = $(id);
      select.replaceChildren(...[1, 2, 3, 4, 5].map((n) => h("option", { value: String(n) }, `Lv ${n}`)));
    }
  }

  function buildScenarioSelects() {
    const scenarios = data.scenarios || [];
    $("target-scenario").replaceChildren(...scenarios.map((sc) => h("option", { value: sc.id }, sc.name)));
    $("parent-scenario").replaceChildren(h("option", { value: "auto" }, t("scenario.auto")), ...scenarios.map((sc) => h("option", { value: sc.id }, sc.name)));
  }

  function renderScenarioSelects() {
    $("target-scenario").value = state.traineeScenario;
    $("parent-scenario").value = state.parentScenario;
    const auto = $("parent-scenario").querySelector('option[value="auto"]');
    if (auto) auto.textContent = t("scenario.auto");
  }

  function renderInputs() {
    renderTarget();
    renderWanted();
    renderWeightMode();
    renderParent();
    renderGrandparents();
    renderScenarioSelects();
    renderTypeMins();
    renderDeckOptions();
    for (const picker of Object.values(pickers)) picker.refresh();
  }

  function scheduleCompute() {
    clearTimeout(computeTimer);
    document.body.classList.add("busy");
    computeTimer = setTimeout(() => requestAnimationFrame(() => {
      compute();
      document.body.classList.remove("busy");
    }), 40);
  }

  function compute() {
    lastResult = S.solve(index, {
      wanted: state.wanted,
      weightMode: state.weightMode,
      target: { charaId: state.targetId, awakening: state.targetAwakening, deck: state.targetDeck, scenario: state.traineeScenario },
      parent: { charaId: state.parentId, awakening: state.parentAwakening, scenario: state.parentScenario },
      typeMin: state.typeMin,
      fillDeck: state.fillDeck,
      preferHintOdds: state.preferHintOdds,
      preferHintLevel: state.preferHintLevel,
      limitBreaks: state.limitBreaks,
      notOwned: new Set(state.notOwned),
      notOwnedCharas: new Set(state.notOwnedCharas),
      excludeCharaIds: firstParentCharaIds(),
      grandparents: state.grandparents,
      maxDecks: 8,
      maxParents: 8,
    });
    renderWanted();
    renderResults();
  }

  function skillChip(id, sub, extraClass) {
    const skill = index.skillById.get(id);
    return h(
      "span",
      { class: "chip" + (isGold(skill) ? " skill-gold" : "") + (extraClass ? ` ${extraClass}` : "") },
      h("img", { class: "skill-icon", src: skillImg(skill), alt: "", title: skill.desc || "" }),
      h("span", { class: "chip-text" }, skill.name, sub ? h("span", { class: "chip-sub" }, sub) : null)
    );
  }

  function scenarioAbbr(id) {
    const words = scenarioName(id).split(" ").filter(Boolean);
    if (words.length > 1 && /^[A-Z]+$/.test(words[0])) return words[0];
    return words.map((w) => w[0]).join("").toUpperCase();
  }

  function renderChoiceRow(pick, owner) {
    const card = pick.card ? index.cardById.get(pick.card) : null;
    let image;
    let source;
    if (card) {
      image = h("img", { class: "choice-img", src: cardImg(card.id), alt: "" });
      source = `${card.chara} ${card.title} · ${t(`rarity.${card.rar}`)} · ${t(`type.${card.type}`)}`;
    } else if (pick.how) {
      image = h("div", { class: "choice-img choice-mark" }, scenarioAbbr(pick.scenario));
      source = scenarioName(pick.scenario);
    } else {
      image = owner ? h("img", { class: "choice-img", src: charaImg(owner.id), alt: "" }) : h("div", { class: "choice-img choice-mark" }, "?");
      source = owner ? charaLabel(owner) : "";
    }
    const event = pick.how ? howText({ how: pick.how }, pick.scenario) : t(pick.secret ? "results.choiceSecretEvent" : "results.choiceEvent", { event: pick.name });
    const number = pick.how ? null : h("span", { class: "choice-num" }, t("results.choiceOption", { n: (pick.optionIndex || 0) + 1 }));
    return h(
      "div",
      { class: "choice-row" },
      image,
      h(
        "div",
        { class: "choice-body" },
        h("div", { class: "choice-source" }, source),
        h("div", { class: "choice-event" }, event),
        h("div", { class: "choice-pick" }, number, pick.how ? h("span", { class: "choice-text" }, pick.option) : pick.option ? h("span", { class: "choice-text jp", lang: "ja", title: t("results.choiceJp") }, pick.option) : null),
        h("div", { class: "choice-skills" }, pick.skills.map((id) => h("span", null, skillIcon(id), index.skillById.get(id).name)))
      )
    );
  }

  function renderSummary(result) {
    const summary = $("summary");
    const blocks = [];
    const first = index.charaById.get(state.firstParentId);
    if (first) {
      blocks.push(
        h(
          "div",
          { class: "notice info notice-row" },
          h("span", null, t("results.secondParent", { name: charaLabel(first) })),
          h("button", { type: "button", class: "btn btn-ghost btn-small", onclick: () => update(() => {
            state.firstParentId = 0;
          }) }, t("results.secondParentClear"))
        )
      );
    }
    if (!state.wanted.length) blocks.push(h("div", { class: "notice info" }, t("results.empty")));
    const impossible = result.excluded.filter((e) => e.reason === "fallbackCovered" || e.reason === "notInheritable");
    const covered = result.excluded.filter((e) => !impossible.includes(e));
    if (covered.length) {
      blocks.push(
        h(
          "div",
          { class: "notice" },
          h("div", { class: "notice-title" }, t("results.excluded")),
          h("div", { class: "chip-list" }, covered.map((e) => skillChip(e.id, excludedText(e), "muted")))
        )
      );
    }
    if (result.traineeChoices.length) {
      const trainee = index.charaById.get(state.targetId) || null;
      blocks.push(
        h(
          "div",
          { class: "notice info" },
          h("div", { class: "notice-title" }, t("results.traineeChoices")),
          h("div", { class: "notice-hint" }, t("results.traineeChoicesHint")),
          h("div", { class: "choice-rows" }, result.traineeChoices.map((pick) => renderChoiceRow(pick, trainee)))
        )
      );
    }
    if (impossible.length || result.unobtainable.length) {
      blocks.push(
        h(
          "div",
          { class: "notice warn" },
          h("div", { class: "notice-title" }, t("results.unobtainable")),
          h("div", { class: "chip-list" }, impossible.map((e) => skillChip(e.id, excludedText(e), "muted")), result.unobtainable.map((id) => skillChip(id, t("skill.sources.none"), "muted")))
        )
      );
    }
    summary.replaceChildren(...blocks);
  }

  function currentParent(result) {
    const viewed = state.viewParentId && result.parents.find((p) => p.charaId === state.viewParentId);
    return viewed || result.parents.find((p) => p.charaId === result.selectedParent) || result.parents[0] || null;
  }

  function renderParents(result, current) {
    const mount = $("parents");
    if (!state.wanted.length || !result.effective.length) {
      mount.replaceChildren();
      return;
    }
    mount.replaceChildren(
      ...result.parents.map((p) => {
        const chara = index.charaById.get(p.charaId);
        const choiceTitle = p.choices.map((c) => `${c.name}: ${c.option}`).join("\n");
        return h(
          "div",
          {
            class: "parent-card" + (current && current.charaId === p.charaId ? " selected" : ""),
            role: "button",
            tabindex: "0",
            onclick: () => {
              state.viewParentId = p.charaId;
              saveState();
              renderResults();
            },
            onkeydown: (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.currentTarget.click();
              }
            },
          },
          h("button", { type: "button", class: "parent-remove", title: t("parent.notOwn"), onclick: (e) => {
            e.stopPropagation();
            markNotOwnedChara(p.charaId);
          } }, "✕"),
          h("img", { src: charaImg(chara.id), alt: "", loading: "lazy" }),
          h(
            "div",
            { class: "body" },
            h("div", { class: "name" }, chara.name),
            h("div", { class: "title" }, chara.title),
            h(
              "div",
              { class: "stats" },
              h("span", { class: "badge" }, t("parent.covers", { a: p.coveredCount, b: result.effective.length })),
              h("span", { class: "badge" }, t("parent.cards", { n: p.cardCount })),
              p.scenario ? h("span", { class: "badge badge-scenario", title: p.scenario.origins.map((o) => `${index.skillById.get(o.id).name}: ${howText(o.origin, p.scenario.id)}`).join("\n") }, t("parent.trainIn", { name: p.scenario.name })) : null
            ),
            p.innate.length || p.viaEvents.length || p.viaGrand.length || p.viaScenario.length
              ? h(
                  "div",
                  { class: "innate", title: choiceTitle || t("parent.innate") },
                  p.innate.map((id) => skillIcon(id, t("deck.fromParent"))),
                  p.events.map((e) => skillIcon(e.id, parentEventText(e), e.secret ? "via-secret" : "via-event")),
                  p.viaScenario.map((id) => skillIcon(id, p.scenario ? p.scenario.name : "", "via-scenario")),
                  p.viaGrand.map((id) => skillIcon(id, t("deck.fromGrandShort"), "via-grand"))
                )
              : null
          )
        );
      })
    );
  }

  function markNotOwned(cardId) {
    update(() => {
      if (!state.notOwned.includes(cardId)) state.notOwned.push(cardId);
    }, { keepView: true });
  }

  function markNotOwnedChara(charaCardId) {
    update(() => {
      if (!state.notOwnedCharas.includes(charaCardId)) state.notOwnedCharas.push(charaCardId);
      if (state.viewParentId === charaCardId) state.viewParentId = 0;
    }, { keepView: true });
  }

  function renderSlot(slot) {
    if (slot.kind === "card") {
      const card = index.cardById.get(slot.id);
      const altList = h(
        "div",
        { class: "slot-alt-list", hidden: true, onclick: (e) => {
          e.currentTarget.hidden = true;
        } },
        h("div", { class: "slot-alt-head" }, t("deck.alts", { n: slot.alts.length }), h("span", { class: "slot-alt-close" }, "✕")),
        slot.alts.map((id) => {
          const alt = index.cardById.get(id);
          return h("div", { class: "slot-alt" }, h("span", { class: `badge badge-rarity rar-${alt.rar}` }, t(`rarity.${alt.rar}`)), hintBadges(alt, limitBreakOf(alt.id)), cardLabel(alt));
        })
      );
      return h(
        "div",
        { class: `slot slot-card type-${card.type}` + (slot.borrowed ? " borrow" : "") + (slot.extra ? " extra" : "") },
        slot.borrowed
          ? h("span", { class: "slot-borrow" }, t("deck.borrow"))
          : h("button", { type: "button", class: "slot-remove", title: t("deck.notOwn"), onclick: () => markNotOwned(card.id) }, "✕"),
        h("img", { class: "thumb", src: cardImg(card.id), alt: cardLabel(card), loading: "lazy" }),
        h("div", { class: "slot-name" }, card.chara, h("small", { title: card.title }, card.title)),
        h(
          "div",
          { class: "chip-list", style: "justify-content:center;margin:0" },
          h("span", { class: `badge badge-rarity rar-${card.rar}` }, t(`rarity.${card.rar}`)),
          h("span", { class: `badge badge-type type-${card.type}` }, t(`type.short.${card.type}`)),
          slot.extra ? h("span", { class: "badge badge-extra", title: t("deck.extraTitle") }, t("deck.extra")) : null,
          hintBadges(card, limitBreakOf(card.id))
        ),
        h("div", { class: "slot-lb" }, limitBreakSelect(card)),
        slot.choices.length || slot.links.length
          ? h(
              "div",
              { class: "slot-choices" },
              slot.choices.map((choice) => h("div", { class: "slot-choice", title: choice.option }, t("deck.eventChoice", { event: choice.name, n: choice.optionIndex + 1 }))),
              slot.links.map((link) => h("div", { class: "slot-choice scenario", title: howText({ how: link.how, option: link.option }, link.scenario) }, t("deck.linkChoice", { scenario: scenarioName(link.scenario), option: link.option })))
            )
          : null,
        h(
          "div",
          { class: "slot-skills" },
          slot.skills.map((id) => {
            if (slot.linkSkills.includes(id)) return skillIcon(id, scenarioName(slot.links[0].scenario), "via-scenario");
            if (slot.eventSkills.includes(id)) return skillIcon(id, t("deck.viaEvent"), "via-event");
            return skillIcon(id);
          })
        ),
        slot.alts.length
          ? h("button", { type: "button", class: "slot-alts", title: t("deck.alts", { n: slot.alts.length }), onclick: () => {
            altList.hidden = !altList.hidden;
          } }, `+${slot.alts.length}`)
          : null,
        altList
      );
    }
    if (slot.kind === "type") {
      return h("div", { class: `slot slot-type type-${slot.type}` }, h("div", { class: "type-circle" }, t(`type.short.${slot.type}`)), h("div", null, t("deck.anyType", { type: t(`type.${slot.type}`) })));
    }
    return h("div", { class: "slot slot-free" }, h("div", { class: "free-mark" }, "+"), h("div", null, t("deck.free")));
  }

  function renderDeck(deck, rank, result, parent) {
    const covered = deck.covered.map((c) => {
      const skill = index.skillById.get(c.id);
      let note;
      if (c.from === "parent") note = c.viaEvent ? parentEventText(c) : t("deck.fromParent");
      else if (c.from === "scenario") note = t("deck.fromScenario", { scenario: scenarioName(c.scenario), how: howText(c.origin, c.scenario) });
      else if (c.from === "grandparent") note = t("deck.fromGrand", { name: c.grandparent ? charaLabel(index.charaById.get(c.grandparent)) : "" });
      else note = c.cards.map((id) => index.cardById.get(id).chara).join(", ") + (c.viaEvent ? ` (${t("deck.viaEvent")})` : "");
      const odds = c.from === "card" && !c.viaEvent
        ? h("span", { class: "badge badge-hint", title: t("deck.hintOddsTitle", { cards: c.cards.map((id) => `${index.cardById.get(id).chara} ${round1(S.hintOdds(index.cardById.get(id), limitBreakOf(id)))}`).join(", ") }) }, t("card.odds", { n: round1(c.odds) }))
        : null;
      return h("div", { class: "skill-row" }, skillIcon(c.id), skillNameNode(skill), h("span", { class: "note" }, note), odds);
    });
    const missing = deck.missing.map((m) => {
      const skill = index.skillById.get(m.id);
      let note;
      let actions = null;
      if (m.reason === "scenario") {
        const ids = (m.via || []).filter((id) => scenarioById(id));
        note = t("deck.missing.scenario", { names: scenarioNames(ids) });
        actions = ids.filter((id) => state.parentScenario !== id).map((id) => h("button", { type: "button", class: "btn btn-ghost btn-small", onclick: () => update(() => {
          state.parentScenario = id;
        }) }, t("results.trainIn", { name: scenarioName(id) })));
      } else if (m.reason === "grandparent") {
        const via = (m.via || []).slice(0, 4).map((id) => index.charaById.get(id)).filter(Boolean);
        note = t("deck.missing.grandparent") + (via.length ? `: ${via.map(charaLabel).join(", ")}` : "");
      } else note = t(`deck.missing.${m.reason}`);
      return h("div", { class: "skill-row missing" }, skillIcon(m.id), skillNameNode(skill), h("span", { class: "note" }, note), actions);
    });
    const leftovers = deck.missing.filter((m) => m.reason !== "none");
    const planButton = leftovers.length && !state.firstParentId
      ? h("div", { class: "deck-actions" }, h("button", { type: "button", class: "btn btn-ghost btn-small", onclick: () => planSecondParent(result, parent, deck) }, t("results.planSecond")))
      : null;
    return h(
      "div",
      { class: "deck" },
      h(
        "div",
        { class: "deck-head" },
        h("span", { class: "deck-rank" }, t("deck.rank", { n: rank })),
        h("span", { class: "badge" }, t("deck.covers", { a: deck.coveredCount, b: result.effective.length })),
        h("span", { class: "badge" }, t("deck.cards", { n: deck.cardCount })),
        deck.borrowed ? h("span", { class: "badge badge-gold" }, t("deck.borrow")) : null,
        deck.scenario
          ? h("span", { class: "badge badge-scenario", title: deck.scenarioChoices.map((c) => `${c.option}: ${c.skills.map((id) => index.skillById.get(id).name).join(", ")}`).join("\n") }, t("parent.trainIn", { name: scenarioName(deck.scenario) }))
          : null
      ),
      h("div", { class: "slots" }, deck.slots.map(renderSlot)),
      h(
        "div",
        { class: "deck-skills" },
        h("div", null, h("h4", null, t("deck.covered")), covered.length ? covered : h("div", { class: "skill-row missing" }, "—")),
        h("div", null, h("h4", null, t("deck.missing")), missing.length ? missing : h("div", { class: "skill-row missing" }, "—"), planButton)
      )
    );
  }

  function originalWantedId(result, effectiveId) {
    const info = result.effectiveInfo.find((e) => e.id === effectiveId);
    return info && info.fallbackOf ? info.fallbackOf : effectiveId;
  }

  function planSecondParent(result, current, deck) {
    const leftovers = deck.missing.filter((m) => m.reason !== "none").map((m) => originalWantedId(result, m.id));
    if (!leftovers.length) return;
    update(() => {
      state.firstParentId = current.charaId;
      state.wanted = leftovers;
      state.parentId = 0;
    });
    showToast(t("results.secondParentSet"));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderDecks(result, current) {
    const mount = $("decks");
    const title = $("decks-title");
    if (!current || !state.wanted.length || !result.effective.length) {
      title.textContent = t("results.decks", { name: "—" });
      mount.replaceChildren(...(state.wanted.length && !result.effective.length ? [h("div", { class: "notice info" }, t("results.excluded"))] : []));
      return;
    }
    const chara = index.charaById.get(current.charaId);
    title.textContent = t("results.decks", { name: charaLabel(chara) });
    const blocks = current.decks.map((deck, i) => renderDeck(deck, i + 1, result, current));
    const rules = renderRulesNotice(result);
    if (rules) blocks.unshift(rules);
    const scenarioPicks = current.scenario ? current.scenario.choices.filter((c) => c.optionIndex !== undefined).map((c) => Object.assign({ scenario: current.scenario.id }, c)) : [];
    const parentPicks = current.choices.concat(scenarioPicks);
    if (parentPicks.length) {
      blocks.unshift(
        h(
          "div",
          { class: "notice info" },
          h("div", { class: "notice-title" }, t("results.parentChoices", { name: charaLabel(chara) })),
          h("div", { class: "notice-hint" }, t("results.parentChoicesHint")),
          h("div", { class: "choice-rows" }, parentPicks.map((pick) => renderChoiceRow(pick, chara)))
        )
      );
    }
    if (!current.complete) blocks.unshift(h("div", { class: "notice warn" }, t("results.incomplete")));
    mount.replaceChildren(...blocks);
  }

  function renderNotOwned() {
    const mount = $("not-owned");
    const limited = Object.keys(state.limitBreaks).map(Number).filter((id) => index.cardById.has(id));
    if (!state.notOwned.length && !state.notOwnedCharas.length && !limited.length) {
      mount.replaceChildren(h("span", { class: "hint" }, t("notOwned.empty")));
      return;
    }
    const blocks = [];
    if (state.notOwned.length) {
      blocks.push(
        h("h4", { class: "not-owned-title" }, t("notOwned.cards")),
        h(
          "div",
          { class: "chip-list" },
          state.notOwned.map((id) => {
            const card = index.cardById.get(id);
            return h(
              "span",
              { class: `chip type-${card.type}` },
              h("img", { src: cardImg(card.id), alt: "" }),
              h("span", { class: "chip-text" }, card.chara, h("span", { class: "chip-sub" }, `${card.title} · ${t(`rarity.${card.rar}`)}`)),
              h("button", { type: "button", class: "icon-btn", title: t("notOwned.restore"), onclick: () => update(() => {
                state.notOwned = state.notOwned.filter((x) => x !== id);
              }, { keepView: true }) }, "↩")
            );
          })
        )
      );
    }
    if (state.notOwnedCharas.length) {
      blocks.push(
        h("h4", { class: "not-owned-title" }, t("notOwned.umas")),
        h(
          "div",
          { class: "chip-list" },
          state.notOwnedCharas.map((id) => {
            const chara = index.charaById.get(id);
            return h(
              "span",
              { class: "chip" },
              h("img", { class: "chibi", src: charaImg(chara.id), alt: "" }),
              h("span", { class: "chip-text" }, chara.name, h("span", { class: "chip-sub" }, chara.title)),
              h("button", { type: "button", class: "icon-btn", title: t("notOwned.restore"), onclick: () => update(() => {
                state.notOwnedCharas = state.notOwnedCharas.filter((x) => x !== id);
              }, { keepView: true }) }, "↩")
            );
          })
        )
      );
    }
    if (limited.length) {
      blocks.push(
        h("h4", { class: "not-owned-title" }, t("notOwned.limitBreaks")),
        h(
          "div",
          { class: "chip-list" },
          limited.map((id) => {
            const card = index.cardById.get(id);
            return h(
              "span",
              { class: `chip type-${card.type}` },
              h("img", { src: cardImg(card.id), alt: "" }),
              h("span", { class: "chip-text" }, card.chara, h("span", { class: "chip-sub" }, `${card.title} · ${limitBreakLabel(card, limitBreakOf(id))}`)),
              h("button", { type: "button", class: "icon-btn", title: t("card.lbReset"), onclick: () => setLimitBreak(id, S.MAX_LIMIT_BREAK) }, "↩")
            );
          })
        )
      );
    }
    mount.replaceChildren(...blocks);
  }

  function renderResults() {
    if (!lastResult) return;
    const current = currentParent(lastResult);
    renderSummary(lastResult);
    renderParents(lastResult, current);
    renderDecks(lastResult, current);
    renderNotOwned();
  }

  function showToast(text) {
    const toast = $("toast");
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      toast.hidden = true;
    }, 1800);
  }

  function shareLink() {
    const url = `${location.origin}${location.pathname}#s=${encodeState(state)}`;
    const done = () => showToast(t("action.shared"));
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => prompt("URL", url));
    else prompt("URL", url);
  }

  function resetInputs() {
    if (!confirm(t("action.resetConfirm"))) return;
    const keep = { lang: state.lang, notOwned: state.notOwned, notOwnedCharas: state.notOwnedCharas, limitBreaks: state.limitBreaks };
    state = Object.assign(defaultState(), keep);
    saveState();
    renderInputs();
    scheduleCompute();
  }

  function setLanguage(lang) {
    state.lang = lang;
    I.setLanguage(lang);
    saveState();
    I.applyStatic();
    for (const btn of document.querySelectorAll("#lang-switch [data-lang]")) btn.classList.toggle("active", btn.dataset.lang === lang);
    renderInputs();
    renderResults();
  }

  function init() {
    I.setLanguage(state.lang);
    I.applyStatic();
    renderAwakeningSelects();
    buildScenarioSelects();
    buildTypeMins();
    buildDeckOptions();
    buildPickers();
    $("target-scenario").addEventListener("change", (e) => update(() => {
      state.traineeScenario = e.target.value;
    }));
    $("parent-scenario").addEventListener("change", (e) => update(() => {
      state.parentScenario = e.target.value;
    }));
    $("target-awakening").addEventListener("change", (e) => update(() => {
      state.targetAwakening = clampInt(e.target.value, 1, 5, 5);
    }));
    $("parent-awakening").addEventListener("change", (e) => update(() => {
      state.parentAwakening = clampInt(e.target.value, 1, 5, 5);
    }));
    $("btn-share").addEventListener("click", shareLink);
    $("btn-reset").addEventListener("click", resetInputs);
    $("btn-clear-not-owned").addEventListener("click", () => update(() => {
      state.notOwned = [];
      state.notOwnedCharas = [];
      state.limitBreaks = {};
    }, { keepView: true }));
    for (const btn of document.querySelectorAll("#lang-switch [data-lang]")) {
      btn.classList.toggle("active", btn.dataset.lang === state.lang);
      btn.addEventListener("click", () => setLanguage(btn.dataset.lang));
    }
    $("footer-generated").textContent = t("footer.generated", { date: data.generated });
    document.addEventListener("click", (e) => {
      if (e.target.closest(".slot-alts") || e.target.closest(".slot-alt-list")) return;
      for (const el of document.querySelectorAll(".slot-alt-list:not([hidden])")) el.hidden = true;
    });
    renderInputs();
    compute();
  }

  init();
})();
