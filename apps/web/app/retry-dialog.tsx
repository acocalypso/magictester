"use client";
import { useEffect, useRef, useState } from "react";
export function RetryDialog({
  job,
  onClose,
  onRetry,
}: {
  job: { name: string; state: string; clockSeconds: number; timeouts: number };
  onClose: () => void;
  onRetry: (options: {
    mode: "resume" | "new";
    clockSeconds?: number;
  }) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canResume = ["FAILED", "CANCELLED"].includes(job.state);
  const [mode, setMode] = useState<"resume" | "new">(
    canResume ? "resume" : "new",
  );
  const [clock, setClock] = useState(job.timeouts > 0 ? 300 : job.clockSeconds);
  const [sending, setSending] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal panel retry-dialog"
      aria-labelledby="retry-title"
      onCancel={(event) => {
        if (sending) event.preventDefault();
        else onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const items = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]',
          ),
        );
        const first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <div className="panel-heading">
        <h2 id="retry-title">Retry with settings</h2>
        <button
          className="text-button"
          aria-label="Close retry settings"
          disabled={sending}
          onClick={onClose}
        >
          Close ×
        </button>
      </div>
      <form
        className="panel-body"
        onSubmit={async (event) => {
          event.preventDefault();
          setSending(true);
          setError("");
          try {
            await onRetry(
              mode === "new" ? { mode, clockSeconds: clock } : { mode },
            );
          } catch (cause) {
            setError((cause as Error).message);
          } finally {
            setSending(false);
          }
        }}
      >
        <p>{job.name}</p>
        <label htmlFor="retry-mode">Retry method</label>
        <select
          autoFocus
          id="retry-mode"
          value={mode}
          disabled={sending}
          onChange={(event) => setMode(event.target.value as "resume" | "new")}
        >
          {canResume && <option value="resume">Resume unfinished games</option>}
          <option value="new">Start a new run</option>
        </select>
        <p>
          {mode === "resume"
            ? `Completed games stay unchanged. Unfinished work resumes with the original ${job.clockSeconds}-second game limit. Choose a new run to change settings.`
            : "All planned games will be played again using the saved deck, opponents, seeds and Forge build. The earlier run and its histories stay unchanged."}
        </p>
        <label htmlFor="retry-clock">Game time limit (seconds)</label>
        <input
          id="retry-clock"
          type="number"
          min={5}
          max={300}
          step={1}
          required
          value={mode === "resume" ? job.clockSeconds : clock}
          disabled={sending || mode === "resume"}
          onChange={(event) => setClock(Number(event.target.value))}
        />
        <p className="muted">
          5–300 seconds per game. Longer limits give complex Commander games
          more time to finish and increase total run time.
        </p>
        {error && (
          <p role="alert" className="error-banner">
            {error}
          </p>
        )}
        <button
          className="primary"
          disabled={
            sending ||
            (mode === "new" &&
              (!Number.isInteger(clock) || clock < 5 || clock > 300))
          }
        >
          {sending
            ? "Starting…"
            : mode === "resume"
              ? "Resume unfinished games"
              : "Start new run"}
        </button>
      </form>
    </dialog>
  );
}
