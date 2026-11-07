export const setupStages = [
  ["release", "Find the latest stable engine"],
  ["download", "Download Forge"],
  ["verify", "Verify the engine download"],
  ["extract", "Extract engine files"],
  ["cards", "Download card data"],
  ["metadata", "Prepare card compatibility data"],
  ["bridge", "Prepare the simulation engine"],
  ["validation", "Check rules and play validation games"],
  ["ready", "Ready to test decks"],
];
const events = {
  checking_release: "release", downloading_forge: "download", using_cached_forge: "download",
  verifying_forge: "verify", extracting_forge: "extract", extraction_progress: "extract", forge_extracted: "extract",
  downloading_scryfall: "cards", using_cached_cards: "cards", cards_cached: "metadata", card_aliases_cached: "metadata",
  reading_forge_card_names: "metadata", reading_forge_card_rules: "metadata", forge_metadata_cached: "metadata",
  compiling_forge_bridge: "bridge", forge_bridge_compiled: "bridge", bootstrap_complete: "bridge",
  validation_progress: "validation", validating_engine: "validation", setup_complete: "ready",
};
export class SetupProgress {
  constructor(publish = () => {}) { this.publish = publish; this.generation = 0; this.state = { status: "idle", generation: 0, revision: 0, stage: "release", message: "Set up your local testing engine", stages: setupStages.map(([id, title]) => ({ id, title, status: "pending" })) }; }
  snapshot() { return structuredClone(this.state); }
  begin() { this.state = { status: "running", generation: ++this.generation, revision: 0, stage: "release", message: "Checking the latest stable Forge release…", startedAt: new Date().toISOString(), stages: setupStages.map(([id, title]) => ({ id, title, status: "pending" })) }; this.update("release", {}); }
  changed() { this.state.revision++; this.publish(this.snapshot()); }
  update(stage, detail) {
    const index = setupStages.findIndex(([id]) => id === stage);
    const previous = setupStages.findIndex(([id]) => id === this.state.stage);
    // Late progress from a finished subprocess must not move the assistant back.
    if (this.state.status !== "running" || index < previous) return;
    const same = stage === this.state.stage;
    this.state = { ...this.state, stage, stageIndex: index, stageCount: setupStages.length,
      message: detail.message || (same ? this.state.message : setupStages[index][1]),
      bytes: detail.bytes ?? null, totalBytes: detail.totalBytes ?? null,
      completed: detail.completed ?? null, total: detail.total ?? null,
      bytesPerSecond: detail.bytesPerSecond ?? null,
      fraction: detail.fraction ?? null,
      stages: setupStages.map(([id, title], n) => ({ id, title, status: n < index ? "complete" : n === index ? "running" : "pending" })),
    };
    this.changed();
  }
  event(payload) {
    let stage = events[payload.event];
    if (payload.event === "download_progress") stage = payload.target === "forge" ? "download" : "cards";
    if (!stage) return;
    const detail = { ...payload };
    const friendly = { reading_forge_card_names: "Checking supported card names…", reading_forge_card_rules: "Preparing Commander and card compatibility rules…", forge_metadata_cached: "Card compatibility data is ready.", card_aliases_cached: "Alternate card names are ready.", compiling_forge_bridge: "Preparing local simulation support…", forge_bridge_compiled: "Simulation support is ready.", bootstrap_complete: "Engine files are prepared. Starting validation…", forge_extracted: "Engine files are extracted." };
    if (friendly[payload.event]) detail.message = friendly[payload.event];
    if (payload.bytes !== undefined && payload.totalBytes > 0)
      detail.fraction = Math.min(payload.complete ? 1 : 0.99, payload.bytes / payload.totalBytes);
    if (payload.completed !== undefined && payload.total > 0) detail.fraction = payload.completed / payload.total;
    if (["forge_extracted", "forge_bridge_compiled", "forge_metadata_cached"].includes(payload.event)) detail.fraction = 1;
    this.update(stage, detail);
  }
  finish(status, message) {
    this.state.status = status;
    this.state.message = message;
    if (status === "complete") { this.state.stage = "ready"; this.state.stageIndex = setupStages.length - 1; this.state.fraction = 1; this.state.stages = setupStages.map(([id, title]) => ({ id, title, status: "complete" })); }
    this.changed();
  }
}

// Fetch may transparently decode HTTP compression, so Content-Length is only
// an honest denominator for an unencoded response body.
export function monitorDownload(response, target, emit, now = () => performance.now()) {
  const encoding = response.headers.get("content-encoding");
  const length = Number(response.headers.get("content-length"));
  const totalBytes = (!encoding || encoding === "identity") && length > 0 ? length : null;
  let bytes = 0, last = 0;
  const started = now();
  const report = (complete = false) => { const elapsed = now() - started; if (!complete && bytes && elapsed - last < 250) return; last = elapsed;
    emit({ event: "download_progress", target, bytes, totalBytes, bytesPerSecond: elapsed > 0 ? Math.round(bytes * 1000 / elapsed) : null, complete,
      message: target === "forge" ? "Downloading the Forge engine…" : "Downloading current card data…" }); };
  report();
  return new Response(response.body.pipeThrough(new TransformStream({ transform(chunk, controller) { bytes += chunk.byteLength; report(); controller.enqueue(chunk); }, flush() { report(true); } })), { status: response.status, headers: response.headers });
}
