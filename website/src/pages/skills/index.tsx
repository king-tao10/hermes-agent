import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import Layout from "@theme/Layout";
import Link from "@docusaurus/Link";
import Translate, { translate } from "@docusaurus/Translate";
import styles from "./styles.module.css";
import { skillCatalogInstallIdentifier, skillCatalogInstallUrl } from "../../../../apps/shared/src/catalog-install";
import {
  CATALOG_STALL_TIMEOUT_MS,
  createCatalogStore,
  initialCatalogSnapshot,
  type CatalogFilterResult,
  type CatalogSnapshot,
  type CatalogStore,
  type IndexMeta,
  type ShardPlan,
  type Skill,
} from "../../components/SkillsHub/catalogStore";

/** `translate()` ids the page adds on top of the T1 i18n pass. The strings are
 *  English fallbacks so the page keeps working in every locale. */
const humanizeCategory = (key: string): string =>
  key
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) =>
      CATEGORY_ACRONYMS.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");

/** Acronyms the humanized fallback keeps uppercase (`autonomous-ai-agents` →
 *  "Autonomous AI Agents"). Real labels come from the records themselves and
 *  win as soon as one shard containing the category has arrived. */
const CATEGORY_ACRONYMS = new Set([
  "ai", "api", "cli", "cms", "crm", "csv", "erp", "gpu", "json", "llm", "mcp",
  "ml", "nft", "ocr", "sdk", "seo", "sql", "stt", "tts", "ui", "ux",
]);

const indexMeta: IndexMeta = {};

function formatRelativeTime(iso?: string): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const now = Date.now();
  const diffMs = now - then;
  const justNow = translate({
    id: "skillsHub.time.justNow",
    message: "just now",
    description: "Relative timestamp shown when the catalog was refreshed moments ago",
  });
  if (diffMs < 0) return justNow;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return justNow;
  if (mins < 60)
    return mins === 1
      ? translate({
          id: "skillsHub.time.minuteAgo",
          message: "{count} minute ago",
          description: "Relative timestamp for exactly one minute ago; {count} is the number of minutes",
        }, { count: String(mins) })
      : translate({
          id: "skillsHub.time.minutesAgo",
          message: "{count} minutes ago",
          description: "Relative timestamp for several minutes; {count} is the number of minutes",
        }, { count: String(mins) });
  const hours = Math.floor(mins / 60);
  if (hours < 24)
    return hours === 1
      ? translate({
          id: "skillsHub.time.hourAgo",
          message: "{count} hour ago",
          description: "Relative timestamp for exactly one hour ago; {count} is the number of hours",
        }, { count: String(hours) })
      : translate({
          id: "skillsHub.time.hoursAgo",
          message: "{count} hours ago",
          description: "Relative timestamp for several hours; {count} is the number of hours",
        }, { count: String(hours) });
  const days = Math.floor(hours / 24);
  if (days < 30)
    return days === 1
      ? translate({
          id: "skillsHub.time.dayAgo",
          message: "{count} day ago",
          description: "Relative timestamp for exactly one day ago; {count} is the number of days",
        }, { count: String(days) })
      : translate({
          id: "skillsHub.time.daysAgo",
          message: "{count} days ago",
          description: "Relative timestamp for several days; {count} is the number of days",
        }, { count: String(days) });
  const months = Math.floor(days / 30);
  return months === 1
    ? translate({
        id: "skillsHub.time.monthAgo",
        message: "{count} month ago",
        description: "Relative timestamp for exactly one month ago; {count} is the number of months",
      }, { count: String(months) })
    : translate({
        id: "skillsHub.time.monthsAgo",
        message: "{count} months ago",
        description: "Relative timestamp for several months; {count} is the number of months",
      }, { count: String(months) });
}

const CATEGORY_ICONS: Record<string, string> = {
  apple: "\u{f179}",
  "autonomous-ai-agents": "\u{1F916}",
  blockchain: "\u{26D3}",
  communication: "\u{1F4AC}",
  creative: "\u{1F3A8}",
  "data-science": "\u{1F4CA}",
  devops: "\u{2699}",
  dogfood: "\u{1F436}",
  domain: "\u{1F310}",
  email: "\u{2709}",
  feeds: "\u{1F4E1}",
  gaming: "\u{1F3AE}",
  gifs: "\u{1F3AC}",
  github: "\u{1F4BB}",
  health: "\u{2764}",
  "inference-sh": "\u{26A1}",
  leisure: "\u{2615}",
  mcp: "\u{1F50C}",
  media: "\u{1F3B5}",
  migration: "\u{1F4E6}",
  mlops: "\u{1F9EA}",
  "note-taking": "\u{1F4DD}",
  productivity: "\u{2705}",
  "red-teaming": "\u{1F6E1}",
  research: "\u{1F50D}",
  security: "\u{1F512}",
  "smart-home": "\u{1F3E0}",
  "social-media": "\u{1F4F1}",
  "software-development": "\u{1F4BB}",
  translation: "\u{1F30D}",
  other: "\u{1F4E6}",
};

const SOURCE_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; border: string; icon: string }
> = {
  "built-in": {
    label: "Built-in",
    color: "#4ade80",
    bg: "rgba(74, 222, 128, 0.08)",
    border: "rgba(74, 222, 128, 0.2)",
    icon: "\u{2713}",
  },
  optional: {
    label: "Optional",
    color: "#fbbf24",
    bg: "rgba(251, 191, 36, 0.08)",
    border: "rgba(251, 191, 36, 0.2)",
    icon: "\u{2B50}",
  },
  Anthropic: {
    label: "Anthropic",
    color: "#d4845a",
    bg: "rgba(212, 132, 90, 0.08)",
    border: "rgba(212, 132, 90, 0.2)",
    icon: "\u{25C6}",
  },
  LobeHub: {
    label: "LobeHub",
    color: "#60a5fa",
    bg: "rgba(96, 165, 250, 0.08)",
    border: "rgba(96, 165, 250, 0.2)",
    icon: "\u{25CB}",
  },
  "skills.sh": {
    label: "skills.sh",
    color: "#34d399",
    bg: "rgba(52, 211, 153, 0.08)",
    border: "rgba(52, 211, 153, 0.2)",
    icon: "\u{2734}",
  },
  ClawHub: {
    label: "ClawHub",
    color: "#f472b6",
    bg: "rgba(244, 114, 182, 0.08)",
    border: "rgba(244, 114, 182, 0.2)",
    icon: "\u{2726}",
  },
  "browse.sh": {
    label: "browse.sh",
    color: "#22d3ee",
    bg: "rgba(34, 211, 238, 0.08)",
    border: "rgba(34, 211, 238, 0.2)",
    icon: "\u{29BF}",
  },
  OpenAI: {
    label: "OpenAI",
    color: "#10b981",
    bg: "rgba(16, 185, 129, 0.08)",
    border: "rgba(16, 185, 129, 0.2)",
    icon: "\u{2737}",
  },
  HuggingFace: {
    label: "HuggingFace",
    color: "#fbbf24",
    bg: "rgba(251, 191, 36, 0.08)",
    border: "rgba(251, 191, 36, 0.2)",
    icon: "\u{1F917}",
  },
  NVIDIA: {
    label: "NVIDIA",
    color: "#76b900",
    bg: "rgba(118, 185, 0, 0.08)",
    border: "rgba(118, 185, 0, 0.25)",
    icon: "\u{25B6}",
  },
  VoltAgent: {
    label: "VoltAgent",
    color: "#facc15",
    bg: "rgba(250, 204, 21, 0.08)",
    border: "rgba(250, 204, 21, 0.2)",
    icon: "\u{26A1}",
  },
  GitHub: {
    label: "GitHub",
    color: "#94a3b8",
    bg: "rgba(148, 163, 184, 0.08)",
    border: "rgba(148, 163, 184, 0.2)",
    icon: "\u{2756}",
  },
  "Well-Known": {
    label: "Well-Known",
    color: "#818cf8",
    bg: "rgba(129, 140, 248, 0.08)",
    border: "rgba(129, 140, 248, 0.2)",
    icon: "\u{2756}",
  },
  gstack: {
    label: "gstack",
    color: "#fb923c",
    bg: "rgba(251, 146, 60, 0.08)",
    border: "rgba(251, 146, 60, 0.2)",
    icon: "\u{2756}",
  },
  MiniMax: {
    label: "MiniMax",
    color: "#f87171",
    bg: "rgba(248, 113, 113, 0.08)",
    border: "rgba(248, 113, 113, 0.2)",
    icon: "\u{2756}",
  },
};

const SOURCE_ORDER = [
  "all",
  "built-in",
  "optional",
  "Anthropic",
  "OpenAI",
  "HuggingFace",
  "NVIDIA",
  "skills.sh",
  "ClawHub",
  "browse.sh",
  "LobeHub",
  "VoltAgent",
  "Well-Known",
  "GitHub",
  "gstack",
  "MiniMax",
];

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query || !text) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className={styles.highlight}>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const copyLabel = translate({
    id: "skillsHub.copyButton.label",
    message: "Copy install command",
    description: "Tooltip and accessible label of the button that copies a skill's install command",
  });
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard?.writeText(text).then(
        () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        },
        () => {},
      );
    },
    [text],
  );
  return (
    <button
      className={styles.copyBtn}
      onClick={onCopy}
      title={copyLabel}
      aria-label={copyLabel}
    >
      {copied ? (
        <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
          <path
            fillRule="evenodd"
            d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
          <path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12A1.5 1.5 0 0117 6.622V12.5a1.5 1.5 0 01-1.5 1.5h-1v-3.379a3 3 0 00-.879-2.121L10.5 5.379A3 3 0 008.379 4.5H7v-1z" />
          <path d="M4.5 6A1.5 1.5 0 003 7.5v9A1.5 1.5 0 004.5 18h7a1.5 1.5 0 001.5-1.5v-5.879a1.5 1.5 0 00-.44-1.06L9.44 6.439A1.5 1.5 0 008.378 6H4.5z" />
        </svg>
      )}
      <span className={styles.copyBtnLabel}>
        {copied
          ? translate({
              id: "skillsHub.copyButton.copied",
              message: "Copied",
              description: "Copy button label right after the install command was copied",
            })
          : translate({
              id: "skillsHub.copyButton.copy",
              message: "Copy",
              description: "Copy button label before the install command is copied",
            })}
      </span>
    </button>
  );
}

function SkillCard({
  skill,
  query,
  expanded,
  onToggle,
  onCategoryClick,
  onTagClick,
  style,
  onPick,
}: {
  skill: Skill;
  query: string;
  expanded: boolean;
  onToggle: () => void;
  onCategoryClick: (cat: string) => void;
  onTagClick: (tag: string) => void;
  style?: React.CSSProperties;
  /** Picker embed mode: render "+ Add to this Agent" and call this. */
  onPick?: (skill: Skill) => void;
}) {
  const src = SOURCE_CONFIG[skill.source] || SOURCE_CONFIG["optional"];
  const icon = CATEGORY_ICONS[skill.category] || "\u{1F4E6}";
  const installUrl = skillCatalogInstallUrl(skill);

  return (
    <div
      className={`${styles.card} ${expanded ? styles.cardExpanded : ""}`}
      onClick={onToggle}
      style={style}
    >
      <div className={styles.cardAccent} style={{ background: src.color }} />

      <div className={styles.cardInner}>
        <div className={styles.cardTop}>
          <span className={styles.cardIcon}>{icon}</span>
          <div className={styles.cardTitleGroup}>
            <h3 className={styles.cardTitle}>
              {highlightMatch(skill.name, query)}
            </h3>
            <span
              className={styles.sourcePill}
              style={{
                color: src.color,
                background: src.bg,
                borderColor: src.border,
              }}
            >
              {src.icon} {src.label}
            </span>
          </div>
        </div>

        <p className={`${styles.cardDesc} ${expanded ? styles.cardDescFull : ""}`}>
          {highlightMatch(
            skill.description ||
              translate({
                id: "skillsHub.card.noDescription",
                message: "No description available.",
                description: "Placeholder shown on a skill card that has no description",
              }),
            query,
          )}
        </p>

        <div className={styles.cardMeta}>
          <button
            className={styles.catButton}
            onClick={(e) => {
              e.stopPropagation();
              onCategoryClick(skill.category);
            }}
            title={translate({
                id: "skillsHub.card.filterBy",
                message: "Filter by {label}",
                description: "Tooltip of the category button on a skill card; {label} is the category name",
              }, { label: skill.categoryLabel || skill.category })}
          >
            {skill.categoryLabel || skill.category}
          </button>
          {skill.platforms?.map((p) => (
            <span key={p} className={styles.platformPill}>
              {p === "macos" ? "\u{F8FF} macOS" : p === "linux" ? "\u{1F427} Linux" : p}
            </span>
          ))}
        </div>

        {!onPick && installUrl && (
          <a
            className={styles.pickBtn}
            href={installUrl}
            onClick={(e) => e.stopPropagation()}
          >
            <Translate
              id="skillsHub.card.installInHermes"
              description="Link on a skill card that opens the install flow in the Hermes app"
            >
              Install in Hermes
            </Translate>
          </a>
        )}

        {expanded && (
          <div className={styles.cardDetail}>
            {skill.overview && (
              <div className={styles.overviewBlock}>
                <span className={styles.detailLabel}>
                  <Translate
                    id="skillsHub.card.overview"
                    description="Label of the overview block on an expanded skill card"
                  >
                    Overview
                  </Translate>
                </span>
                <p className={styles.overviewText}>{skill.overview}</p>
              </div>
            )}
            {(skill.envVars?.length || skill.commands?.length) ? (
              <div className={styles.prereqBlock}>
                <span className={styles.detailLabel}>
                  <Translate
                    id="skillsHub.card.prerequisites"
                    description="Label of the prerequisites block (env vars, commands) on an expanded skill card"
                  >
                    Prerequisites
                  </Translate>
                </span>
                {skill.envVars?.length ? (
                  <div className={styles.prereqRow}>
                    <span className={styles.prereqKind}>env</span>
                    <span className={styles.prereqList}>
                      {skill.envVars.map((v) => (
                        <code key={v} className={styles.prereqItem}>{v}</code>
                      ))}
                    </span>
                  </div>
                ) : null}
                {skill.commands?.length ? (
                  <div className={styles.prereqRow}>
                    <span className={styles.prereqKind}>cmd</span>
                    <span className={styles.prereqList}>
                      {skill.commands.map((c) => (
                        <code key={c} className={styles.prereqItem}>{c}</code>
                      ))}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}
            {skill.tags?.length > 0 && (
              <div className={styles.tagRow}>
                {skill.tags.map((tag) => (
                  <button
                    key={tag}
                    className={styles.tagPill}
                    onClick={(e) => {
                      e.stopPropagation();
                      onTagClick(tag);
                    }}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
            {skill.author && (
              <div className={styles.authorRow}>
                <span className={styles.authorLabel}>
                  <Translate
                    id="skillsHub.card.author"
                    description="Detail row label on an expanded skill card"
                  >
                    Author
                  </Translate>
                </span>
                <span className={styles.authorValue}>{skill.author}</span>
              </div>
            )}
            {skill.version && (
              <div className={styles.authorRow}>
                <span className={styles.authorLabel}>
                  <Translate
                    id="skillsHub.card.version"
                    description="Detail row label on an expanded skill card"
                  >
                    Version
                  </Translate>
                </span>
                <span className={styles.authorValue}>{skill.version}</span>
              </div>
            )}
            {skill.license && (
              <div className={styles.authorRow}>
                <span className={styles.authorLabel}>
                  <Translate
                    id="skillsHub.card.license"
                    description="Detail row label on an expanded skill card"
                  >
                    License
                  </Translate>
                </span>
                <span className={styles.authorValue}>{skill.license}</span>
              </div>
            )}
            <div className={styles.installHint}>
              <code>{skill.installCmd || `hermes skills install ${skillCatalogInstallIdentifier(skill) || skill.name}`}</code>
              <CopyButton
                text={skill.installCmd || `hermes skills install ${skillCatalogInstallIdentifier(skill) || skill.name}`}
              />
            </div>
            {onPick ? (
              <button
                className={styles.pickBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  onPick(skill);
                }}
              >
                <Translate
                  id="skillsHub.card.addToAgent"
                  description="Button on a skill card inside the picker embed that adds the skill to the host agent"
                >
                  + Add to this Agent
                </Translate>
              </button>
            ) : null}
            <div className={styles.cardLinks}>
              {skill.docsPath ? (
                <a
                  className={styles.docsLink}
                  href={`/docs/user-guide/skills/${skill.docsPath}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Translate
                    id="skillsHub.card.viewDocs"
                    description="Link on an expanded skill card to the skill's generated documentation page"
                  >
                    View full documentation →
                  </Translate>
                </a>
              ) : skill.sourceUrl ? (
                <a
                  className={styles.docsLink}
                  href={skill.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Translate
                    id="skillsHub.card.viewSource"
                    description="Link on an expanded skill card to the skill's upstream repository"
                  >
                    View source ↗
                  </Translate>
                </a>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue} style={{ color }}>
        {value}
      </span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

const PAGE_SIZE = 60;

/** Mirrors the `max-width: 600px` blocks in styles.module.css. */
const MOBILE_FILTER_QUERY = "(max-width: 600px)";

/**
 * The catalog lives in `website/static/api/skills-shards/`:
 *
 *   - `index.json` (~17 KB) carries the total, the per-source / per-category
 *     counts and the shard manifest — everything the hero, the filters and the
 *     source pills need;
 *   - `shards/*.json` (each ≤ 2 MB) are pulled on demand;
 *   - the old 63 MB `/docs/api/skills.json` stays as the fallback when the shard
 *     index is not deployed yet.
 *
 * `catalogStore.ts` fetches the bytes and hands every payload to
 * `catalog.worker.ts`, which parses it and builds the search index off the main
 * thread; the store's cache (`openBrowserCache()`, i.e. `indexedDB` with a
 * localStorage fallback) is keyed by the index's `contentHash`, so the second
 * visit — including a language switch, which is a full page reload — is free.
 * See `out/task3-perf-frontend.md` for the measured numbers.
 */
function createCatalogWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  try {
    // Bundler-recognised Worker construction: webpack/Rspack emit
    // `catalog.worker.ts` as its own chunk. `type: "module"` keeps the emitted
    // chunk self-contained (a classic chunk can inherit an unresolved
    // `__webpack_require__` reference and die on load); browsers without module
    // workers throw, and the store then parses inline instead of hanging.
    return new Worker(new URL("../../components/SkillsHub/catalog.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return null;
  }
}

const EMPTY_FILTER_RESULT: CatalogFilterResult = {
  records: [],
  scope: { loaded: 0, total: 0, pending: 0, failed: 0, complete: false },
};

export default function SkillsDashboard() {
  // Picker embed mode (?embed=picker): the page is being iframed by a host
  // app (Hermes desktop's Bot Mode agent editor) as a skill PICKER. Site
  // chrome is hidden via a CSS class and every card gains an
  // "+ Add to this Agent" button that posts
  //   { type: 'hermes-skill-pick', name, identifier, installCmd, source }
  // to the parent window. The HOST performs the actual install through its
  // own gateway (skills.manage) — the page never installs anything, so
  // there is no origin to trust in this direction; parents must validate
  // event.origin themselves before acting on the message.
  const pickerMode =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("embed") === "picker";

  const pickSkill = useCallback(
    (skill: Skill) => {
      if (typeof window === "undefined" || window.parent === window) return;
      window.parent.postMessage(
        {
          type: "hermes-skill-pick",
          name: skill.name,
          identifier: skillCatalogInstallIdentifier(skill) || skill.name,
          installCmd: skill.installCmd || `hermes skills install ${skillCatalogInstallIdentifier(skill) || skill.name}`,
          source: skill.source,
        },
        "*"
      );
    },
    []
  );

  // Catalog data. The page used to fetch a 63 MB `skills.json` on mount and
  // JSON.parse it on the main thread while the user stared at "Loading the
  // catalog…" for 6.4–45 s. It now fetches a ~17 KB shard index, renders the
  // hero/filters/counts straight from it, and pulls shards on demand — bytes are
  // parsed in a Worker and cached in IndexedDB, so a reload (a language switch
  // is one) costs zero requests.
  const [snapshot, setSnapshot] = useState<CatalogSnapshot>(() => initialCatalogSnapshot());
  const storeRef = useRef<CatalogStore | null>(null);
  // Bumped by the error card's Retry button to rebuild the store and force a
  // fresh index (the cache may be the thing that is stale).
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useState("");
  // Debounced copy of `search` — used by the filter. Without the debounce,
  // typing into the search box ran .filter() over the whole catalog on
  // every keystroke, which on a 50k-item list felt like the page had
  // hung. 150ms gives a snappy feel without lagging behind the user.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileFiltersActive, setMobileFiltersActive] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const filterToggleRef = useRef<HTMLButtonElement>(null);
  const filterDialogRef = useRef<HTMLElement>(null);
  const filterCloseRef = useRef<HTMLButtonElement>(null);

  /**
   * One store per page instance. It owns the index/shard fetches, the Worker
   * round-trips and the IndexedDB cache; this component only renders snapshots
   * and calls `filterRecords()`.
   *
   * The stall guard from #97861 (a transfer that goes quiet for
   * CATALOG_STALL_TIMEOUT_MS is aborted, a slow-but-alive one is not) lives in
   * the store now: it streams the response into *bytes* and hands them to the
   * Worker, instead of accumulating a 63 MB string here.
   */
  useEffect(() => {
    const store = createCatalogStore({
      createWorker: createCatalogWorker,
      forceIndexRefresh: reloadKey > 0,
    });
    storeRef.current = store;
    setSnapshot(store.getSnapshot());
    const unsubscribe = store.subscribe(() => setSnapshot(store.getSnapshot()));
    store.start().catch(() => {
      /* failures surface through the snapshot's error state */
    });
    return () => {
      unsubscribe();
      store.destroy();
      storeRef.current = null;
    };
  }, [reloadKey]);

  const retryCatalogLoad = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  /** Pull everything that is still missing (used by the progress row and by an
   *  active search, which has to see the whole catalog to be correct). */
  const loadEveryShard = useCallback(() => {
    storeRef.current?.loadAllShards();
  }, []);

  /** Page the catalog in: the next shards in first-paint priority order. */
  const loadNextShardBatch = useCallback(() => {
    storeRef.current?.loadNextShards();
  }, []);

  // Debounce the search input — 150ms feels instant while preventing the
  // filter from running on every individual keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  // A global search has to see the whole catalog, so it pulls what is still
  // missing — progressively, in the background, with the progress shown next to
  // the results. Scoped filters (source / category) only pull their own shards.
  useEffect(() => {
    if (debouncedSearch.trim()) storeRef.current?.loadAllShards();
  }, [debouncedSearch]);

  useEffect(() => {
    storeRef.current?.ensureScope(sourceFilter, categoryFilter);
  }, [sourceFilter, categoryFilter]);

  const indexMetaLocal: IndexMeta = snapshot.meta ?? indexMeta;
  // The store reports a machine-readable code so the page can keep showing the
  // localized "stalled" message it had before the store existed.
  const loadError = !snapshot.error
    ? null
    : snapshot.errorCode === "stalled"
      ? translate(
          {
            id: "skillsHub.error.stalled",
            message: "catalog fetch stalled — no data received for {seconds}s",
            description: "Error text shown when the catalog download produced no data for a while; {seconds} is the idle timeout in seconds",
          },
          { seconds: String(CATALOG_STALL_TIMEOUT_MS / 1000) },
        )
      : snapshot.error;
  const catalogReady = snapshot.mode !== null;
  const totalSkills = snapshot.total;
  const statsBySource = snapshot.bySource;
  const shardPlans: ShardPlan[] = snapshot.shards;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const isEditable =
        target?.matches("input, textarea, select") ||
        target?.isContentEditable ||
        Boolean(target?.closest("[contenteditable='true']"));
      if (e.key === "/" && !isEditable) {
        e.preventDefault();
        e.stopImmediatePropagation();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") {
        searchRef.current?.blur();
        setExpandedCard(null);
        setSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_FILTER_QUERY);
    const sync = () => {
      setMobileFiltersActive(media.matches);
      // Leaving the mobile band hides the drawer, so its state has to go with
      // it: otherwise a resize leaves aria-expanded="true" on a hidden toggle
      // and coming back reopens the drawer and re-locks body scroll.
      if (!media.matches) setSidebarOpen(false);
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!sidebarOpen || !mobileFiltersActive) return;

    const dialog = filterDialogRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : filterToggleRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    filterCloseRef.current?.focus();

    const trapFocus = (e: KeyboardEvent) => {
      if (!dialog) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setSidebarOpen(false);
        return;
      }
      if (e.key !== "Tab") {
        if (!dialog.contains(e.target as Node)) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          "button:not([disabled]), select:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"
        )
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", trapFocus, true);
    return () => {
      document.removeEventListener("keydown", trapFocus, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [sidebarOpen, mobileFiltersActive]);

  // The filter labels below are shared by the compact toolbar and the mobile
  // sidebar, so they are resolved once per render instead of per usage.
  const sourceFilterLabel = translate({
    id: "skillsHub.filter.source",
    message: "Source",
    description: "Label of the source (registry) filter dropdown, shown in the toolbar and in the sidebar",
  });
  const allSourcesLabel = translate({
    id: "skillsHub.filter.allSources",
    message: "All sources",
    description: "Option that clears the source filter",
  });

  // Which source pills exist — now straight from the index's `bySource`, so no
  // records have to be loaded to render the toolbar.
  const sources = useMemo(() => {
    const present = new Set(Object.keys(statsBySource));
    return SOURCE_ORDER.filter((s) => s === "all" || present.has(s));
  }, [statsBySource]);

  // Records of the selected source that are already loaded. Used for the
  // sidebar's per-category counts: for "All sources" the index's `byCategory` is
  // exact and instant; for a single source the counts fill in as that source's
  // shards arrive (the progress row says so).
  const sourceRecords = useMemo(() => {
    if (sourceFilter === "all") return [];
    return (
      storeRef.current?.filterRecords({ search: "", source: sourceFilter, category: "all" }).records ?? []
    );
  }, [snapshot.revision, sourceFilter]);

  const categoryEntries = useMemo(() => {
    const counts = new Map<string, number>();
    if (sourceFilter === "all") {
      for (const [key, count] of Object.entries(snapshot.byCategory)) counts.set(key, count);
    } else {
      // Category membership for one source comes from the shard manifest — it is
      // exact, and needs no shard bytes.
      for (const plan of shardPlans) {
        if (plan.source !== sourceFilter) continue;
        for (const category of plan.categories || []) {
          if (!counts.has(category)) counts.set(category, 0);
        }
      }
      for (const record of sourceRecords) {
        const key = record.category || "uncategorized";
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({
        key,
        // Real labels are captured from the records as shards load; the
        // humanized fallback covers categories whose shard is not here yet.
        label: snapshot.categoryLabels[key] || humanizeCategory(key),
        count,
      }));
  }, [sourceFilter, snapshot.byCategory, snapshot.categoryLabels, shardPlans, sourceRecords]);

  /**
   * The visible records. `catalogStore.filterRecords()` scans the flat haystack
   * of every *loaded* shard in scope (one `indexOf` pass, then a binary search
   * per hit through the offsets array) — no per-record `_search` strings and no
   * 101k-element array on the main thread. `scope` reports how complete the
   * underlying shard set is, which is what the progress row and the "Load more
   * shards" button use.
   */
  const filterResult = useMemo<CatalogFilterResult>(
    () =>
      storeRef.current?.filterRecords({
        search: debouncedSearch,
        source: sourceFilter,
        category: categoryFilter,
      }) ?? EMPTY_FILTER_RESULT,
    [snapshot.revision, debouncedSearch, sourceFilter, categoryFilter],
  );
  const filtered = filterResult.records;
  const scope = filterResult.scope;
  /** True while more shards may still add results to the current filter. */
  const scopeIncomplete = !snapshot.error && catalogReady && !scope.complete;

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setExpandedCard(null);
  }, [debouncedSearch, sourceFilter, categoryFilter]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  const handleSourceChange = useCallback(
    (src: string) => {
      setSourceFilter(src);
      setCategoryFilter("all");
    },
    []
  );

  const handleCategoryClick = useCallback((cat: string) => {
    setCategoryFilter(cat);
    gridRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setSidebarOpen(false);
  }, []);

  const handleTagClick = useCallback((tag: string) => {
    setSearch(tag);
    searchRef.current?.focus();
  }, []);

  const clearAll = useCallback(() => {
    setSearch("");
    setSourceFilter("all");
    setCategoryFilter("all");
  }, []);

  return (
    <Layout
      title={translate({
          id: "skillsHub.pageTitle",
          message: "Skills Hub",
          description: "Browser tab title of the Skills Hub page",
        })}
      description={translate({
          id: "skillsHub.pageDescription",
          message: "Browse all skills and plugins available for Hermes Agent",
          description: "Meta description of the Skills Hub page",
        })}
    >
      <div className={`${styles.page} ${pickerMode ? styles.pickerMode : ""}`}>
        <header className={styles.hero}>
          <div className={styles.heroGlow} />
          <div className={styles.heroContent}>
            <p className={styles.heroEyebrow}>Hermes Agent</p>
            <h1 className={styles.heroTitle}>
              <Translate
                id="skillsHub.heroTitle"
                description="Main heading of the Skills Hub page"
              >
                Skills Hub
              </Translate>
            </h1>
            <nav
              className={styles.crossNav}
              aria-label={translate({
                  id: "skillsHub.crossNav.label",
                  message: "Catalog pages",
                  description: "Accessible label of the Skills/Plugins cross-navigation in the hero",
                })}
            >
              <span className={`${styles.crossNavLink} ${styles.crossNavActive}`}>
                <Translate
                  id="skillsHub.crossNav.skills"
                  description="Label of the Skills tab in the catalog cross-navigation"
                >
                  Skills
                </Translate>
              </span>
              <Link className={styles.crossNavLink} to="/plugins">
                <Translate
                  id="skillsHub.crossNav.plugins"
                  description="Label of the Plugins tab in the catalog cross-navigation"
                >
                  Plugins
                </Translate>
              </Link>
            </nav>
            <p className={styles.heroSub}>
              <Translate
                id="skillsHub.heroSub"
                description="Hero sentence of the Skills Hub page; {count} is the highlighted skill count and {registries} the number of registries"
                values={{
                  count: (
                    <strong className={styles.heroAccent}>
                      {catalogReady ? totalSkills.toLocaleString() : "…"}
                    </strong>
                  ),
                  registries: String(sources.length - 1),
                }}
              >
                {"Discover, search, and install from {count} skills across {registries} registries"}
              </Translate>
              {loadError && (
                <span style={{ color: "#f87171", marginLeft: 8 }}>
                  {translate({
                      id: "skillsHub.hero.loadFailed",
                      message: "· failed to load catalog ({error})",
                      description: "Shown in the hero when the skills catalog could not be loaded; {error} is the error text",
                    }, { error: String(loadError) })}
                </span>
              )}
            </p>
            {(indexMetaLocal?.indexGeneratedAt || indexMetaLocal?.extractedAt) && (
              <p className={styles.heroSub} style={{ fontSize: "0.85rem", opacity: 0.75 }}>
                <Translate
                  id="skillsHub.catalog.refreshed"
                  description="Sentence placed before the relative time of the last catalog refresh"
                >
                  Catalog refreshed
                </Translate>{" "}
                <span title={indexMetaLocal.indexGeneratedAt || indexMetaLocal.extractedAt}>
                  {formatRelativeTime(
                    indexMetaLocal.indexGeneratedAt || indexMetaLocal.extractedAt,
                  ) ||
                    translate({
                      id: "skillsHub.catalog.recently",
                      message: "recently",
                      description: "Fallback shown when the last catalog refresh time is unknown",
                    })}
                </span>
                {" "}
                ·{" "}
                <Translate
                  id="skillsHub.catalog.rebuildNote"
                  description="Note that the catalog index is rebuilt automatically twice a day"
                >
                  auto-rebuilt twice daily
                </Translate>
              </p>
            )}

            <p className={styles.heroSub} style={{ fontSize: "0.85rem", opacity: 0.85 }}>
              <a href="https://portal.nousresearch.com/terms" target="_blank" rel="noopener noreferrer">
                <Translate
                  id="skillsHub.footer.terms"
                  description="Link label to the Nous Research terms of service"
                >
                  Terms
                </Translate>
              </a>
              {" • "}
              <a href="https://portal.nousresearch.com/privacy" target="_blank" rel="noopener noreferrer">
                <Translate
                  id="skillsHub.footer.privacy"
                  description="Link label to the Nous Research privacy policy"
                >
                  Privacy Policy
                </Translate>
              </a>
            </p>

            <div className={styles.statsRow}>
              {/* Counts come from the shard index, so the hero is complete
                  before a single skill record has been downloaded. */}
              <StatCard
                value={statsBySource["built-in"] ?? 0}
                label={translate({
                    id: "skillsHub.stats.builtIn",
                    message: "Built-in",
                    description: "Hero statistic label: skills shipped with Hermes Agent",
                  })}
                color="#4ade80"
              />
              <StatCard
                value={statsBySource["optional"] ?? 0}
                label={translate({
                    id: "skillsHub.stats.optional",
                    message: "Optional",
                    description: "Hero statistic label: optional first-party skills",
                  })}
                color="#fbbf24"
              />
              <StatCard
                value={
                  totalSkills - (statsBySource["built-in"] ?? 0) - (statsBySource["optional"] ?? 0)
                }
                label={translate({
                    id: "skillsHub.stats.community",
                    message: "Community",
                    description: "Hero statistic label: skills from third-party registries",
                  })}
                color="#60a5fa"
              />
              <StatCard
                value={snapshot.categoryCount}
                label={translate({
                    id: "skillsHub.stats.categories",
                    message: "Categories",
                    description: "Hero statistic label: number of distinct skill categories",
                  })}
                color="#a78bfa"
              />
            </div>
          </div>
        </header>

        <div className={styles.controlsBar}>
          <div className={styles.controlsTopRow}>
          <div className={styles.searchWrap}>
            <svg className={styles.searchIcon} viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
              <path
                fillRule="evenodd"
                d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                clipRule="evenodd"
              />
            </svg>
            <input
              ref={searchRef}
              type="text"
              placeholder={translate({
                  id: "skillsHub.searchPlaceholder",
                  message: "Search skills",
                  description: "Placeholder of the skills search box",
                })}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={styles.searchInput}
            />
            {search && (
              <button className={styles.clearBtn} onClick={() => setSearch("")}>
                <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
          </div>

          <button
            ref={filterToggleRef}
            type="button"
            className={styles.filterToggle}
            aria-expanded={sidebarOpen}
            aria-controls="skills-directory-filters"
            onClick={() => setSidebarOpen((open) => !open)}
          >
            <Translate
              id="skillsHub.filtersToggle"
              description="Label of the button that opens the skill filters on mobile"
            >
              Filters
            </Translate>
            {(sourceFilter !== "all" || categoryFilter !== "all") && (
              <span className={styles.activeFilterCount}>
                {Number(sourceFilter !== "all") + Number(categoryFilter !== "all")}
              </span>
            )}
          </button>

          <label className={styles.compactSelect}>
            <span>{sourceFilterLabel}</span>
            <select value={sourceFilter} onChange={(e) => handleSourceChange(e.target.value)}>
              {sources.map((src) => (
                <option key={src} value={src}>{src === "all" ? allSourcesLabel : SOURCE_CONFIG[src]?.label || src}</option>
              ))}
            </select>
          </label>

          <label className={styles.compactSelect}>
            <span>{translate({
                id: "skillsHub.filter.category",
                message: "Category",
                description: "Label of the category filter dropdown",
              })}</span>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="all">{translate({
                  id: "skillsHub.filter.allCategories",
                  message: "All categories",
                  description: "Option that clears the category filter",
                })}</option>
              {categoryEntries.map((cat) => <option key={cat.key} value={cat.key}>{cat.label}</option>)}
            </select>
          </label>
          </div>

          <div className={styles.sourcePills}>
            {sources.map((src) => {
              const active = sourceFilter === src;
              const conf = SOURCE_CONFIG[src];
              const count = src === "all" ? totalSkills : statsBySource[src] ?? 0;
              return (
                <button
                  key={src}
                  className={`${styles.srcPill} ${active ? styles.srcPillActive : ""}`}
                  onClick={() => handleSourceChange(src)}
                  style={
                    active && conf
                      ? ({
                          "--pill-color": conf.color,
                          "--pill-bg": conf.bg,
                          "--pill-border": conf.border,
                        } as React.CSSProperties)
                      : undefined
                  }
                >
                  {src === "all"
                    ? translate({
                        id: "skillsHub.filter.all",
                        message: "All",
                        description: "Source pill that clears the source filter",
                      })
                    : conf?.label || src}
                  <span className={styles.srcCount}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.layout}>
          <aside
            id="skills-directory-filters"
            ref={filterDialogRef}
            role={mobileFiltersActive && sidebarOpen ? "dialog" : undefined}
            aria-modal={mobileFiltersActive && sidebarOpen ? true : undefined}
            aria-labelledby="skills-directory-filters-title"
            className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}`}
          >
            <div className={styles.sidebarHeader}>
              <h2 id="skills-directory-filters-title" className={styles.sidebarTitle}>
                <Translate
                  id="skillsHub.sidebar.categories"
                  description="Title of the category filter sidebar"
                >
                  Categories
                </Translate>
              </h2>
              {categoryFilter !== "all" && (
                <button className={styles.sidebarClear} onClick={() => setCategoryFilter("all")}>
                  <Translate
                    id="skillsHub.sidebar.clear"
                    description="Button that clears the selected category in the sidebar"
                  >
                    Clear
                  </Translate>
                </button>
              )}
              <button
                ref={filterCloseRef}
                type="button"
                className={styles.sidebarClose}
                aria-label={translate({
                    id: "skillsHub.sidebar.close",
                    message: "Close skill filters",
                    description: "Accessible label of the button that closes the mobile filter dialog",
                  })}
                onClick={() => setSidebarOpen(false)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <label className={styles.sidebarSourceSelect}>
              <span>{sourceFilterLabel}</span>
              <select value={sourceFilter} onChange={(e) => handleSourceChange(e.target.value)}>
                {sources.map((src) => (
                  <option key={src} value={src}>{src === "all" ? allSourcesLabel : SOURCE_CONFIG[src]?.label || src}</option>
                ))}
              </select>
            </label>
            <nav className={styles.catList}>
              <button
                className={`${styles.catItem} ${categoryFilter === "all" ? styles.catItemActive : ""}`}
                onClick={() => {
                  setCategoryFilter("all");
                  setSidebarOpen(false);
                }}
              >
                <span className={styles.catItemIcon}>{"\u{1F4CB}"}</span>
                <span className={styles.catItemLabel}>
                  <Translate
                    id="skillsHub.sidebar.allSkills"
                    description="Sidebar entry that removes the category filter"
                  >
                    All Skills
                  </Translate>
                </span>
                <span className={styles.catItemCount}>{filtered.length}</span>
              </button>
              {categoryEntries.map((cat) => (
                <button
                  key={cat.key}
                  className={`${styles.catItem} ${categoryFilter === cat.key ? styles.catItemActive : ""}`}
                  onClick={() => handleCategoryClick(cat.key)}
                >
                  <span className={styles.catItemIcon}>
                    {CATEGORY_ICONS[cat.key] || "\u{1F4E6}"}
                  </span>
                  <span className={styles.catItemLabel}>{cat.label}</span>
                  <span className={styles.catItemCount}>{cat.count}</span>
                </button>
              ))}
            </nav>
          </aside>

          <main className={styles.main} ref={gridRef}>
            {(search || sourceFilter !== "all" || categoryFilter !== "all") && (
              <div className={styles.filterSummary}>
                <span className={styles.filterCount}>
                  {filtered.length === 1
                    ? translate({
                        id: "skillsHub.results.one",
                        message: "1 result",
                        description: "Filter summary when exactly one skill matches",
                      })
                    : translate({
                        id: "skillsHub.results.many",
                        message: "{count} results",
                        description: "Filter summary with the number of matching skills",
                      }, { count: String(filtered.length) })}
                </span>
                {search && (
                  <span className={styles.filterChip}>
                    &ldquo;{search}&rdquo;
                    <button onClick={() => setSearch("")}>&times;</button>
                  </span>
                )}
                {sourceFilter !== "all" && (
                  <span className={styles.filterChip}>
                    {SOURCE_CONFIG[sourceFilter]?.label || sourceFilter}
                    <button onClick={() => setSourceFilter("all")}>&times;</button>
                  </span>
                )}
                {categoryFilter !== "all" && (
                  <span className={styles.filterChip}>
                    {categoryEntries.find((c) => c.key === categoryFilter)?.label ||
                      categoryFilter}
                    <button onClick={() => setCategoryFilter("all")}>&times;</button>
                  </span>
                )}
                <button className={styles.clearAllBtn} onClick={clearAll}>
                  <Translate
                    id="skillsHub.results.clearAll"
                    description="Button in the filter summary that clears every filter"
                  >
                    Clear all
                  </Translate>
                </button>
              </div>
            )}

            {/* Shard progress. The catalog is no longer one 63 MB download, so
                the page has to say out loud how much of it is in memory — both
                for the raw shard counts and for the "this search is still
                filling in" case (a non-empty `debouncedSearch` pulls the rest
                via loadAllShards). */}
            {scopeIncomplete && (
              <div className={styles.filterSummary}>
                <span className={styles.filterCount}>
                  {translate(
                    {
                      id: "skillsHub.progress.shards",
                      message: "{loaded}/{total} shards loaded · {records} skills available",
                      description: "Catalog progress row: how many of the shards behind the current filter are loaded, and how many records they hold",
                    },
                    {
                      loaded: String(scope.loaded),
                      total: String(scope.total),
                      records: snapshot.loadedRecords.toLocaleString(),
                    },
                  )}
                </span>
                {snapshot.pendingShards > 0 && (
                  <span className={styles.filterChip}>
                    {translate(
                      {
                        id: "skillsHub.progress.loading",
                        message: "loading {count} more…",
                        description: "Catalog progress row: number of shards currently being fetched",
                      },
                      { count: String(snapshot.pendingShards) },
                    )}
                  </span>
                )}
                <button className={styles.clearAllBtn} onClick={loadEveryShard}>
                  {translate({
                    id: "skillsHub.progress.loadAll",
                    message: "Load the whole catalog",
                    description: "Button in the catalog progress row that pulls every remaining shard",
                  })}
                </button>
              </div>
            )}

            {!loadError && (!catalogReady || (snapshot.loadedRecords === 0 && scope.pending > 0)) ? (
              <div className={styles.empty}>
                <div className={styles.loadingSpinner} />
                <h3 className={styles.emptyTitle}>
                  <Translate
                    id="skillsHub.loading.title"
                    description="Title of the card shown while the skills catalog is downloading"
                  >
                    Loading the catalog…
                  </Translate>
                </h3>
                <p className={styles.emptyDesc}>
                  <Translate
                    id="skillsHub.loading.desc"
                    description="Progress hint shown while the skills catalog is downloading"
                  >
                    Fetching 88k+ skills across every registry. One moment.
                  </Translate>
                </p>
                {snapshot.indexBytes > 0 && (
                  <p className={styles.emptyDesc}>
                    {translate(
                      {
                        id: "skillsHub.loading.progress",
                        message: "Index {size} ready in {ms} ms · {loaded}/{total} shards loaded by the Worker",
                        description: "Loading card progress line: size and parse time of the shard index, plus how many shards the Worker has parsed",
                      },
                      {
                        size: `${Math.round(snapshot.indexBytes / 1024)} KB`,
                        ms: String(Math.round(snapshot.indexParseMs)),
                        loaded: String(scope.loaded),
                        total: String(scope.total),
                      },
                    )}
                  </p>
                )}
              </div>
            ) : loadError ? (
              <div className={styles.empty}>
                <div className={styles.emptyIcon}>{"\u26A0\uFE0F"}</div>
                <h3 className={styles.emptyTitle}>
                  <Translate
                    id="skillsHub.error.title"
                    description="Title of the card shown when the skills catalog fails to load"
                  >
                    Couldn't load the catalog
                  </Translate>
                </h3>
                <p className={styles.emptyDesc}>
                  <Translate
                    id="skillsHub.error.desc"
                    description="Explanation shown when the skills catalog fails to load; {error} is the error text"
                    values={{ error: String(loadError) }}
                  >
                    {"{error}. The catalog is served from a public CDN — restricted networks may need a working proxy. Check your connection and retry."}
                  </Translate>
                </p>
                <button className={styles.emptyReset} onClick={retryCatalogLoad}>
                  <Translate
                    id="skillsHub.error.retry"
                    description="Button that retries loading the skills catalog"
                  >
                    Retry
                  </Translate>
                </button>
              </div>
            ) : visible.length > 0 ? (
              <>
                <div className={styles.grid}>
                  {visible.map((skill, i) => {
                    const key = `${skill.source}-${skill.name}-${i}`;
                    return (
                      <SkillCard
                        key={key}
                        skill={skill}
                        query={search}
                        expanded={expandedCard === key}
                        onToggle={() =>
                          setExpandedCard(expandedCard === key ? null : key)
                        }
                        onCategoryClick={handleCategoryClick}
                        onTagClick={handleTagClick}
                        style={{ animationDelay: `${Math.min(i, 20) * 25}ms` }}
                        onPick={pickerMode ? pickSkill : undefined}
                      />
                    );
                  })}
                </div>
                {hasMore ? (
                  <div className={styles.loadMoreWrap}>
                    <button
                      className={styles.loadMoreBtn}
                      onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
                    >
                      {translate({
                          id: "skillsHub.loadMore",
                          message: "Show more ({count} remaining)",
                          description: "Button that renders the next page of skill cards; {count} is the number of remaining skills",
                        }, { count: String(filtered.length - visibleCount) })}

                    </button>
                  </div>
                ) : scopeIncomplete ? (
                  // Everything loaded so far is on screen: continue by pulling
                  // the next shards instead of pretending the catalog ended.
                  <div className={styles.loadMoreWrap}>
                    <button className={styles.loadMoreBtn} onClick={loadNextShardBatch}>
                      {translate({
                        id: "skillsHub.progress.loadMore",
                        message: "Load more shards",
                        description: "Button shown when the loaded shards are exhausted but more of the catalog can still be pulled",
                      })}
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className={styles.empty}>
                <div className={styles.emptyIcon}>{"\u{1F50D}"}</div>
                <h3 className={styles.emptyTitle}>
                  <Translate
                    id="skillsHub.empty.title"
                    description="Title shown when the filters match no skill"
                  >
                    No skills found
                  </Translate>
                </h3>
                <p className={styles.emptyDesc}>
                  <Translate
                    id="skillsHub.empty.desc"
                    description="Hint shown when the filters match no skill"
                  >
                    Try a different search term or clear your filters.
                  </Translate>
                </p>
                <button className={styles.emptyReset} onClick={clearAll}>
                  <Translate
                    id="skillsHub.empty.reset"
                    description="Button that clears every filter when no skill matches"
                  >
                    Reset all filters
                  </Translate>
                </button>
              </div>
            )}
          </main>
        </div>
      </div>

      {sidebarOpen && (
        <div className={styles.backdrop} onClick={() => setSidebarOpen(false)} />
      )}
    </Layout>
  );
}
