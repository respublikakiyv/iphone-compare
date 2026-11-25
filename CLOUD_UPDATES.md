# Shared catalog updates

The published Site exposes authenticated MCP tools `catalog_status`, `refresh_prices`, and `continue_refresh`. Use the Site-created connected plugin. Do not copy tokens into prompts or use browser credentials.

A scheduled run reads status, queues a price refresh (scope `all`) if no queued/running job exists, then calls `continue_refresh` sequentially until status is `succeeded`, `partial`, or `failed`. Each call saves a durable checkpoint. A transport failure can safely retry the same tool; a busy lease should be retried after 3 seconds. Stop on a terminal result and report unresolved source failures concisely. Do not repeatedly restart a partial job. Read `catalog_status` at the end to verify persisted results. Do not republish or send Telegram messages during routine updates.

Only public store pages are fetched. Existing robots rules and global per-host crawl reservations apply. No external paid services are configured. Limits: 2,000 page attempts per job, 8,000 processing attempts per UTC day, one active job globally, 60-second cooldown on completed jobs. These application limits are not a guarantee of the hosting account's free quota.

The catalog, settings read, and bounded refresh operations are public and require no login. Anonymous store selection and manual rate do not write shared account preferences. Owner operations and MCP automation remain authenticated. Link a Telegram account using a short-lived, single-use code generated in the authenticated Telegram app and redeemed in the authenticated web app. Never trust client-submitted catalog prices; device migration imports missing store URLs for server verification. Existing local storage remains as a backup.

## Apple catalog

The new inventory supports `iphone`, `ipad`, `mac`, `watch`, `airpods`, and `other`. Missing category means legacy iPhone. Catalog refresh accepts a category to bound discovery and does not mark other categories unavailable. Public UI supports token search across titles, articles and configuration, source/availability filters, sorting, and incremental result rendering. Cross-store grouping for other Apple devices requires an exact manufacturer article plus extracted configuration; offers with no article remain separate. Price refresh skips link/menu discovery. Large catalog snapshots use lossless gzip storage and preserve compatibility with legacy JSON snapshots.
