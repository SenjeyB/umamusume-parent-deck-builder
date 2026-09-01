import { mkdir, writeFile, access, copyFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, ".cache");
const SITE = "https://uma.guide";
const ENTRY_PAGE = `${SITE}/support-cards/`;
const CONCURRENCY = 8;

const TYPE_BY_COMMAND = { 101: "speed", 105: "stamina", 102: "power", 103: "guts", 106: "wit" };
const IMAGE_SIZES = { card: [120, 160], skill: [64, 64], chara: [72, 116] };

const args = new Set(process.argv.slice(2));
const skipImages = args.has("--no-images");
const forceImages = args.has("--force-images");

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
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
  const tables = { cards: null, charas: null, skills: null, overrides: null };
  for (const value of Object.values(mod)) {
    if (isArrayOf(value, "supportCardId", "skillHints", "rarityDisplay")) tables.cards = value;
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

function buildDataset({ cards, charas, skills, overrides }) {
  const groupNames = new Map((overrides.supportCards || []).map((o) => [o.supportCardId, o.charaName]));
  const skillById = new Map(skills.map((s) => [s.skillId, s]));

  const outCards = cards
    .map((c) => ({
      id: c.supportCardId,
      chara: groupNames.get(c.supportCardId) || c.charaName,
      title: c.supportCardTitle,
      rar: c.rarity,
      type: cardType(c),
      date: String(c.startDate || "").slice(0, 10),
      hints: (c.skillHints || []).map((h) => h.skillId).filter((id) => id && skillById.has(id)),
    }))
    .sort((a, b) => a.id - b.id);

  const outCharas = charas
    .map((c) => {
      const unique = c.skillIds.split(",").map(Number).find((id) => id >= 100000 && id < 200000) || 0;
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
      desc: cleanDescription(s.skillDesc),
    }))
    .sort((a, b) => a.id - b.id);

  return {
    server: "gl",
    source: SITE,
    generated: new Date().toISOString().slice(0, 10),
    skills: outSkills,
    cards: outCards,
    charas: outCharas,
  };
}

async function runPool(items, worker) {
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
  await Promise.all(Array.from({ length: CONCURRENCY }, next));
  return failures;
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
  const failures = await runPool(jobs, async (job) => {
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
  });
  for (const f of failures) console.warn(`  image failed: ${f.item.url} (${f.err.message})`);
  console.log(`images: ${jobs.length} total, ${done} written, ${failures.length} failed`);
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  await mkdir(path.join(ROOT, "data"), { recursive: true });
  for (const dir of ["card", "skill", "chara"]) await mkdir(path.join(ROOT, "img", dir), { recursive: true });

  const chunkUrl = await discoverChunk();
  console.log(`data chunk: ${chunkUrl}`);
  const chunkFile = path.join(CACHE, "uma-data.mjs");
  await writeFile(chunkFile, await fetchText(chunkUrl));

  const mod = await import(pathToFileURL(chunkFile).href);
  const tables = pickTables(mod);
  const dataset = buildDataset(tables);
  console.log(`skills: ${dataset.skills.length}, cards: ${dataset.cards.length}, characters: ${dataset.charas.length}`);

  const json = JSON.stringify(dataset);
  await writeFile(path.join(ROOT, "data", "gl.js"), `window.UMA_DATA=${json};\n`);
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
