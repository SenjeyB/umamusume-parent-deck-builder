(function (root) {
  const TYPES = ["speed", "stamina", "power", "guts", "wit", "friend", "group"];
  const DECK_SIZE = 6;
  const MAX_WANTED = 24;
  const MAX_VARIANTS = 8;

  function isGoldSkill(skill) {
    return Boolean(skill) && skill.rar >= 2 && skill.id < 900000;
  }

  function createIndex(data) {
    const skillById = new Map(data.skills.map((s) => [s.id, s]));
    const cardById = new Map(data.cards.map((c) => [c.id, c]));
    const charaById = new Map(data.charas.map((c) => [c.id, c]));
    const lower = new Map();
    for (const s of data.skills) {
      const last = s.id % 10;
      if (last === 1 && skillById.has(s.id + 1)) lower.set(s.id, s.id + 1);
      else if (last === 4 && s.rar === 2 && skillById.has(s.id - 3)) lower.set(s.id, s.id - 3);
    }
    const upper = new Map();
    for (const [u, l] of lower) upper.set(l, u);
    const index = { data, skillById, cardById, charaById, lower, upper };

    const push = (map, id, owner) => {
      if (!map.has(id)) map.set(id, []);
      if (!map.get(id).includes(owner)) map.get(id).push(owner);
    };
    index.skillCards = new Map();
    index.skillCardEvents = new Map();
    for (const card of data.cards) {
      for (const id of expandDown(index, card.hints)) push(index.skillCards, id, card.id);
      for (const id of expandDown(index, eventSkillIds(card))) if (!expandDown(index, card.hints).has(id)) push(index.skillCardEvents, id, card.id);
    }
    index.skillCharas = new Map();
    index.skillCharaEvents = new Map();
    for (const chara of data.charas) {
      const innate = expandDown(index, charaSkillIds(chara, 5));
      for (const id of innate) push(index.skillCharas, id, chara.id);
      for (const id of expandDown(index, eventSkillIds(chara))) if (!innate.has(id)) push(index.skillCharaEvents, id, chara.id);
    }
    index.isGold = (id) => isGoldSkill(skillById.get(id));
    return index;
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

  function charaSkillIds(chara, awakening) {
    const ids = chara.skills.filter((s) => s.rank <= awakening).map((s) => s.id);
    if (chara.unique) ids.push(chara.unique + 800000);
    return ids;
  }

  function splitEvents(index, owner, label) {
    const free = [];
    const groups = [];
    for (const event of owner.events || []) {
      if (event.o.length === 1) free.push(...event.o[0].s);
      else groups.push({ owner: label, name: event.n, options: event.o.map((option) => ({ text: option.t, set: expandDown(index, option.s) })) });
    }
    return { free, groups };
  }

  function charaSources(index, chara, awakening, label) {
    const events = splitEvents(index, chara, label);
    return { free: expandDown(index, charaSkillIds(chara, awakening).concat(events.free)), groups: events.groups };
  }

  function cardSources(index, card, label) {
    const events = splitEvents(index, card, label);
    return { free: expandDown(index, card.hints.concat(events.free)), groups: events.groups };
  }

  function whiteOnly(index, set) {
    const out = new Set();
    for (const id of set) if (!index.isGold(id)) out.add(id);
    return out;
  }

  function weightsFor(count, mode) {
    const weights = [];
    for (let i = 0; i < count; i++) {
      if (mode === "strict") weights.push(Math.pow(2, count - 1 - i));
      else if (mode === "count") weights.push(1 + (count - i) / (2 * count * count));
      else weights.push(count - i);
    }
    return weights;
  }

  function popcount(mask) {
    let n = 0;
    while (mask) {
      mask &= mask - 1;
      n++;
    }
    return n;
  }

  function maskWeight(mask, weights) {
    let total = 0;
    let bit = 0;
    while (mask) {
      if (mask & 1) total += weights[bit];
      mask >>>= 1;
      bit++;
    }
    return total;
  }

  function maskToIndexes(mask) {
    const out = [];
    for (let i = 0; mask; i++, mask >>>= 1) if (mask & 1) out.push(i);
    return out;
  }

  function setMask(set, position) {
    let mask = 0;
    for (const id of set) {
      const pos = position.get(id);
      if (pos !== undefined) mask |= 1 << pos;
    }
    return mask;
  }

  function resolveGroups(groups, position, weights, covered, transform) {
    const picks = [];
    let mask = 0;
    for (const group of groups) {
      let best = null;
      let bestGain = 0;
      group.options.forEach((option, i) => {
        const gainMask = setMask(transform ? transform(option.set) : option.set, position) & ~(covered | mask);
        const gain = maskWeight(gainMask, weights);
        if (gain > bestGain) {
          best = { group, optionIndex: i, mask: gainMask };
          bestGain = gain;
        }
      });
      if (best) {
        mask |= best.mask;
        picks.push({ owner: group.owner, name: group.name, option: group.options[best.optionIndex].text, optionIndex: best.optionIndex, ids: maskToIndexes(best.mask) });
      }
    }
    return { mask, picks };
  }

  function cardVariants(index, card, position, weights, remainingMask, owned) {
    const sources = cardSources(index, card, "card");
    const baseMask = setMask(whiteOnly(index, sources.free), position) & remainingMask;
    const groupMasks = sources.groups
      .map((group) => ({ group, options: group.options.map((option, i) => ({ i, text: option.text, mask: setMask(whiteOnly(index, option.set), position) & remainingMask })).filter((o) => o.mask) }))
      .filter((g) => g.options.length);
    let combos = [{ mask: baseMask, choices: [] }];
    let total = 1;
    for (const g of groupMasks) total *= g.options.length + 1;
    if (total <= MAX_VARIANTS) {
      for (const g of groupMasks) {
        const next = [];
        for (const combo of combos) {
          next.push(combo);
          for (const option of g.options) next.push({ mask: combo.mask | option.mask, choices: combo.choices.concat({ name: g.group.name, option: option.text, optionIndex: option.i, mask: option.mask }) });
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
          const gain = maskWeight(option.mask & ~mask, weights);
          if (gain > bestGain) {
            best = option;
            bestGain = gain;
          }
        }
        if (best) {
          mask |= best.mask;
          choices.push({ name: g.group.name, option: best.text, optionIndex: best.i, mask: best.mask });
        }
      }
      combos = [{ mask, choices }];
    }
    const variants = [];
    const seen = new Set();
    for (const combo of combos) {
      if (!combo.mask || seen.has(combo.mask)) continue;
      seen.add(combo.mask);
      variants.push({ id: card.id, type: card.type, rar: card.rar, owned, mask: combo.mask, hintMask: baseMask, weight: maskWeight(combo.mask, weights), choices: combo.choices, alts: [] });
    }
    return variants;
  }

  function buildCandidates(index, position, weights, remainingMask, notOwned) {
    const raw = [];
    for (const card of index.data.cards) {
      if (!card.hints.length && !(card.events || []).length) continue;
      raw.push(...cardVariants(index, card, position, weights, remainingMask, !notOwned.has(card.id)));
    }
    raw.sort((a, b) => popcount(b.mask) - popcount(a.mask) || b.rar - a.rar || (b.owned ? 1 : 0) - (a.owned ? 1 : 0) || a.choices.length - b.choices.length || b.id - a.id);
    const kept = [];
    for (const cand of raw) {
      const dominator = kept.find((k) => k.type === cand.type && (k.mask & cand.mask) === cand.mask && k.rar >= cand.rar && (k.owned || !cand.owned));
      if (dominator) {
        if (dominator.mask === cand.mask && dominator.id !== cand.id && !dominator.alts.includes(cand.id)) dominator.alts.push(cand.id);
        continue;
      }
      kept.push(cand);
    }
    kept.sort((a, b) => b.weight - a.weight || b.rar - a.rar || (b.owned ? 1 : 0) - (a.owned ? 1 : 0) || b.id - a.id);
    return kept;
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
    if (state.count >= DECK_SIZE) return false;
    if (!cand.owned && state.borrowed) return false;
    if (state.cards.includes(cand.id)) return false;
    const current = state.typeCounts[cand.type] || 0;
    if (current >= constraints.mins[cand.type] && state.overflow + 1 > constraints.free) return false;
    return true;
  }

  function applyAdd(state, cand, constraints, gain) {
    const typeCounts = Object.assign({}, state.typeCounts);
    const current = typeCounts[cand.type] || 0;
    typeCounts[cand.type] = current + 1;
    return {
      covered: state.covered | cand.mask,
      count: state.count + 1,
      typeCounts,
      overflow: state.overflow + (current >= constraints.mins[cand.type] ? 1 : 0),
      borrowed: state.borrowed || !cand.owned,
      score: state.score + gain,
      raritySum: state.raritySum + cand.rar,
      cards: state.cards.concat(cand.id),
      chosen: state.chosen.concat(cand),
    };
  }

  function emptyState() {
    return { covered: 0, count: 0, typeCounts: {}, overflow: 0, borrowed: false, score: 0, raritySum: 0, cards: [], chosen: [] };
  }

  function greedy(cands, weights, constraints) {
    let state = emptyState();
    for (;;) {
      let best = null;
      let bestGain = 0;
      for (const cand of cands) {
        const gainMask = cand.mask & ~state.covered;
        if (!gainMask || !canAdd(state, cand, constraints)) continue;
        const gain = maskWeight(gainMask, weights);
        if (gain > bestGain || (gain === bestGain && best && (cand.rar > best.rar || (cand.rar === best.rar && cand.owned && !best.owned)))) {
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
    if (a.raritySum !== b.raritySum) return a.raritySum > b.raritySum;
    if (a.borrowed !== b.borrowed) return !a.borrowed;
    const ca = a.chosen.reduce((n, c) => n + c.choices.length, 0);
    const cb = b.chosen.reduce((n, c) => n + c.choices.length, 0);
    if (ca !== cb) return ca < cb;
    return false;
  }

  function searchDecks(cands, weights, constraints, maxDecks, nodeBudget) {
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

    function record(state) {
      const existing = results.get(state.covered);
      if (existing) {
        if (betterDeck(state, existing)) {
          results.set(state.covered, state);
          ordered[ordered.indexOf(existing)] = state;
          sortOrdered();
        }
        return;
      }
      if (ordered.length >= maxDecks && state.score <= kthScore()) return;
      results.set(state.covered, state);
      ordered.push(state);
      sortOrdered();
      if (ordered.length > maxDecks) {
        const dropped = ordered.pop();
        results.delete(dropped.covered);
      }
    }

    const seed = greedy(cands, weights, constraints);
    if (seed.count) record(seed);

    function visit(state, pool) {
      if (nodes++ > nodeBudget) {
        complete = false;
        return;
      }
      const slotsLeft = DECK_SIZE - state.count;
      if (!slotsLeft) return;
      const children = [];
      for (const cand of pool) {
        const gainMask = cand.mask & ~state.covered;
        if (!gainMask || !canAdd(state, cand, constraints)) continue;
        children.push({ cand, gain: maskWeight(gainMask, weights) });
      }
      if (!children.length) return;
      children.sort((a, b) => b.gain - a.gain || b.cand.rar - a.cand.rar || (b.cand.owned ? 1 : 0) - (a.cand.owned ? 1 : 0));
      const gains = children.map((c) => c.gain);
      for (let j = 0; j < children.length; j++) {
        let bound = state.score + gains[j];
        for (let k = j + 1; k < children.length && k <= j + slotsLeft - 1; k++) bound += gains[k];
        if (ordered.length >= maxDecks && bound <= kthScore()) break;
        const next = applyAdd(state, children[j].cand, constraints, gains[j]);
        record(next);
        if (next.count < DECK_SIZE) visit(next, children.slice(j + 1).map((c) => c.cand));
        if (!complete) return;
      }
    }

    visit(emptyState(), cands);
    return { decks: ordered.map((s) => pruneRedundant(s, weights, constraints)), complete, nodes };
  }

  function pruneRedundant(state, weights, constraints) {
    const chosen = state.chosen.slice().sort((a, b) => a.rar - b.rar || (a.owned ? 1 : 0) - (b.owned ? 1 : 0));
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < chosen.length; i++) {
        let others = 0;
        for (let j = 0; j < chosen.length; j++) if (j !== i) others |= chosen[j].mask;
        if ((chosen[i].mask & ~others) === 0) {
          chosen.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    let rebuilt = emptyState();
    for (const cand of chosen) rebuilt = applyAdd(rebuilt, cand, constraints, maskWeight(cand.mask & ~rebuilt.covered, weights));
    return rebuilt;
  }

  function frontier(decks) {
    const kept = [];
    for (const deck of decks) {
      const dominated = kept.some((k) => (k.coveredMask & deck.coveredMask) === deck.coveredMask && k.coveredMask !== deck.coveredMask);
      if (!dominated) kept.push(deck);
    }
    return kept;
  }

  function describeDeck(state, ctx) {
    const cards = state.chosen.slice().sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || b.rar - a.rar || a.id - b.id);
    const typeCounts = {};
    for (const c of cards) typeCounts[c.type] = (typeCounts[c.type] || 0) + 1;
    const slots = cards.map((c) => ({
      kind: "card",
      id: c.id,
      borrowed: !c.owned,
      alts: c.alts,
      skills: maskToIndexes(c.mask).map((i) => ctx.effective[i]),
      eventSkills: maskToIndexes(c.mask & ~c.hintMask).map((i) => ctx.effective[i]),
      choices: c.choices.map((choice) => ({ name: choice.name, option: choice.option, optionIndex: choice.optionIndex, skills: maskToIndexes(choice.mask).map((i) => ctx.effective[i]) })),
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
      const bit = 1 << i;
      if (ctx.parentMask & bit) covered.push({ id, from: "parent", viaEvent: Boolean(ctx.parentEventMask & bit) });
      else if (state.covered & bit) {
        const providers = cards.filter((c) => c.mask & bit);
        covered.push({ id, from: "card", cards: providers.map((c) => c.id), viaEvent: providers.every((c) => !(c.hintMask & bit)) });
      } else missing.push({ id, reason: ctx.cardSources.has(id) ? "limit" : ctx.charaSources.has(id) ? "nocard" : "none" });
    }
    return {
      slots,
      coveredMask: state.covered | ctx.parentMask,
      cardIds: cards.map((c) => c.id),
      score: state.score + ctx.parentScore,
      deckScore: state.score,
      cardCount: cards.length,
      raritySum: state.raritySum,
      borrowed: state.borrowed,
      covered,
      missing,
      coveredCount: covered.length,
    };
  }

  function solve(index, opts) {
    const weightMode = opts.weightMode || "balanced";
    const notOwned = opts.notOwned instanceof Set ? opts.notOwned : new Set(opts.notOwned || []);
    const constraints = makeConstraints(opts.typeMin || {});
    const maxDecks = opts.maxDecks || 10;
    const maxParents = opts.maxParents || 8;
    const target = opts.target || {};
    const parentOpts = opts.parent || {};
    const parentAwakening = parentOpts.awakening || 5;

    const wanted = [];
    for (const raw of opts.wanted || []) {
      const id = Number(raw);
      if (index.skillById.has(id) && !wanted.includes(id)) wanted.push(id);
      if (wanted.length >= MAX_WANTED) break;
    }

    const traineeReason = new Map();
    const traineeGroups = [];
    const targetChara = target.charaId ? index.charaById.get(target.charaId) : null;
    if (targetChara) {
      const innate = expandDown(index, charaSkillIds(targetChara, target.awakening || 5));
      for (const id of innate) traineeReason.set(id, { reason: "target" });
      const events = splitEvents(index, targetChara, "target");
      for (const id of expandDown(index, events.free)) if (!traineeReason.has(id)) traineeReason.set(id, { reason: "targetEvent" });
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

    const preliminary = wanted.filter((id) => !traineeReason.has(id));
    const prePosition = new Map(preliminary.map((id, i) => [id, i]));
    const preWeights = weightsFor(preliminary.length, weightMode);
    const groupPicks = resolveGroups(traineeGroups, prePosition, preWeights, 0, null);
    const traineeChoices = [];
    for (const pick of groupPicks.picks) {
      const group = traineeGroups.find((g) => g.name === pick.name && g.owner === pick.owner);
      const card = group ? group.card : undefined;
      const skills = pick.ids.map((i) => preliminary[i]);
      for (const id of skills) traineeReason.set(id, { reason: pick.owner === "deck" ? "deckChoice" : "targetChoice", card, event: pick.name, option: pick.option, optionIndex: pick.optionIndex });
      traineeChoices.push({ owner: pick.owner, card, name: pick.name, option: pick.option, optionIndex: pick.optionIndex, skills });
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
      if (isGoldSkill(skill)) {
        const white = index.lower.get(id);
        if (!white) {
          excluded.push({ id, reason: "goldNoWhite" });
          continue;
        }
        if (traineeReason.has(white)) {
          excluded.push(Object.assign({ id, white }, traineeReason.get(white), { reason: "goldWhiteCovered", whiteReason: traineeReason.get(white).reason }));
          continue;
        }
        effectiveId = white;
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
    const position = new Map(effective.map((id, i) => [id, i]));
    const weights = weightsFor(effective.length, weightMode);
    const fullMask = effective.length ? (1 << effective.length) - 1 : 0;
    const cardSourceSet = new Set(effective.filter((id) => index.skillCards.has(id) || index.skillCardEvents.has(id)));
    const charaSourceSet = new Set(effective.filter((id) => index.skillCharas.has(id) || index.skillCharaEvents.has(id)));
    const unobtainable = effective.filter((id) => !cardSourceSet.has(id) && !charaSourceSet.has(id));

    const parents = index.data.charas.map((chara) => {
      const sources = charaSources(index, chara, parentAwakening, "parent");
      const freeMask = setMask(whiteOnly(index, sources.free), position);
      const picks = resolveGroups(sources.groups, position, weights, freeMask, (set) => whiteOnly(index, set));
      const parentMask = freeMask | picks.mask;
      const parentScore = maskWeight(parentMask, weights);
      const remainingMask = fullMask & ~parentMask;
      const cands = buildCandidates(index, position, weights, remainingMask, notOwned);
      const seed = greedy(cands, weights, constraints);
      return { chara, parentMask, parentEventMask: picks.mask, parentPicks: picks.picks, parentScore, cands, estimate: parentScore + seed.score, estimateCards: seed.count, exact: null };
    });

    parents.sort((a, b) => b.estimate - a.estimate || a.estimateCards - b.estimateCards || popcount(b.parentMask) - popcount(a.parentMask) || a.chara.id - b.chara.id);
    const detailed = parents.slice(0, maxParents);
    const manual = parentOpts.charaId ? parents.find((p) => p.chara.id === parentOpts.charaId) : null;
    if (manual && !detailed.includes(manual)) detailed.push(manual);
    for (const p of detailed) {
      const ctx = { effective, constraints, parentMask: p.parentMask, parentEventMask: p.parentEventMask, parentScore: p.parentScore, cardSources: cardSourceSet, charaSources: charaSourceSet };
      const search = searchDecks(p.cands, weights, constraints, maxDecks * 3, opts.nodeBudget || 150000);
      const decks = frontier(search.decks.map((s) => describeDeck(s, ctx))).slice(0, maxDecks);
      if (!decks.length) decks.push(describeDeck(emptyState(), ctx));
      p.exact = { decks, complete: search.complete, nodes: search.nodes };
      p.total = decks[0].score;
    }
    detailed.sort((a, b) => b.total - a.total || a.exact.decks[0].cardCount - b.exact.decks[0].cardCount || popcount(b.parentMask) - popcount(a.parentMask) || a.chara.id - b.chara.id);

    const parentSummaries = detailed.map((p) => ({
      charaId: p.chara.id,
      total: p.total,
      innate: maskToIndexes(p.parentMask & ~p.parentEventMask).map((i) => effective[i]),
      viaEvents: maskToIndexes(p.parentEventMask).map((i) => effective[i]),
      choices: p.parentPicks.map((pick) => ({ name: pick.name, option: pick.option, optionIndex: pick.optionIndex, skills: pick.ids.map((i) => effective[i]) })),
      coveredCount: p.exact.decks[0].coveredCount,
      cardCount: p.exact.decks[0].cardCount,
      decks: p.exact.decks,
      complete: p.exact.complete,
    }));

    return {
      wanted,
      excluded,
      effective,
      effectiveInfo,
      traineeChoices,
      weights,
      unobtainable,
      sources: { cards: cardSourceSet, charas: charaSourceSet },
      constraints,
      parents: parentSummaries,
      selectedParent: manual ? manual.chara.id : parentSummaries.length ? parentSummaries[0].charaId : null,
      maxScore: maskWeight(fullMask, weights),
    };
  }

  root.UmaSolver = { TYPES, DECK_SIZE, MAX_WANTED, createIndex, expandDown, charaSkillIds, weightsFor, solve, isGoldSkill };
})(typeof window !== "undefined" ? window : globalThis);
