import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import type { Card, Opponent } from "./domain.js";
import type { GameResult } from "./engine.js";
const time = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "string" });
export const snapshots = pgTable("meta_snapshots", {
  id: uuid().primaryKey(),
  format: text().notNull(),
  name: text().notNull(),
  source: text().notNull(),
  sourceDate: text("source_date"),
  selectionMethod: text("selection_method").notNull(),
  decks: jsonb().$type<Opponent[]>().notNull(),
  metadata: jsonb().$type<Record<string, unknown>>().notNull(),
  createdAt: time("created_at").defaultNow().notNull(),
});
export const deckVersions = pgTable("deck_versions", {
  id: uuid().primaryKey(),
  name: text().notNull(),
  format: text().notNull(),
  decklist: text().notNull(),
  cards: jsonb().$type<Card[]>().notNull(),
  cardData: jsonb("card_data").$type<Record<string, unknown>>().notNull(),
  createdAt: time("created_at").defaultNow().notNull(),
});
export const jobs = pgTable(
  "simulation_jobs",
  {
    id: uuid().primaryKey(),
    deckVersionId: uuid("deck_version_id")
      .references(() => deckVersions.id)
      .notNull(),
    snapshotId: uuid("snapshot_id")
      .references(() => snapshots.id)
      .notNull(),
    state: text().notNull().default("QUEUED"),
    games: integer().notNull(),
    seed: integer().notNull(),
    clockSeconds: integer("clock_seconds").notNull(),
    clientKey: text("client_key").notNull(),
    cancelRequested: boolean("cancel_requested").default(false).notNull(),
    config: jsonb().$type<Record<string, unknown>>().notNull(),
    error: text(),
    createdAt: time("created_at").defaultNow().notNull(),
    startedAt: time("started_at"),
    finishedAt: time("finished_at"),
  },
  (t) => [index("jobs_state_idx").on(t.state)],
);
export const runs = pgTable(
  "simulation_runs",
  {
    id: uuid().primaryKey(),
    jobId: uuid("job_id")
      .references(() => jobs.id)
      .notNull(),
    opponentId: text("opponent_id").notNull(),
    batchIndex: integer("batch_index").notNull(),
    seed: integer().notNull(),
    state: text().notNull().default("PENDING"),
    result: jsonb().$type<GameResult>(),
    error: text(),
    finishedAt: time("finished_at"),
  },
  (t) => [
    uniqueIndex("run_identity_idx").on(t.jobId, t.opponentId, t.batchIndex),
    index("runs_job_idx").on(t.jobId),
  ],
);
export const events = pgTable("simulation_events", {
  id: uuid().primaryKey(),
  jobId: uuid("job_id")
    .references(() => jobs.id)
    .notNull(),
  kind: text().notNull(),
  data: jsonb().notNull(),
  createdAt: time("created_at").defaultNow().notNull(),
});
