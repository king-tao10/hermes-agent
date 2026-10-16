/**
 * catalog.worker.ts — the Worker half of the Skills Hub catalog pipeline.
 *
 * Everything expensive about the catalog happens here, off the main thread:
 *
 *   - `TextDecoder` over the payload bytes (17 KB index, ≤ 2 MB shards, or the
 *     63 MB legacy `skills.json`),
 *   - `JSON.parse` of the whole payload,
 *   - `buildSearchHaystack()` for every record plus the flat haystack + offsets
 *     that the page's filter scans.
 *
 * The main thread only ever sees the finished reply, so the long tasks that
 * used to block first paint (measured 242 / 148 / 64 ms) are gone.
 *
 * Protocol (both directions are plain structured-clone messages):
 *
 *   in : { type: "parse", requestId, kind: "index"|"meta"|"shard"|"legacy",
 *          key, bytes: ArrayBuffer }        // `bytes` arrives in the transfer
 *                                           // list — zero copy, detached here
 *   out: { type: "parsed", requestId, kind, key, index }            // index
 *      | { type: "parsed", requestId, kind, key, meta }             // meta
 *      | { type: "parsed", requestId, kind, key, payload }          // shard|legacy
 *      | { type: "error",  requestId, kind, key, message }
 *
 * `payload.offsets` (Uint32Array) is returned in the transfer list as well: the
 * search index itself crosses the thread boundary by ownership transfer, not by
 * copy. The record objects and the flat haystack string are structured-cloned —
 * they are the data the page renders, so they have to exist on the main thread
 * either way; the point is that they are *built* here.
 *
 * The parsing functions live in `catalogStore.ts` so that the Node verification
 * script (`out/task3-verify.mjs`) can drive this exact file through a stub
 * `self`, and so the page can fall back to an inline main-thread parse when no
 * Worker can be constructed at all.
 */

import {
  parseCatalogIndexBytes,
  parseCatalogMetaBytes,
  parseCatalogShardBytes,
  type WorkerParseKind,
} from "./catalogStore";

interface WorkerParseRequest {
  type?: string;
  requestId?: number;
  kind?: WorkerParseKind;
  key?: string;
  bytes?: ArrayBuffer;
}

interface WorkerScope {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown, transfer?: unknown[]): void;
}

/** `self` in a dedicated worker; in the Node harness a stub global. */
const scope = self as unknown as WorkerScope;

scope.onmessage = (event: { data: unknown }) => {
  const request = event?.data as WorkerParseRequest | null;
  if (!request || request.type !== "parse" || typeof request.requestId !== "number") return;
  const { requestId, kind, key } = request;
  const base = { requestId, kind, key: key ?? "" };
  try {
    const bytes = new Uint8Array(request.bytes ?? new ArrayBuffer(0));

    if (kind === "index") {
      scope.postMessage({
        ...base,
        type: "parsed",
        index: parseCatalogIndexBytes(bytes),
      });
      return;
    }

    if (kind === "meta") {
      scope.postMessage({
        ...base,
        type: "parsed",
        meta: parseCatalogMetaBytes(bytes),
      });
      return;
    }

    const payload = parseCatalogShardBytes(bytes, kind === "legacy" ? "legacy" : "shard");
    // Hand the search index over instead of copying it.
    scope.postMessage({ ...base, type: "parsed", payload }, [payload.offsets.buffer]);
  } catch (err) {
    scope.postMessage({
      ...base,
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
