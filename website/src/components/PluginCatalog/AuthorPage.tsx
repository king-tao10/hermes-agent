import React from "react";
import Layout from "@theme/Layout";
import Link from "@docusaurus/Link";
import Translate, { translate } from "@docusaurus/Translate";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import { type CatalogPlugin, CATEGORY_ORDER, categoryLabel, categoryOf, formatDate, formatStars, repoUrl } from "./catalog";
import MiniCard from "./MiniCard";
import styles from "./pages.module.css";

interface AuthorPageData {
  author: { slug: string; name: string; count: number };
  plugins: CatalogPlugin[];
  generatedAt: string | null;
}

/** GitHub/GitLab profile when every listed repo belongs to one owner; null when they differ. */
function profileUrl(plugins: CatalogPlugin[]): string | null {
  const owners = new Set<string>();
  for (const p of plugins) {
    const m = repoUrl(p).match(/^https:\/\/(github\.com|gitlab\.com)\/([^/]+)\//);
    if (!m) return null;
    owners.add(`https://${m[1]}/${m[2]}`);
  }
  return owners.size === 1 ? [...owners][0] : null;
}

export default function AuthorPage({ data }: { data: AuthorPageData }) {
  const { author, plugins } = data;
  const { i18n } = useDocusaurusContext();
  const stars = plugins.reduce((sum, p) => sum + (typeof p.stars === "number" ? p.stars : 0), 0);
  const hasStars = plugins.some((p) => typeof p.stars === "number");
  const profile = profileUrl(plugins);
  const firstListed = plugins
    .map((p) => p.addedAt)
    .filter((d): d is string => Boolean(d))
    .sort()[0];
  const categories = CATEGORY_ORDER.filter((c) => plugins.some((p) => categoryOf(p) === categoryOf({ category: c })));
  const official = plugins.filter((p) => p.tier === "official").length;

  return (
    <Layout
      title={translate({
          id: "authorPage.title",
          message: "Plugins by {name} · Plugin Catalog",
          description: "Browser tab title of a maintainer page; {name} is the maintainer name",
        }, { name: author.name })}
      description={
        plugins.length === 1
          ? translate({
              id: "authorPage.description.one",
              message: "1 Hermes Agent plugin by {name} in the reviewed catalog.",
              description: "Meta description of a maintainer page with a single plugin; {name} is the maintainer name",
            }, { name: author.name })
          : translate({
              id: "authorPage.description.many",
              message: "{count} Hermes Agent plugins by {name} in the reviewed catalog.",
              description: "Meta description of a maintainer page; {count} is the number of plugins and {name} the maintainer name",
            }, { count: String(plugins.length), name: author.name })
      }
    >
      <div className={styles.page}>
        <nav
          className={styles.crumbs}
          aria-label={translate({
              id: "authorPage.breadcrumb",
              message: "Breadcrumb",
              description: "Accessible label of the breadcrumb navigation on a maintainer page",
            })}
        >
          <Link to="/plugins">
            <Translate
              id="authorPage.crumb.catalog"
              description="First breadcrumb link on a maintainer page"
            >
              Plugin Catalog
            </Translate>
          </Link>
          <span aria-hidden="true">/</span>
          <span>
            <Translate
              id="authorPage.crumb.authors"
              description="Breadcrumb crumb for the maintainer namespaces"
            >
              Authors
            </Translate>
          </span>
          <span aria-hidden="true">/</span>
          <span className={styles.crumbCurrent}>{author.name}</span>
        </nav>

        <header className={`${styles.hero} ${styles.authorHero}`}>
          <div className={styles.heroBody}>
            <p className={styles.eyebrow}>
              <Translate
                id="authorPage.eyebrow"
                description="Small heading above the maintainer name"
              >
                Plugin author
              </Translate>
            </p>
            <h1 className={styles.title}>{author.name}</h1>
            <p className={styles.byline}>
              {plugins.length === 1
                ? translate({
                    id: "authorPage.count.one",
                    message: "1 plugin in the catalog",
                    description: "Byline on a maintainer page with a single plugin",
                  })
                : translate({
                    id: "authorPage.count.many",
                    message: "{count} plugins in the catalog",
                    description: "Byline on a maintainer page; {count} is the number of plugins",
                  }, { count: String(plugins.length) })}
              {official > 0 && (
                <Translate
                  id="authorPage.official"
                  description="Byline fragment with the number of official plugins; {count} is the count"
                  values={{ count: String(official) }}
                >
                  {" · {count} official"}
                </Translate>
              )}
              {hasStars && (
                <Translate
                  id="authorPage.stars"
                  description="Byline fragment with the total star count across the maintainer's plugins; {count} is the star count"
                  values={{ count: formatStars(stars) }}
                >
                  {" · ★ {count} GitHub stars across them"}
                </Translate>
              )}
              {firstListed && (
                <Translate
                  id="authorPage.firstListed"
                  description="Byline fragment with the date the maintainer's first plugin was listed; {date} is an absolute date"
                  values={{ date: formatDate(firstListed, i18n.currentLocale) || "" }}
                >
                  {" · first listed {date}"}
                </Translate>
              )}
              {categories.length > 0 && (
                <> · {categories.map((c) => categoryLabel(c, translate)).join(", ")}</>
              )}
            </p>
            {profile && (
              <div className={styles.links}>
                <a className={styles.link} href={profile} target="_blank" rel="noopener noreferrer">
                  {profile.replace(/^https:\/\//, "")} ↗
                </a>
              </div>
            )}
          </div>
        </header>

        <main className={styles.main}>
          <div className={styles.shelf}>
            {plugins.map((p) => <MiniCard key={p.name} plugin={p} />)}
          </div>
          <p className={styles.footerMeta}>
            <Link to="/plugins">
              <Translate
                id="authorPage.backToCatalog"
                description="Link back to the plugin catalog grid"
              >
                ← Back to the catalog
              </Translate>
            </Link>
          </p>
        </main>
      </div>
    </Layout>
  );
}
