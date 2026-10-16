import React from "react";
import Link from "@docusaurus/Link";
import { translate } from "@docusaurus/Translate";
import {
  type CatalogPlugin,
  categoryLabel,
  categoryOf,
  formatStars,
  pluginPagePath,
  repoUrl,
  tierLabel,
  tierOf,
} from "./catalog";
import styles from "./pages.module.css";

/** Compact card for shelves: "More by this author" on a plugin page and the author page grid. */
export default function MiniCard({ plugin }: { plugin: CatalogPlugin }) {
  const tier = tierOf(plugin);
  const category = categoryOf(plugin);
  return (
    <Link className={styles.miniCard} to={pluginPagePath(plugin.name)}>
      <span className={styles.miniAccent} style={{ background: tier.color }} />
      <div className={styles.miniTop}>
        <span className={styles.miniIcon} aria-hidden="true" title={categoryLabel(plugin.category, translate)}>
          {category.icon}
        </span>
        <span className={styles.miniName}>{plugin.name}</span>
        <span
          className={styles.tierPill}
          style={{ color: tier.color, background: tier.bg, borderColor: tier.border }}
        >
          {tier.icon} {tierLabel(plugin.tier, translate)}
        </span>
        {typeof plugin.stars === "number" && (
          <span
            className={styles.miniStars}
            title={translate({
                id: "pluginCatalog.miniCard.starsTitle",
                message: "{count} GitHub stars on {repo}",
                description: "Tooltip of the star count on a compact plugin card; {count} is the star count and {repo} the repository URL",
              }, { count: plugin.stars.toLocaleString(), repo: repoUrl(plugin) })}
          >
            {"\u2605"} {formatStars(plugin.stars)}
          </span>
        )}
      </div>
      <p className={styles.miniDesc}>
        {plugin.description ||
          translate({
            id: "pluginCatalog.miniCard.noDescription",
            message: "No description available.",
            description: "Placeholder shown on a compact plugin card that has no description",
          })}
      </p>
      <span className={styles.miniCategory}>{categoryLabel(plugin.category, translate)}</span>
    </Link>
  );
}
