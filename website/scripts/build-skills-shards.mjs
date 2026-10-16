#!/usr/bin/env node
// build-skills-shards.mjs — split the monolithic Skills Hub catalog
// (website/static/api/skills.json, ~63 MB / 100k records) into a lightweight
// index plus a set of byte-bounded shards that a browser can fetch lazily.
//
// Why: src/pages/skills/index.tsx currently fetches the whole skills.json,
// streams it through TextDecoder into one giant string and JSON.parses it on
// the main thread (14 MB -> 213 MB JS heap, 6-45 s to first card, 200+ ms long
// tasks). With an index in the low tens of KB the first paint only needs
// index.json; shards are pulled on demand (per source / per category).
//
// Output layout (defaults, both relative to the current working directory):
//   <out>/index.json          — lightweight catalog index (see buildIndex())
//   <out>/shards/<id>.json    — JSON array of records, each file <= maxShardBytes
//
// Sharding strategy: partition by `source` first, then by `category`; a single
// category that is still too large is cut into byte-bounded chunks ("parts").
// Small categories are packed together (adjacent in sorted order) up to the
// byte budget so we don't emit hundreds of tiny HTTP requests.
//
// Every record keeps the canonical Skills Hub fields (see RECORD_FIELDS);
// pass --all-fields to keep every key present in the input record verbatim.
//
// Usage:
//   node scripts/build-skills-shards.mjs \
//     [--input ./static/api/skills.json] \
//     [--out ./static/api/skills-shards] \
//     [--max-shard-bytes 2097152] \
//     [--all-fields] [--quiet]
//
// Pure Node (node:fs / node:path / node:crypto only), requires Node >= 20.

import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const DEFAULT_INPUT = "./static/api/skills.json";
const DEFAULT_OUT = "./static/api/skills-shards";
const DEFAULT_MAX_SHARD_BYTES = 2 * 1024 * 1024; // 2 MiB
const SHARDS_SUBDIR = "shards";
const SCHEMA_VERSION = 1;

// Canonical record fields carried over into every shard.
const RECORD_FIELDS = [
  "name",
  "description",
  "overview",
  "category",
  "categoryLabel",
  "source",
  "tags",
  "platforms",
  "author",
  "version",
  "license",
  "envVars",
  "commands",
  "docsPath",
  "installIdentifier",
  "installCmd",
];

function usage(stream = process.stdout) {
  stream.write(
    "Usage: node build-skills-shards.mjs [--input FILE] [--out DIR] " +
      "[--max-shard-bytes N] [--all-fields] [--quiet]\n",
  );
}

function parseArgs(argv) {
  const opts = {
    input: DEFAULT_INPUT,
    out: DEFAULT_OUT,
    maxShardBytes: DEFAULT_MAX_SHARD_BYTES,
    allFields: false,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const take = (name) => {
      const next = argv[++i];
      if (next === undefined) {
        process.stderr.write(`error: ${name} requires a value\n`);
        process.exit(2);
      }
      return next;
    };
    switch (arg) {
      case "--input":
      case "-i":
        opts.input = take(arg);
        break;
      case "--out":
      case "-o":
        opts.out = take(arg);
        break;
      case "--max-shard-bytes":
      case "-m": {
        const raw = take(arg);
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 1024) {
          process.stderr.write(`error: invalid --max-shard-bytes ${raw}\n`);
          process.exit(2);
        }
        opts.maxShardBytes = Math.floor(n);
        break;
      }
      case "--all-fields":
        opts.allFields = true;
        break;
      case "--quiet":
        opts.quiet = true;
        break;
      case "--help":
      case "-h":
        usage();
        process.exit(0);
        break;
      default:
        process.stderr.write(`error: unknown argument ${arg}\n`);
        usage(process.stderr);
        process.exit(2);
    }
  }
  return opts;
}

const byteLen = (s) => Buffer.byteLength(s, "utf8");

/** slugify a source/category name into a URL- and filesystem-safe token */
function slugify(value) {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 64);
  return slug || "unknown";
}

/** keep canonical fields only (or every original key with --all-fields) */
function projectRecord(record, allFields) {
  const out = {};
  if (allFields) {
    for (const key of Object.keys(record)) out[key] = record[key];
    return out;
  }
  for (const field of RECORD_FIELDS) {
    if (record[field] !== undefined) out[field] = record[field];
  }
  return out;
}

function buildIndex() {
  return {
    schemaVersion: SCHEMA_VERSION,
    total: 0,
    generatedAt: new Date().toISOString(),
    contentHash: "",
    sourceCount: 0,
    categoryCount: 0,
    maxShardBytes: DEFAULT_MAX_SHARD_BYTES,
    bySource: {},
    byCategory: {},
    shards: [],
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const inputPath = resolve(process.cwd(), opts.input);
  const outDir = resolve(process.cwd(), opts.out);
  const shardsDir = join(outDir, SHARDS_SUBDIR);

  const log = opts.quiet ? () => {} : (msg) => console.log(msg);

  // ---------------------------------------------------------------- read+parse
  const tStart = performance.now();
  let raw;
  try {
    raw = readFileSync(inputPath, "utf8");
  } catch (err) {
    process.stderr.write(`error: cannot read ${inputPath}: ${err.message}\n`);
    process.exit(1);
  }
  const inputBytes = byteLen(raw);
  const tRead = performance.now();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`error: ${inputPath} is not valid JSON: ${err.message}\n`);
    process.exit(1);
  }
  const tParse = performance.now();
  if (!Array.isArray(parsed)) {
    process.stderr.write(
      `error: expected ${inputPath} to contain a JSON array of skill records\n`,
    );
    process.exit(1);
  }
  raw = null; // let the string go; parsed records are all we need

  // ------------------------------------------------------------- project+group
  const bySource = new Map(); // source -> { count, bytes, cats: Map<cat, entries[]> }
  const categoryCounts = new Map();
  const hash = createHash("sha256");
  hash.update("[");
  let firstHashed = true;

  for (const record of parsed) {
    if (record === null || typeof record !== "object") continue;
    const projected = projectRecord(record, opts.allFields);
    const json = JSON.stringify(projected);
    // contentHash is the sha256 of the canonical serialization of the data
    // content (JSON.stringify(array) byte-for-byte), so it only depends on the
    // data, not on whitespace/formatting of the input file.
    hash.update(firstHashed ? json : "," + json);
    firstHashed = false;

    const source = typeof projected.source === "string" && projected.source
      ? projected.source
      : "unknown";
    const category = typeof projected.category === "string" && projected.category
      ? projected.category
      : "uncategorized";

    let src = bySource.get(source);
    if (!src) {
      src = { count: 0, bytes: 0, cats: new Map() };
      bySource.set(source, src);
    }
    src.count++;
    src.bytes += byteLen(json);
    let entries = src.cats.get(category);
    if (!entries) {
      entries = [];
      src.cats.set(category, entries);
    }
    entries.push({ json, bytes: byteLen(json) });
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
  }
  hash.update("]");
  const contentHash = hash.digest("hex");
  const tGroup = performance.now();
  const total = [...bySource.values()].reduce((acc, s) => acc + s.count, 0);

  // ------------------------------------------------------------------- sharding
  const budget = opts.maxShardBytes;
  const usedNames = new Set();
  const shards = [];
  let oversized = 0;

  const writeShard = (source, categoryPrefix, categories, entries, part, parts) => {
    // 2 bytes for the surrounding brackets; the accumulator inside the packers
    // charges one extra byte per record, so the estimate is conservative.
    const content = "[" + entries.map((e) => e.json).join(",") + "]\n";
    const bytes = byteLen(content);
    if (bytes > budget) oversized++;

    let id = `${slugify(source)}__${slugify(categoryPrefix)}`;
    if (parts > 1) id += `__part${part}`;
    if (usedNames.has(id)) {
      let n = 2;
      while (usedNames.has(`${id}__${n}`)) n++;
      id = `${id}__${n}`;
    }
    usedNames.add(id);

    const file = `${SHARDS_SUBDIR}/${id}.json`;
    writeFileSync(join(outDir, file), content);
    shards.push({
      id,
      source,
      categoryPrefix,
      categories: [...categories],
      part,
      parts,
      count: entries.length,
      bytes,
      file,
      hash: createHash("sha256").update(content, "utf8").digest("hex"),
    });
    log(
      `[shards]   ${file.padEnd(48)} count=${String(entries.length).padStart(6)} ` +
        `bytes=${String(bytes).padStart(8)}${bytes > budget ? "  <-- OVER BUDGET" : ""}`,
    );
  };

  const packSource = (source, src) => {
    const cats = [...src.cats.keys()].sort();
    let bucket = null; // { cats: string[], entries: [], bytes }
    let sourceShardsBefore = shards.length;

    const flushBucket = () => {
      if (bucket && bucket.entries.length) {
        writeShard(source, bucket.cats[0], bucket.cats, bucket.entries, 1, 1);
      }
      bucket = null;
    };

    for (const cat of cats) {
      const entries = src.cats.get(cat);
      // Bytes contributed by this category inside a shard: records + separators.
      const catBytes = entries.reduce((acc, e) => acc + e.bytes + 1, 0);
      const standalone = catBytes + 2; // wrapped in [ ... ]

      if (standalone > budget) {
        // Too big on its own: cut it into byte-bounded parts.
        flushBucket();
        const partsEntries = [];
        let cur = [];
        let curBytes = 2; // "["
        for (const entry of entries) {
          if (cur.length && curBytes + entry.bytes + 1 + 1 > budget) {
            partsEntries.push(cur);
            cur = [];
            curBytes = 2;
          }
          cur.push(entry);
          curBytes += entry.bytes + 1; // record + separator (conservative)
        }
        if (cur.length) partsEntries.push(cur);
        partsEntries.forEach((chunk, i) =>
          writeShard(source, cat, [cat], chunk, i + 1, partsEntries.length),
        );
        continue;
      }

      if (bucket && bucket.bytes + catBytes > budget - 2) flushBucket();
      if (!bucket) bucket = { cats: [], entries: [], bytes: 2 }; // "[" + "]"
      bucket.cats.push(cat);
      bucket.entries.push(...entries);
      bucket.bytes += catBytes;
    }
    flushBucket();
    return shards.length - sourceShardsBefore;
  };

  mkdirSync(shardsDir, { recursive: true });
  const sources = [...bySource.keys()].sort();
  const shardsPerSource = {};
  for (const source of sources) {
    shardsPerSource[source] = packSource(source, bySource.get(source));
  }
  const tWrite = performance.now();

  // Drop shards from a previous run that are no longer part of the build so
  // the output directory never accumulates stale files.
  const live = new Set(shards.map((s) => s.file.slice(SHARDS_SUBDIR.length + 1)));
  let removed = 0;
  for (const name of readdirSync(shardsDir)) {
    if (!name.endsWith(".json") || live.has(name)) continue;
    try {
      if (statSync(join(shardsDir, name)).isFile()) {
        rmSync(join(shardsDir, name));
        removed++;
      }
    } catch {
      /* best effort */
    }
  }

  // ---------------------------------------------------------------------- index
  const index = buildIndex();
  index.total = total;
  index.contentHash = contentHash;
  index.sourceCount = sources.length;
  index.categoryCount = categoryCounts.size;
  index.maxShardBytes = budget;
  index.bySource = Object.fromEntries(sources.map((s) => [s, bySource.get(s).count]));
  index.byCategory = Object.fromEntries(
    [...categoryCounts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  );
  index.shards = shards.sort(
    (a, b) =>
      (a.source < b.source ? -1 : a.source > b.source ? 1 : 0) ||
      (a.categoryPrefix < b.categoryPrefix ? -1 : a.categoryPrefix > b.categoryPrefix ? 1 : 0) ||
      a.part - b.part,
  );
  const indexContent = JSON.stringify(index, null, 0) + "\n";
  writeFileSync(join(outDir, "index.json"), indexContent);
  const indexBytes = byteLen(indexContent);
  const tEnd = performance.now();

  // --------------------------------------------------------------------- report
  const maxShardBytes = shards.reduce((acc, s) => Math.max(acc, s.bytes), 0);
  log("[shards] --- build-skills-shards ---");
  log(`[shards] input          : ${inputPath}`);
  log(`[shards] input bytes    : ${inputBytes}`);
  log(`[shards] total records  : ${total}`);
  log(`[shards] sources        : ${sources.length}`);
  log(`[shards] categories     : ${categoryCounts.size}`);
  log(`[shards] shards written : ${shards.length}`);
  log(`[shards] index.json     : ${indexBytes} bytes -> ${join(outDir, "index.json")}`);
  log(`[shards] shards dir     : ${shardsDir}`);
  log(`[shards] max shard bytes: ${maxShardBytes} (budget ${budget})`);
  if (removed) log(`[shards] removed stale  : ${removed}`);
  if (oversized) {
    log(
      `[shards] WARNING: ${oversized} shard(s) exceed --max-shard-bytes ` +
        `(single record larger than the budget)`,
    );
  }
  for (const source of sources) {
    log(`[shards]   ${source.padEnd(14)} ${shardsPerSource[source]} shard(s), ${bySource.get(source).count} record(s)`);
  }
  log(
    `[shards] elapsed        : ${(tEnd - tStart).toFixed(0)} ms ` +
      `(read ${(tRead - tStart).toFixed(0)} / parse ${(tParse - tRead).toFixed(0)} / ` +
      `group ${(tGroup - tParse).toFixed(0)} / write ${(tWrite - tGroup).toFixed(0)} / ` +
      `index ${(tEnd - tWrite).toFixed(0)})`,
  );
  log(
    `[shards] index vs full  : ${indexBytes} bytes vs ${inputBytes} bytes ` +
      `(${(inputBytes / Math.max(indexBytes, 1)).toFixed(0)}x smaller)`,
  );
  log(`[shards] contentHash    : ${contentHash}`);

  const shardTotal = shards.reduce((acc, s) => acc + s.count, 0);
  if (shardTotal !== total) {
    process.stderr.write(
      `error: shards hold ${shardTotal} records but the input has ${total}\n`,
    );
    process.exit(1);
  }
}

main();
