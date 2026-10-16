import React from "react";
import Layout from "@theme/Layout";
import Link from "@docusaurus/Link";
import Head from "@docusaurus/Head";
import Translate, { translate } from "@docusaurus/Translate";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import {
  type CatalogPlugin,
  SUBMIT_PLUGIN_URL,
  authorPagePath,
  categoryLabel,
  categoryOf,
  desktopInstallLink,
  formatDate,
  formatStars,
  pinUrl,
  repoUrl,
  splitDisclosure,
  tierLabel,
  tierOf,
} from "./catalog";
import CopyButton from "./CopyButton";
import MiniCard from "./MiniCard";
import styles from "./pages.module.css";

interface PluginPageData {
  plugin: CatalogPlugin;
  /** Allowlisted HTML rendered at build time from the README at the pinned commit; null when not opted in. */
  readmeHtml: string | null;
  /** Raw URL of the README file that was rendered (subdir or repo root at the pinned sha). */
  readmeSourceUrl: string | null;
  author: { slug: string; name: string; count: number } | null;
  moreByAuthor: CatalogPlugin[];
  generatedAt: string | null;
  starsFetchedAt: string | null;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={styles.factValue}>{children}</dd>
    </div>
  );
}

function ChipList({ label, items, mono = true }: { label: string; items?: string[]; mono?: boolean }) {
  if (!items?.length) return null;
  return (
    <div className={styles.capRow}>
      <h3 className={styles.capLabel}>
        {label} <span className={styles.count}>{items.length}</span>
      </h3>
      <div className={styles.chipWrap}>
        {items.map((item) =>
          mono ? (
            <code key={item} className={styles.chip}>{item}</code>
          ) : (
            <span key={item} className={styles.chip}>{item}</span>
          ),
        )}
      </div>
    </div>
  );
}

function platformLabel(p: string): string {
  return p === "macos" ? "macOS" : p === "linux" ? "Linux" : p === "windows" ? "Windows" : p;
}

export default function PluginPage({ data }: { data: PluginPageData }) {
  const { plugin, readmeHtml, author, moreByAuthor } = data;
  const { i18n } = useDocusaurusContext();
  const tier = tierOf(plugin);
  const category = categoryOf(plugin);
  const caps = plugin.capabilities || {};
  const { prose, disclosures } = splitDisclosure(plugin.description || "");
  const repo = repoUrl(plugin);
  const pinned = pinUrl(plugin);
  const readmeFileUrl = data.readmeSourceUrl
    ? data.readmeSourceUrl
        .replace(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([0-9a-f]{40})\//, "https://github.com/$1/$2/blob/$3/")
        .replace("/-/raw/", "/-/blob/")
    : null;
  const added = formatDate(plugin.addedAt, i18n.currentLocale);
  const updated = formatDate(plugin.updatedAt, i18n.currentLocale);
  const metaDescription = (
    prose ||
    plugin.description ||
    translate({
      id: "pluginPage.metaDescription",
      message: "{name} — a Hermes Agent plugin",
      description: "Meta description of a plugin page when the plugin has no description; {name} is the plugin name",
    }, { name: plugin.name })
  ).slice(0, 160);

  return (
    <Layout
      title={translate({
          id: "pluginPage.title",
          message: "{name} · Plugin Catalog",
          description: "Browser tab title of a plugin page; {name} is the plugin name",
        }, { name: plugin.name })}
      description={metaDescription}
    >
      <Head>
        <meta property="og:type" content="website" />
        {plugin.image && <meta property="og:image" content={plugin.image} />}
      </Head>
      <div className={styles.page}>
        <nav
          className={styles.crumbs}
          aria-label={translate({
              id: "pluginPage.breadcrumb",
              message: "Breadcrumb",
              description: "Accessible label of the breadcrumb navigation on a plugin page",
            })}
        >
          <Link to="/plugins">
            <Translate
              id="pluginPage.crumb.catalog"
              description="First breadcrumb link on a plugin page"
            >
              Plugin Catalog
            </Translate>
          </Link>
          <span aria-hidden="true">/</span>
          <span>{categoryLabel(plugin.category, translate)}</span>
          <span aria-hidden="true">/</span>
          <span className={styles.crumbCurrent}>{plugin.name}</span>
        </nav>

        <header className={styles.hero}>
          {plugin.image && (
            <img
              className={styles.heroImage}
              src={plugin.image}
              alt=""
              decoding="async"
              referrerPolicy="no-referrer"
            />
          )}
          <div className={styles.heroBody}>
            <div className={styles.titleRow}>
              <span className={styles.heroIcon} aria-hidden="true" title={categoryLabel(plugin.category, translate)}>
                {category.icon}
              </span>
              <h1 className={styles.title}>{plugin.name}</h1>
              <span
                className={styles.tierPill}
                style={{ color: tier.color, background: tier.bg, borderColor: tier.border }}
              >
                {tier.icon} {tierLabel(plugin.tier, translate)}
              </span>
              {plugin.version && (
                <span
                  className={styles.versionPill}
                  title={translate({
                      id: "pluginPage.versionTitle",
                      message: "Version {version} at {sha}",
                      description: "Tooltip of the version pill in the plugin page hero",
                    }, { version: plugin.version, sha: plugin.sha })}
                >
                  v{plugin.version.replace(/^v/i, "")}
                </span>
              )}
              {typeof plugin.stars === "number" && (
                <a
                  className={styles.starPill}
                  href={`${repo}/stargazers`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={
                    data.starsFetchedAt
                      ? translate({
                          id: "pluginPage.starsTitle.asOf",
                          message: "{count} GitHub stars as of {date}",
                          description: "Tooltip of the star pill in the plugin page hero when the star count has a fetch date",
                        }, { count: plugin.stars.toLocaleString(), date: data.starsFetchedAt })
                      : translate({
                          id: "pluginPage.starsTitle",
                          message: "{count} GitHub stars",
                          description: "Tooltip of the star pill in the plugin page hero; {count} is the star count",
                        }, { count: plugin.stars.toLocaleString() })
                  }
                >
                  {"\u2605"} {formatStars(plugin.stars)}
                </a>
              )}
            </div>
            <p className={styles.byline}>
              {categoryLabel(plugin.category, translate)}
              {plugin.maintainer && (
                <>
                  {translate({
                    id: "pluginPage.byline.by",
                    message: " · by ",
                    description: "Byline prefix before the maintainer link on a plugin page",
                  })}
                  {author ? (
                    <Link className={styles.authorLink} to={authorPagePath(author.slug)}>
                      {plugin.maintainer}
                    </Link>
                  ) : (
                    plugin.maintainer
                  )}
                </>
              )}
              {added && (
                <>
                  {translate({
                    id: "pluginPage.byline.added",
                    message: " · added ",
                    description: "Byline prefix before the date the plugin was first listed",
                  })}
                  <time dateTime={plugin.addedAt || undefined}>{added}</time>
                </>
              )}
              {updated && updated !== added && (
                <>
                  {translate({
                    id: "pluginPage.byline.updated",
                    message: " · updated ",
                    description: "Byline prefix before the date the plugin was last re-pinned",
                  })}
                  <time dateTime={plugin.updatedAt || undefined}>{updated}</time>
                </>
              )}
            </p>
            {prose && <p className={styles.lede}>{prose}</p>}
            {disclosures.map((text) => (
              <aside key={text} className={styles.disclosure} role="note">
                <strong>
                  <Translate
                    id="pluginPage.disclosure.label"
                    description="Bold label of a disclosure note rendered from the plugin description"
                  >
                    Disclosure
                  </Translate>
                </strong>{" "}
                — {text}
              </aside>
            ))}

            <div className={styles.actions}>
              <a
                className={styles.installBtn}
                href={desktopInstallLink(plugin.name)}
                title={translate({
                  id: "pluginPage.desktopInstallTitle",
                  message: "Opens the Install Plugin dialog in Hermes Desktop at the reviewed version. No app? Use the install command.",
                  description: "Tooltip of the install button on a plugin page",
                })}
              >
                <Translate
                  id="pluginPage.openInDesktop"
                  description="Button that deep-links into the Hermes Desktop app to install the plugin"
                >
                  Open in Hermes Desktop
                </Translate>
              </a>
              <div className={styles.installCmd}>
                <code>{plugin.installCommand}</code>
                <CopyButton text={plugin.installCommand} />
              </div>
            </div>
            <div className={styles.links}>
              <a className={styles.link} href={repo} target="_blank" rel="noopener noreferrer">
                <Translate
                  id="pluginPage.repository"
                  description="Link to the plugin's source repository"
                >
                  Repository ↗
                </Translate>
              </a>
              <a className={styles.link} href={pinned} target="_blank" rel="noopener noreferrer" title={plugin.sha}>
                <Translate
                  id="pluginPage.reviewedSource"
                  description="Link to the exact reviewed commit of the plugin; {sha} is the short commit hash"
                  values={{ sha: plugin.shaShort }}
                >
                  {"Reviewed source @ {sha} ↗"}
                </Translate>
              </a>
              {plugin.docsUrl && (
                <a className={styles.link} href={plugin.docsUrl} target="_blank" rel="noopener noreferrer">
                  <Translate
                    id="pluginPage.documentation"
                    description="Link to the plugin's external documentation"
                  >
                    Documentation ↗
                  </Translate>
                </a>
              )}
            </div>
          </div>
        </header>

        <main className={styles.main}>
          <div className={styles.columns}>
            <div className={styles.primary}>
              {plugin.screenshots?.length ? (
                <section className={styles.section} aria-labelledby="screenshots">
                  <h2 id="screenshots" className={styles.sectionTitle}>
                    <Translate
                      id="pluginPage.screenshots"
                      description="Section title of the plugin screenshot gallery"
                    >
                      Screenshots
                    </Translate>
                  </h2>
                  <div className={styles.gallery}>
                    {plugin.screenshots.map((src, i) => (
                      <a key={src} href={src} target="_blank" rel="noopener noreferrer" className={styles.shot}>
                        <img
                          src={src}
                          alt={translate({
                            id: "pluginPage.screenshotAlt",
                            message: "{name} screenshot {index}",
                            description: "Alt text of a screenshot image; {name} is the plugin name and {index} the position in the gallery",
                          }, { name: plugin.name, index: String(i + 1) })}
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                        />
                      </a>
                    ))}
                  </div>
                </section>
              ) : null}

              {(caps.providesTools?.length || caps.providesHooks?.length || caps.providesMiddleware?.length || caps.requiresEnv?.length) ? (
                <section className={styles.section} aria-labelledby="capabilities">
                  <h2 id="capabilities" className={styles.sectionTitle}>
                    <Translate
                      id="pluginPage.whatItAdds"
                      description="Section title listing the tools, hooks, middleware and env vars a plugin adds"
                    >
                      What it adds
                    </Translate>
                  </h2>
                  <ChipList
                    label={translate({
                        id: "pluginPage.cap.tools",
                        message: "Tools",
                        description: "Capability list heading: tools the plugin provides",
                      })}
                    items={caps.providesTools}
                  />
                  <ChipList
                    label={translate({
                        id: "pluginPage.cap.hooks",
                        message: "Hooks",
                        description: "Capability list heading: hooks the plugin provides",
                      })}
                    items={caps.providesHooks}
                  />
                  <ChipList
                    label={translate({
                        id: "pluginPage.cap.middleware",
                        message: "Middleware",
                        description: "Capability list heading: middleware the plugin provides",
                      })}
                    items={caps.providesMiddleware}
                  />
                  <ChipList
                    label={translate({
                        id: "pluginPage.cap.env",
                        message: "Environment variables it needs",
                        description: "Capability list heading: environment variables the plugin requires",
                      })}
                    items={caps.requiresEnv}
                  />
                </section>
              ) : null}

              {readmeHtml ? (
                <section className={styles.section} aria-labelledby="readme">
                  <div className={styles.readmeHead}>
                    <h2 id="readme" className={styles.sectionTitle}>README</h2>
                    <span className={styles.readmeNote}>
                      <Translate
                        id="pluginPage.readme.note"
                        description="Note next to the README heading; {sha} is the reviewed commit reference"
                        values={{
                          sha: readmeFileUrl ? (
                            <a href={readmeFileUrl} target="_blank" rel="noopener noreferrer">
                              <code>{plugin.shaShort}</code> ↗
                            </a>
                          ) : (
                            <code>{plugin.shaShort}</code>
                          ),
                        }}
                      >
                        {"From the reviewed commit {sha}; it updates when the author re-pins."}
                      </Translate>
                    </span>
                  </div>
                  <article
                    className={`${styles.readme} markdown`}
                    // Build-time output of plugins/plugin-catalog-pages/readme.js: raw HTML dropped,
                    // tags/attributes allowlisted, URLs restricted to http(s)/mailto/#.
                    dangerouslySetInnerHTML={{ __html: readmeHtml }}
                  />
                </section>
              ) : null}
            </div>

            <aside className={styles.side}>
              <dl className={styles.facts}>
                <Fact label={translate({
              id: "pluginPage.fact.pinnedCommit",
              message: "Pinned commit",
              description: "Fact row label on a plugin page: the exact commit the entry installs",
            })}>
                  <a href={pinned} target="_blank" rel="noopener noreferrer" title={plugin.sha}>
                    <code>{plugin.shaShort}</code> ↗
                  </a>
                </Fact>
                {plugin.version && <Fact label={translate({
              id: "pluginPage.fact.version",
              message: "Version",
              description: "Fact row label on a plugin page: the plugin version",
            })}><code>{plugin.version}</code></Fact>}
                {plugin.subdir && <Fact label={translate({
              id: "pluginPage.fact.path",
              message: "Path in repo",
              description: "Fact row label on a plugin page: the subdirectory the plugin lives in",
            })}><code>{plugin.subdir}</code></Fact>}
                <Fact label={translate({
              id: "pluginPage.fact.requires",
              message: "Requires",
              description: "Fact row label on a plugin page: the minimum Hermes version",
            })}>
                  <code>
                    hermes{" "}
                    {plugin.requiresHermes ||
                      translate({
                        id: "pluginPage.fact.anyVersion",
                        message: "(any version)",
                        description: "Shown when a plugin does not require a specific Hermes version",
                      })}
                  </code>
                </Fact>
                <Fact label={translate({
              id: "pluginPage.fact.platforms",
              message: "Platforms",
              description: "Fact row label on a plugin page: supported operating systems",
            })}>
                  {plugin.platforms?.length ? plugin.platforms.map(platformLabel).join(", ") : "Linux, macOS, Windows"}
                </Fact>
                <Fact label={translate({
              id: "pluginPage.fact.category",
              message: "Category",
              description: "Fact row label on a plugin page: the plugin category",
            })}>
                  <Link to="/plugins">{categoryLabel(plugin.category, translate)}</Link>
                </Fact>
                <Fact label={translate({
            id: "pluginPage.fact.tier",
            message: "Tier",
            description: "Fact row label on a plugin page: official or community",
          })}>{tierLabel(plugin.tier, translate)}</Fact>
                {plugin.maintainer && (
                  <Fact label={translate({
              id: "pluginPage.fact.maintainer",
              message: "Maintainer",
              description: "Fact row label on a plugin page: who maintains the plugin",
            })}>
                    {author ? <Link to={authorPagePath(author.slug)}>{plugin.maintainer}</Link> : plugin.maintainer}
                  </Fact>
                )}
                {added && <Fact label={translate({
              id: "pluginPage.fact.listed",
              message: "Listed",
              description: "Fact row label on a plugin page: when the plugin was first listed",
            })}>{added}</Fact>}
                {updated && updated !== added && <Fact label={translate({
              id: "pluginPage.fact.lastRepin",
              message: "Last re-pin",
              description: "Fact row label on a plugin page: when the plugin was last re-pinned",
            })}>{updated}</Fact>}
              </dl>
              <p className={styles.sideNote}>
                <Translate
                  id="pluginPage.sideNote"
                  description="Side note on a plugin page explaining the reviewed pin workflow; {link} is a link to the how-listing-works guide"
                  values={{
                    link: (
                      <Link to={SUBMIT_PLUGIN_URL}>
                        <Translate
                          id="pluginPage.sideNote.link"
                          description="Link text inside the side note on a plugin page"
                        >
                          how listing works
                        </Translate>
                      </Link>
                    ),
                  }}
                >
                  {"Every entry installs exactly the commit above. Updates reach users only through a reviewed re-pin PR — {link}."}
                </Translate>
              </p>
            </aside>
          </div>

          {author && moreByAuthor.length > 0 && (
            <section className={styles.section} aria-labelledby="more-by">
              <div className={styles.shelfHead}>
                <h2 id="more-by" className={styles.sectionTitle}>
                  <Translate
                    id="pluginPage.moreBy"
                    description="Section title listing other plugins from the same maintainer; {author} is the maintainer name"
                    values={{ author: author.name }}
                  >
                    {"More by {author}"}
                  </Translate>
                </h2>
                <Link className={styles.shelfAll} to={authorPagePath(author.slug)}>
                  <Translate
                    id="pluginPage.moreBy.all"
                    description="Link to the maintainer page; {count} is the number of plugins and {author} the maintainer name"
                    values={{ count: String(author.count), author: author.name }}
                  >
                    {"All {count} plugins by {author} →"}
                  </Translate>
                </Link>
              </div>
              <div className={styles.shelf}>
                {moreByAuthor.slice(0, 6).map((p) => <MiniCard key={p.name} plugin={p} />)}
              </div>
            </section>
          )}

          <p className={styles.footerMeta}>
            <Link to="/plugins">
              <Translate
                id="pluginPage.backToCatalog"
                description="Link back to the plugin catalog grid"
              >
                ← Back to the catalog
              </Translate>
            </Link>
            {formatDate(data.generatedAt, i18n.currentLocale) && (
              // Absolute date, not "x hours ago": the page is server-rendered and a clock-relative
              // string would differ at hydration.
              <span title={data.generatedAt || undefined}>
                <Translate
                  id="pluginPage.catalogBuilt"
                  description="Footer note with the date the catalog was built; {date} is an absolute date"
                  values={{ date: formatDate(data.generatedAt, i18n.currentLocale) || "" }}
                >
                  {" · catalog built {date}"}
                </Translate>
              </span>
            )}
          </p>
        </main>
      </div>
    </Layout>
  );
}
