(function (root) {
  const TYPES = ["speed", "stamina", "power", "guts", "wit", "friend", "group"];
  const DECK_SIZE = 6;
  const MAX_WANTED = 150;
  const MAX_VARIANTS = 8;
  const WORD_BITS = 31;

  const LIMIT_BREAKS = 5;
  const MAX_LIMIT_BREAK = LIMIT_BREAKS - 1;
  const FILL_DECAY = 0.5;

  const Mask = {
    words(count) {
      return Math.max(1, Math.ceil(count / WORD_BITS));
    },
    empty(words) {
      const m = new Array(words);
      for (let i = 0; i < words; i++) m[i] = 0;
      return m;
    },
    full(count) {
      const m = Mask.empty(Mask.words(count));
      for (let i = 0; i < count; i++) Mask.set(m, i);
      return m;
    },
    set(m, pos) {
      m[(pos / WORD_BITS) | 0] |= 1 << pos % WORD_BITS;
    },
    has(m, pos) {
      return (m[(pos / WORD_BITS) | 0] & (1 << pos % WORD_BITS)) !== 0;
    },
    or(a, b) {
      const out = new Array(a.length);
      for (let i = 0; i < a.length; i++) out[i] = a[i] | b[i];
      return out;
    },
    and(a, b) {
      const out = new Array(a.length);
      for (let i = 0; i < a.length; i++) out[i] = a[i] & b[i];
      return out;
    },
    andNot(a, b) {
      const out = new Array(a.length);
      for (let i = 0; i < a.length; i++) out[i] = a[i] & ~b[i];
      return out;
    },
    isZero(m) {
      for (let i = 0; i < m.length; i++) if (m[i]) return false;
      return true;
    },
    equals(a, b) {
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    },
    isSubset(a, b) {
      for (let i = 0; i < a.length; i++) if (a[i] & ~b[i]) return false;
      return true;
    },
    anyGain(cand, covered) {
      for (let i = 0; i < cand.length; i++) if (cand[i] & ~covered[i]) return true;
      return false;
    },
    key(m) {
      return m.join(",");
    },
    popcount(m) {
      let n = 0;
      for (let i = 0; i < m.length; i++) {
        let bits = m[i];
        while (bits) {
          bits &= bits - 1;
          n++;
        }
      }
      return n;
    },
    indexes(m) {
      const out = [];
      for (let w = 0; w < m.length; w++) {
        let bits = m[w];
        while (bits) {
          const low = bits & -bits;
          out.push(w * WORD_BITS + 31 - Math.clz32(low));
          bits ^= low;
        }
      }
      return out;
    },
    weight(m, weights) {
      let total = 0;
      for (let w = 0; w < m.length; w++) {
        let bits = m[w];
        while (bits) {
          const low = bits & -bits;
          total += weights[w * WORD_BITS + 31 - Math.clz32(low)];
          bits ^= low;
        }
      }
      return total;
    },
    gain(cand, covered, weights) {
      let total = 0;
      for (let w = 0; w < cand.length; w++) {
        let bits = cand[w] & ~covered[w];
        while (bits) {
          const low = bits & -bits;
          total += weights[w * WORD_BITS + 31 - Math.clz32(low)];
          bits ^= low;
        }
      }
      return total;
    },
  };

  function isGoldSkill(skill) {
    return Boolean(skill) && skill.rar >= 2 && skill.id < 900000;
  }

  function isInheritableSkill(skill) {
    return Boolean(skill) && (Boolean(skill.inh) || skill.id >= 900000);
  }

  function createIndex(data) {
    const skillById = new Map(data.skills.map((s) => [s.id, s]));
    const cardById = new Map(data.cards.map((c) => [c.id, c]));
    const charaById = new Map(data.charas.map((c) => [c.id, c]));
    const lower = new Map();
    for (const s of data.skills) if (s.low && skillById.has(s.low)) lower.set(s.id, s.low);
    const upper = new Map();
    for (const [u, l] of lower) upper.set(l, u);
    const scenarios = (data.scenarios || []).filter((sc) => sc.grants.length || sc.teammates.length);
    const charaNameByCharaId = new Map();
    for (const c of data.charas) if (!charaNameByCharaId.has(c.charaId)) charaNameByCharaId.set(c.charaId, c.name);
    const index = { data, skillById, cardById, charaById, charaNameByCharaId, lower, upper, scenarios };

    const push = (map, id, owner) => {
      if (!map.has(id)) map.set(id, []);
      if (!map.get(id).includes(owner)) map.get(id).push(owner);
    };
    index.skillCards = new Map();
    index.skillCardEvents = new Map();
    for (const card of data.cards) {
      const hinted = expandDown(index, card.hints);
      for (const id of hinted) push(index.skillCards, id, card.id);
      for (const id of expandDown(index, eventSkillIds(card))) if (!hinted.has(id)) push(index.skillCardEvents, id, card.id);
    }
    index.skillCharas = new Map();
    index.skillCharaEvents = new Map();
    for (const chara of data.charas) {
      const innate = expandDown(index, charaSkillIds(chara, 5));
      for (const id of innate) push(index.skillCharas, id, chara.id);
      for (const id of expandDown(index, eventSkillIds(chara))) if (!innate.has(id)) push(index.skillCharaEvents, id, chara.id);
    }
    index.skillScenarios = new Map();
    for (const sc of scenarios) {
      for (const grant of sc.grants) {
        const ids = grant.skills.slice();
        for (const option of grant.options || []) ids.push(...option.skills, ...(option.fallback || []));
        for (const id of expandDown(index, ids)) push(index.skillScenarios, id, sc.id);
      }
      for (const charaId of sc.teammates) {
        const pool = teammatePool(index, charaId);
        for (const id of expandDown(index, pool)) push(index.skillScenarios, id, sc.id);
      }
    }
    index.isGold = (id) => isGoldSkill(skillById.get(id));
    index.isInheritable = (id) => isInheritableSkill(skillById.get(id));
    return index;
  }

  function teammatePool(index, charaId) {
    const cards = index.data.cards.filter((c) => c.charaId === charaId && c.hints.length).sort((a, b) => a.rar - b.rar);
    return cards.length ? cards[0].hints : [];
  }

  function eventSkillIds(owner) {
    const ids = [];
    for (const event of owner.events || []) for (const option of event.o) for (const id of option.s) ids.push(id);
    return ids;
  }

  function expandDown(index, ids) {
    const out = new Set();
    for (const id of ids) {
      let cur = id;
      while (cur !== undefined && !out.has(cur)) {
        out.add(cur);
        cur = index.lower.get(cur);
      }
    }
    return out;
  }

  function inheritableFallback(index, id) {
    let cur = index.lower.get(id);
    while (cur !== undefined) {
      if (index.isInheritable(cur)) return cur;
      cur = index.lower.get(cur);
    }
    return 0;
  }

  function charaSkillIds(chara, awakening) {
    const ids = chara.skills.filter((s) => s.rank <= awakening).map((s) => s.id);
    if (chara.unique) ids.push(chara.unique + 800000);
    return ids;
  }

  function splitEvents(index, owner, label, skipSecret) {
    const free = [];
    const groups = [];
    const origins = new Map();
    for (const event of owner.events || []) {
      const secret = event.g === "secret";
      if (secret && skipSecret) continue;
      if ((event.c || event.o.length) <= 1) {
        for (const id of expandDown(index, event.o[0].s)) {
          free.push(id);
          if (!origins.has(id)) origins.set(id, { event: event.n, secret });
        }
      } else groups.push({ owner: label, name: event.n, secret, options: event.o.map((option, i) => ({ text: option.t, set: expandDown(index, option.s), index: option.n ? option.n - 1 : i })) });
    }
    return { free, groups, origins };
  }

  function charaSources(index, chara, awakening, label, skipSecret) {
    const events = splitEvents(index, chara, label, skipSecret);
    const innate = expandDown(index, charaSkillIds(chara, awakening));
    const origins = new Map();
    for (const [id, origin] of events.origins) if (origin.secret && !innate.has(id)) origins.set(id, origin);
    return { free: expandDown(index, [...innate].concat(events.free)), innate, groups: events.groups, origins };
  }

  function cardSources(index, card, label) {
    const events = splitEvents(index, card, label);
    return { free: expandDown(index, card.hints.concat(events.free)), groups: events.groups };
  }

  function scenarioSources(index, scenario, ownerCharaId, deckCardIds, deferLinks) {
    const deckCharas = new Set((deckCardIds || []).map((id) => (index.cardById.get(id) || {}).charaId).filter(Boolean));
    const free = [];
    const origin = new Map();
    const groups = [];
    const note = (ids, how, extra) => {
      for (const id of expandDown(index, ids)) if (!origin.has(id)) origin.set(id, Object.assign({ how }, extra || {}));
    };
    const optionText = (option, ids, withLink) => {
      const skill = index.skillById.get(ids[0]);
      const base = (withLink && option.name) || (skill ? skill.name : "");
      const chara = withLink && option.link ? index.charaNameByCharaId.get(option.link) : "";
      return chara ? `${base} (${chara})` : base;
    };
    scenario.grants.forEach((grant, grantIndex) => {
      if (grant.skills.length) {
        free.push(...grant.skills);
        note(grant.skills, grant.how, grant.note ? { note: grant.note } : null);
      }
      if (!grant.options || !grant.options.length) return;
      const options = [];
      const links = [];
      for (const option of grant.options) {
        const linked = !option.link || option.link === ownerCharaId || deckCharas.has(option.link);
        const text = optionText(option, option.skills, true);
        if (linked) {
          note(option.skills, grant.how, { link: option.link || 0, option: text });
          options.push({ text, set: expandDown(index, option.skills), link: option.link || 0, linked: true });
          continue;
        }
        if (option.fallback.length) {
          const fallbackText = optionText(option, option.fallback, false);
          note(option.fallback, grant.how, { link: 0, option: fallbackText });
          options.push({ text: fallbackText, set: expandDown(index, option.fallback), link: 0, linked: false });
        }
        if (deferLinks) links.push({ text, set: expandDown(index, option.skills), link: option.link });
      }
      if (options.length || links.length) groups.push({ owner: "scenario", key: `${scenario.id}:${grant.how}:${grantIndex}`, name: `${scenario.name}: ${grant.how}`, how: grant.how, options, links });
    });
    for (const charaId of scenario.teammates) {
      if (charaId === ownerCharaId || deckCharas.has(charaId)) continue;
      const pool = teammatePool(index, charaId);
      free.push(...pool);
      note(pool, "teammate", { teammate: charaId });
    }
    return { free: expandDown(index, free), groups, origin };
  }

  function inheritableOnly(index, set) {
    const out = new Set();
    for (const id of set) if (index.isInheritable(id)) out.add(id);
    return out;
  }

  function weightsFor(count, mode) {
    const weights = [];
    const steep = Math.min(1, 50 / Math.max(1, count - 1));
    for (let i = 0; i < count; i++) {
      if (mode === "strict") weights.push(Math.pow(2, (count - 1 - i) * steep));
      else if (mode === "count") weights.push(1 + (count - i) / (2 * count * count));
      else weights.push(count - i);
    }
    return weights;
  }

  function setMask(set, position, words) {
    const mask = Mask.empty(words);
    for (const id of set) {
      const pos = position.get(id);
      if (pos !== undefined) Mask.set(mask, pos);
    }
    return mask;
  }

  function resolveGroups(groups, position, weights, covered, transform) {
    const picks = [];
    let mask = Mask.empty(covered.length);
    for (const group of groups) {
      let best = null;
      let bestGain = 0;
      group.options.forEach((option, i) => {
        const gainMask = Mask.andNot(setMask(transform ? transform(option.set) : option.set, position, covered.length), Mask.or(covered, mask));
        const gain = Mask.weight(gainMask, weights);
        if (gain > bestGain) {
          best = { optionIndex: i, mask: gainMask };
          bestGain = gain;
        }
      });
      if (best) {
        mask = Mask.or(mask, best.mask);
        const chosen = group.options[best.optionIndex];
        picks.push({ owner: group.owner, name: group.name, how: group.how, option: chosen.text, optionIndex: chosen.index !== undefined ? chosen.index : best.optionIndex, ids: Mask.indexes(best.mask) });
      }
    }
    return { mask, picks };
  }

  function limitBreakOf(limitBreaks, cardId) {
    const raw = Math.floor(Number((limitBreaks || {})[cardId]));
    return Number.isFinite(raw) ? Math.min(MAX_LIMIT_BREAK, Math.max(0, raw)) : MAX_LIMIT_BREAK;
  }

  function hintStat(card, key, limitBreak) {
    const values = card[key];
    if (!values || !values.length) return 0;
    return values[Math.min(values.length - 1, limitBreak)] || 0;
  }

  function cardQuality(card, opts) {
    const limitBreak = limitBreakOf(opts.limitBreaks, card.id);
    const frequency = opts.preferHintFreq ? hintStat(card, "hf", limitBreak) : 0;
    const level = opts.preferHintLevel ? hintStat(card, "hl", limitBreak) : 0;
    return frequency * 100 + level * 10 + card.rar;
  }

  function qualityIndex(index, opts) {
    const map = new Map();
    for (const card of index.data.cards) map.set(card.id, cardQuality(card, opts));
    return (card) => map.get(card.id) || card.rar;
  }

  function cardVariants(index, card, position, weights, remainingMask, owned, quality) {
    const words = remainingMask.length;
    const sources = cardSources(index, card, "card");
    const baseMask = Mask.and(setMask(inheritableOnly(index, sources.free), position, words), remainingMask);
    const groupMasks = sources.groups
      .map((group) => ({
        group,
        options: group.options
          .map((option, i) => ({ i: option.index !== undefined ? option.index : i, text: option.text, mask: Mask.and(setMask(inheritableOnly(index, option.set), position, words), remainingMask) }))
          .filter((o) => !Mask.isZero(o.mask)),
      }))
      .filter((g) => g.options.length);
    let combos = [{ mask: baseMask, choices: [] }];
    let total = 1;
    for (const g of groupMasks) total *= g.options.length + 1;
    if (total <= MAX_VARIANTS) {
      for (const g of groupMasks) {
        const next = [];
        for (const combo of combos) {
          next.push(combo);
          for (const option of g.options) next.push({ mask: Mask.or(combo.mask, option.mask), choices: combo.choices.concat({ name: g.group.name, option: option.text, optionIndex: option.i, mask: option.mask }) });
        }
        combos = next;
      }
    } else {
      let mask = baseMask;
      const choices = [];
      for (const g of groupMasks) {
        let best = null;
        let bestGain = 0;
        for (const option of g.options) {
          const gain = Mask.gain(option.mask, mask, weights);
          if (gain > bestGain) {
            best = option;
            bestGain = gain;
          }
        }
        if (best) {
          mask = Mask.or(mask, best.mask);
          choices.push({ name: g.group.name, option: best.text, optionIndex: best.i, mask: best.mask });
        }
      }
      combos = [{ mask, choices }];
    }
    const variants = [];
    const seen = new Set();
    for (const combo of combos) {
      const key = Mask.key(combo.mask);
      if (Mask.isZero(combo.mask) || seen.has(key)) continue;
      seen.add(key);
      variants.push({ kind: "card", id: card.id, charaId: card.charaId || 0, type: card.type, rar: card.rar, q: quality(card), owned, mask: combo.mask, hintMask: baseMask, linkMask: Mask.empty(words), weight: Mask.weight(combo.mask, weights), choices: combo.choices, alts: [], groups: [], links: [] });
    }
    return variants;
  }

  function buildCandidates(index, position, weights, remainingMask, notOwned, excludeCharaId, quality, keepDominated) {
    const raw = [];
    for (const card of index.data.cards) {
      if (!card.hints.length && !(card.events || []).length) continue;
      if (excludeCharaId && card.charaId === excludeCharaId) continue;
      raw.push(...cardVariants(index, card, position, weights, remainingMask, !notOwned.has(card.id), quality));
    }
    for (const cand of raw) cand.bits = Mask.popcount(cand.mask);
    raw.sort((a, b) => b.bits - a.bits || b.q - a.q || (b.owned ? 1 : 0) - (a.owned ? 1 : 0) || a.choices.length - b.choices.length || b.id - a.id);
    const kept = [];
    const dominatedCards = new Map();
    for (const cand of raw) {
      const dominator = kept.find((k) => k.type === cand.type && Mask.isSubset(cand.mask, k.mask) && k.q >= cand.q && (k.owned || !cand.owned));
      if (dominator) {
        if (dominator.id !== cand.id && Mask.equals(dominator.mask, cand.mask) && !dominator.alts.includes(cand.id)) dominator.alts.push(cand.id);
        if (keepDominated && !dominatedCards.has(cand.id)) dominatedCards.set(cand.id, cand);
        continue;
      }
      kept.push(cand);
    }
    if (!keepDominated) return sortCandidates(kept);
    const chosen = new Set(kept.map((c) => c.id));
    return sortCandidates(kept.concat([...dominatedCards.values()].filter((c) => !chosen.has(c.id))));
  }

  function sortCandidates(cands) {
    cands.sort((a, b) => b.weight - a.weight || b.q - a.q || (b.owned ? 1 : 0) - (a.owned ? 1 : 0) || b.id - a.id);
    return cands;
  }

  function restrictCandidates(cands, removeMask, weights) {
    if (Mask.isZero(removeMask)) return cands;
    const out = [];
    const seen = new Set();
    for (const cand of cands) {
      const mask = Mask.andNot(cand.mask, removeMask);
      if (Mask.isZero(mask)) continue;
      const key = `${cand.id}|${Mask.key(mask)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (Mask.equals(mask, cand.mask)) {
        out.push(cand);
        continue;
      }
      const choices = cand.choices.map((choice) => Object.assign({}, choice, { mask: Mask.andNot(choice.mask, removeMask) })).filter((choice) => !Mask.isZero(choice.mask));
      out.push(Object.assign({}, cand, { mask, hintMask: Mask.andNot(cand.hintMask, removeMask), weight: Mask.weight(mask, weights), bits: Mask.popcount(mask), choices }));
    }
    return out;
  }

  function betterSeed(a, b) {
    return a.score > b.score || (a.score === b.score && (a.count < b.count || (a.count === b.count && !a.borrowed && b.borrowed)));
  }

  function bestSeed(cands, hasExtras, weights, constraints, words) {
    const plain = greedy(cands, weights, constraints, words, false);
    if (!hasExtras) return plain;
    const eager = greedy(cands, weights, constraints, words, true);
    return betterSeed(eager, plain) ? eager : plain;
  }

  function deckGroupCandidates(index, groups, position, weights, remaining, notOwned, excludeCharaId, plain, variantCache, quality) {
    const words = remaining.length;
    const out = [];
    const full = Mask.full(position.size);
    const variantsOf = (card, owned) => {
      const key = `${card.id}|${owned ? 1 : 0}`;
      if (!variantCache.has(key)) variantCache.set(key, cardVariants(index, card, position, weights, full, owned, quality));
      const variants = restrictCandidates(variantCache.get(key), Mask.andNot(full, remaining), weights);
      return variants.length ? variants : [{ kind: "card", id: card.id, charaId: card.charaId, type: card.type, rar: card.rar, q: quality(card), owned, mask: Mask.empty(words), hintMask: Mask.empty(words), linkMask: Mask.empty(words), weight: 0, choices: [], alts: [], groups: [], links: [] }];
    };
    const dominated = (cand) => plain.some((k) => k.type === cand.type && Mask.isSubset(cand.mask, k.mask) && k.q >= cand.q && (k.owned || !cand.owned));
    for (const group of groups) {
      const options = group.options
        .map((option) => ({ option, mask: Mask.and(setMask(inheritableOnly(index, option.set), position, words), remaining) }))
        .filter((o) => !Mask.isZero(o.mask))
        .sort((a, b) => Mask.popcount(b.mask) - Mask.popcount(a.mask));
      const kept = [];
      for (const o of options) if (!kept.some((k) => Mask.isSubset(o.mask, k.mask))) kept.push(o);
      for (const o of kept) {
        out.push({ kind: "choice", id: 0, charaId: 0, type: "choice", rar: 0, q: 0, owned: true, mask: o.mask, hintMask: Mask.empty(words), linkMask: o.mask, weight: Mask.weight(o.mask, weights), bits: Mask.popcount(o.mask), choices: [], alts: [], groups: [group.key], links: [], choice: { name: group.name, how: group.how, text: o.option.text, link: o.option.link } });
      }
      const linked = [];
      for (const link of group.links) {
        if (link.link === excludeCharaId) continue;
        const linkMask = Mask.and(setMask(inheritableOnly(index, link.set), position, words), remaining);
        if (Mask.isZero(linkMask) || options.some((o) => Mask.isSubset(linkMask, o.mask))) continue;
        for (const card of index.data.cards) {
          if (card.charaId !== link.link) continue;
          const owned = !notOwned.has(card.id);
          for (const variant of variantsOf(card, owned)) {
            const added = Mask.andNot(linkMask, variant.mask);
            if (Mask.isZero(added)) continue;
            const mask = Mask.or(variant.mask, added);
            const cand = Object.assign({}, variant, { mask, linkMask: added, weight: Mask.weight(mask, weights), bits: Mask.popcount(mask), groups: [group.key], links: [{ name: group.name, how: group.how, text: link.text, link: link.link, mask: added }], alts: [] });
            if (!dominated(cand)) linked.push(cand);
          }
        }
      }
      linked.sort((a, b) => b.bits - a.bits || b.q - a.q || (b.owned ? 1 : 0) - (a.owned ? 1 : 0) || a.choices.length - b.choices.length || b.id - a.id);
      for (const cand of linked) {
        if (!out.some((k) => k.kind === "card" && k.type === cand.type && Mask.isSubset(cand.mask, k.mask) && k.q >= cand.q && (k.owned || !cand.owned))) out.push(cand);
      }
    }
    return out;
  }

  function makeConstraints(typeMin) {
    const mins = {};
    let reserved = 0;
    for (const t of TYPES) {
      mins[t] = Math.max(0, Math.floor(Number(typeMin[t]) || 0));
      reserved += mins[t];
    }
    return { mins, free: Math.max(0, DECK_SIZE - reserved) };
  }

  function canAdd(state, cand, constraints) {
    if (cand.groups.length && cand.groups.some((g) => state.groups.includes(g))) return false;
    if (cand.kind === "choice") return true;
    if (state.count >= DECK_SIZE) return false;
    if (!cand.owned && state.borrowed) return false;
    if (state.cards.includes(cand.id)) return false;
    if (cand.charaId && state.charas.includes(cand.charaId)) return false;
    const current = state.typeCounts[cand.type] || 0;
    if (current >= constraints.mins[cand.type] && state.overflow + 1 > constraints.free) return false;
    return true;
  }

  function applyAdd(state, cand, constraints, gain) {
    const next = Object.assign({}, state, {
      covered: Mask.or(state.covered, cand.mask),
      score: state.score + gain,
      chosen: state.chosen.concat(cand),
      groups: cand.groups.length ? state.groups.concat(cand.groups) : state.groups,
    });
    if (cand.kind === "choice") return next;
    const typeCounts = Object.assign({}, state.typeCounts);
    const current = typeCounts[cand.type] || 0;
    typeCounts[cand.type] = current + 1;
    next.count = state.count + 1;
    next.typeCounts = typeCounts;
    next.overflow = state.overflow + (current >= constraints.mins[cand.type] ? 1 : 0);
    next.borrowed = state.borrowed || !cand.owned;
    next.qualitySum = state.qualitySum + cand.q;
    next.cards = state.cards.concat(cand.id);
    next.charas = state.charas.concat(cand.charaId || []);
    return next;
  }

  function emptyState(words) {
    return { covered: Mask.empty(words), count: 0, typeCounts: {}, overflow: 0, borrowed: false, score: 0, qualitySum: 0, cards: [], charas: [], chosen: [], groups: [] };
  }

  function greedy(cands, weights, constraints, words, preferChoices) {
    let state = emptyState(words);
    for (;;) {
      let best = null;
      let bestGain = 0;
      for (const cand of cands) {
        if (!Mask.anyGain(cand.mask, state.covered) || !canAdd(state, cand, constraints)) continue;
        if (preferChoices && best && (best.kind === "choice") !== (cand.kind === "choice")) {
          if (best.kind === "choice") continue;
          best = null;
          bestGain = 0;
        }
        const gain = Mask.gain(cand.mask, state.covered, weights);
        if (gain > bestGain || (gain === bestGain && best && (cand.q > best.q || (cand.q === best.q && cand.owned && !best.owned)))) {
          best = cand;
          bestGain = gain;
        }
      }
      if (!best) return state;
      state = applyAdd(state, best, constraints, bestGain);
    }
  }

  function betterDeck(a, b) {
    if (a.score !== b.score) return a.score > b.score;
    if (a.count !== b.count) return a.count < b.count;
    if (a.qualitySum !== b.qualitySum) return a.qualitySum > b.qualitySum;
    if (a.borrowed !== b.borrowed) return !a.borrowed;
    const assumptions = (c) => c.choices.length + c.links.length + (c.kind === "choice" ? 1 : 0);
    const ca = a.chosen.reduce((n, c) => n + assumptions(c), 0);
    const cb = b.chosen.reduce((n, c) => n + assumptions(c), 0);
    if (ca !== cb) return ca < cb;
    return false;
  }

  function searchDecks(cands, weights, constraints, maxDecks, nodeBudget, words, initial) {
    const pool = cands.filter((c) => c.kind !== "choice");
    const choices = cands.filter((c) => c.kind === "choice");
    const results = new Map();
    const ordered = [];
    let nodes = 0;
    let complete = true;

    function kthScore() {
      return ordered.length < maxDecks ? -Infinity : ordered[ordered.length - 1].score;
    }

    function sortOrdered() {
      ordered.sort((a, b) => (betterDeck(a, b) ? -1 : betterDeck(b, a) ? 1 : 0));
    }

    function bestChoices(state) {
      const best = new Map();
      for (const choice of choices) {
        const group = choice.groups[0];
        if (state.groups.includes(group)) continue;
        const gain = Mask.gain(choice.mask, state.covered, weights);
        if (gain > 0 && (!best.has(group) || gain > best.get(group).gain)) best.set(group, { choice, gain });
      }
      return best;
    }

    function withChoices(state) {
      let out = state;
      for (const { choice } of bestChoices(state).values()) out = applyAdd(out, choice, constraints, Mask.gain(choice.mask, out.covered, weights));
      return out;
    }

    function choiceBound(state) {
      let total = 0;
      for (const { gain } of bestChoices(state).values()) total += gain;
      return total;
    }

    function record(state) {
      const key = Mask.key(state.covered);
      const existing = results.get(key);
      if (existing) {
        if (betterDeck(state, existing)) {
          results.set(key, state);
          ordered[ordered.indexOf(existing)] = state;
          sortOrdered();
        }
        return;
      }
      if (ordered.length >= maxDecks && state.score <= kthScore()) return;
      results.set(key, state);
      ordered.push(state);
      sortOrdered();
      if (ordered.length > maxDecks) {
        const dropped = ordered.pop();
        results.delete(Mask.key(dropped.covered));
      }
    }

    const seed = withChoices(initial || greedy(cands, weights, constraints, words));
    if (seed.chosen.length) record(seed);

    function visit(state, rest) {
      if (nodes++ > nodeBudget) {
        complete = false;
        return;
      }
      const slotsLeft = DECK_SIZE - state.count;
      if (!slotsLeft) return;
      const children = [];
      for (const cand of rest) {
        if (!Mask.anyGain(cand.mask, state.covered) || !canAdd(state, cand, constraints)) continue;
        children.push({ cand, gain: Mask.gain(cand.mask, state.covered, weights) });
      }
      if (!children.length) return;
      children.sort((a, b) => b.gain - a.gain || b.cand.q - a.cand.q || (b.cand.owned ? 1 : 0) - (a.cand.owned ? 1 : 0));
      const gains = children.map((c) => c.gain);
      const extra = choices.length ? choiceBound(state) : 0;
      for (let j = 0; j < children.length; j++) {
        let bound = state.score + gains[j] + extra;
        for (let k = j + 1; k < children.length && k <= j + slotsLeft - 1; k++) bound += gains[k];
        if (ordered.length >= maxDecks && bound <= kthScore()) break;
        const next = applyAdd(state, children[j].cand, constraints, gains[j]);
        record(choices.length ? withChoices(next) : next);
        if (next.count < DECK_SIZE) visit(next, children.slice(j + 1).map((c) => c.cand));
        if (!complete) return;
      }
    }

    const start = emptyState(words);
    if (choices.length) record(withChoices(start));
    visit(start, pool);
    return { decks: ordered.filter((s) => s.chosen.length).map((s) => pruneRedundant(s, weights, constraints, words)), complete, nodes };
  }

  function pruneRedundant(state, weights, constraints, words) {
    const chosen = state.chosen.slice().sort((a, b) => (a.kind === "choice" ? 1 : 0) - (b.kind === "choice" ? 1 : 0) || a.q - b.q || (a.owned ? 1 : 0) - (b.owned ? 1 : 0));
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < chosen.length; i++) {
        let others = Mask.empty(words);
        for (let j = 0; j < chosen.length; j++) if (j !== i) others = Mask.or(others, chosen[j].mask);
        if (Mask.isSubset(chosen[i].mask, others)) {
          chosen.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    let rebuilt = emptyState(words);
    for (const cand of chosen) rebuilt = applyAdd(rebuilt, cand, constraints, Mask.gain(cand.mask, rebuilt.covered, weights));
    return rebuilt;
  }

  function fillDeck(state, pool, weights, constraints) {
    if (!pool || !pool.length) return state;
    const counts = [];
    const bump = (cand) => {
      for (const i of Mask.indexes(cand.mask)) counts[i] = (counts[i] || 0) + 1;
    };
    let out = state;
    for (const cand of out.chosen) if (cand.kind !== "choice") bump(cand);
    const score = (cand) => {
      let total = 0;
      for (const i of Mask.indexes(cand.mask)) total += weights[i] * Math.pow(FILL_DECAY, counts[i] || 0);
      return total;
    };
    const pick = (type) => {
      let best = null;
      let bestScore = 0;
      for (const cand of pool) {
        if (type && cand.type !== type) continue;
        if (!canAdd(out, cand, constraints)) continue;
        const value = score(cand);
        if (value > bestScore || (value === bestScore && best && (cand.q > best.q || (cand.q === best.q && cand.owned && !best.owned)))) {
          best = cand;
          bestScore = value;
        }
      }
      return best;
    };
    const add = (cand) => {
      out = applyAdd(out, Object.assign({}, cand, { extra: true }), constraints, Mask.gain(cand.mask, out.covered, weights));
      bump(cand);
    };
    for (const type of TYPES) {
      while ((out.typeCounts[type] || 0) < constraints.mins[type] && out.count < DECK_SIZE) {
        const best = pick(type);
        if (!best) break;
        add(best);
      }
    }
    while (out.count < DECK_SIZE) {
      const best = pick(null);
      if (!best) break;
      add(best);
    }
    return out;
  }

  function frontier(decks) {
    const kept = [];
    for (const deck of decks) {
      const dominated = kept.some((k) => Mask.isSubset(deck.coveredMask, k.coveredMask) && !Mask.equals(k.coveredMask, deck.coveredMask));
      if (!dominated) kept.push(deck);
    }
    return kept;
  }

  function describeDeck(state, ctx) {
    const cards = state.chosen.filter((c) => c.kind !== "choice").sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || b.q - a.q || a.id - b.id);
    const picks = state.chosen.filter((c) => c.kind === "choice");
    const scenarioId = ctx.scenario ? ctx.scenario.id : "";
    const names = (mask) => Mask.indexes(mask).map((i) => ctx.effective[i]);
    const typeCounts = {};
    for (const c of cards) typeCounts[c.type] = (typeCounts[c.type] || 0) + 1;
    const slots = cards.map((c) => ({
      kind: "card",
      id: c.id,
      borrowed: !c.owned,
      extra: Boolean(c.extra),
      alts: c.alts,
      skills: names(c.mask),
      eventSkills: names(Mask.andNot(Mask.andNot(c.mask, c.hintMask), c.linkMask)),
      linkSkills: names(c.linkMask),
      choices: c.choices.map((choice) => ({ name: choice.name, option: choice.option, optionIndex: choice.optionIndex, skills: names(choice.mask) })),
      links: c.links.map((link) => ({ name: link.name, how: link.how, option: link.text, link: link.link, scenario: scenarioId, skills: names(link.mask) })),
    }));
    for (const t of TYPES) {
      let missing = ctx.constraints.mins[t] - (typeCounts[t] || 0);
      while (missing-- > 0 && slots.length < DECK_SIZE) slots.push({ kind: "type", type: t });
    }
    while (slots.length < DECK_SIZE) slots.push({ kind: "free" });

    const covered = [];
    const missing = [];
    for (let i = 0; i < ctx.effective.length; i++) {
      const id = ctx.effective[i];
      if (Mask.has(ctx.ownMask, i)) covered.push(Object.assign({ id, from: "parent", viaEvent: Mask.has(ctx.parentEventMask, i) }, ctx.parentOrigins.get(id) || {}));
      else if (Mask.has(ctx.scenarioMask, i)) covered.push({ id, from: "scenario", scenario: scenarioId, origin: ctx.scenarioOrigin.get(id) || null });
      else if (Mask.has(ctx.parentMask, i)) covered.push({ id, from: "grandparent", grandparent: ctx.grandBy.get(i) });
      else if (Mask.has(state.covered, i)) {
        const providers = cards.filter((c) => Mask.has(c.mask, i) && !Mask.has(c.linkMask, i));
        if (providers.length) covered.push({ id, from: "card", cards: providers.map((c) => c.id), viaEvent: providers.every((c) => !Mask.has(c.hintMask, i)) });
        else {
          const linker = cards.find((c) => Mask.has(c.linkMask, i));
          const pick = linker ? null : picks.find((p) => Mask.has(p.mask, i));
          const source = linker ? linker.links.find((l) => Mask.has(l.mask, i)) : pick ? pick.choice : null;
          covered.push({ id, from: "scenario", scenario: scenarioId, origin: source ? { how: source.how, link: source.link, option: source.text, card: linker ? linker.id : 0 } : null });
        }
      } else if (ctx.cardSources.has(id)) missing.push({ id, reason: "limit" });
      else if (Mask.has(ctx.secretMask, i)) missing.push({ id, reason: "secret" });
      else if (ctx.parentSources.has(id)) missing.push({ id, reason: "nocard" });
      else if (ctx.scenarioSources.has(id)) missing.push({ id, reason: "scenario", via: ctx.scenarioSources.get(id) });
      else if (ctx.charaSources.has(id)) missing.push({ id, reason: "grandparent", via: ctx.grandSources(id) });
      else missing.push({ id, reason: "none" });
    }
    const scenarioChoices = picks
      .map((p) => ({ name: p.choice.name, how: p.choice.how, option: p.choice.text, link: p.choice.link, card: 0, skills: names(p.mask) }))
      .concat(cards.flatMap((c) => c.links.map((l) => ({ name: l.name, how: l.how, option: l.text, link: l.link, card: c.id, skills: names(l.mask) }))));
    return {
      slots,
      coveredMask: Mask.or(state.covered, ctx.parentMask),
      cardIds: cards.map((c) => c.id),
      score: state.score + ctx.parentScore,
      deckScore: state.score,
      cardCount: cards.length,
      qualitySum: state.qualitySum,
      borrowed: state.borrowed,
      covered,
      missing,
      coveredCount: covered.length,
      scenario: covered.some((c) => c.from === "scenario") ? scenarioId : "",
      scenarioChoices,
    };
  }

  function solve(index, opts) {
    const weightMode = opts.weightMode || "balanced";
    const notOwned = opts.notOwned instanceof Set ? opts.notOwned : new Set(opts.notOwned || []);
    const notOwnedCharas = opts.notOwnedCharas instanceof Set ? opts.notOwnedCharas : new Set(opts.notOwnedCharas || []);
    const excludeCharaIds = new Set(opts.excludeCharaIds || []);
    const grandparents = (opts.grandparents || []).map((id) => index.charaById.get(Number(id))).filter(Boolean);
    const grandCharaIds = new Set(grandparents.map((g) => g.charaId));
    const constraints = makeConstraints(opts.typeMin || {});
    const quality = qualityIndex(index, opts);
    const fillSlots = Boolean(opts.fillDeck);
    const maxDecks = opts.maxDecks || 10;
    const maxParents = opts.maxParents || 8;
    const target = opts.target || {};
    const parentOpts = opts.parent || {};
    const parentAwakening = parentOpts.awakening || 5;
    const traineeScenario = index.scenarios.find((sc) => sc.id === target.scenario) || null;
    const parentScenarioChoice = parentOpts.scenario || "auto";
    const parentScenarioPool = parentScenarioChoice === "auto" ? index.scenarios : index.scenarios.filter((sc) => sc.id === parentScenarioChoice);

    const wanted = [];
    for (const raw of opts.wanted || []) {
      const id = Number(raw);
      if (index.skillById.has(id) && !wanted.includes(id)) wanted.push(id);
      if (wanted.length >= MAX_WANTED) break;
    }

    const traineeReason = new Map();
    const traineeGroups = [];
    const targetChara = target.charaId ? index.charaById.get(target.charaId) : null;
    const targetCharaId = targetChara ? targetChara.charaId : 0;
    if (targetChara) {
      const innate = expandDown(index, charaSkillIds(targetChara, target.awakening || 5));
      for (const id of innate) traineeReason.set(id, { reason: "target" });
      const events = splitEvents(index, targetChara, "target", Boolean(traineeScenario && traineeScenario.id === "trackblazer"));
      for (const id of expandDown(index, events.free)) if (!traineeReason.has(id)) traineeReason.set(id, Object.assign({ reason: "targetEvent" }, events.origins.get(id) || {}));
      traineeGroups.push(...events.groups);
    }
    for (const cardId of target.deck || []) {
      const card = index.cardById.get(cardId);
      if (!card) continue;
      for (const id of expandDown(index, card.hints)) if (!traineeReason.has(id)) traineeReason.set(id, { reason: "deck", card: card.id });
      const events = splitEvents(index, card, "deck");
      for (const id of expandDown(index, events.free)) if (!traineeReason.has(id)) traineeReason.set(id, { reason: "deckEvent", card: card.id });
      for (const group of events.groups) traineeGroups.push(Object.assign({ card: card.id }, group));
    }
    if (traineeScenario) {
      const sources = scenarioSources(index, traineeScenario, targetCharaId, target.deck || []);
      for (const id of sources.free) if (!traineeReason.has(id)) traineeReason.set(id, Object.assign({ reason: "scenario", scenario: traineeScenario.id }, sources.origin.get(id) || {}));
      for (const group of sources.groups) traineeGroups.push(Object.assign({ scenario: traineeScenario.id, origin: sources.origin }, group));
    }

    const preliminary = wanted.filter((id) => !traineeReason.has(id));
    const prePosition = new Map(preliminary.map((id, i) => [id, i]));
    const preWeights = weightsFor(preliminary.length, weightMode);
    const groupPicks = resolveGroups(traineeGroups, prePosition, preWeights, Mask.empty(Mask.words(preliminary.length)), null);
    const traineeChoices = [];
    for (const pick of groupPicks.picks) {
      const group = traineeGroups.find((g) => g.name === pick.name && g.owner === pick.owner);
      const card = group ? group.card : undefined;
      const skills = pick.ids.map((i) => preliminary[i]);
      const reason = pick.owner === "deck" ? "deckChoice" : pick.owner === "scenario" ? "scenarioChoice" : "targetChoice";
      const secret = Boolean(group && group.secret);
      for (const id of skills) traineeReason.set(id, Object.assign({ reason, card, event: pick.name, option: pick.option, optionIndex: pick.optionIndex, secret, scenario: group ? group.scenario : undefined }, group && group.origin ? group.origin.get(id) || {} : {}));
      traineeChoices.push({ owner: pick.owner, card, scenario: group ? group.scenario : undefined, name: pick.name, how: pick.how, option: pick.option, optionIndex: pick.optionIndex, secret, skills });
    }

    const excluded = [];
    const effectiveInfo = [];
    for (const id of wanted) {
      const skill = index.skillById.get(id);
      if (traineeReason.has(id)) {
        excluded.push(Object.assign({ id }, traineeReason.get(id)));
        continue;
      }
      let effectiveId = id;
      let fallbackOf = null;
      if (!isInheritableSkill(skill)) {
        const lowerId = inheritableFallback(index, id);
        if (!lowerId) {
          excluded.push({ id, reason: "notInheritable" });
          continue;
        }
        if (traineeReason.has(lowerId)) {
          excluded.push(Object.assign({ id, white: lowerId }, traineeReason.get(lowerId), { reason: "fallbackCovered", whiteReason: traineeReason.get(lowerId).reason }));
          continue;
        }
        effectiveId = lowerId;
        fallbackOf = id;
      }
      const duplicate = effectiveInfo.find((e) => e.id === effectiveId);
      if (duplicate) {
        excluded.push({ id, reason: "duplicate", white: effectiveId, mergedWith: duplicate.fallbackOf || duplicate.id });
        continue;
      }
      effectiveInfo.push({ id: effectiveId, fallbackOf });
    }

    const effective = effectiveInfo.map((e) => e.id);
    const words = Mask.words(effective.length);
    const position = new Map(effective.map((id, i) => [id, i]));
    const weights = weightsFor(effective.length, weightMode);
    const fullMask = Mask.full(effective.length);
    const cardSourceSet = new Set(effective.filter((id) => index.skillCards.has(id) || index.skillCardEvents.has(id)));
    const charaSourceSet = new Set(effective.filter((id) => index.skillCharas.has(id) || index.skillCharaEvents.has(id)));
    const scenarioSourceMap = new Map(effective.filter((id) => index.skillScenarios.has(id)).map((id) => [id, index.skillScenarios.get(id)]));
    const unobtainable = effective.filter((id) => !cardSourceSet.has(id) && !charaSourceSet.has(id) && !scenarioSourceMap.has(id));

    let grandMask = Mask.empty(words);
    const grandBy = new Map();
    for (const grand of grandparents) {
      const sources = charaSources(index, grand, 5, "grand");
      const freeMask = setMask(inheritableOnly(index, sources.free), position, words);
      const picks = resolveGroups(sources.groups, position, weights, Mask.or(freeMask, grandMask), (set) => inheritableOnly(index, set));
      const mask = Mask.or(freeMask, picks.mask);
      for (const i of Mask.indexes(Mask.andNot(mask, grandMask))) grandBy.set(i, grand.id);
      grandMask = Mask.or(grandMask, mask);
    }

    const isEligible = (chara) => chara.charaId !== targetCharaId && !excludeCharaIds.has(chara.charaId) && !grandCharaIds.has(chara.charaId);
    const manualChara = parentOpts.charaId ? index.charaById.get(parentOpts.charaId) : null;
    const manualId = manualChara && isEligible(manualChara) ? manualChara.id : 0;
    const eligible = index.data.charas.filter((chara) => isEligible(chara) && (!notOwnedCharas.has(chara.id) || chara.id === manualId));
    const eligibleIds = new Set(index.data.charas.filter(isEligible).map((chara) => chara.id));
    const parentSourceSet = new Set(effective.filter((id) => [...(index.skillCharas.get(id) || []), ...(index.skillCharaEvents.get(id) || [])].some((cid) => eligibleIds.has(cid))));
    const grandSources = (id) => [...new Set([...(index.skillCharas.get(id) || []), ...(index.skillCharaEvents.get(id) || [])])];

    const inh = (set) => inheritableOnly(index, set);
    const variantCache = new Map();
    const assemble = (chara, plain, deckGroups, remaining) => {
      const extra = deckGroups.length ? deckGroupCandidates(index, deckGroups, position, weights, remaining, notOwned, chara.charaId, plain, variantCache, quality) : [];
      const cands = extra.length ? sortCandidates(plain.concat(extra)) : plain;
      return { cands, extra, seed: bestSeed(cands, extra.length > 0, weights, constraints, words) };
    };
    const scenarioPool = parentScenarioChoice === "auto" || !parentScenarioPool.length ? [null].concat(parentScenarioPool) : parentScenarioPool;
    const parents = eligible.map((chara) => {
      const variant = (skipSecret) => {
        const sources = charaSources(index, chara, parentAwakening, "parent", skipSecret);
        const innateMask = setMask(inheritableOnly(index, sources.innate), position, words);
        const freeMask = setMask(inheritableOnly(index, sources.free), position, words);
        const picks = resolveGroups(sources.groups, position, weights, Mask.or(freeMask, grandMask), inh);
        const ownMask = Mask.or(freeMask, picks.mask);
        const origins = new Map(sources.origins);
        for (const pick of picks.picks) {
          const group = sources.groups.find((g) => g.name === pick.name);
          for (const i of pick.ids) origins.set(effective[i], { event: pick.name, secret: Boolean(group && group.secret), option: pick.option, optionIndex: pick.optionIndex });
        }
        const secretMask = Mask.andNot(setMask(new Set(sources.origins.keys()), position, words), innateMask);
        return { ownMask, eventMask: Mask.or(picks.mask, secretMask), picks: picks.picks, origins, baseMask: Mask.or(ownMask, grandMask), baseCands: null };
      };
      const full = variant(false);
      let noSecret = (chara.events || []).some((e) => e.g === "secret") ? variant(true) : full;
      if (noSecret !== full && Mask.equals(noSecret.ownMask, full.ownMask)) noSecret = full;
      const candsFor = (own) => {
        if (!own.baseCands) own.baseCands = buildCandidates(index, position, weights, Mask.andNot(fullMask, own.baseMask), notOwned, chara.charaId, quality);
        return own.baseCands;
      };
      const evaluate = (sc) => {
        const own = sc && sc.id === "trackblazer" ? noSecret : full;
        let scenarioMask = Mask.empty(words);
        let scenarioPicks = [];
        let scenarioOrigin = new Map();
        let deckGroups = [];
        if (sc) {
          const scSources = scenarioSources(index, sc, chara.charaId, [], true);
          const scFree = setMask(inheritableOnly(index, scSources.free), position, words);
          const scPicks = resolveGroups(scSources.groups.filter((g) => !g.links.length), position, weights, Mask.or(own.baseMask, scFree), inh);
          scenarioMask = Mask.andNot(Mask.or(scFree, scPicks.mask), own.baseMask);
          scenarioPicks = scPicks.picks;
          scenarioOrigin = scSources.origin;
          deckGroups = scSources.groups.filter((g) => g.links.length);
        }
        const parentMask = Mask.or(own.baseMask, scenarioMask);
        const remaining = Mask.andNot(fullMask, parentMask);
        const built = assemble(chara, restrictCandidates(candsFor(own), scenarioMask, weights), deckGroups, remaining);
        if (sc && parentScenarioChoice === "auto" && Mask.isZero(scenarioMask) && !built.extra.length) return null;
        const parentScore = Mask.weight(parentMask, weights);
        return { scenario: sc, own, scenarioMask, scenarioPicks, scenarioOrigin, deckGroups, parentMask, parentScore, remaining, cands: built.cands, seed: built.seed, estimate: parentScore + built.seed.score, estimateCards: built.seed.count, estimateBorrow: built.seed.borrowed };
      };
      const better = (a, b) => a.estimate > b.estimate || (a.estimate === b.estimate && (a.estimateCards < b.estimateCards || (a.estimateCards === b.estimateCards && !a.estimateBorrow && b.estimateBorrow)));
      let plan = null;
      for (const sc of scenarioPool) {
        const candidate = evaluate(sc);
        if (candidate && (!plan || better(candidate, plan))) plan = candidate;
      }
      return Object.assign({ chara, ownMask: plan.own.ownMask, parentEventMask: plan.own.eventMask, parentPicks: plan.own.picks, parentOrigins: plan.own.origins, secretMask: Mask.andNot(full.ownMask, plan.own.ownMask), exact: null }, plan);
    });

    parents.sort((a, b) => b.estimate - a.estimate || a.estimateCards - b.estimateCards || Mask.popcount(b.parentMask) - Mask.popcount(a.parentMask) || a.chara.id - b.chara.id);
    const detailed = parents.slice(0, maxParents);
    const manual = manualId ? parents.find((p) => p.chara.id === manualId) : null;
    if (manual && !detailed.includes(manual)) detailed.push(manual);
    for (const p of detailed) {
      if (!Mask.isZero(p.scenarioMask)) {
        const built = assemble(p.chara, buildCandidates(index, position, weights, p.remaining, notOwned, p.chara.charaId, quality), p.deckGroups, p.remaining);
        p.cands = built.cands;
        if (betterSeed(built.seed, p.seed)) p.seed = built.seed;
      }
      const ctx = {
        effective,
        constraints,
        parentMask: p.parentMask,
        ownMask: p.ownMask,
        scenarioMask: p.scenarioMask,
        scenario: p.scenario,
        scenarioOrigin: p.scenarioOrigin,
        parentEventMask: p.parentEventMask,
        parentOrigins: p.parentOrigins,
        secretMask: p.secretMask,
        grandBy,
        parentScore: p.parentScore,
        cardSources: cardSourceSet,
        charaSources: charaSourceSet,
        parentSources: parentSourceSet,
        scenarioSources: scenarioSourceMap,
        grandSources,
      };
      const search = searchDecks(p.cands, weights, constraints, maxDecks * 3, opts.nodeBudget || 150000, words, p.seed);
      const pool = fillSlots ? buildCandidates(index, position, weights, p.remaining, notOwned, p.chara.charaId, quality, true) : null;
      const states = fillSlots ? search.decks.map((s) => fillDeck(s, pool, weights, constraints)) : search.decks;
      const decks = frontier(states.map((s) => describeDeck(s, ctx))).slice(0, maxDecks);
      if (!decks.length) decks.push(describeDeck(emptyState(words), ctx));
      p.exact = { decks, complete: search.complete, nodes: search.nodes };
      p.total = decks[0].score;
    }
    detailed.sort((a, b) => b.total - a.total || a.exact.decks[0].cardCount - b.exact.decks[0].cardCount || Mask.popcount(b.parentMask) - Mask.popcount(a.parentMask) || a.chara.id - b.chara.id);

    const parentSummaries = detailed.map((p) => {
      const best = p.exact.decks[0];
      const viaScenario = best.covered.filter((c) => c.from === "scenario");
      return {
        charaId: p.chara.id,
        total: p.total,
        innate: Mask.indexes(Mask.andNot(p.ownMask, p.parentEventMask)).map((i) => effective[i]),
        viaEvents: Mask.indexes(p.parentEventMask).map((i) => effective[i]),
        events: Mask.indexes(p.parentEventMask).map((i) => Object.assign({ id: effective[i] }, p.parentOrigins.get(effective[i]) || {})),
        secretLost: Mask.indexes(p.secretMask).map((i) => effective[i]),
        viaGrand: Mask.indexes(Mask.andNot(Mask.andNot(p.parentMask, p.ownMask), p.scenarioMask)).map((i) => effective[i]),
        viaScenario: viaScenario.map((c) => c.id),
        scenario: p.scenario && viaScenario.length
          ? {
              id: p.scenario.id,
              name: p.scenario.name,
              origins: viaScenario.map((c) => ({ id: c.id, origin: c.origin })),
              choices: p.scenarioPicks.map((pick) => ({ name: pick.name, how: pick.how, option: pick.option, optionIndex: pick.optionIndex, card: 0, skills: pick.ids.map((i) => effective[i]) })).concat(best.scenarioChoices),
            }
          : null,
        choices: p.parentPicks.map((pick) => ({ name: pick.name, option: pick.option, optionIndex: pick.optionIndex, skills: pick.ids.map((i) => effective[i]) })),
        coveredCount: best.coveredCount,
        cardCount: best.cardCount,
        decks: p.exact.decks,
        complete: p.exact.complete,
        nodes: p.exact.nodes,
        estimate: p.estimate,
      };
    });

    return {
      wanted,
      excluded,
      effective,
      effectiveInfo,
      traineeChoices,
      weights,
      unobtainable,
      sources: { cards: cardSourceSet, charas: charaSourceSet, scenarios: scenarioSourceMap },
      constraints,
      parents: parentSummaries,
      selectedParent: manual ? manual.chara.id : parentSummaries.length ? parentSummaries[0].charaId : null,
      manualIgnored: Boolean(parentOpts.charaId && !manualId),
      targetCharaId,
      grandparents: grandparents.map((g) => g.id),
      maxScore: Mask.weight(fullMask, weights),
    };
  }

  root.UmaSolver = { TYPES, DECK_SIZE, MAX_WANTED, MAX_LIMIT_BREAK, createIndex, expandDown, charaSkillIds, weightsFor, solve, isGoldSkill, isInheritableSkill, inheritableFallback, limitBreakOf, hintStat };
})(typeof window !== "undefined" ? window : globalThis);
