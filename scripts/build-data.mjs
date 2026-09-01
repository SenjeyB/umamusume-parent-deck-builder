import { mkdir, writeFile, readFile, access, copyFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, ".cache");
const DATA_FILE = path.join(ROOT, "data", "gl.js");
const SITE = "https://uma.guide";
const ENTRY_PAGE = `${SITE}/support-cards/`;
const GAMETORA = "https://gametora.com";
const CONCURRENCY = 8;
const GAMETORA_CONCURRENCY = 4;
const GAMETORA_DELAY_MS = 120;

const TYPE_BY_COMMAND = { 101: "speed", 105: "stamina", 102: "power", 103: "guts", 106: "wit" };

const SCENARIOS = [
  { id: "ura", name: "URA Finale", grants: [], teammates: [] },
  {
    id: "unity",
    name: "Unity Cup",
    grants: [
      { how: "extremeBurst", skills: [210012, 210022, 210032, 210042, 210052] },
      { how: "zenith", options: [{ skills: [210011] }, { skills: [210021] }, { skills: [210031] }, { skills: [210041] }, { skills: [210051] }] },
      { how: "teamRankS", skills: [200461] },
    ],
    teammates: [1052, 1030, 1056, 1010],
  },
  {
    id: "trackblazer",
    name: "Trackblazer",
    grants: [
      { how: "umaOfYear", skills: [210062] },
      { how: "climaxWin", skills: [210061] },
    ],
    teammates: [],
  },
  {
    id: "concert",
    name: "Grand Concert",
    grants: [
      {
        how: "songs16",
        options: [
          { skills: [202281], link: 1046, fallback: [202282] },
          { skills: [200431], link: 1026, fallback: [200432] },
          { skills: [201701], link: 1032, fallback: [201702] },
          { skills: [200711], link: 1002, fallback: [200712] },
          { skills: [200501] },
        ],
      },
      { how: "songs18", skills: [210071] },
    ],
    teammates: [],
  },
];

const EXPECTED_SKILL_NAMES = {
  210012: "Ignited Spirit SPD",
  210011: "Burning Spirit SPD",
  200461: "It's On!",
  210062: "Glittering Star",
  210061: "Radiant Star",
  202281: "Full Speed!",
  200431: "Concentration",
  201701: "Come What May",
  200711: "Trackblazer",
  200501: "Lane Legerdemain",
  210071: "I Wanna Win with You",
};
const IMAGE_SIZES = { card: [120, 160], skill: [64, 64], chara: [72, 116] };

const args = new Set(process.argv.slice(2));
const skipImages = args.has("--no-images");
const forceImages = args.has("--force-images");
const skipEvents = args.has("--no-events");
const forceEvents = args.has("--force-events");

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function downloadWithFallbacks(urls, dest) {
  let lastError;
  for (const url of urls) {
    try {
      await download(url, dest);
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function loadSharp() {
  try {
    const mod = await import("sharp");
    return mod.default;
  } catch {
    console.warn("sharp is not installed, images are stored without resizing");
    return null;
  }
}

async function loadPreviousDataset() {
  try {
    const text = await readFile(DATA_FILE, "utf8");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function discoverChunk() {
  const html = await fetchText(ENTRY_PAGE);
  const match = html.match(/\/assets\/chunks\/uma-data\.[A-Za-z0-9_-]+\.js/);
  if (!match) throw new Error("uma-data chunk not found on the entry page");
  return SITE + match[0];
}

function isArrayOf(value, ...keys) {
  return Array.isArray(value) && value.length > 0 && value[0] !== null && typeof value[0] === "object" && keys.every((k) => k in value[0]);
}

function pickTables(mod) {
  const tables = { cards: null, charas: null, skills: null, overrides: null, sparks: null };
  for (const value of Object.values(mod)) {
    if (isArrayOf(value, "supportCardId", "skillHints", "rarityDisplay")) tables.cards = value;
    else if (isArrayOf(value, "id", "name", "description", "rarity", "grade", "type") && value.some((v) => v.type === 4)) tables.sparks = value;
    else if (isArrayOf(value, "charaId", "potentialSkills", "cardTitle")) tables.charas = value;
    else if (isArrayOf(value, "skillId", "skillName", "supportCardIds", "iconId")) tables.skills = value;
    else if (value && typeof value === "object" && Array.isArray(value.supportCards) && Array.isArray(value.characters) && Array.isArray(value.skills)) tables.overrides = value;
  }
  for (const [name, table] of Object.entries(tables)) {
    if (!table) throw new Error(`table "${name}" was not recognised in the data chunk`);
  }
  return tables;
}

function cardType(card) {
  if (card.supportCardType === 3) return "group";
  if (card.supportCardType === 2) return "friend";
  return TYPE_BY_COMMAND[card.commandId] || "friend";
}

function cleanDescription(text) {
  return String(text || "").replace(/\\n|\n/g, " ").replace(/\s+/g, " ").trim();
}

function expectedUniqueId(cardId, charaId) {
  const outfit = cardId % 100;
  return Number(`1${outfit - 1}${String(charaId % 1000).padStart(3, "0")}1`);
}

function pickUnique(cardId, charaId, skillIds) {
  const uniques = skillIds.filter((id) => id >= 100000 && id < 200000);
  const expected = expectedUniqueId(cardId, charaId);
  if (uniques.includes(expected)) return expected;
  return uniques.length ? Math.max(...uniques) : 0;
}

function computeLowerLinks(skills) {
  const isCross = (s) => /×/.test(s.skillName);
  const isDouble = (s) => /◎/.test(s.skillName);
  const cond = (s) => `${s.activationCondition}|${s.precondition}`;
  const families = new Map();
  for (const s of skills) {
    const family = Math.floor(s.skillId / 10);
    if (!families.has(family)) families.set(family, []);
    families.get(family).push(s);
  }
  const lower = new Map();
  for (const s of skills) {
    if (isCross(s)) continue;
    const family = (families.get(Math.floor(s.skillId / 10)) || []).filter((o) => o.skillId !== s.skillId && !isCross(o) && o.rarity === 1);
    let target = null;
    if (s.rarity >= 2) {
      target = family.find(isDouble) || (family.length === 1 ? family[0] : family.find((o) => cond(o) === cond(s)) || family[0] || null);
      if (!target) {
        const global = skills.filter((o) => o.skillId !== s.skillId && o.rarity === 1 && !isCross(o) && cond(o) === cond(s) && o.skillCategory === s.skillCategory);
        target = global.find(isDouble) || (global.length === 1 ? global[0] : null);
      }
    } else if (isDouble(s)) {
      target = family.find((o) => !isDouble(o)) || null;
    }
    if (target) lower.set(s.skillId, target.skillId);
  }
  return lower;
}

function computeInheritable(skills, sparks) {
  const sparkFamilies = new Set(sparks.filter((s) => s.type === 4).map((s) => Math.floor(s.id / 100)));
  const sparkNames = new Set(sparks.filter((s) => s.type === 4).map((s) => s.name));
  const families = new Map();
  for (const s of skills) {
    const family = Math.floor(s.skillId / 10);
    if (!families.has(family)) families.set(family, []);
    families.get(family).push(s);
  }
  const inheritable = new Set();
  for (const [family, members] of families) {
    if (!sparkFamilies.has(family)) continue;
    const candidates = members.filter((s) => s.rarity === 1 && !/[◎×]/.test(s.skillName));
    if (!candidates.length) continue;
    const pick = candidates.find((s) => sparkNames.has(s.skillName)) || candidates.find((s) => s.skillId % 10 !== 3) || candidates[0];
    inheritable.add(pick.skillId);
  }
  return inheritable;
}

function buildScenarios(skillById) {
  for (const [id, name] of Object.entries(EXPECTED_SKILL_NAMES)) {
    const skill = skillById.get(Number(id));
    if (!skill) console.warn(`  scenario skill ${id} (${name}) is missing from the skill list`);
    else if (skill.skillName !== name) console.warn(`  scenario skill ${id} is "${skill.skillName}", expected "${name}"`);
  }
  return SCENARIOS.map((sc) => ({
    id: sc.id,
    name: sc.name,
    teammates: sc.teammates,
    grants: sc.grants
      .map((g) => ({
        how: g.how,
        skills: (g.skills || []).filter((id) => skillById.has(id)),
        options: (g.options || []).map((o) => ({ skills: o.skills.filter((id) => skillById.has(id)), link: o.link || 0, fallback: (o.fallback || []).filter((id) => skillById.has(id)) })).filter((o) => o.skills.length),
      }))
      .filter((g) => g.skills.length || g.options.length),
  }));
}

function buildDataset({ cards, charas, skills, overrides, sparks }) {
  const groupNames = new Map((overrides.supportCards || []).map((o) => [o.supportCardId, o.charaName]));
  const skillOverrides = new Map((overrides.characters || []).map((o) => [o.cardId, o.skillIds]));
  const skillById = new Map(skills.map((s) => [s.skillId, s]));
  const normalSkills = skills.filter((s) => s.skillId >= 200000 && s.skillId < 900000);
  const lowerLinks = computeLowerLinks(normalSkills);
  const inheritable = computeInheritable(normalSkills, sparks);

  const outCards = cards
    .map((c) => ({
      id: c.supportCardId,
      charaId: c.charaId,
      chara: groupNames.get(c.supportCardId) || c.charaName,
      title: c.supportCardTitle,
      rar: c.rarity,
      type: cardType(c),
      date: String(c.startDate || "").slice(0, 10),
      hints: (c.skillHints || []).map((h) => h.skillId).filter((id) => id && skillById.has(id)),
      events: [],
    }))
    .sort((a, b) => a.id - b.id);

  const outCharas = charas
    .map((c) => {
      const skillIds = String(skillOverrides.get(c.cardId) || c.skillIds).split(",").map(Number);
      const unique = pickUnique(c.cardId, c.charaId, skillIds);
      return {
        id: c.cardId,
        charaId: c.charaId,
        name: c.charaName,
        title: c.cardTitle,
        date: String(c.startDate || "").slice(0, 10),
        unique,
        skills: (c.potentialSkills || [])
          .filter((p) => skillById.has(p.skillId))
          .map((p) => ({ id: p.skillId, rank: p.needRank }))
          .sort((a, b) => a.rank - b.rank || a.id - b.id),
        events: [],
      };
    })
    .sort((a, b) => a.id - b.id);

  const uniqueIds = new Set(outCharas.map((ch) => ch.unique).filter(Boolean));

  const outSkills = skills
    .filter((s) => s.skillId >= 200000 || uniqueIds.has(s.skillId))
    .map((s) => ({
      id: s.skillId,
      name: s.skillName,
      cat: s.skillCategory,
      rar: s.rarity,
      icon: s.iconId,
      sp: s.needSkillPoint || 0,
      low: lowerLinks.get(s.skillId) || 0,
      inh: inheritable.has(s.skillId) || s.skillId >= 900000 ? 1 : 0,
      desc: cleanDescription(s.skillDesc),
    }))
    .sort((a, b) => a.id - b.id);

  return {
    server: "gl",
    source: SITE,
    eventSource: GAMETORA,
    generated: new Date().toISOString().slice(0, 10),
    skills: outSkills,
    cards: outCards,
    charas: outCharas,
    scenarios: buildScenarios(skillById),
  };
}

async function runPool(items, worker, concurrency) {
  let index = 0;
  const failures = [];
  async function next() {
    while (index < items.length) {
      const item = items[index++];
      try {
        await worker(item);
      } catch (err) {
        failures.push({ item, err });
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, next));
  return failures;
}

async function gametoraUrls() {
  const indexXml = await fetchText(`${GAMETORA}/sitemap.xml`);
  const subs = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => /sitemap-\d+\.xml$/.test(u));
  const supports = new Map();
  const charas = new Map();
  for (const sub of subs.length ? subs : [`${GAMETORA}/sitemap-0.xml`]) {
    const xml = await fetchText(sub);
    for (const m of xml.matchAll(/https:\/\/gametora\.com\/umamusume\/(supports|characters)\/(\d+)-[^<\s"]+/g)) {
      (m[1] === "supports" ? supports : charas).set(Number(m[2]), m[0]);
    }
  }
  return { supports, charas };
}

async function gametoraPage(kind, id, url) {
  const cacheFile = path.join(CACHE, "gametora", `${kind}-${id}.json`);
  if (!forceEvents && (await exists(cacheFile))) return JSON.parse(await readFile(cacheFile, "utf8"));
  const html = await fetchText(url);
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (!match) throw new Error(`page data not found for ${url}`);
  const props = JSON.parse(match[1]).props.pageProps;
  const page = { item: props.itemData || null, events: props.eventData || null };
  await mkdir(path.dirname(cacheFile), { recursive: true });
  await writeFile(cacheFile, JSON.stringify(page));
  await delay(GAMETORA_DELAY_MS);
  return page;
}

function parseLocalizedEvents(eventData, lang) {
  const raw = eventData && eventData[lang];
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

function parseEvents(eventData, skillById) {
  const base = parseLocalizedEvents(eventData, "ja") || parseLocalizedEvents(eventData, "en");
  if (!base) return [];
  const en = parseLocalizedEvents(eventData, "en");
  const englishNames = new Map();
  if (en) {
    for (const list of Object.values(en)) {
      if (!Array.isArray(list)) continue;
      for (const e of list) if (e && typeof e === "object" && e.i !== undefined && e.n) englishNames.set(e.i, e.n);
    }
  }
  const events = [];
  for (const [group, list] of Object.entries(base)) {
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      if (!e || typeof e !== "object" || !Array.isArray(e.c)) continue;
      const options = [];
      for (const choice of e.c) {
        const ids = [];
        for (const reward of choice.r || []) {
          const id = Number(reward && reward.t === "sk" ? reward.d : NaN);
          if (skillById.has(id) && !ids.includes(id)) ids.push(id);
        }
        if (ids.length) options.push({ t: String(choice.o || ""), s: ids });
      }
      if (!options.length) continue;
      events.push({ n: englishNames.get(e.i) || String(e.n || ""), g: group, o: options });
    }
  }
  return events;
}

async function addEvents(dataset, previous) {
  const skillById = new Map(dataset.skills.map((s) => [s.id, s]));
  const previousCards = new Map((previous ? previous.cards : []).map((c) => [c.id, c.events || []]));
  const previousCharas = new Map((previous ? previous.charas : []).map((c) => [c.id, c.events || []]));
  let urls;
  try {
    urls = await gametoraUrls();
  } catch (err) {
    console.warn(`GameTora sitemap unavailable (${err.message}), keeping previous event data`);
    for (const card of dataset.cards) card.events = previousCards.get(card.id) || [];
    for (const chara of dataset.charas) chara.events = previousCharas.get(chara.id) || [];
    return;
  }
  const jobs = [];
  for (const card of dataset.cards) jobs.push({ kind: "support", target: card, url: urls.supports.get(card.id), previous: previousCards.get(card.id) || [] });
  for (const chara of dataset.charas) jobs.push({ kind: "character", target: chara, url: urls.charas.get(chara.id), previous: previousCharas.get(chara.id) || [] });

  let fetched = 0;
  let hintMismatches = 0;
  const failures = await runPool(
    jobs,
    async (job) => {
      if (!job.url) throw new Error(`no GameTora page for ${job.kind} ${job.target.id}`);
      const page = await gametoraPage(job.kind, job.target.id, job.url);
      job.target.events = parseEvents(page.events, skillById);
      if (job.kind === "support" && page.item && page.item.hints && Array.isArray(page.item.hints.hint_skills)) {
        const a = job.target.hints.slice().sort().join(",");
        const b = page.item.hints.hint_skills.slice().sort().join(",");
        if (a !== b) {
          hintMismatches++;
          console.warn(`  hint mismatch for card ${job.target.id}: uma.guide [${a}] vs GameTora [${b}]`);
        }
      }
      fetched++;
    },
    GAMETORA_CONCURRENCY
  );
  for (const f of failures) {
    f.item.target.events = f.item.previous;
    console.warn(`  events failed for ${f.item.kind} ${f.item.target.id}: ${f.err.message}`);
  }
  const cardEvents = dataset.cards.filter((c) => c.events.length).length;
  const charaEvents = dataset.charas.filter((c) => c.events.length).length;
  console.log(`events: ${fetched} pages, ${failures.length} failed, ${hintMismatches} hint mismatches, cards with skill events ${cardEvents}, characters with skill events ${charaEvents}`);
}

async function processImages(dataset, sharp) {
  const jobs = [];
  for (const card of dataset.cards) {
    jobs.push({ kind: "card", url: `${SITE}/img/card/composite/tex_support_card_${card.id}_thumb.webp`, dest: path.join(ROOT, "img/card", `${card.id}.webp`) });
  }
  const baseOutfit = new Map();
  for (const ch of dataset.charas) if (!baseOutfit.has(ch.charaId) || ch.id < baseOutfit.get(ch.charaId)) baseOutfit.set(ch.charaId, ch.id);
  for (const ch of dataset.charas) {
    const urls = [`${SITE}/img/chibi/petit_chr_${ch.charaId}_${ch.id}_0010.webp`];
    if (baseOutfit.get(ch.charaId) !== ch.id) urls.push(`${SITE}/img/chibi/petit_chr_${ch.charaId}_${baseOutfit.get(ch.charaId)}_0010.webp`);
    jobs.push({ kind: "chara", url: urls[0], fallbacks: urls.slice(1), dest: path.join(ROOT, "img/chara", `${ch.id}.webp`) });
  }
  const icons = new Set(dataset.skills.map((s) => s.icon).filter(Boolean));
  for (const icon of icons) {
    jobs.push({ kind: "skill", url: `${SITE}/icon/skill/utx_ico_skill_${icon}.webp`, dest: path.join(ROOT, "img/skill", `${icon}.webp`) });
  }

  let done = 0;
  const failures = await runPool(
    jobs,
    async (job) => {
      if (!forceImages && (await exists(job.dest))) return;
      const raw = path.join(CACHE, "img", job.kind, path.basename(job.dest));
      await mkdir(path.dirname(raw), { recursive: true });
      if (forceImages || !(await exists(raw))) await downloadWithFallbacks([job.url, ...(job.fallbacks || [])], raw);
      if (sharp) {
        const [w, h] = IMAGE_SIZES[job.kind];
        await sharp(raw).resize(w, h, { fit: "inside" }).webp({ quality: 82 }).toFile(job.dest);
      } else {
        await copyFile(raw, job.dest);
      }
      done++;
      if (done % 50 === 0) console.log(`  ${done} images processed`);
    },
    CONCURRENCY
  );
  for (const f of failures) console.warn(`  image failed: ${f.item.url} (${f.err.message})`);
  console.log(`images: ${jobs.length} total, ${done} written, ${failures.length} failed`);
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  await mkdir(path.join(ROOT, "data"), { recursive: true });
  for (const dir of ["card", "skill", "chara"]) await mkdir(path.join(ROOT, "img", dir), { recursive: true });

  const previous = await loadPreviousDataset();
  const chunkUrl = await discoverChunk();
  console.log(`data chunk: ${chunkUrl}`);
  const chunkFile = path.join(CACHE, "uma-data.mjs");
  await writeFile(chunkFile, await fetchText(chunkUrl));

  const mod = await import(pathToFileURL(chunkFile).href);
  const tables = pickTables(mod);
  const dataset = buildDataset(tables);
  console.log(`skills: ${dataset.skills.length}, cards: ${dataset.cards.length}, characters: ${dataset.charas.length}`);

  if (skipEvents) {
    const previousCards = new Map((previous ? previous.cards : []).map((c) => [c.id, c.events || []]));
    const previousCharas = new Map((previous ? previous.charas : []).map((c) => [c.id, c.events || []]));
    for (const card of dataset.cards) card.events = previousCards.get(card.id) || [];
    for (const chara of dataset.charas) chara.events = previousCharas.get(chara.id) || [];
  } else {
    await addEvents(dataset, previous);
  }

  const json = JSON.stringify(dataset);
  await writeFile(DATA_FILE, `window.UMA_DATA=${json};\n`);
  await writeFile(path.join(CACHE, "gl.pretty.json"), JSON.stringify(dataset, null, 2));
  console.log(`data/gl.js written (${(json.length / 1024).toFixed(0)} KB)`);

  if (!skipImages) {
    const sharp = await loadSharp();
    await processImages(dataset, sharp);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
