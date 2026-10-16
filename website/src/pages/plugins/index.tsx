import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import Layout from "@theme/Layout";
import Link from "@docusaurus/Link";
import { useHistory } from "@docusaurus/router";
import useBaseUrl from "@docusaurus/useBaseUrl";
import Translate, { translate } from "@docusaurus/Translate";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import styles from "./styles.module.css";

import {
  type CatalogPlugin,
  type CatalogMeta,
  CATEGORY_CONFIG,
  CATEGORY_ORDER,
  SUBMIT_PLUGIN_URL,
  TIER_CONFIG,
  authorPagePath,
  capToolChips,
  categoryBlurb,
  categoryLabel,
  categoryOf,
  desktopInstallLink,
  formatDate,
  formatRelativeTimeLocalized,
  formatStars,
  pinUrl,
  pluginPagePath,
  repoUrl,
  tierLabel,
  tierOf,
} from "../../components/PluginCatalog/catalog";
import CopyButton from "../../components/PluginCatalog/CopyButton";

// Routes Docusaurus serves the static API JSON from. `baseUrl` is `/docs/`,
// `static/api/` ends up at `/docs/api/` — same pattern as the Skills Hub.
const PLUGINS_URL = "/docs/api/plugins.json";
const META_URL = "/docs/api/plugins-meta.json";
/** Mirrors the `max-width: 600px` blocks in styles.module.css. */
const MOBILE_PANEL_QUERY = "(max-width: 600px)";

const TIER_ORDER = ["all", "official", "community"];

// Sort orders. "stars" is the extractor's own order (stars desc, name), so it
// needs no client-side work; the two date sorts read the git-derived
// addedAt/updatedAt fields and push undated entries last.
type SortKey = "stars" | "newest" | "updated";

/**
 * Sort options are built by a function so their labels resolve against the
 * active locale at render time, while the translate() calls stay statically
 * extractable for `docusaurus write-translations`.
 */
function sortOptions(): { key: SortKey; label: string; title: string }[] {
  return [
    {
      key: "stars",
      label: translate({
        id: "pluginCatalog.sort.mostStarred",
        message: "Most starred",
        description: "Sort option: plugins with the most GitHub stars first",
      }),
      title: translate({
        id: "pluginCatalog.sort.mostStarred.title",
        message: "GitHub stars, most first",
        description: "Tooltip of the Most starred sort option",
      }),
    },
    {
      key: "newest",
      label: translate({
        id: "pluginCatalog.sort.newest",
        message: "Newest",
        description: "Sort option: most recently added to the catalog first",
      }),
      title: translate({
        id: "pluginCatalog.sort.newest.title",
        message: "Most recently added to the catalog first",
        description: "Tooltip of the Newest sort option",
      }),
    },
    {
      key: "updated",
      label: translate({
        id: "pluginCatalog.sort.recentlyUpdated",
        message: "Recently updated",
        description: "Sort option: most recently re-pinned or edited first",
      }),
      title: translate({
        id: "pluginCatalog.sort.recentlyUpdated.title",
        message: "Most recently re-pinned or edited first",
        description: "Tooltip of the Recently updated sort option",
      }),
    },
  ];
}

function dateMs(iso?: string | null): number {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : -Infinity;
}

function sortPlugins(list: CatalogPlugin[], sort: SortKey): CatalogPlugin[] {
  if (sort === "stars") return list;
  const field = sort === "newest" ? "addedAt" : "updatedAt";
  return [...list].sort(
    (a, b) => dateMs(b[field]) - dateMs(a[field]) || a.name.localeCompare(b.name),
  );
}

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

function PluginCard({
  plugin,
  query,
  onPick,
  onCategoryClick,
  style,
}: {
  plugin: CatalogPlugin;
  query: string;
  /** Picker embed mode: render "+ Add to this Agent" and call this. */
  onPick?: (plugin: CatalogPlugin) => void;
  onCategoryClick?: (category: string) => void;
  style?: React.CSSProperties;
}) {
  const { i18n } = useDocusaurusContext();
  const tier = tierOf(plugin);
  const category = categoryOf(plugin);
  const caps = plugin.capabilities || {};
  const toolCount = caps.providesTools?.length || 0;
  const hookCount = caps.providesHooks?.length || 0;
  const middlewareCount = caps.providesMiddleware?.length || 0;
  const toolChips = capToolChips(caps.providesTools);
  const description =
    plugin.description ||
    translate({
      id: "pluginCatalog.card.noDescription",
      message: "No description available.",
      description: "Placeholder shown on a plugin card that has no description",
    });
  // A broken banner URL swaps to the placeholder instead of collapsing, so the card keeps its
  // height (every card in a grid row shares one height; see .grid in styles.module.css).
  const [imageBroken, setImageBroken] = useState(false);
  const showImage = Boolean(plugin.image) && !imageBroken;
  const pagePath = pluginPagePath(plugin.name);
  const history = useHistory();
  const pageHref = useBaseUrl(pagePath); // <Link> adds baseUrl itself; history.push does not
  // A card IS the link to the plugin's own page: nothing expands or collapses in place. Inside
  // the Desktop picker iframe an in-frame navigation would leave the host's embed, so the page
  // opens in a new tab there instead.
  const onCardClick = onPick
    ? () => window.open(new URL(pageHref, window.location.href).toString(), "_blank", "noopener,noreferrer")
    : () => history.push(pageHref);

  return (
    <div
      className={styles.card}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCardClick();
      }}
      onClick={onCardClick}
      style={style}
    >
      <div className={styles.cardAccent} style={{ background: tier.color }} />

      {showImage ? (
        <img
          className={styles.cardImage}
          src={plugin.image}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setImageBroken(true)}
        />
      ) : (
        <div
          className={styles.cardImagePlaceholder}
          aria-hidden="true"
          style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${tier.color} 12%, transparent), transparent 70%)` }}
        >
          <span className={styles.cardImagePlaceholderIcon}>{category.icon}</span>
        </div>
      )}

      <div className={styles.cardInner}>
        <div className={styles.cardTop}>
          <span className={styles.cardIcon} title={categoryLabel(plugin.category, translate)}>{category.icon}</span>
          <div className={styles.cardTitleGroup}>
            <h3 className={styles.cardTitle} title={plugin.name}>
              <Link className={styles.cardTitleLink} to={pagePath} onClick={(e) => e.stopPropagation()}>
                {highlightMatch(plugin.name, query)}
              </Link>
            </h3>
            {typeof plugin.stars === "number" && (
              <a
                className={styles.starPill}
                href={`${repoUrl(plugin)}/stargazers`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={translate({
                  id: "pluginCatalog.card.starsTitle",
                  message: "{count} GitHub stars",
                  description: "Tooltip of the star pill on a plugin card; {count} is the star count",
                }, { count: plugin.stars.toLocaleString() })}
              >
                {"\u2605"} {formatStars(plugin.stars)}
              </a>
            )}
          </div>
        </div>

        <p className={styles.cardDesc} title={description}>
          {highlightMatch(description, query)}
        </p>

        <div className={styles.cardMeta}>
          <span
            className={styles.tierPill}
            style={{
              color: tier.color,
              background: tier.bg,
              borderColor: tier.border,
            }}
          >
            {tier.icon} {tierLabel(plugin.tier, translate)}
          </span>
          {plugin.version && (
            <span
              className={styles.versionPill}
              title={translate({
                    id: "pluginCatalog.card.versionTitle",
                    message: "Version {version} at {sha}",
                    description: "Tooltip of the version pill on a plugin card",
                  }, { version: plugin.version, sha: plugin.sha })}
            >
              v{plugin.version.replace(/^v/i, "")}
            </span>
          )}
          <button
            className={styles.categoryChip}
            onClick={(e) => {
              e.stopPropagation();
              onCategoryClick?.(plugin.category);
            }}
            title={translate({
                id: "pluginCatalog.card.filterBy",
                message: "Filter by {label}",
                description: "Tooltip of the category chip on a plugin card; {label} is the category name",
              }, { label: categoryLabel(plugin.category, translate) })}
          >
            {categoryLabel(plugin.category, translate)}
          </button>
          {toolCount > 0 && (
            <span className={styles.capChip}>
              {toolCount === 1
                ? translate({
                    id: "pluginCatalog.card.tool.one",
                    message: "1 tool",
                    description: "Capability chip: the plugin provides a single tool",
                  })
                : translate({
                    id: "pluginCatalog.card.tool.many",
                    message: "{count} tools",
                    description: "Capability chip: number of tools the plugin provides",
                  }, { count: String(toolCount) })}
            </span>
          )}
          {hookCount > 0 && (
            <span className={styles.capChip}>
              {hookCount === 1
                ? translate({
                    id: "pluginCatalog.card.hook.one",
                    message: "1 hook",
                    description: "Capability chip: the plugin provides a single hook",
                  })
                : translate({
                    id: "pluginCatalog.card.hook.many",
                    message: "{count} hooks",
                    description: "Capability chip: number of hooks the plugin provides",
                  }, { count: String(hookCount) })}
            </span>
          )}
          {middlewareCount > 0 && (
            <span className={styles.capChip}>
              {translate({
                  id: "pluginCatalog.card.middleware",
                  message: "{count} middleware",
                  description: "Capability chip: amount of middleware the plugin provides",
                }, { count: String(middlewareCount) })}
            </span>
          )}
          {caps.requiresEnv?.map((v) => (
            <code key={v} className={styles.envChip}>
              {v}
            </code>
          ))}
          {plugin.platforms?.map((p) => (
            <span key={p} className={styles.platformPill}>
              {p === "macos" ? "\u{F8FF} macOS" : p === "linux" ? "\u{1F427} Linux" : p}
            </span>
          ))}
        </div>

        {/* Always rendered (empty when undated) so every card keeps the same row layout.
            Updated is omitted while it equals Added: a fresh entry has nothing to say yet. */}
        <div className={styles.cardDates}>
          {plugin.addedAt && (
            <span
              title={translate({
                  id: "pluginCatalog.card.addedTitle",
                  message: "Added to the catalog {date}",
                  description: "Tooltip of the Added date on a plugin card; {date} is an absolute date",
                }, { date: formatDate(plugin.addedAt, i18n.currentLocale) || "" })}
            >
              <Translate
                id="pluginCatalog.card.added"
                description="Added date on a plugin card; {time} is a relative or absolute date"
                values={{ time: formatRelativeTimeLocalized(plugin.addedAt, translate) ?? formatDate(plugin.addedAt, i18n.currentLocale) ?? "" }}
              >
                {"Added {time}"}
              </Translate>
            </span>
          )}
          {plugin.addedAt && plugin.updatedAt && plugin.updatedAt !== plugin.addedAt && (
            <>
              <span aria-hidden="true" className={styles.cardDatesSep}>·</span>
              <span
                title={translate({
                    id: "pluginCatalog.card.updatedTitle",
                    message: "Last catalog change {date}",
                    description: "Tooltip of the Updated date on a plugin card; {date} is an absolute date",
                  }, { date: formatDate(plugin.updatedAt, i18n.currentLocale) || "" })}
              >
                <Translate
                  id="pluginCatalog.card.updated"
                  description="Updated date on a plugin card; {time} is a relative or absolute date"
                  values={{ time: formatRelativeTimeLocalized(plugin.updatedAt, translate) ?? formatDate(plugin.updatedAt, i18n.currentLocale) ?? "" }}
                >
                  {"Updated {time}"}
                </Translate>
              </span>
            </>
          )}
        </div>

        {onPick ? (
          <button
            className={styles.pickBtn}
            onClick={(e) => {
              e.stopPropagation();
              onPick(plugin);
            }}
          >
            <Translate
              id="pluginCatalog.card.addToAgent"
              description="Button on a plugin card inside the picker embed that adds the plugin to the host agent"
            >
              + Add to this Agent
            </Translate>
          </button>
        ) : (
          <a
            className={styles.pickBtn}
            href={desktopInstallLink(plugin.name)}
            title={translate({
                id: "pluginCatalog.card.desktopInstallTitle",
                message: "Opens the Install Plugin dialog in Hermes Desktop at the reviewed version. No app? Use the install command below.",
                description: "Tooltip of the Open in Hermes Desktop button on a plugin card",
              })}
            onClick={(e) => e.stopPropagation()}
          >
            <Translate
              id="pluginCatalog.card.openInDesktop"
              description="Button that deep-links into the Hermes Desktop app to install the plugin"
            >
              Open in Hermes Desktop
            </Translate>
          </a>
        )}

        {
          <div className={styles.cardDetail}>
            {/* Exactly three fixed-height fact rows so the install box and links land on the same
                edge in every card: Maintainer, Pinned (+ Requires), Tools (capped, or a dash). */}
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>
                <Translate
                  id="pluginCatalog.card.maintainer"
                  description="Fact row label on a plugin card: who maintains the plugin"
                >
                  Maintainer
                </Translate>
              </span>
              <span className={styles.metaValue} title={plugin.maintainer || undefined}>
                {plugin.maintainerSlug ? (
                  <Link to={authorPagePath(plugin.maintainerSlug)} onClick={(e) => e.stopPropagation()}>
                    {plugin.maintainer}
                  </Link>
                ) : (
                  plugin.maintainer || <span className={styles.metaEmpty}>—</span>
                )}
              </span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>
                <Translate
                  id="pluginCatalog.card.pinned"
                  description="Fact row label on a plugin card: the reviewed commit the plugin is pinned to"
                >
                  Pinned
                </Translate>
              </span>
              <span
                className={styles.metaValue}
                title={
                  plugin.requiresHermes
                    ? translate({
                        id: "pluginCatalog.card.pinTitleWithRequirement",
                        message: "{sha} · requires hermes {version}",
                        description: "Tooltip of the pinned commit on a plugin card when it requires a minimum Hermes version",
                      }, { sha: plugin.sha, version: plugin.requiresHermes })
                    : plugin.sha
                }
              >
                <a
                  href={pinUrl(plugin)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className={styles.shaLink}
                >
                  <code>{plugin.version ? `${plugin.version} @ ${plugin.shaShort}` : plugin.shaShort}</code> ↗
                </a>
                {plugin.requiresHermes && (
                  <>
                    <span aria-hidden="true" className={styles.cardDatesSep}> · </span>
                    <code>hermes {plugin.requiresHermes}</code>
                  </>
                )}
              </span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>
                <Translate
                  id="pluginCatalog.card.toolsLabel"
                  description="Fact row label on a plugin card: the tools the plugin provides"
                >
                  Tools
                </Translate>
              </span>
              {toolChips.shown.length ? (
                <span className={styles.chipList} title={caps.providesTools?.join(", ")}>
                  <code className={styles.toolList}>{toolChips.shown.join(", ")}</code>
                  {toolChips.hidden > 0 && (
                    <code className={`${styles.envChip} ${styles.moreChip}`}>+{toolChips.hidden}</code>
                  )}
                </span>
              ) : (
                <span className={`${styles.metaValue} ${styles.metaEmpty}`}>—</span>
              )}
            </div>
            <div className={styles.installHint}>
              <code>{plugin.installCommand}</code>
              <CopyButton text={plugin.installCommand} />
            </div>
            <div className={styles.cardLinks}>
              <Link className={styles.docsLink} to={pagePath} onClick={(e) => e.stopPropagation()}>
                <Translate
                  id="pluginCatalog.card.pluginPage"
                  description="Link on a plugin card to the plugin's own catalog page"
                >
                  Plugin page →
                </Translate>
              </Link>
              <a
                className={styles.docsLink}
                href={plugin.repo}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <Translate
                  id="pluginCatalog.card.repository"
                  description="Link on a plugin card to the plugin's source repository"
                >
                  Repository ↗
                </Translate>
              </a>
              {plugin.docsUrl ? (
                <a
                  className={styles.docsLink}
                  href={plugin.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Translate
                    id="pluginCatalog.card.documentation"
                    description="Link on a plugin card to the plugin's external documentation"
                  >
                    Documentation ↗
                  </Translate>
                </a>
              ) : null}
            </div>
          </div>
        }
      </div>
    </div>
  );
}

function buildSearchHaystack(p: CatalogPlugin): string {
  return [
    p.name,
    p.description,
    p.maintainer,
    p.tier,
    p.category,
    CATEGORY_CONFIG[p.category]?.label,
    ...(p.capabilities?.providesTools || []),
    ...(p.capabilities?.providesHooks || []),
    ...(p.capabilities?.requiresEnv || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export default function PluginCatalogPage() {
  const { i18n } = useDocusaurusContext();
  // Picker embed mode (?embed=picker): the page is iframed by a host app
  // (Hermes desktop's Capabilities > Plugins tab) as a one-click catalog
  // picker. Site chrome is hidden via CSS and every card gains an
  // "+ Add to this Agent" button that posts
  //   { type: 'hermes-plugin-pick', name, repo, sha, subdir, tier,
  //     installCmd }
  // to the parent window. The HOST performs the actual install through its
  // own gateway (plugins.manage, catalog_name=<name>) — this page never
  // installs anything; parents must validate event.origin before acting.
  const pickerMode =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("embed") === "picker";

  const pickPlugin = useCallback((plugin: CatalogPlugin) => {
    if (typeof window === "undefined" || window.parent === window) return;
    window.parent.postMessage(
      {
        type: "hermes-plugin-pick",
        name: plugin.name,
        repo: plugin.repo,
        sha: plugin.sha,
        subdir: plugin.subdir || "",
        tier: plugin.tier,
        installCmd: plugin.installCommand || `hermes plugins install ${plugin.name}`,
      },
      "*"
    );
  }, []);

  const [data, setData] = useState<{ plugins: CatalogPlugin[]; meta: CatalogMeta } | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sort, setSort] = useState<SortKey>("stars");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const filterPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [pl, mt] = await Promise.all([
          fetch(PLUGINS_URL).then((r) => {
            if (!r.ok) throw new Error(`plugins.json HTTP ${r.status}`);
            return r.json();
          }),
          fetch(META_URL).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
        ]);
        if (cancelled) return;
        const arr = Array.isArray(pl) ? (pl as CatalogPlugin[]) : [];
        for (const p of arr) p._search = buildSearchHaystack(p);
        setData({ plugins: arr, meta: mt || {} });
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
        setFiltersOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Reveal the panel once it opens. `block: "nearest"` leaves the page alone
  // when the panel is already in view; `start` scrolled the hero off-screen.
  useEffect(() => {
    if (!filtersOpen) return;
    const frame = requestAnimationFrame(() => {
      filterPanelRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [filtersOpen]);

  // The panel only exists in the mobile band, so leaving it should drop the
  // state too — otherwise `aria-expanded` stays "true" on a hidden toggle.
  useEffect(() => {
    const media = window.matchMedia(MOBILE_PANEL_QUERY);
    const sync = () => {
      if (!media.matches) setFiltersOpen(false);
    };
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const allPlugins: CatalogPlugin[] = data?.plugins ?? [];
  const meta: CatalogMeta = data?.meta ?? {};

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const matching = allPlugins.filter((p) => {
      if (tierFilter !== "all" && p.tier !== tierFilter) return false;
      if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
      if (q) return (p._search || "").includes(q);
      return true;
    });
    return sortPlugins(matching, sort);
  }, [search, tierFilter, categoryFilter, sort, allPlugins]);

  // Browse mode (no search, no category picked): render one section per
  // category so Memory, Desktop, Platforms… read as distinct shelves rather
  // than one undifferentiated wall. Filtering or searching flattens to a grid.
  const grouped = useMemo(() => {
    if (search.trim() || categoryFilter !== "all") return null;
    const buckets = new Map<string, CatalogPlugin[]>();
    for (const p of filtered) {
      const key = CATEGORY_CONFIG[p.category] ? p.category : "general";
      (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(p);
    }
    return CATEGORY_ORDER.filter((c) => buckets.has(c)).map((c) => [c, buckets.get(c)!] as const);
  }, [filtered, search, categoryFilter]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of allPlugins) {
      if (tierFilter !== "all" && p.tier !== tierFilter) continue;
      const key = CATEGORY_CONFIG[p.category] ? p.category : "general";
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [allPlugins, tierFilter]);

  const clearAll = useCallback(() => {
    setSearch("");
    setTierFilter("all");
    setCategoryFilter("all");
    setFiltersOpen(false);
  }, []);

  const pickCategory = useCallback((c: string) => {
    setCategoryFilter((cur) => (cur === c ? "all" : c));
    setSearch("");
  }, []);

  // Labels shared by the toolbar, the filter panel and the sort pills, so they
  // are resolved once per render.
  const allCategoriesLabel = translate({
    id: "pluginCatalog.filter.allCategories",
    message: "All categories",
    description: "Option and pill that clear the category filter",
  });
  const sortLabel = translate({
    id: "pluginCatalog.filter.sort",
    message: "Sort",
    description: "Label of the sort control, shown in the toolbar and above the sort pills",
  });
  const sortOptionsList = sortOptions();

  const catalogEmpty = data !== null && allPlugins.length === 0;

  const renderCard = (plugin: CatalogPlugin, i: number) => {
    const key = `${plugin.tier}-${plugin.name}`;
    return (
      <PluginCard
        key={key}
        plugin={plugin}
        query={search}
        onPick={pickerMode ? pickPlugin : undefined}
        onCategoryClick={pickCategory}
        style={{ animationDelay: `${Math.min(i, 20) * 25}ms` }}
      />
    );
  };

  return (
    <Layout
      title={translate({
          id: "pluginCatalog.pageTitle",
          message: "Plugin Catalog",
          description: "Browser tab title of the Plugin Catalog page",
        })}
      description={translate({
          id: "pluginCatalog.pageDescription",
          message: "Give Hermes new powers: reviewed plugins you can install in one click",
          description: "Meta description of the Plugin Catalog page",
        })}
    >
      <div className={`${styles.page} ${pickerMode ? styles.pickerMode : ""}`}>
        <header className={styles.hero}>
          <div className={styles.heroGlow} />
          <div className={styles.heroContent}>
            <p className={styles.heroEyebrow}>Hermes Agent</p>
            <h1 className={styles.heroTitle}>
              <Translate
                id="pluginCatalog.heroTitle"
                description="Main heading of the Plugin Catalog page"
              >
                Plugin Catalog
              </Translate>
            </h1>
            <nav
              className={styles.crossNav}
              aria-label={translate({
                  id: "pluginCatalog.crossNav.label",
                  message: "Catalog pages",
                  description: "Accessible label of the Skills/Plugins cross-navigation in the hero",
                })}
            >
              <Link className={styles.crossNavLink} to="/skills">
                <Translate
                  id="pluginCatalog.crossNav.skills"
                  description="Label of the Skills tab in the catalog cross-navigation"
                >
                  Skills
                </Translate>
              </Link>
              <span className={`${styles.crossNavLink} ${styles.crossNavActive}`}>
                <Translate
                  id="pluginCatalog.crossNav.plugins"
                  description="Label of the Plugins tab in the catalog cross-navigation"
                >
                  Plugins
                </Translate>
              </span>
            </nav>
            <p className={styles.heroSub}>
              <Translate
                id="pluginCatalog.heroSub"
                description="Hero sentence of the Plugin Catalog page"
              >
                Give Hermes new powers. Memory, voice, messaging, browsing, Desktop panes and more, built by the community.
              </Translate>
              {loadError && (
                <span style={{ color: "#f87171", marginLeft: 8 }}>
                  {translate({
                      id: "pluginCatalog.loadFailed",
                      message: "· failed to load catalog ({error})",
                      description: "Shown in the hero when the plugin catalog could not be loaded; {error} is the error text",
                    }, { error: String(loadError) })}
                </span>
              )}
            </p>
            {!catalogEmpty && (
              <p className={styles.heroSub} style={{ fontSize: "0.9rem" }}>
                <Translate
                  id="pluginCatalog.submitPrompt"
                  description="Prompt shown above the plugin submission link"
                >
                  Built a plugin?
                </Translate>{" "}
                <Link className={styles.heroLink} to={SUBMIT_PLUGIN_URL}>
                  <Translate
                    id="pluginCatalog.submitLink"
                    description="Link to the guide explaining how to submit a plugin to the catalog"
                  >
                    Submit it to the catalog →
                  </Translate>
                </Link>
              </p>
            )}
            {meta.generatedAt && !catalogEmpty && (
              <p className={styles.heroMeta}>
                <Translate
                  id="pluginCatalog.heroMeta.counts"
                  description="Catalog size line; {plugins} is the number of plugins and {categories} the number of categories"
                  values={{
                    plugins: allPlugins.length.toLocaleString(),
                    categories: String(Object.keys(categoryCounts).length),
                  }}
                >
                  {"{plugins} plugins across {categories} categories"}
                </Translate>
                {" · "}
                <Translate
                  id="pluginCatalog.heroMeta.updated"
                  description="Prefix placed before the relative time of the last catalog build"
                >
                  updated
                </Translate>{" "}
                <span
                  title={
                    meta.starsFetchedAt
                      ? translate({
                          id: "pluginCatalog.heroMeta.timestampTitle",
                          message: "Catalog {generatedAt}; popularity ranking as of {starsFetchedAt}",
                          description: "Tooltip of the catalog timestamp line",
                        }, { generatedAt: String(meta.generatedAt), starsFetchedAt: meta.starsFetchedAt })
                      : meta.generatedAt
                  }
                >
                  {formatRelativeTimeLocalized(meta.generatedAt, translate) ||
                    translate({
                      id: "pluginCatalog.heroMeta.recently",
                      message: "recently",
                      description: "Fallback shown when the last catalog build time is unknown",
                    })}
                </span>
              </p>
            )}
            <p className={styles.heroSub} style={{ fontSize: "0.85rem", opacity: 0.85 }}>
              <a href="https://portal.nousresearch.com/terms" target="_blank" rel="noopener noreferrer">
                <Translate
                  id="pluginCatalog.footer.terms"
                  description="Link label to the Nous Research terms of service"
                >
                  Terms
                </Translate>
              </a>
              {" • "}
              <a href="https://portal.nousresearch.com/privacy" target="_blank" rel="noopener noreferrer">
                <Translate
                  id="pluginCatalog.footer.privacy"
                  description="Link label to the Nous Research privacy policy"
                >
                  Privacy Policy
                </Translate>
              </a>
            </p>
          </div>
        </header>

        {!catalogEmpty && (
          <div className={styles.controlsBar}>
            <div className={styles.controlsTopRow}>
            <div className={styles.searchWrap}>
              <svg
                className={styles.searchIcon}
                viewBox="0 0 20 20"
                fill="currentColor"
                width="18"
                height="18"
              >
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
                    id: "pluginCatalog.searchPlaceholder",
                    message: "Search plugins",
                    description: "Placeholder of the plugin search box",
                  })}
                title={translate({
                    id: "pluginCatalog.searchTip",
                    message: "Tip: press \"/\" to jump here",
                    description: "Tooltip of the plugin search box",
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
              type="button"
              className={styles.filterToggle}
              aria-expanded={filtersOpen}
              aria-controls="plugin-directory-filters"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <Translate
                id="pluginCatalog.filtersToggle"
                description="Label of the button that opens the plugin filters on mobile"
              >
                Filters
              </Translate>
              {(tierFilter !== "all" || categoryFilter !== "all") && (
                <span className={styles.activeFilterCount}>
                  {Number(tierFilter !== "all") + Number(categoryFilter !== "all")}
                </span>
              )}
            </button>
            <label className={styles.compactSelect}>
              <span>{translate({
                  id: "pluginCatalog.filter.source",
                  message: "Source",
                  description: "Label of the tier (official/community) filter dropdown",
                })}</span>
              <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
                {TIER_ORDER.map((tier) => (
                  <option key={tier} value={tier}>{tier === "all" ? translate({
                      id: "pluginCatalog.filter.allSources",
                      message: "All sources",
                      description: "Option that clears the tier filter",
                    }) : TIER_CONFIG[tier] ? tierLabel(tier, translate) : tier}</option>
                ))}
              </select>
            </label>
            <label className={styles.compactSelect}>
              <span>{translate({
                  id: "pluginCatalog.filter.category",
                  message: "Category",
                  description: "Label of the category filter dropdown",
                })}</span>
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="all">{allCategoriesLabel}</option>
                {CATEGORY_ORDER.filter((c) => categoryCounts[c]).map((c) => (
                  <option key={c} value={c}>{categoryLabel(c, translate)}</option>
                ))}
              </select>
            </label>
            <label className={`${styles.compactSelect} ${styles.compactSort}`}>
              <span>{sortLabel}</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                {sortOptionsList.map((opt) => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
              </select>
            </label>
            </div>

            <div
              id="plugin-directory-filters"
              ref={filterPanelRef}
              className={`${styles.filterPanel} ${filtersOpen ? styles.filterPanelOpen : ""}`}
            >
            <div className={styles.tierPills}>
              {TIER_ORDER.map((tier) => {
                const active = tierFilter === tier;
                const conf = TIER_CONFIG[tier];
                const count =
                  tier === "all"
                    ? allPlugins.length
                    : allPlugins.filter((p) => p.tier === tier).length;
                return (
                  <button
                    key={tier}
                    className={`${styles.tierBtn} ${active ? styles.tierBtnActive : ""}`}
                    onClick={() => setTierFilter(tier)}
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
                    {tier === "all"
                      ? translate({
                          id: "pluginCatalog.filter.all",
                          message: "All",
                          description: "Tier pill that clears the tier filter",
                        })
                      : conf ? categoryLabel(categoryFilter, translate) : tier}
                    <span className={styles.tierCount}>{count}</span>
                  </button>
                );
              })}
            </div>

            <div
              className={styles.sortPills}
              role="radiogroup"
              aria-label={translate({
                  id: "pluginCatalog.sortGroup.label",
                  message: "Sort plugins",
                  description: "Accessible label of the sort pill group",
                })}
            >
              <span className={styles.sortLabel}>{sortLabel}</span>
              {sortOptionsList.map((opt) => {
                const active = sort === opt.key;
                return (
                  <button
                    key={opt.key}
                    className={`${styles.tierBtn} ${active ? styles.sortBtnActive : ""}`}
                    onClick={() => setSort(opt.key)}
                    role="radio"
                    aria-checked={active}
                    title={opt.title}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <div
              className={styles.categoryPills}
              role="tablist"
              aria-label={translate({
                  id: "pluginCatalog.categoryGroup.label",
                  message: "Plugin categories",
                  description: "Accessible label of the category pill group",
                })}
            >
              <button
                className={`${styles.categoryBtn} ${categoryFilter === "all" ? styles.categoryBtnActive : ""}`}
                onClick={() => setCategoryFilter("all")}
                role="tab"
                aria-selected={categoryFilter === "all"}
              >
                {allCategoriesLabel}
              </button>
              {CATEGORY_ORDER.filter((c) => categoryCounts[c]).map((c) => {
                const conf = CATEGORY_CONFIG[c];
                const active = categoryFilter === c;
                return (
                  <button
                    key={c}
                    className={`${styles.categoryBtn} ${active ? styles.categoryBtnActive : ""}`}
                    onClick={() => pickCategory(c)}
                    role="tab"
                    aria-selected={active}
                    title={categoryBlurb(c, translate)}
                  >
                    <span aria-hidden="true">{conf.icon}</span> {categoryLabel(c, translate)}
                    <span className={styles.tierCount}>{categoryCounts[c]}</span>
                  </button>
                );
              })}
            </div>
            </div>
          </div>
        )}

        <main className={styles.main}>
          {!data && !loadError ? (
            <div className={styles.empty}>
              <div className={styles.loadingSpinner} />
              <h3 className={styles.emptyTitle}>
                <Translate
                  id="pluginCatalog.loading.title"
                  description="Title of the card shown while the plugin catalog is downloading"
                >
                  Loading the catalog…
                </Translate>
              </h3>
            </div>
          ) : catalogEmpty ? (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>{"\u{1F331}"}</div>
              <h3 className={styles.emptyTitle}>
                <Translate
                  id="pluginCatalog.empty.title"
                  description="Title shown when the plugin catalog contains no entry at all"
                >
                  The catalog is just getting started
                </Translate>
              </h3>
              <p className={styles.emptyDesc}>
                <Translate
                  id="pluginCatalog.empty.desc"
                  description="Explanation shown when the plugin catalog contains no entry at all"
                >
                  {"The plugin catalog is a curated, human-reviewed list of Hermes plugins — each entry pinned to an exact commit. Want yours listed? Submissions are open."}
                </Translate>
              </p>
              <div className={styles.emptyActions}>
                <Link className={styles.emptyCta} to={SUBMIT_PLUGIN_URL}>
                  <Translate
                    id="pluginCatalog.empty.submitCta"
                    description="Link to the submission guide on the empty catalog page"
                  >
                    How to submit a plugin
                  </Translate>
                </Link>
                <Link className={styles.emptyCtaSecondary} to="/user-guide/features/plugin-catalog">
                  <Translate
                    id="pluginCatalog.empty.docsCta"
                    description="Link to the catalog documentation on the empty catalog page"
                  >
                    Read the catalog docs
                  </Translate>
                </Link>
              </div>
            </div>
          ) : filtered.length > 0 && grouped ? (
            grouped.map(([cat, plugins]) => {
              const conf = CATEGORY_CONFIG[cat];
              return (
                <section key={cat} className={styles.categorySection} aria-labelledby={`cat-${cat}`}>
                  <header className={styles.categoryHeader}>
                    <h2 id={`cat-${cat}`} className={styles.categoryTitle}>
                      <span aria-hidden="true">{conf.icon}</span> {categoryLabel(cat, translate)}
                      <span className={styles.tierCount}>{plugins.length}</span>
                    </h2>
                    <p className={styles.categoryBlurb}>{categoryBlurb(cat, translate)}</p>
                    <button className={styles.categoryViewAll} onClick={() => pickCategory(cat)}>
                      <Translate
                        id="pluginCatalog.section.viewOnly"
                        description="Button in a category section header that filters the grid down to that category; {label} is the category name"
                        values={{ label: categoryLabel(cat, translate) }}
                      >
                        {"View only {label} →"}
                      </Translate>
                    </button>
                  </header>
                  <div className={styles.grid}>
                    {plugins.map((plugin, i) => renderCard(plugin, i))}
                  </div>
                </section>
              );
            })
          ) : filtered.length > 0 ? (
            <>
              <div className={styles.resultsBar} role="status">
                {categoryFilter !== "all" && CATEGORY_CONFIG[categoryFilter] && (
                  <span>
                    <span aria-hidden="true">{CATEGORY_CONFIG[categoryFilter].icon}</span>{" "}
                    <strong>{categoryLabel(categoryFilter, translate)}</strong>
                    <span style={{ opacity: 0.7 }}> · {categoryBlurb(categoryFilter, translate)}</span>
                  </span>
                )}
                {search.trim() && (
                  <span>
                    <Translate
                      id="pluginCatalog.results.for"
                      description="Results bar line for a search query; {query} is the quoted query"
                      values={{ query: <strong>“{search.trim()}”</strong> }}
                    >
                      {"Results for {query}"}
                    </Translate>
                  </span>
                )}
                <span>
                  {filtered.length === 1
                    ? translate({
                        id: "pluginCatalog.results.one",
                        message: "1 plugin",
                        description: "Results bar count when exactly one plugin matches",
                      })
                    : translate({
                        id: "pluginCatalog.results.many",
                        message: "{count} plugins",
                        description: "Results bar count with the number of matching plugins",
                      }, { count: String(filtered.length) })}
                </span>
                <button className={styles.resultsClear} onClick={clearAll}>
                  <Translate
                    id="pluginCatalog.results.clear"
                    description="Button in the results bar that clears search, tier and category filters"
                  >
                    Clear filters
                  </Translate>
                </button>
              </div>
              <div className={styles.grid}>{filtered.map((plugin, i) => renderCard(plugin, i))}</div>
            </>
          ) : (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>{"\u{1F50D}"}</div>
              <h3 className={styles.emptyTitle}>
                <Translate
                  id="pluginCatalog.noResults.title"
                  description="Title shown when the filters match no plugin"
                >
                  No plugins found
                </Translate>
              </h3>
              <p className={styles.emptyDesc}>
                <Translate
                  id="pluginCatalog.noResults.desc"
                  description="Hint shown when the filters match no plugin"
                >
                  Try a different search term or clear your filters.
                </Translate>
              </p>
              <button className={styles.emptyReset} onClick={clearAll}>
                <Translate
                  id="pluginCatalog.noResults.reset"
                  description="Button that clears every filter when no plugin matches"
                >
                  Reset all filters
                </Translate>
              </button>
            </div>
          )}
        </main>
      </div>
    </Layout>
  );
}
