import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const snapshots = sqliteTable('snapshots', { id: text('id').primaryKey(), payload: text('payload').notNull(), updated: text('updated').notNull() });
export const preferences = sqliteTable('preferences', { userId: text('user_id').primaryKey(), rate: text('rate').notNull(), updated: text('updated').notNull() });
export const jobs = sqliteTable('jobs', { id: text('id').primaryKey(), kind: text('kind').notNull(), status: text('status').notNull(), progress: integer('progress').notNull(), message: text('message').notNull(), created: text('created').notNull(), updated: text('updated').notNull(), requestedBy: text('requested_by').notNull(), lease: integer('lease').notNull() });
export const cloudRefresh = sqliteTable('cloud_refresh', {id:text('id').primaryKey(),payload:text('payload').notNull(),lease:integer('lease').notNull().default(0),token:text('token').notNull().default(''),updated:text('updated').notNull()});
export const accountLinks = sqliteTable('account_links',{webId:text('web_id').primaryKey(),telegramId:text('telegram_id').notNull().unique()});
export const linkCodes = sqliteTable('link_codes',{code:text('code').primaryKey(),telegramId:text('telegram_id').notNull(),expires:integer('expires').notNull()});
