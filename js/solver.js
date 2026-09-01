(function (root) {
  const TYPES = ["speed", "stamina", "power", "guts", "wit", "friend", "group"];
  const DECK_SIZE = 6;
  const MAX_WANTED = 24;

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

    const skillCards = new Map();
    for (const card of data.cards) {
      for (const id of expandDownRaw(lower, card.hints)) {
        if (!skillCards.has(id)) skillCards.set(id, []);
        skillCards.get(id).push(card.id);
      }
    }
    const skillCharas = new Map();
    for (const chara of data.charas) {
      for (const id of expandDownRaw(lower, charaSkillIds(chara, 5))) {
        if (!skillCharas.has(id)) skillCharas.set(id, []);
        skillCharas.get(id).push(chara.id);
      }
    }
    return { data, skillById, cardById, charaById, lower, upper, skillCards, skillCharas };
  }

  function expandDownRaw(lower, ids) {
    const out = new Set();
    for (const id of ids) {
      let cur = id;
      while (cur !== undefined && !out.has(cur)) {
        out.add(cur);
        cur = lower.get(cur);
      }
    }
    return out;
  }

  function expandDown(index, ids) {
    return expandDownRaw(index.lower, ids);
  }

  function charaSkillIds(chara, awakening) {
    const ids = chara.skills.filter((s) => s.rank <= awakening).map((s) => s.id);
    if (chara.unique) ids.push(chara.unique + 800000);
    return ids;
  }

  function charaCoverage(index, chara, awakening) {
    return expandDown(index, charaSkillIds(chara, awakening));
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

  function buildCandidates(index, effective, weights, remainingMask, notOwned) {
    const position = new Map(effective.map((id, i) => [id, i]));
    const raw = [];
    for (const card of index.data.cards) {
      if (!card.hints.length) continue;
      let mask = 0;
      for (const id of expandDown(index, card.hints)) {
        const pos = position.get(id);
        if (pos !== undefined) mask |= 1 << pos;
      }
      mask &= remainingMask;
      if (!mask) continue;
      raw.push({ id: card.id, type: card.type, rar: card.rar, owned: !notOwned.has(card.id), mask, weight: maskWeight(mask, weights), alts: [] });
    }
    raw.sort((a, b) => popcount(b.mask) - popcount(a.mask) || b.rar - a.rar || (b.owned ? 1 : 0) - (a.owned ? 1 : 0) || b.id - a.id);
    const kept = [];
    for (const cand of raw) {
      const dominator = kept.find((k) => k.type === cand.type && (k.mask & cand.mask) === cand.mask && k.rar >= cand.rar && (k.owned || !cand.owned));
      if (dominator) {
        if (dominator.mask === cand.mask) dominator.alts.push(cand.id);
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
      chosen: state.chosen.concat(cand),
    };
  }

  function emptyState() {
    return { covered: 0, count: 0, typeCounts: {}, overflow: 0, borrowed: false, score: 0, raritySum: 0, chosen: [] };
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
    return false;
  }

  function searchDecks(cands, weights, constraints, maxDecks, nodeBudget) {
    const results = new Map();
    let ordered = [];
    let nodes = 0;
    let complete = true;

    function kthScore() {
      return ordered.length < maxDecks ? -Infinity : ordered[ordered.length - 1].score;
    }

    function record(state) {
      const existing = results.get(state.covered);
      if (existing) {
        if (betterDeck(state, existing)) {
          results.set(state.covered, state);
          ordered[ordered.indexOf(existing)] = state;
          ordered.sort((a, b) => (betterDeck(a, b) ? -1 : betterDeck(b, a) ? 1 : 0));
        }
        return;
      }
      if (ordered.length >= maxDecks && state.score <= kthScore()) return;
      results.set(state.covered, state);
      ordered.push(state);
      ordered.sort((a, b) => (betterDeck(a, b) ? -1 : betterDeck(b, a) ? 1 : 0));
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
        if (bound <= kthScore() && ordered.length >= maxDecks) break;
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
    let chosen = state.chosen.slice().sort((a, b) => a.rar - b.rar || (a.owned ? 1 : 0) - (b.owned ? 1 : 0));
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
    const slots = cards.map((c) => ({ kind: "card", id: c.id, borrowed: !c.owned, alts: c.alts, skills: maskToIndexes(c.mask).map((i) => ctx.effective[i]) }));
    for (const t of TYPES) {
      let missing = ctx.constraints.mins[t] - (typeCounts[t] || 0);
      while (missing-- > 0 && slots.length < DECK_SIZE) slots.push({ kind: "type", type: t });
    }
    while (slots.length < DECK_SIZE) slots.push({ kind: "free" });

    const covered = [];
    const missing = [];
    for (let i = 0; i < ctx.effective.length; i++) {
      const id = ctx.effective[i];
      if (ctx.parentMask & (1 << i)) covered.push({ id, from: "parent" });
      else if (state.covered & (1 << i)) covered.push({ id, from: "card", cards: cards.filter((c) => c.mask & (1 << i)).map((c) => c.id) });
      else missing.push({ id, reason: ctx.cardSources.has(id) ? "limit" : ctx.charaSources.has(id) ? "nocard" : "none" });
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

    const coveredReason = new Map();
    const targetChara = target.charaId ? index.charaById.get(target.charaId) : null;
    if (targetChara) for (const id of charaCoverage(index, targetChara, target.awakening || 5)) coveredReason.set(id, "target");
    for (const cardId of target.deck || []) {
      const card = index.cardById.get(cardId);
      if (!card) continue;
      for (const id of expandDown(index, card.hints)) if (!coveredReason.has(id)) coveredReason.set(id, "deck");
    }

    const excluded = [];
    const effective = [];
    for (const id of wanted) {
      if (coveredReason.has(id)) excluded.push({ id, reason: coveredReason.get(id) });
      else effective.push(id);
    }

    const weights = weightsFor(effective.length, weightMode);
    const fullMask = effective.length ? (effective.length === 31 ? -1 : (1 << effective.length) - 1) : 0;
    const cardSources = new Set(effective.filter((id) => index.skillCards.has(id)));
    const charaSources = new Set(effective.filter((id) => index.skillCharas.has(id)));
    const unobtainable = effective.filter((id) => !cardSources.has(id) && !charaSources.has(id));

    const parents = index.data.charas.map((chara) => {
      const coverage = charaCoverage(index, chara, parentAwakening);
      let parentMask = 0;
      effective.forEach((id, i) => {
        if (coverage.has(id)) parentMask |= 1 << i;
      });
      const parentScore = maskWeight(parentMask, weights);
      const remainingMask = fullMask & ~parentMask;
      const cands = buildCandidates(index, effective, weights, remainingMask, notOwned);
      const seed = greedy(cands, weights, constraints);
      return { chara, parentMask, parentScore, cands, estimate: parentScore + seed.score, estimateCards: seed.count, exact: null };
    });

    parents.sort((a, b) => b.estimate - a.estimate || a.estimateCards - b.estimateCards || popcount(b.parentMask) - popcount(a.parentMask) || a.chara.id - b.chara.id);
    const detailed = parents.slice(0, maxParents);
    const manual = parentOpts.charaId ? parents.find((p) => p.chara.id === parentOpts.charaId) : null;
    if (manual && !detailed.includes(manual)) detailed.push(manual);
    for (const p of detailed) {
      const ctx = { effective, constraints, parentMask: p.parentMask, parentScore: p.parentScore, cardSources, charaSources };
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
      innate: maskToIndexes(p.parentMask).map((i) => effective[i]),
      coveredCount: p.exact.decks[0].coveredCount,
      cardCount: p.exact.decks[0].cardCount,
      decks: p.exact.decks,
      complete: p.exact.complete,
    }));

    return {
      wanted,
      excluded,
      effective,
      weights,
      unobtainable,
      sources: { cards: cardSources, charas: charaSources },
      constraints,
      parents: parentSummaries,
      selectedParent: manual ? manual.chara.id : parentSummaries.length ? parentSummaries[0].charaId : null,
      maxScore: maskWeight(fullMask, weights),
    };
  }

  root.UmaSolver = { TYPES, DECK_SIZE, MAX_WANTED, createIndex, expandDown, charaCoverage, charaSkillIds, weightsFor, solve };
})(typeof window !== "undefined" ? window : globalThis);
