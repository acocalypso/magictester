import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
export class Store {
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    if (this.db.prepare("PRAGMA user_version").get().user_version > 2) {
      this.db.close();
      throw Error("This data directory requires a newer desktop application");
    }
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY,format TEXT NOT NULL,document TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,name TEXT NOT NULL,format TEXT NOT NULL,state TEXT NOT NULL,document TEXT NOT NULL,created_at TEXT NOT NULL,started_at TEXT,finished_at TEXT,error TEXT,cancel_requested INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0);
 CREATE TRIGGER IF NOT EXISTS immutable_jobs BEFORE UPDATE OF document,created_at,name,format ON jobs BEGIN SELECT RAISE(ABORT,'Saved run inputs are immutable'); END;
 CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),plan_key TEXT NOT NULL,unit_index INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'PENDING',result TEXT,error TEXT,UNIQUE(job_id,plan_key,unit_index));
 CREATE INDEX IF NOT EXISTS runs_job ON runs(job_id,state);
 CREATE TABLE IF NOT EXISTS histories(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),plan_key TEXT NOT NULL,unit_index INTEGER NOT NULL,game_index INTEGER NOT NULL,attempt_id TEXT NOT NULL,digest TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(job_id,plan_key,unit_index,game_index,attempt_id));
 CREATE TABLE IF NOT EXISTS observations(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),plan_key TEXT NOT NULL,unit_index INTEGER NOT NULL,attempt_id TEXT NOT NULL,result TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS observations_job ON observations(job_id,created_at);
 CREATE TABLE IF NOT EXISTS http_cache(url TEXT PRIMARY KEY,body TEXT NOT NULL,sha256 TEXT NOT NULL,checked_at TEXT NOT NULL,etag TEXT,last_modified TEXT);
 CREATE TABLE IF NOT EXISTS source_hosts(host TEXT PRIMARY KEY,next_at INTEGER NOT NULL DEFAULT 0);
 `);
    const columns = this.db
      .prepare("PRAGMA table_info(jobs)")
      .all()
      .map((c) => c.name);
    this.transaction(() => {
      for (const name of ["completed", "failed", "pending", "timeouts"])
        if (!columns.includes(name))
          this.db.exec(
            `ALTER TABLE jobs ADD COLUMN ${name} INTEGER NOT NULL DEFAULT 0`,
          );
      if (!columns.includes("summary_json"))
        this.db.exec(
          "ALTER TABLE jobs ADD COLUMN summary_json TEXT NOT NULL DEFAULT '{}'",
        );
      if (!columns.includes("completed"))
        this.db.exec(
          `UPDATE jobs SET completed=(SELECT count(*) FROM runs WHERE job_id=jobs.id AND state='DONE'),failed=(SELECT count(*) FROM runs WHERE job_id=jobs.id AND state='ERROR'),pending=(SELECT count(*) FROM runs WHERE job_id=jobs.id AND state='PENDING'),timeouts=(SELECT count(*) FROM runs WHERE job_id=jobs.id AND json_extract(result,'$.termination')='timeout')`,
        );
      this.db
        .exec(`UPDATE jobs SET summary_json=json_object('name',name,'format',format,'games',json_extract(document,'$.input.games'),'clockSeconds',json_extract(document,'$.input.clockSeconds'),'gameMode',json_extract(document,'$.config.gameMode'),'players',json_extract(document,'$.config.players'),'retryOf',json_extract(document,'$.config.retryOf'),'snapshotName',json_extract(document,'$.snapshot.name')) WHERE summary_json='{}';
      CREATE TRIGGER IF NOT EXISTS run_progress_insert AFTER INSERT ON runs BEGIN UPDATE jobs SET completed=completed+(NEW.state='DONE'),failed=failed+(NEW.state='ERROR'),pending=pending+(NEW.state='PENDING'),timeouts=timeouts+coalesce(json_extract(NEW.result,'$.termination')='timeout',0) WHERE id=NEW.job_id; END;
      CREATE TRIGGER IF NOT EXISTS run_progress_update AFTER UPDATE OF state,result ON runs BEGIN UPDATE jobs SET completed=completed-(OLD.state='DONE')+(NEW.state='DONE'),failed=failed-(OLD.state='ERROR')+(NEW.state='ERROR'),pending=pending-(OLD.state='PENDING')+(NEW.state='PENDING'),timeouts=timeouts-coalesce(json_extract(OLD.result,'$.termination')='timeout',0)+coalesce(json_extract(NEW.result,'$.termination')='timeout',0) WHERE id=NEW.job_id; END;
      CREATE TRIGGER IF NOT EXISTS run_progress_delete AFTER DELETE ON runs BEGIN UPDATE jobs SET completed=completed-(OLD.state='DONE'),failed=failed-(OLD.state='ERROR'),pending=pending-(OLD.state='PENDING'),timeouts=timeouts-coalesce(json_extract(OLD.result,'$.termination')='timeout',0) WHERE id=OLD.job_id; END;
      PRAGMA user_version=2;`);
    });
    this.db
      .prepare(
        `UPDATE jobs SET state=CASE WHEN cancel_requested=1 THEN 'CANCELLED' ELSE 'QUEUED' END WHERE state IN ('PREPARING','RUNNING','AGGREGATING')`,
      )
      .run();
  }
  get(sql, ...args) {
    return this.db.prepare(sql).get(...args);
  }
  all(sql, ...args) {
    return this.db.prepare(sql).all(...args);
  }
  run(sql, ...args) {
    return this.db.prepare(sql).run(...args);
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  setting(key, fallback = null) {
    const row = this.get("SELECT value FROM settings WHERE key=?", key);
    return row ? JSON.parse(row.value) : fallback;
  }
  set(key, value) {
    this.run(
      "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      key,
      JSON.stringify(value),
    );
  }
  close() {
    this.db.close();
  }
}
