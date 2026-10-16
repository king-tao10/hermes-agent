// Shared catalog vocabulary for the Plugins grid (src/pages/plugins), the per-plugin pages and the
// author pages (plugins/plugin-catalog-pages generates their routes). One definition of the entry
// shape, the tier/category taxonomy and the link builders keeps the three surfaces from drifting.

export interface PluginCapabilities {
  providesTools?: string[];
  providesHooks?: string[];
  providesMiddleware?: string[];
  requiresEnv?: string[];
}

export interface CatalogPlugin {
  name: string;
  description: string;
  repo: string;
  sha: string;
  shaShort: string;
  tier: string;
  category: string;
  maintainer: string;
  /** URL segment of the author page (/plugins/by/<slug>); one per maintainer. */
  maintainerSlug?: string;
  subdir?: string;
  requiresHermes?: string;
  platforms?: string[];
  capabilities?: PluginCapabilities;
  docsUrl?: string;
  /** Human label for the pin ("1.4.0"); cosmetic, shown beside the sha. */
  version?: string;
  /** Card banner image (GitHub-hosted https URL enforced by the extractor). */
  image?: string;
  /** Gallery on the plugin page; GitHub-hosted https URLs, at most 6. */
  screenshots?: string[];
  /** The plugin page renders the README from the pinned commit when true. */
  readme?: boolean;
  readmeUrl?: string;
  installCommand: string;
  /** GitHub stargazers at the last daily probe; null when the repo is not on GitHub or unprobed. */
  stars?: number | null;
  /** ISO dates from git history (first listing / last re-pin); present once the dates extractor runs. */
  addedAt?: string | null;
  updatedAt?: string | null;
  /** Lowercase pre-joined haystack for the search filter (built at load). */
  _search?: string;
}

export interface CatalogMeta {
  generatedAt?: string;
  total?: number;
  byTier?: Record<string, number>;
  byCategory?: Record<string, number>;
  removedCount?: number;
  starsFetchedAt?: string | null;
}

// Docs section describing the PR-based submission workflow.
export const SUBMIT_PLUGIN_URL = "/developer-guide/plugins/catalog-submission";

/** Deep link into the Desktop app's Install Plugin dialog, catalog mode: the app
 *  resolves the reviewed pin itself, so the page never hands it a repo URL. */
export function desktopInstallLink(name: string): string {
  return `hermes://plugin/install?catalog=${encodeURIComponent(name)}`;
}

/** Site route of an entry's page (Docusaurus prefixes baseUrl/locale via <Link>). */
export function pluginPagePath(name: string): string {
  return `/plugins/${encodeURIComponent(name)}`;
}

/** Site route of a maintainer's page. */
export function authorPagePath(slug: string): string {
  return `/plugins/by/${encodeURIComponent(slug)}`;
}

export function repoUrl(plugin: Pick<CatalogPlugin, "repo">): string {
  return plugin.repo.replace(/\.git$/, "").replace(/\/$/, "");
}

/** Browse link to the exact reviewed tree (GitHub `tree/<sha>`, GitLab `-/tree/<sha>`). */
export function pinUrl(plugin: Pick<CatalogPlugin, "repo" | "sha" | "subdir">): string {
  const base = repoUrl(plugin);
  const tree = /^https:\/\/gitlab\.com\//.test(base) ? `${base}/-/tree/${plugin.sha}` : `${base}/tree/${plugin.sha}`;
  return plugin.subdir ? `${tree}/${plugin.subdir.replace(/^\/+|\/+$/g, "")}` : tree;
}

export const TIER_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; border: string; icon: string }
> = {
  official: {
    label: "Official",
    color: "var(--plugin-catalog-official)",
    bg: "var(--plugin-catalog-official-bg)",
    border: "var(--plugin-catalog-official-border)",
    icon: "\u{2713}",
  },
  community: {
    label: "Community",
    color: "var(--plugin-catalog-community)",
    bg: "var(--plugin-catalog-community-bg)",
    border: "var(--plugin-catalog-community-border)",
    icon: "\u{2756}",
  },
};

// Browse taxonomy. Order here is the order of the filter pills and of the
// grouped sections; keep it in sync with CATALOG_CATEGORIES in
// hermes_cli/plugin_catalog.py and website/scripts/extract-plugins.py.
export const CATEGORY_CONFIG: Record<string, { label: string; icon: string; blurb: string }> = {
  desktop: { label: "Desktop", icon: "\u{1F5A5}\u{FE0F}", blurb: "Panes, tabs and views for Hermes Desktop" },
  memory: { label: "Memory", icon: "\u{1F9E0}", blurb: "Memory providers and context engines" },
  platform: { label: "Platforms", icon: "\u{1F4AC}", blurb: "Messaging and channel adapters" },
  web: { label: "Web & Browser", icon: "\u{1F310}", blurb: "Search backends, extraction and browser control" },
  tools: { label: "Tools", icon: "\u{1F6E0}\u{FE0F}", blurb: "New tools the agent can call" },
  voice: { label: "Voice", icon: "\u{1F399}\u{FE0F}", blurb: "Speech, TTS and realtime audio" },
  automation: { label: "Automation", icon: "\u{23F1}\u{FE0F}", blurb: "Hooks, wake triggers and session automation" },
  models: { label: "Models", icon: "\u{2728}", blurb: "Model and inference providers" },
  general: { label: "General", icon: "\u{1F4E6}", blurb: "Plugins that span several areas" },
};
export const CATEGORY_ORDER = Object.keys(CATEGORY_CONFIG);

export function categoryOf(plugin: Pick<CatalogPlugin, "category">) {
  return CATEGORY_CONFIG[plugin.category] || CATEGORY_CONFIG.general;
}

export function tierOf(plugin: Pick<CatalogPlugin, "tier">) {
  return TIER_CONFIG[plugin.tier] || TIER_CONFIG.community;
}

/**
 * String localizer injected by callers (Docusaurus `translate`). This module is also imported by
 * build-time Node code (plugins/plugin-catalog-pages), so it must not import
 * @docusaurus/Translate itself — that alias only exists inside the webpack bundle.
 */
export type CatalogLocalizer = (
  args: {
    id: string;
    message: string;
    description?: string;
  },
  /**
   * Interpolation values. They MUST be passed as the second argument — Docusaurus'
   * `translate({message, id}, values)` ignores an inline `values` field, which left
   * literal `{n}` placeholders on the page.
   */
  values?: Record<string, string | number>,
) => string;

/** Tier badge text ("Official" / "Community") through the caller's localizer. */
export function tierLabel(tier: string, t: CatalogLocalizer): string {
  const cfg = TIER_CONFIG[tier] || TIER_CONFIG.community;
  return t({
    id: `pluginCatalog.tier.${TIER_CONFIG[tier] ? tier : "community"}.label`,
    message: cfg.label,
    description: "Tier badge of a plugin catalog entry",
  });
}

/** Category label ("Desktop" / "Memory" / …) through the caller's localizer. */
export function categoryLabel(category: string, t: CatalogLocalizer): string {
  const cfg = CATEGORY_CONFIG[category] || CATEGORY_CONFIG.general;
  return t({
    id: `pluginCatalog.category.${CATEGORY_CONFIG[category] ? category : "general"}.label`,
    message: cfg.label,
    description: "Category label of a plugin catalog entry",
  });
}

/** One-line category description through the caller's localizer. */
export function categoryBlurb(category: string, t: CatalogLocalizer): string {
  const cfg = CATEGORY_CONFIG[category] || CATEGORY_CONFIG.general;
  return t({
    id: `pluginCatalog.category.${CATEGORY_CONFIG[category] ? category : "general"}.blurb`,
    message: cfg.blurb,
    description: "One-line description of a plugin category",
  });
}

/** Localized relative time ("3 days ago" / "3 天前"); null for missing/unparseable input. */
export function formatRelativeTimeLocalized(
  iso: string | null | undefined,
  t: CatalogLocalizer,
): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (Date.now() - then < 0 || mins < 1)
    return t({
      id: "pluginCatalog.time.justNow",
      message: "just now",
      description: "Relative time for a catalog entry touched less than a minute ago",
    });
  if (mins < 60)
    return mins === 1
      ? t({
          id: "pluginCatalog.time.minuteAgo",
          message: "1 minute ago",
          description: "Relative time, a single minute",
        })
      : t(
          {
            id: "pluginCatalog.time.minutesAgo",
            message: "{n} minutes ago",
            description: "Relative time in minutes; {n} is the count",
          },
          { n: mins },
        );
  const hours = Math.floor(mins / 60);
  if (hours < 24)
    return hours === 1
      ? t({
          id: "pluginCatalog.time.hourAgo",
          message: "1 hour ago",
          description: "Relative time, a single hour",
        })
      : t(
          {
            id: "pluginCatalog.time.hoursAgo",
            message: "{n} hours ago",
            description: "Relative time in hours; {n} is the count",
          },
          { n: hours },
        );
  const days = Math.floor(hours / 24);
  if (days < 30)
    return days === 1
      ? t({
          id: "pluginCatalog.time.dayAgo",
          message: "1 day ago",
          description: "Relative time, a single day",
        })
      : t(
          {
            id: "pluginCatalog.time.daysAgo",
            message: "{n} days ago",
            description: "Relative time in days; {n} is the count",
          },
          { n: days },
        );
  const months = Math.floor(days / 30);
  return months === 1
    ? t({
        id: "pluginCatalog.time.monthAgo",
        message: "1 month ago",
        description: "Relative time, a single month",
      })
    : t(
        {
          id: "pluginCatalog.time.monthsAgo",
          message: "{n} months ago",
          description: "Relative time in months; {n} is the count",
        },
        { n: months },
      );
}

/** Tool chips a catalog card shows: the first `max` names plus how many were folded into a `+N`. */
export const CARD_TOOL_CHIP_LIMIT = 3;

export interface CappedToolChips {
  shown: string[];
  hidden: number;
}

export function capToolChips(tools: string[] | undefined, max = CARD_TOOL_CHIP_LIMIT): CappedToolChips {
  const all = tools ?? [];
  return { shown: all.slice(0, max), hidden: Math.max(0, all.length - max) };
}

export function formatStars(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

export function formatRelativeTime(iso?: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const diffMs = Date.now() - then;
  if (diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

/** "Sep 20, 2026" / "2026年9月20日" for an ISO date; null when unparseable.
 *  Pass the page locale (useDocusaurusContext().i18n.currentLocale) so SSR and hydration agree. */
export function formatDate(iso?: string | null, locale = "en-US"): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const tag = locale === "zh-Hans" ? "zh-CN" : locale;
  return d.toLocaleDateString(tag, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

/** Split a description into prose and its "Disclosure — …" sentences (catalog convention for
 *  behaviour a user opts into: auto-payments, vendor client identity, etc.). */
export function splitDisclosure(description: string): { prose: string; disclosures: string[] } {
  const marker = /\bDisclosure\s*[—–-]\s*/g;
  const idx = description.search(marker);
  if (idx === -1) return { prose: description, disclosures: [] };
  const prose = description.slice(0, idx).trim();
  const disclosures = description
    .slice(idx)
    .split(marker)
    .map((s) => s.trim())
    .filter(Boolean);
  return { prose, disclosures };
}
