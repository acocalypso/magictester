CREATE TABLE game_action_histories (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES simulation_jobs(id),
  opponent_id text NOT NULL,
  unit_index integer NOT NULL CHECK (unit_index >= 0),
  game_index integer NOT NULL CHECK (game_index >= 0),
  attempt_id text NOT NULL,
  digest text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT game_action_histories_identity_idx UNIQUE(job_id, opponent_id, unit_index, game_index, attempt_id)
);
