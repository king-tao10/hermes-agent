/**
 * catalogStore.ts — data layer for the Skills Hub page.
 *
 * ## Why this file exists
 *
 * The page used to download `/docs/api/skills.json` (63,324,299 bytes raw,
 * 11.2 MB gzip, 101,024 records) into a single accumulated string on the main
 * thread (`res.body.getReader()` + `TextDecoder` + `JSON.parse`), build a
 * lowercase haystack for every record, and keep ~213 MB of JS heap alive. Every
 * language switch is a full page reload (the navbar renders `<a href>`), so the
 * whole 63 MB round trip happened again — measured cold-load to first card was
 * 6.4–45 s, with 242/148/64 ms main-thread long tasks.
 *
 * The pipeline is now split (see `website/scripts/build-skills-shards.mjs`):
 *
 *   1. an index of 17,395 bytes (`/docs/api/skills-shards/index.json`) that
 *      carries the total, the per-source / per-category counts and the shard
 *      manifest — everything the hero, the filter dropdowns and the source
 *      pills need, with zero shard bytes;
 *   2. 36 shards of ≤ 2,097,152 bytes, fetched on demand;
 *   3. this store, which fetches bytes and never parses them: every byte string
 *      goes to `catalog.worker.ts`, which does `JSON.parse` + haystack building
 *      off the main thread;
 *   4. IndexedDB (handed out by `openBrowserCache()`), keyed by the index's own
 *      `contentHash`, so a reload — including a language switch — reads from
 *      disk and issues **zero** network requests.
 *
 * ## Data flow
 *
 *   start() → cache/index.json ──hit──► Worker("index") ─┐
 *                    └──miss──► fetch ──► cache.write ────┤
 *                                                          ├─► index applied
 *                            fetch(meta) (best effort) ────┘  (total, bySource,
 *                                                              byCategory, shards)
 *   first batch of shards (small sources first) ──► Worker("shard") per shard
 *        (bytes come from IndexedDB when the contentHash already cached them)
 *   search / filter / "load more" ──► more shards, progress surfaced in the UI
 *
 * ## Legacy fallback (safe to deploy in either order)
 *
 * If the shard index 404s, fails to parse, or declares a schemaVersion this
 * build does not understand, `start()` falls back to the old
 * `/docs/api/skills.json` entry point. The fallback is **not** a return to the
 * old main-thread path: the 63 MB body is streamed into byte chunks and handed
 * to the same Worker (`kind: "legacy"`), which parses it and builds the
 * haystack off the main thread. The main thread only ever holds the Worker's
 * reply. The legacy body is deliberately *not* written to IndexedDB (63 MB per
 * visitor is a quota risk); a page that is served shards never touches it.
 *
 * ## Node-importable on purpose
 *
 * Nothing in this module touches `window`, `document`, `indexedDB` or `Worker`
 * at import time: `fetchFn`, `cache` and `createWorker` are all injectable, and
 * every pure function (`buildSearchHaystack`, the three parsers, the haystack
 * matcher) is exported so `tools`-style Node scripts can drive the real code
 * path — see `out/task3-verify.mjs`.
 */

/* ------------------------------------------------------------------ types */

/** One skill record, exactly the shape the shard builder projects onto disk. */
export interface Skill {
  name: string;
  description: string;
  overview?: string;
  category: string;
  categoryLabel: string;
  source: string;
  tags: string[];
  platforms: string[];
  author: string;
  version: string;
  license?: string;
  envVars?: string[];
  commands?: string[];
  docsPath?: string;
  identifier?: string;
  installIdentifier?: string;
  installCmd?: string;
  /** Clickable URL to the skill's origin (repo / detail page). */
  sourceUrl?: string;
}

/** One entry of `index.json`'s `shards[]` (see the T2 pipeline contract). */
export interface ShardPlan {
  id: string;
  source: string;
  categoryPrefix: string;
  categories: string[];
  part: number;
  parts: number;
  count: number;
  bytes: number;
  /** Path relative to the index directory, e.g. `shards/clawhub__apple.json`. */
  file: string;
  hash: string;
}

/** `index.json` — the only file the first paint has to download. */
export interface CatalogIndex {
  schemaVersion: number;
  total: number;
  generatedAt: string;
  contentHash: string;
  sourceCount: number;
  categoryCount: number;
  maxShardBytes: number;
  bySource: Record<string, number>;
  byCategory: Record<string, number>;
  shards: ShardPlan[];
}

/** Metadata file kept for the "Catalog refreshed …" hero line. */
export interface IndexMeta {
  extractedAt?: string;
  indexGeneratedAt?: string;
  totalSkills?: number;
  externalSource?: string;
  bySource?: Record<string, number>;
}

/** A shard (or the legacy whole-catalog payload) after Worker parsing. */
export interface LoadedShard {
  id: string;
  source: string;
  categories: string[];
  records: Skill[];
  /** Lowercase haystacks of every record, joined by CATALOG_HAYSTACK_SEPARATOR. */
  haystack: string;
  /** `offsets[i]` = index of record `i`'s haystack in `haystack`; length = n + 1. */
  offsets: Uint32Array;
  /** Raw JSON byte length of the shard as delivered by the network / cache. */
  bytes: number;
}

export interface CatalogSnapshot {
  revision: number;
  phase: "idle" | "loading" | "ready" | "error";
  mode: "shards" | "legacy" | null;
  error: string | null;
  errorCode: string | null;
  total: number;
  sourceCount: number;
  categoryCount: number;
  bySource: Record<string, number>;
  byCategory: Record<string, number>;
  categoryLabels: Record<string, string>;
  generatedAt: string | null;
  contentHash: string;
  /** The index's shard manifest — lets the UI list a source's categories
   *  (and page through shards) without loading any shard bytes. */
  shards: ShardPlan[];
  totalShards: number;
  loadedShards: number;
  pendingShards: number;
  failedShards: number;
  loadedRecords: number;
  loadedBytes: number;
  indexBytes: number;
  networkCalls: number;
  networkBytes: number;
  cacheHits: number;
  /** Wall time spent inside `JSON.parse` + haystack building (Worker time). */
  parseMs: number;
  indexParseMs: number;
  /** True once a parse round-trip actually went through a Worker. */
  usedWorker: boolean;
  meta: IndexMeta;
}

/** Coverage of the shard set behind the *current* filter (for the UI). */
export interface CatalogScopeCoverage {
  loaded: number;
  total: number;
  pending: number;
  failed: number;
  complete: boolean;
}

export interface CatalogFilterResult {
  records: Skill[];
  scope: CatalogScopeCoverage;
}

/* ------------------------------------------------------------- injection */

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  body?: {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel?(reason?: unknown): Promise<void>;
    };
  } | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<FetchResponseLike>;

/** Structural clone of the two IndexedDB calls this store needs. */
export interface CatalogCache {
  get(key: string): Promise<ArrayBuffer | undefined>;
  put(key: string, value: ArrayBuffer): Promise<void>;
}

/** Structural clone of a dedicated Worker (a fake in tests, a real one in the browser). */
export interface CatalogWorkerLike {
  postMessage(message: unknown, transfer?: unknown[]): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener?(type: "message", listener: (event: { data: unknown }) => void): void;
  terminate?(): void;
}

/* ------------------------------------------------------------ constants */

/** The index. Fixed path per the T2 contract — never derive it from locale. */
export const SKILLS_INDEX_URL = "/hermes-agent/api/skills-shards/index.json";
/** Pre-shard entry point, kept as the deploy-order-safe fallback. */
export const LEGACY_SKILLS_URL = "/hermes-agent/api/skills.json";
export const SKILLS_META_URL = "/hermes-agent/api/skills-meta.json";

export const CATALOG_INDEX_SCHEMA_VERSION = 1;

/**
 * Idle timeout for a catalog request — abort only when the transfer produced no
 * bytes for this long, so slow-but-alive downloads survive (#97861). Kept from
 * the previous implementation; it now guards byte-streaming inside this module
 * instead of a giant string accumulator in the page.
 */
export const CATALOG_STALL_TIMEOUT_MS = 45_000;

/** Index cache entry (bytes with an 8-byte `storedAt` header). */
export const CATALOG_INDEX_CACHE_KEY = "skillshub:index:v1";
export const CATALOG_META_CACHE_KEY = "skillshub:meta:v1";
/** Shard cache entries are `skillshub:shard:<contentHash>:<shardId>`. */
export const CATALOG_SHARD_CACHE_PREFIX = "skillshub:shard:";
export const CATALOG_CACHE_HEADER_BYTES = 8;

/**
 * The catalog is rebuilt twice a day, so a cached index is trusted for 12 h.
 * Within that window a page load issues **zero** requests. `generatedAt` is
 * deliberately *not* used as a cache key (it changes on every build); the
 * `contentHash` is.
 */
export const DEFAULT_INDEX_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
export const DEFAULT_MAX_CONCURRENT_SHARD_LOADS = 4;
export const DEFAULT_FIRST_BATCH_MIN_RECORDS = 600;
export const DEFAULT_FIRST_BATCH_MAX_BYTES = 3 * 1024 * 1024;
export const CATALOG_HAYSTACK_SEPARATOR = "\n";

/**
 * First-paint shard priority: several small registries beat one 2 MB slice of
 * ClawHub, so the first screen fills with first-party / well-known sources.
 * Anything not listed ranks after these, smallest file first.
 */
export const FIRST_BATCH_SOURCE_ORDER = [
  "built-in",
  "optional",
  "Anthropic",
  "OpenAI",
  "HuggingFace",
  "NVIDIA",
  "GitHub",
  "gstack",
  "browse.sh",
  "LobeHub",
  "skills.sh",
  "ClawHub",
];

/* ------------------------------------------------------------- errors */

export interface CatalogError extends Error {
  code: "stalled" | "http" | "parse" | "schema" | "network" | "empty";
}

export function catalogError(code: CatalogError["code"], message: string): CatalogError {
  const err = new Error(message) as CatalogError;
  err.name = `CatalogError(${code})`;
  err.code = code;
  return err;
}

export function catalogErrorCode(err: unknown): string | null {
  if (err && typeof err === "object" && typeof (err as { code?: unknown }).code === "string") {
    return (err as { code: string }).code;
  }
  return null;
}

/* ------------------------------------------------- pure helpers (shared) */

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * The lowercase blob the search filter scans, built once per record inside the
 * Worker instead of per keystroke per record.
 */
export function buildSearchHaystack(s: Skill): string {
  return [s.name, s.description, s.overview, s.categoryLabel, s.author, ...(s.tags || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Parse + validate `index.json` (runs in the Worker). */
export function parseCatalogIndexBytes(bytes: Uint8Array): CatalogIndex {
  const parsed: unknown = JSON.parse(decodeUtf8(bytes));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw catalogError("schema", "shard index is not a JSON object");
  }
  const index = parsed as CatalogIndex;
  if (index.schemaVersion !== CATALOG_INDEX_SCHEMA_VERSION) {
    throw catalogError(
      "schema",
      `unsupported shard index schemaVersion ${String(index.schemaVersion)} (expected ${CATALOG_INDEX_SCHEMA_VERSION})`,
    );
  }
  if (!Array.isArray(index.shards) || typeof index.total !== "number") {
    throw catalogError("schema", "shard index is missing `total` or `shards`");
  }
  if (typeof index.contentHash !== "string" || !index.contentHash) {
    throw catalogError("schema", "shard index is missing `contentHash`");
  }
  for (const shard of index.shards) {
    if (!shard || typeof shard.file !== "string" || typeof shard.id !== "string") {
      throw catalogError("schema", "shard index contains an entry without `id`/`file`");
    }
  }
  return index;
}

export function parseCatalogMetaBytes(bytes: Uint8Array): IndexMeta {
  const parsed: unknown = JSON.parse(decodeUtf8(bytes));
  return parsed && typeof parsed === "object" ? (parsed as IndexMeta) : {};
}

export interface WorkerShardPayload {
  kind: "shard" | "legacy";
  records: Skill[];
  haystack: string;
  offsets: Uint32Array;
  labels: Record<string, string>;
  bySource: Record<string, number>;
  byCategory: Record<string, number>;
}

/**
 * Parse one shard (a JSON array of records) and build the search index.
 * Runs in the Worker — the two expensive steps (`JSON.parse` over ~2 MB,
 * ~4k × `buildSearchHaystack`) never touch the main thread.
 *
 * `offsets`/`haystack` describe a *flat* search index: record `i`'s haystack is
 * `haystack.slice(offsets[i], offsets[i + 1] - 1)`. One contiguous string with
 * no per-record JS string objects is cheaper to keep alive and to scan than
 * 101k individual `_search` properties (which is what the page used to build).
 */
export function parseCatalogShardBytes(
  bytes: Uint8Array,
  kind: "shard" | "legacy" = "shard",
): WorkerShardPayload {
  const parsed: unknown = JSON.parse(decodeUtf8(bytes));
  if (!Array.isArray(parsed)) {
    throw catalogError("schema", `${kind} payload is not a JSON array of skill records`);
  }
  const records = parsed as Skill[];
  const n = records.length;
  const offsets = new Uint32Array(n + 1);
  const parts: string[] = new Array(n);
  const labels: Record<string, string> = {};
  const bySource: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const record = records[i];
    const haystack = buildSearchHaystack(record);
    parts[i] = haystack;
    offsets[i] = cursor;
    cursor += haystack.length + CATALOG_HAYSTACK_SEPARATOR.length;
    const categoryKey = record.category || "uncategorized";
    if (record.categoryLabel && !labels[categoryKey]) labels[categoryKey] = record.categoryLabel;
    bySource[record.source] = (bySource[record.source] ?? 0) + 1;
    byCategory[categoryKey] = (byCategory[categoryKey] ?? 0) + 1;
  }
  // Sentinel: offsets[n] - 1 === haystack.length, so `slice(offsets[i],
  // offsets[i + 1] - 1)` is exact for the last record too.
  offsets[n] = cursor;
  return {
    kind,
    records,
    haystack: parts.join(CATALOG_HAYSTACK_SEPARATOR),
    offsets,
    labels,
    bySource,
    byCategory,
  };
}

/** First index whose `offsets[index] > at` (offsets are non-decreasing). */
function upperBound(offsets: Uint32Array, at: number): number {
  let lo = 0;
  let hi = offsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (offsets[mid] <= at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Which record owns character `at` of the flat haystack. */
export function matchRecordIndexAt(shard: LoadedShard, at: number): number {
  const offsets = shard.offsets;
  const n = offsets.length - 1;
  if (n <= 0) return -1;
  let i = upperBound(offsets, at) - 1;
  if (i < 0) i = 0;
  if (i >= n) i = n - 1;
  // Records with an empty haystack share a start offset with their successor;
  // the separator can never be part of a hit (queries cannot contain "\n"),
  // so walk forward to the record that really owns `at`.
  while (i < n - 1 && at >= offsets[i + 1] - 1) i++;
  return i;
}

/**
 * Record indices whose haystack contains `query` (already lowercased/trimmed).
 * `null` means "no query → every record matches".
 *
 * Scanning one flat string and mapping hits back through `offsets` is what
 * keeps this a single pass with no per-record allocation.
 */
export function matchRecordIndices(shard: LoadedShard, query: string): Set<number> | null {
  if (!query) return null;
  const hits = new Set<number>();
  const haystack = shard.haystack;
  if (!haystack) return hits;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(query, from);
    if (at === -1) break;
    hits.add(matchRecordIndexAt(shard, at));
    from = at + 1;
  }
  return hits;
}

/* ------------------------------------------------- cache implementations */

function toExactBuffer(bytes: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = bytes;
  if (byteOffset === 0 && byteLength === buffer.byteLength) return buffer as ArrayBuffer;
  return (buffer as ArrayBuffer).slice(byteOffset, byteOffset + byteLength) as ArrayBuffer;
}

/** Prefix the cached index bytes with the wall clock, for the TTL check. */
function packIndexCacheEntry(bytes: Uint8Array, storedAt: number): ArrayBuffer {
  const out = new Uint8Array(CATALOG_CACHE_HEADER_BYTES + bytes.byteLength);
  new DataView(out.buffer).setFloat64(0, storedAt, true);
  out.set(bytes, CATALOG_CACHE_HEADER_BYTES);
  return out.buffer;
}

function unpackIndexCacheEntry(value: ArrayBuffer | undefined): {
  bytes: Uint8Array;
  storedAt: number;
} | null {
  if (!value) return null;
  const view = new Uint8Array(value);
  if (view.byteLength <= CATALOG_CACHE_HEADER_BYTES) return null;
  const storedAt = new DataView(view.buffer, view.byteOffset, view.byteLength).getFloat64(0, true);
  return { bytes: view.subarray(CATALOG_CACHE_HEADER_BYTES), storedAt };
}

/**
 * IndexedDB cache. Returns `null` when the platform has no IndexedDB (Node, or
 * a browser with storage disabled) — the caller then simply always uses the
 * network.
 */
export function openIndexedDbCache(
  dbName = "skillshub-catalog",
  storeName = "blobs",
): CatalogCache | null {
  const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!factory) return null;
  let opening: Promise<IDBDatabase> | null = null;
  const db = (): Promise<IDBDatabase> => {
    if (!opening) {
      opening = new Promise<IDBDatabase>((resolve, reject) => {
        const request = factory.open(dbName, 1);
        request.onupgradeneeded = () => {
          const handle = request.result;
          if (!handle.objectStoreNames.contains(storeName)) handle.createObjectStore(storeName);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("indexedDB open failed"));
      }).catch((err) => {
        opening = null;
        throw err;
      });
    }
    return opening;
  };
  const run = <T,>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) =>
    db().then(
      (handle) =>
        new Promise<T>((resolve, reject) => {
          const tx = handle.transaction(storeName, mode);
          const request = fn(tx.objectStore(storeName));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error("indexedDB request failed"));
        }),
    );
  return {
    async get(key) {
      try {
        const value = await run<ArrayBuffer | undefined>("readonly", (store) => store.get(key));
        return value ?? undefined;
      } catch {
        return undefined;
      }
    },
    async put(key, value) {
      try {
        await run("readwrite", (store) => store.put(value, key));
      } catch {
        /* cache writes are best effort: quota, private mode, … */
      }
    },
  };
}

/**
 * localStorage cache — only used when IndexedDB is unavailable. Values are
 * base64 (localStorage stores strings); entries above 256 KB (i.e. shards, but
 * not the 17 KB index) are skipped so a single shard cannot blow the 5 MB quota.
 */
export function openLocalStorageCache(): CatalogCache | null {
  const storage = (globalThis as { localStorage?: Storage }).localStorage;
  if (!storage) return null;
  const maxBytes = 256 * 1024;
  const prefix = "skillshub-cache:";
  const encode = (value: ArrayBuffer): string => {
    const bytes = new Uint8Array(value);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    return btoa(binary);
  };
  const decode = (text: string): ArrayBuffer => {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  };
  return {
    async get(key) {
      const text = storage.getItem(prefix + key);
      if (!text) return undefined;
      try {
        return decode(text);
      } catch {
        return undefined;
      }
    },
    async put(key, value) {
      if (value.byteLength > maxBytes) return;
      try {
        storage.setItem(prefix + key, encode(value));
      } catch {
        /* quota / private mode */
      }
    },
  };
}

/** IndexedDB first, localStorage as the fallback, `null` when neither exists. */
export function openBrowserCache(): CatalogCache | null {
  return openIndexedDbCache() ?? openLocalStorageCache();
}

/* ------------------------------------------------- worker + inline parse */

interface WorkerParseRequest {
  type: "parse";
  requestId: number;
  kind: WorkerParseKind;
  key: string;
  bytes: ArrayBuffer;
}

export type WorkerParseKind = "index" | "shard" | "legacy" | "meta";

interface WorkerParseResponse {
  type: "parsed" | "error";
  requestId: number;
  kind: WorkerParseKind;
  key: string;
  index?: CatalogIndex;
  meta?: IndexMeta;
  payload?: WorkerShardPayload;
  message?: string;
}

export interface ParsedPayload {
  index?: CatalogIndex;
  meta?: IndexMeta;
  payload?: WorkerShardPayload;
}

/**
 * The same pure functions `catalog.worker.ts` calls, executed on the main
 * thread. This is the degraded path used only when no Worker can be created
 * (no Worker support, or the bundler could not emit the worker chunk) — the
 * page keeps working, it just pays the parse cost inline.
 */
export function parseCatalogPayloadInline(
  kind: WorkerParseKind,
  bytes: Uint8Array,
): ParsedPayload {
  if (kind === "index") return { index: parseCatalogIndexBytes(bytes) };
  if (kind === "meta") return { meta: parseCatalogMetaBytes(bytes) };
  return { payload: parseCatalogShardBytes(bytes, kind) };
}

/* ------------------------------------------------------------ the store */

export interface CatalogStoreOptions {
  fetchFn?: FetchLike | null;
  cache?: CatalogCache | null;
  /** Pre-built Worker (browser: a real one; tests: an adapter). */
  worker?: CatalogWorkerLike | null;
  /** Factory used when `worker` is not given, e.g. `() => new Worker(new URL(...))`. */
  createWorker?: (() => CatalogWorkerLike | null) | null;
  indexPath?: string;
  legacyPath?: string;
  metaPath?: string;
  firstBatchMinRecords?: number;
  firstBatchMaxBytes?: number;
  maxConcurrentShardLoads?: number;
  indexCacheTtlMs?: number;
  stallTimeoutMs?: number;
  /** Ignore the cached index (used by the page's Retry button). */
  forceIndexRefresh?: boolean;
  now?: () => number;
}

const EMPTY_SNAPSHOT: CatalogSnapshot = {
  revision: 0,
  phase: "idle",
  mode: null,
  error: null,
  errorCode: null,
  total: 0,
  sourceCount: 0,
  categoryCount: 0,
  bySource: {},
  byCategory: {},
  categoryLabels: {},
  generatedAt: null,
  contentHash: "",
  shards: [],
  totalShards: 0,
  loadedShards: 0,
  pendingShards: 0,
  failedShards: 0,
  loadedRecords: 0,
  loadedBytes: 0,
  indexBytes: 0,
  networkCalls: 0,
  networkBytes: 0,
  cacheHits: 0,
  parseMs: 0,
  indexParseMs: 0,
  usedWorker: false,
  meta: {},
};

/** The pristine snapshot the page renders before `start()` has done anything. */
export function initialCatalogSnapshot(): CatalogSnapshot {
  return EMPTY_SNAPSHOT;
}

export class CatalogStore {
  private options: CatalogStoreOptions;
  private fetchFn: FetchLike | null = null;
  private cache: CatalogCache | null = null;
  private worker: CatalogWorkerLike | null = null;
  private workerUnavailable = false;
  private workerListener: ((event: { data: unknown }) => void) | null = null;
  private pendingRpc = new Map<
    number,
    { resolve: (value: ParsedPayload) => void; reject: (err: unknown) => void }
  >();
  private rpcSeq = 0;
  private listeners = new Set<() => void>();
  private activeRequests = new Set<AbortController>();

  private index: CatalogIndex | null = null;
  private mode: "shards" | "legacy" | null = null;
  private shards = new Map<string, LoadedShard>();
  private plans = new Map<string, ShardPlan>();
  private preferredOrder: ShardPlan[] = [];
  private queue: string[] = [];
  private queued = new Set<string>();
  private inFlight = new Map<string, Promise<void>>();
  private failedShardIds = new Set<string>();
  private draining = false;
  private bySource: Record<string, number> = {};
  private byCategory: Record<string, number> = {};
  private categoryLabels: Record<string, string> = {};
  private meta: IndexMeta = {};
  private phase: CatalogSnapshot["phase"] = "idle";
  private error: string | null = null;
  private errorCode: string | null = null;
  private contentHash = "";
  private total = 0;
  private loadedRecords = 0;
  private loadedBytes = 0;
  private indexBytes = 0;
  private networkCalls = 0;
  private networkBytes = 0;
  private cacheHits = 0;
  private parseMs = 0;
  private indexParseMs = 0;
  private usedWorker = false;
  private revision = 0;
  private snapshot: CatalogSnapshot = EMPTY_SNAPSHOT;
  private destroyed = false;

  constructor(options: CatalogStoreOptions = {}) {
    this.options = options;
    this.fetchFn = options.fetchFn ?? null;
    this.cache = options.cache ?? null;
    this.worker = options.worker ?? null;
  }

  /* ---------------------------------------------------------- plumbing */

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  private get stallTimeoutMs(): number {
    return this.options.stallTimeoutMs ?? CATALOG_STALL_TIMEOUT_MS;
  }

  private get indexCacheTtlMs(): number {
    return this.options.indexCacheTtlMs ?? DEFAULT_INDEX_CACHE_TTL_MS;
  }

  private get maxConcurrent(): number {
    return Math.max(1, this.options.maxConcurrentShardLoads ?? DEFAULT_MAX_CONCURRENT_SHARD_LOADS);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): CatalogSnapshot {
    return this.snapshot;
  }

  private bump(): void {
    this.revision++;
    this.snapshot = {
      revision: this.revision,
      phase: this.phase,
      mode: this.mode,
      error: this.error,
      errorCode: this.errorCode,
      total: this.total,
      sourceCount: Object.keys(this.bySource).length,
      categoryCount: this.index ? this.index.categoryCount : Object.keys(this.byCategory).length,
      bySource: this.bySource,
      byCategory: this.byCategory,
      categoryLabels: this.categoryLabels,
      generatedAt:
        this.index?.generatedAt ?? this.meta.indexGeneratedAt ?? this.meta.extractedAt ?? null,
      contentHash: this.contentHash,
      shards: this.index?.shards ?? [],
      totalShards: this.mode === "legacy" ? 1 : this.preferredOrder.length,
      loadedShards: this.shards.size,
      pendingShards: this.inFlight.size + this.queue.length,
      failedShards: this.failedShardIds.size,
      loadedRecords: this.loadedRecords,
      loadedBytes: this.loadedBytes,
      indexBytes: this.indexBytes,
      networkCalls: this.networkCalls,
      networkBytes: this.networkBytes,
      cacheHits: this.cacheHits,
      parseMs: this.parseMs,
      indexParseMs: this.indexParseMs,
      usedWorker: this.usedWorker,
      meta: this.meta,
    };
    for (const listener of Array.from(this.listeners)) listener();
  }

  destroy(): void {
    this.destroyed = true;
    for (const ctrl of Array.from(this.activeRequests)) {
      try {
        ctrl.abort();
      } catch {
        /* ignore */
      }
    }
    this.activeRequests.clear();
    for (const entry of Array.from(this.pendingRpc.values())) {
      entry.reject(catalogError("network", "catalog store destroyed"));
    }
    this.pendingRpc.clear();
    if (this.worker) {
      if (this.workerListener && this.worker.removeEventListener) {
        this.worker.removeEventListener("message", this.workerListener);
      }
      try {
        this.worker.terminate?.();
      } catch {
        /* ignore */
      }
    }
    this.worker = null;
    this.listeners.clear();
  }

  /* --------------------------------------------------------- networking */

  private resolveFetchFn(): FetchLike {
    if (this.fetchFn) return this.fetchFn;
    const globalFetch = (globalThis as { fetch?: FetchLike }).fetch;
    if (!globalFetch) throw catalogError("network", "no fetch implementation available");
    this.fetchFn = globalFetch;
    return globalFetch;
  }

  /**
   * Read a response into bytes. Streaming (instead of `res.arrayBuffer()`) keeps
   * the idle-stall guard from #97861: the transfer is aborted only when it goes
   * quiet for `stallTimeoutMs`, slow-but-alive downloads survive. Unlike the old
   * implementation, chunks are concatenated as bytes — never decoded, never
   * accumulated into a 63 MB string on the main thread.
   */
  private async readResponseBytes(
    response: FetchResponseLike,
    armStallTimer: () => void,
  ): Promise<Uint8Array> {
    const reader = response.body?.getReader?.();
    if (!reader) return new Uint8Array(await response.arrayBuffer());
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength) {
        chunks.push(value);
        total += value.byteLength;
        armStallTimer();
      }
    }
    if (chunks.length === 0) return new Uint8Array(0);
    if (chunks.length === 1) return chunks[0];
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }

  private async fetchBytes(url: string): Promise<Uint8Array> {
    const fetchFn = this.resolveFetchFn();
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    if (controller) this.activeRequests.add(controller);
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const armStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      if (controller) stallTimer = setTimeout(() => controller.abort(), this.stallTimeoutMs);
    };
    try {
      armStallTimer();
      const response = await fetchFn(url, controller ? { signal: controller.signal } : undefined);
      if (!response.ok) throw catalogError("http", `HTTP ${response.status} from ${url}`);
      const bytes = await this.readResponseBytes(response, armStallTimer);
      this.networkCalls++;
      this.networkBytes += bytes.byteLength;
      return bytes;
    } catch (err) {
      if (controller?.signal.aborted && !this.destroyed) {
        throw catalogError(
          "stalled",
          `no data received for ${Math.round(this.stallTimeoutMs / 1000)}s from ${url}`,
        );
      }
      if (catalogErrorCode(err)) throw err;
      throw catalogError("network", err instanceof Error ? err.message : String(err));
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
      if (controller) this.activeRequests.delete(controller);
    }
  }

  /* -------------------------------------------------------------- cache */

  private async readCache(key: string): Promise<ArrayBuffer | undefined> {
    if (!this.cache) return undefined;
    try {
      return await this.cache.get(key);
    } catch {
      return undefined;
    }
  }

  private async writeCache(key: string, value: ArrayBuffer): Promise<void> {
    if (!this.cache) return;
    try {
      await this.cache.put(key, value);
    } catch {
      /* best effort */
    }
  }

  private shardCacheKey(id: string): string {
    // contentHash is the data version: a rebuild invalidates everything, a
    // reload (including a language switch) hits every entry.
    return `${CATALOG_SHARD_CACHE_PREFIX}${this.contentHash}:${id}`;
  }

  /* ------------------------------------------------------------- worker */

  private ensureWorker(): CatalogWorkerLike | null {
    if (this.worker) return this.worker;
    if (this.workerUnavailable) return null;
    const create = this.options.createWorker;
    if (!create) {
      this.workerUnavailable = true;
      return null;
    }
    try {
      const worker = create();
      if (!worker) {
        this.workerUnavailable = true;
        return null;
      }
      this.workerListener = (event) => this.handleWorkerMessage(event);
      worker.addEventListener("message", this.workerListener);
      this.worker = worker;
      return worker;
    } catch {
      this.workerUnavailable = true;
      return null;
    }
  }

  private handleWorkerMessage(event: { data: unknown }): void {
    const message = event.data as WorkerParseResponse | null;
    if (!message || typeof message !== "object" || typeof message.requestId !== "number") return;
    const entry = this.pendingRpc.get(message.requestId);
    if (!entry) return;
    this.pendingRpc.delete(message.requestId);
    if (message.type === "error") {
      entry.reject(catalogError("parse", message.message ?? "worker parse failed"));
      return;
    }
    entry.resolve({ index: message.index, meta: message.meta, payload: message.payload });
  }

  /**
   * How long a worker reply may take before the worker is declared dead.
   * The probe (first request, an unproven worker chunk) is impatient — a live
   * worker answers in milliseconds, and a dead one must not hold the page on
   * "Loading the catalog…" for long.
   */
  private static readonly WORKER_REPLY_TIMEOUT_MS = 10_000;
  private static readonly WORKER_PROBE_TIMEOUT_MS = 3_000;

  /**
   * Stop using the Worker and hand control back to the inline path.
   *
   * A worker chunk can be emitted *without* the bundler runtime (webpack does
   * this when the worker bundle is not self-contained): it then dies on load
   * with `__webpack_require__ is not defined`, never installs `onmessage`, and
   * every request would hang forever — which is how the page gets stuck on
   * "Loading the catalog…" instead of rendering. Same story for a CSP that
   * blocks workers. Detect it (error, or a reply that never comes) and fall
   * back rather than fail.
   */
  private disableWorker(reason: unknown): void {
    this.workerUnavailable = true;
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      if (this.workerListener && worker.removeEventListener) {
        worker.removeEventListener("message", this.workerListener);
      }
      try {
        worker.terminate?.();
      } catch {
        /* a worker that already died cannot be terminated; nothing to do */
      }
    }
    this.workerListener = null;
    const pending = [...this.pendingRpc.values()];
    this.pendingRpc.clear();
    for (const entry of pending) {
      entry.reject(
        reason instanceof Error ? reason : catalogError("parse", "worker unavailable"),
      );
    }
  }

  /** One `parse` round-trip to the Worker, timed out and cancellable. */
  private rpcParse(
    worker: CatalogWorkerLike,
    kind: WorkerParseKind,
    key: string,
    bytes: Uint8Array,
    probing: boolean,
  ): Promise<ParsedPayload> {
    const requestId = ++this.rpcSeq;
    return new Promise<ParsedPayload>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pendingRpc.delete(requestId);
          reject(catalogError("parse", "worker did not answer in time"));
        },
        probing ? CatalogStore.WORKER_PROBE_TIMEOUT_MS : CatalogStore.WORKER_REPLY_TIMEOUT_MS,
      );
      this.pendingRpc.set(requestId, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      // While the worker is still unproven, hand over a *copy*: if it never
      // answers, the inline fallback below still owns the original bytes.
      // Once a reply has come back, the original buffer is transferred as-is.
      const buffer = probing ? toExactBuffer(bytes).slice(0) : toExactBuffer(bytes);
      const request: WorkerParseRequest = { type: "parse", requestId, kind, key, bytes: buffer };
      worker.postMessage(request, [buffer]);
    });
  }

  /** Parse bytes — in the Worker when one is available, inline otherwise. */
  private async parseBytes(
    kind: WorkerParseKind,
    key: string,
    bytes: Uint8Array,
  ): Promise<ParsedPayload> {
    const started = this.now();
    try {
      const worker = this.ensureWorker();
      if (!worker) return parseCatalogPayloadInline(kind, bytes);
      const probing = !this.usedWorker;
      try {
        const parsed = await this.rpcParse(worker, kind, key, bytes, probing);
        this.usedWorker = true;
        return parsed;
      } catch (err) {
        this.disableWorker(err);
        return parseCatalogPayloadInline(kind, bytes);
      }
    } finally {
      const elapsed = this.now() - started;
      this.parseMs += elapsed;
      if (kind === "index") this.indexParseMs += elapsed;
    }
  }

  /* -------------------------------------------------------------- start */

  async start(): Promise<void> {
    if (this.destroyed) return;
    this.phase = "loading";
    this.error = null;
    this.errorCode = null;
    this.bump();
    void this.loadMeta();
    let index: CatalogIndex | null = null;
    try {
      index = await this.loadIndex();
      this.applyIndex(index);
    } catch {
      if (this.destroyed) return;
      index = null;
    }
    if (index) {
      try {
        await this.loadShards(this.planFirstBatch());
      } catch (err) {
        if (this.destroyed) return;
        // Only if *nothing* rendered: a single failed shard must not take the
        // whole page down, the UI shows it as pending/failed instead.
        if (this.shards.size === 0) {
          this.setError(err);
          return;
        }
      }
    } else {
      // Deploy-order safety: shards absent (or unreadable) → the legacy single
      // file, parsed in the same Worker. See the module doc block.
      try {
        await this.loadLegacyCatalog();
      } catch (err) {
        if (this.destroyed) return;
        this.setError(err);
        return;
      }
    }
    if (this.destroyed || this.error) return;
    this.phase = "ready";
    this.bump();
  }

  private async loadIndex(): Promise<CatalogIndex> {
    if (!this.options.forceIndexRefresh) {
      const cached = unpackIndexCacheEntry(await this.readCache(CATALOG_INDEX_CACHE_KEY));
      if (cached && this.now() - cached.storedAt <= this.indexCacheTtlMs) {
        try {
          const parsed = await this.parseBytes("index", "index", cached.bytes);
          if (parsed.index) {
            this.cacheHits++;
            this.indexBytes = cached.bytes.byteLength;
            return parsed.index;
          }
        } catch {
          /* corrupt cache entry: fall through to the network */
        }
      }
    }
    const bytes = await this.fetchBytes(this.options.indexPath ?? SKILLS_INDEX_URL);
    const byteLength = bytes.byteLength; // read before the buffer is transferred
    // Cache first (this also produces the copy the Worker will receive).
    await this.writeCache(CATALOG_INDEX_CACHE_KEY, packIndexCacheEntry(bytes, this.now()));
    const parsed = await this.parseBytes("index", "index", bytes);
    this.indexBytes = byteLength;
    if (!parsed.index) throw catalogError("schema", "index payload missing");
    return parsed.index;
  }

  private async loadMeta(): Promise<void> {
    try {
      const cached = await this.readCache(CATALOG_META_CACHE_KEY);
      if (cached) {
        const parsed = await this.parseBytes("meta", "meta", new Uint8Array(cached));
        this.meta = parsed.meta ?? {};
        this.cacheHits++;
        this.bump();
        return;
      }
      const bytes = await this.fetchBytes(this.options.metaPath ?? SKILLS_META_URL);
      await this.writeCache(
        CATALOG_META_CACHE_KEY,
        bytes.slice().buffer as ArrayBuffer,
      );
      const parsed = await this.parseBytes("meta", "meta", bytes);
      this.meta = parsed.meta ?? {};
      this.bump();
    } catch {
      /* meta only feeds the "Catalog refreshed …" line; never fatal */
    }
  }

  private applyIndex(index: CatalogIndex): void {
    this.index = index;
    this.mode = "shards";
    this.contentHash = index.contentHash;
    this.total = index.total;
    this.bySource = index.bySource ?? {};
    this.byCategory = index.byCategory ?? {};
    this.plans = new Map(index.shards.map((shard) => [shard.id, shard]));
    const rank = new Map(FIRST_BATCH_SOURCE_ORDER.map((source, i) => [source, i]));
    this.preferredOrder = [...index.shards].sort((a, b) => {
      const ra = rank.get(a.source) ?? FIRST_BATCH_SOURCE_ORDER.length;
      const rb = rank.get(b.source) ?? FIRST_BATCH_SOURCE_ORDER.length;
      if (ra !== rb) return ra - rb;
      if (a.source !== b.source) return a.source < b.source ? -1 : 1;
      return a.part - b.part;
    });
    this.bump();
  }

  private async loadLegacyCatalog(): Promise<void> {
    const bytes = await this.fetchBytes(this.options.legacyPath ?? LEGACY_SKILLS_URL);
    const byteLength = bytes.byteLength;
    const parsed = await this.parseBytes("legacy", "legacy", bytes);
    const payload = parsed.payload;
    if (!payload) throw catalogError("schema", "legacy payload missing");
    this.mode = "legacy";
    this.contentHash = "legacy";
    this.total = payload.records.length;
    this.bySource = payload.bySource;
    this.byCategory = payload.byCategory;
    this.mergeLabels(payload.labels);
    this.shards.set("legacy", {
      id: "legacy",
      source: "",
      categories: [],
      records: payload.records,
      haystack: payload.haystack,
      offsets: payload.offsets,
      bytes: byteLength,
    });
    this.loadedRecords = payload.records.length;
    this.loadedBytes = byteLength;
    this.bump();
  }

  private setError(err: unknown): void {
    if (this.destroyed) return;
    this.error = err instanceof Error ? err.message : String(err);
    this.errorCode = catalogErrorCode(err);
    this.phase = "error";
    this.bump();
  }

  private mergeLabels(labels: Record<string, string>): void {
    for (const key of Object.keys(labels)) {
      if (!this.categoryLabels[key]) this.categoryLabels[key] = labels[key];
    }
  }

  /* ------------------------------------------------------- shard loading */

  private planFirstBatch(): ShardPlan[] {
    const minRecords = this.options.firstBatchMinRecords ?? DEFAULT_FIRST_BATCH_MIN_RECORDS;
    const maxBytes = this.options.firstBatchMaxBytes ?? DEFAULT_FIRST_BATCH_MAX_BYTES;
    const chosen: ShardPlan[] = [];
    let records = 0;
    let bytes = 0;
    for (const plan of this.preferredOrder) {
      if (records >= minRecords || bytes >= maxBytes) break;
      chosen.push(plan);
      records += plan.count;
      bytes += plan.bytes;
    }
    return chosen;
  }

  private async loadShardById(id: string, errors?: unknown[]): Promise<void> {
    const plan = this.plans.get(id);
    if (!plan || this.shards.has(id)) return;
    const existing = this.inFlight.get(id);
    if (existing) return existing;
    const task = (async () => {
      const key = this.shardCacheKey(id);
      let bytes: Uint8Array | null = await this.readCache(key).then((value) =>
        value ? new Uint8Array(value) : null,
      );
      if (bytes) {
        this.cacheHits++;
      } else {
        bytes = await this.fetchBytes(this.shardUrl(plan));
        // The Worker receives (and detaches) the original buffer, so the cache
        // gets its own copy.
        await this.writeCache(key, bytes.slice().buffer as ArrayBuffer);
      }
      const view = bytes;
      // Read length/parse before the buffer is handed to the Worker: a detached
      // view reports byteLength 0 afterwards.
      const byteLength = view.byteLength;
      const parsed = await this.parseBytes("shard", id, view);
      const payload = parsed.payload;
      if (!payload) throw catalogError("parse", `shard ${id} produced no payload`);
      this.shards.set(id, {
        id,
        source: plan.source,
        categories: plan.categories ?? [],
        records: payload.records,
        haystack: payload.haystack,
        offsets: payload.offsets,
        bytes: byteLength,
      });
      this.mergeLabels(payload.labels);
      this.loadedRecords += payload.records.length;
      this.loadedBytes += byteLength;
      this.bump();
    })();
    this.inFlight.set(id, task);
    try {
      await task;
    } catch (err) {
      if (!this.destroyed) {
        this.failedShardIds.add(id);
        this.bump();
      }
      if (errors) errors.push(err);
    } finally {
      this.inFlight.delete(id);
    }
  }

  private shardUrl(plan: ShardPlan): string {
    const base = this.options.indexPath ?? SKILLS_INDEX_URL;
    const dir = base.slice(0, base.lastIndexOf("/") + 1);
    // `shards[].file` is authoritative (slug rules belong to the pipeline).
    return `${dir}${plan.file}`;
  }

  private async loadShards(plans: ShardPlan[]): Promise<void> {
    const ids = plans.map((plan) => plan.id).filter((id) => !this.shards.has(id));
    const errors: unknown[] = [];
    for (let i = 0; i < ids.length; i += this.maxConcurrent) {
      if (this.destroyed) return;
      const batch = ids.slice(i, i + this.maxConcurrent);
      await Promise.all(batch.map((id) => this.loadShardById(id, errors)));
    }
    if (errors.length) throw errors[0];
  }

  private enqueue(ids: string[]): void {
    for (const id of ids) {
      if (this.shards.has(id) || this.inFlight.has(id) || this.queued.has(id)) continue;
      if (this.failedShardIds.has(id)) continue;
      this.queued.add(id);
      this.queue.push(id);
    }
    if (this.queue.length) void this.drainQueue();
  }

  private async drainQueue(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length && !this.destroyed) {
        const batch = this.queue.splice(0, this.maxConcurrent);
        for (const id of batch) this.queued.delete(id);
        await Promise.all(batch.map((id) => this.loadShardById(id)));
      }
    } finally {
      this.draining = false;
    }
  }

  /**
   * Progressively pull every remaining shard (global search needs the whole
   * catalog). The UI shows `pendingShards` / `loadedShards` while it runs.
   */
  loadAllShards(): void {
    if (this.mode !== "shards") return;
    this.enqueue(this.preferredOrder.map((plan) => plan.id));
  }

  /** Pull the next `count` shards in first-paint priority order. */
  loadNextShards(count = DEFAULT_MAX_CONCURRENT_SHARD_LOADS): void {
    if (this.mode !== "shards") return;
    const ids = this.preferredOrder
      .map((plan) => plan.id)
      .filter((id) => !this.shards.has(id) && !this.inFlight.has(id) && !this.queued.has(id))
      .slice(0, Math.max(1, count));
    this.enqueue(ids);
  }

  /**
   * Pull exactly the shards a filter needs. A source filter loads that source's
   * shards; a category filter loads the shards whose `categories` include it
   * (that mapping is exact in the index — no need to guess slugs). Filters that
   * are still "all" deliberately load nothing: the unfiltered first screen must
   * stay at one index + a handful of small shards.
   */
  ensureScope(source: string, category: string): void {
    if (this.mode !== "shards") return;
    if (source === "all" && category === "all") return;
    const ids = (this.index?.shards ?? [])
      .filter(
        (plan) =>
          (source === "all" || plan.source === source) &&
          (category === "all" || (plan.categories ?? []).includes(category)),
      )
      .map((plan) => plan.id);
    this.enqueue(ids);
  }

  private scopePlans(source: string, category: string): ShardPlan[] {
    if (this.mode === "legacy") return [];
    return (this.index?.shards ?? []).filter(
      (plan) =>
        (source === "all" || plan.source === source) &&
        (category === "all" || (plan.categories ?? []).includes(category)),
    );
  }

  private shardsForQuery(source: string, category: string): LoadedShard[] {
    if (this.mode === "legacy") {
      const legacy = this.shards.get("legacy");
      return legacy ? [legacy] : [];
    }
    const plans = this.scopePlans(source, category);
    const out: LoadedShard[] = [];
    for (const plan of plans) {
      const shard = this.shards.get(plan.id);
      if (shard) out.push(shard);
    }
    return out;
  }

  private scopeCoverage(source: string, category: string): CatalogScopeCoverage {
    if (this.mode === "legacy") {
      const complete = this.shards.has("legacy");
      return { loaded: complete ? 1 : 0, total: 1, pending: complete ? 0 : 1, failed: 0, complete };
    }
    const plans = this.scopePlans(source, category);
    let loaded = 0;
    let pending = 0;
    let failed = 0;
    for (const plan of plans) {
      if (this.shards.has(plan.id)) loaded++;
      else if (this.failedShardIds.has(plan.id)) failed++;
      else if (this.inFlight.has(plan.id) || this.queued.has(plan.id)) pending++;
      else pending++;
    }
    return {
      loaded,
      total: plans.length,
      pending,
      failed,
      complete: loaded === plans.length && plans.length > 0,
    };
  }

  /**
   * The filter, scoped to what is actually loaded. Search runs over the flat
   * haystack of each loaded shard: one `indexOf` scan, then a binary search per
   * hit through `offsets` — no per-record string array on the main thread.
   */
  filterRecords(options: {
    search?: string;
    source?: string;
    category?: string;
  }): CatalogFilterResult {
    const source = options.source ?? "all";
    const category = options.category ?? "all";
    const query = (options.search ?? "").toLowerCase().trim();
    const records: Skill[] = [];
    for (const shard of this.shardsForQuery(source, category)) {
      const hits = matchRecordIndices(shard, query);
      if (hits) {
        for (const i of hits) {
          const record = shard.records[i];
          if (!record) continue;
          if (source !== "all" && record.source !== source) continue;
          if (category !== "all" && record.category !== category) continue;
          records.push(record);
        }
        continue;
      }
      for (const record of shard.records) {
        if (source !== "all" && record.source !== source) continue;
        if (category !== "all" && record.category !== category) continue;
        records.push(record);
      }
    }
    return { records, scope: this.scopeCoverage(source, category) };
  }

  /** Records for one shard id (used by tests/tools; the page uses filterRecords). */
  getShard(id: string): LoadedShard | undefined {
    return this.shards.get(id);
  }

  loadedShardIds(): string[] {
    return Array.from(this.shards.keys());
  }
}

/**
 * Browser factory: builds a store wired to the real platform pieces. Kept next
 * to the class so `index.tsx` stays thin, and so the `Worker` URL stays the one
 * documented place it is constructed (bundlers rewrite `new URL(...)` there).
 * Explicit `null` for `cache` / `worker` / `fetchFn` means "do not use one".
 */
export function createCatalogStore(options: CatalogStoreOptions = {}): CatalogStore {
  const merged: CatalogStoreOptions = { ...options };
  if (merged.fetchFn === undefined) {
    merged.fetchFn = (globalThis as { fetch?: FetchLike }).fetch ?? null;
  }
  if (merged.cache === undefined) merged.cache = openBrowserCache();
  return new CatalogStore(merged);
}
