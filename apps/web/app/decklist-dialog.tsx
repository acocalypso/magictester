"use client";
import { useEffect, useRef, useState } from "react";
export type SavedDecklist = {
  name: string;
  decklist: string;
  owner: "your" | "opponent";
};
export function DecklistDialog({
  deck,
  onClose,
}: {
  deck: SavedDecklist;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => previous?.focus();
  }, []);
  function download() {
    const url = URL.createObjectURL(
      new Blob([deck.decklist], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      (deck.name
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80) || "decklist") + ".txt";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return (
    <dialog
      ref={dialog}
      className="modal panel decklist-dialog"
      aria-labelledby="saved-deck-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">
            {deck.owner === "your"
              ? "YOUR SUBMITTED DECK"
              : "SAVED OPPONENT DECK"}
          </span>
          <h2 id="saved-deck-title">{deck.name}</h2>
        </div>
        <button
          autoFocus
          className="text-button"
          aria-label="Close decklist"
          onClick={onClose}
        >
          Close ×
        </button>
      </div>
      <div className="panel-body">
        <p>
          This is the starting list saved with this test. Later deck edits and
          metagame refreshes do not change it.
        </p>
        <p className="muted">
          For BO3 games, changes made between games are shown in the individual
          game details.
        </p>
        {deck.decklist ? (
          <>
            <div className="saved-deck-actions">
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(deck.decklist);
                    setNotice("Decklist copied.");
                  } catch {
                    setNotice(
                      "Clipboard access is unavailable. Select the list below or download it as text.",
                    );
                  }
                }}
              >
                Copy decklist
              </button>
              <button className="text-button" onClick={download}>
                Download .txt ↓
              </button>
            </div>
            <p className="muted" role="status">
              {notice}
            </p>
            <pre
              className="saved-deck-text"
              tabIndex={0}
              aria-label={
                deck.owner === "your"
                  ? "Your saved decklist"
                  : "Saved opponent decklist"
              }
            >
              {deck.decklist}
            </pre>
          </>
        ) : (
          <p>No saved decklist is available for this older test.</p>
        )}
      </div>
    </dialog>
  );
}
