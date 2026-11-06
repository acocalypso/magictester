-- Recovery must use the same deck, pool, plan, seed schedule and engine contract.
CREATE FUNCTION reject_job_config_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.deck_version_id,NEW.snapshot_id,NEW.games,NEW.seed,NEW.clock_seconds,NEW.client_key,NEW.config,NEW.created_at)
     IS DISTINCT FROM
     (OLD.deck_version_id,OLD.snapshot_id,OLD.games,OLD.seed,OLD.clock_seconds,OLD.client_key,OLD.config,OLD.created_at)
  THEN RAISE EXCEPTION 'Immutable job configuration: submit a new job instead'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER immutable_job_config BEFORE UPDATE ON simulation_jobs FOR EACH ROW EXECUTE FUNCTION reject_job_config_change();
