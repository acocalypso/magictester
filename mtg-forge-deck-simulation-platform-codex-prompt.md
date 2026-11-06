# Master Implementation Prompt — MTG Deck Simulation & Meta Benchmark Platform

## Role and Execution Mode

You are the principal engineer for this project.

Build a production-quality, Docker-hosted web application that allows users to paste a **Magic: The Gathering** decklist, select a format, queue a large simulation job, and benchmark that deck against a current metagame snapshot using **real game simulations**.

The primary rules engine should be **Forge / Card-Forge**.

Do not stop at planning, architecture diagrams, or scaffolding.

Work iteratively:

```text
inspect
→ research
→ design
→ implement
→ run
→ test
→ fix
→ document
```

After every meaningful milestone:

- build/compile the affected services,
- run automated tests,
- start the relevant Docker services,
- verify health checks,
- run a real end-to-end scenario,
- inspect logs,
- fix obvious failures before moving on.

Successful compilation alone is not sufficient validation.

---

# Product Goal

A user should eventually be able to:

```text
Open the website
        ↓
Paste a decklist
        ↓
Choose a format
        ↓
Validate the deck
        ↓
Choose simulation depth / benchmark pool
        ↓
Queue the analysis
        ↓
Watch live progress
        ↓
Review overall and matchup-specific results
```

The application should support, or be architected to support:

```text
Standard
Pioneer
Modern
Pauper
Legacy
Vintage
Commander
cEDH
Duel Commander
```

The central value proposition is:

> **Use a real MTG rules engine to repeatedly play the submitted deck against representative current meta decks and provide useful statistical analysis.**

Do not substitute random-number simulations, goldfish-only calculations, or fabricated matchup results for actual engine games.

---

# Research-Backed Forge Facts to Verify Before Coding

Before implementing the main architecture, verify these facts against the **current** Forge source/documentation.

As of the research performed for this project, Forge provides a headless command-line simulation mode intended for AI-vs-AI testing.

The documented pattern is conceptually:

```bash
java -jar forge.jar sim ...
```

The Forge AI documentation currently describes options such as:

```text
-d   deck names/files
-D   deck directory
-n   number of games
-f   game type / format path
-t   tournament mode
-p   player count
-q   quiet output
-c   per-match timeout / clock
```

The documentation also demonstrates multiplayer Commander simulations.

Relevant current sources to re-check:

```text
https://github.com/Card-Forge/forge
https://github.com/Card-Forge/forge/wiki/AI
https://github.com/Card-Forge/forge/blob/master/docs/AI.md
```

Do not blindly hard-code commands from this prompt.

**Inspect the current Forge version and verify the real flags and output format first.**

---

# Important Forge AI Limitation

Forge's own documentation explicitly warns that its AI is heuristic and has meaningful strategic weaknesses.

It is currently described as roughly:

```text
best with aggro / midrange
weaker with control
poor with many combo decks
```

This matters enormously.

Therefore:

- do not present simulated win rates as objective tournament truth,
- store the Forge version used,
- expose a clear "simulation model limitations" note in the UI,
- track deck/archetype categories where AI quality may be weak,
- do not claim a combo/control deck is bad merely because Forge AI pilots it poorly,
- make room for future improved AI engines/adapters.

The application measures:

> **performance under the configured Forge AI simulation environment**

not absolute human competitive win rate.

This limitation must be visible in documentation and the results UI.

---

# First Mandatory Technical Spike

Before building the full web application, prove that Forge can actually be automated in the required environment.

Create the smallest possible real test:

```text
Deck A
+
Deck B
↓
Forge
↓
real AI-vs-AI game
↓
structured result
```

Minimum structured output:

```json
{
  "engine": "forge",
  "engineVersion": "...",
  "seed": 12345,
  "players": [
    { "id": "deck-a", "placement": 1 },
    { "id": "deck-b", "placement": 2 }
  ],
  "winner": "deck-a",
  "turns": 9,
  "durationMs": 1280,
  "termination": "normal"
}
```

This spike must run:

```text
headlessly
inside Linux
inside Docker or a Docker-compatible runner environment
```

before large amounts of frontend/backend code are created.

If the current Forge CLI cannot expose a required value, investigate:

1. current Forge source,
2. public/internal game event hooks,
3. a minimal maintained Forge integration layer,
4. structured log/event instrumentation.

Do not guess.

---

# Engine Adapter Architecture

Forge must be isolated behind an engine interface.

Conceptually:

```text
CardGameEngine
        │
        └── ForgeEngineAdapter
```

The rest of the system should not know Forge CLI details.

Suggested responsibilities:

```text
getCapabilities()
getEngineVersion()
validateDeck()
prepareDeck()
runGame()
runMatch()
runMultiplayerGame()
cancelGame()
parseResult()
```

Use actual project naming conventions.

The interface should support future engines without rewriting:

```text
queue
API
database
frontend
analytics
```

---

# Forge Process Isolation

Prefer running Forge in a separate process/service instead of embedding Forge classes directly into the Node.js API.

Reasons:

```text
resource isolation
timeouts
crash isolation
Java lifecycle
GPL boundary clarity
parallel worker control
easier upgrades
```

A likely architecture is:

```text
Simulation Worker
      ↓
Forge Runner
      ↓
Forge process
```

The Forge runner may:

```text
spawn short-lived Forge processes
or
maintain controlled long-lived worker processes
```

Choose only after measuring startup cost, memory use, reliability, and supported APIs.

Do not assume persistent JVM reuse is automatically better.

---

# Licensing Review

Forge is currently distributed under **GPL-3.0**.

Before distributing Forge inside your own Docker images or shipping modified Forge code:

- inspect the exact current license,
- document the obligations,
- keep Forge source/modifications trackable,
- include required notices/source availability when applicable,
- keep proprietary application code separated where practical.

Do not make unsupported legal claims.

Create:

```text
docs/LICENSING.md
THIRD_PARTY.md
```

and document the actual implementation boundary.

---

# Recommended System Architecture

Use a multi-service Docker architecture.

Preferred baseline:

```text
Browser
   ↓
Web Frontend
   ↓
API
   ↓
PostgreSQL
   ↓
Redis / BullMQ
   ↓
Simulation Workers
   ↓
Forge Runner
   ↓
Forge
```

The web/API process must NOT execute expensive simulations directly.

Use separate worker processes.

---

# Preferred Technology Stack

Unless the repository already contains a suitable stack, use:

## Frontend

```text
Next.js
React
TypeScript
Tailwind CSS
```

## API

```text
Node.js
TypeScript
NestJS
```

or another strongly structured TypeScript backend if there is a concrete reason.

## Queue

```text
Redis
BullMQ
```

## Database

```text
PostgreSQL
```

## Database Access

Use a mature migration-capable ORM such as:

```text
Prisma
Drizzle
TypeORM
```

Select one and remain consistent.

## Rules Engine

```text
Java
Forge / Card-Forge
```

---

# Docker Requirements

Everything must run through Docker Compose.

The local development experience should be approximately:

```bash
docker compose up --build
```

Provide:

```text
docker-compose.yml
docker-compose.override.yml where useful
.env.example
README.md
```

Every long-running service should provide:

```text
health check
structured logs
restart policy
environment configuration
graceful shutdown
```

Persist:

```text
PostgreSQL data
Redis where persistence is needed
meta snapshots
simulation results
```

Do not commit secrets.

---

# Repository Structure

Use a monorepo unless existing repository structure suggests otherwise.

Example:

```text
/
├── apps/
│   ├── web/
│   ├── api/
│   └── worker/
├── services/
│   └── forge-runner/
├── packages/
│   ├── shared-types/
│   ├── mtg-domain/
│   └── analytics/
├── infra/
│   └── docker/
├── docs/
├── docker-compose.yml
├── .env.example
└── README.md
```

Do not force this exact structure if another layout is cleaner.

---

# Main Web Interface

The first screen should be extremely simple.

The user should provide:

```text
Decklist
Format
Benchmark / meta snapshot
Simulation depth
Game mode where relevant
```

Primary action:

```text
Analyze Deck
```

---

# Decklist Input

Support common pasted formats such as:

```text
4 Lightning Bolt
4 Monastery Swiftspear
20 Mountain
```

Also support variants such as:

```text
4x Lightning Bolt
```

Handle common sections:

```text
Deck
Mainboard
Sideboard
Commander
Companion
Maybeboard
```

Ignore purely decorative whitespace.

Do not silently ignore malformed lines.

Show useful parsing errors with line numbers where possible.

---

# Deck Parser

Create a dedicated parser.

Parsed card model should contain at least:

```text
name
quantity
section
normalizedName
```

Potential normalized sections:

```text
MAINBOARD
SIDEBOARD
COMMANDER
COMPANION
MAYBEBOARD
```

Do not make the parser depend directly on frontend components.

Add comprehensive tests.

---

# Supported Formats

Create centralized format definitions.

Prepare support for:

```text
Standard
Pioneer
Modern
Pauper
Legacy
Vintage
Commander
cEDH
Duel Commander
```

Each format definition should describe relevant rules such as:

```text
minimum deck size
maximum deck size if applicable
sideboard limit
singleton
commander rules
color identity
banned list
restricted list
game mode
player count
```

Do not scatter format constants throughout the codebase.

---

# Deck Validation

Before a simulation job can be submitted:

1. parse deck,
2. normalize card names,
3. detect unknown cards,
4. validate quantities,
5. validate deck size,
6. validate sideboard,
7. validate format legality,
8. validate banned/restricted cards,
9. validate Commander singleton rules,
10. validate Commander color identity,
11. validate Commander/partner configuration,
12. validate that Forge supports the required cards/game mode where detectable.

Return structured validation errors.

Example:

```json
{
  "valid": false,
  "errors": [
    {
      "code": "CARD_NOT_LEGAL",
      "card": "Example Card",
      "message": "Example Card is not legal in Modern."
    }
  ]
}
```

---

# Card Data Source

Investigate whether Forge's local card database can be authoritative enough for:

```text
name normalization
card existence
format legality
color identity
```

Where external metadata is useful, use a provider abstraction.

Scryfall is a reasonable candidate for metadata.

Current Scryfall guidance should be respected:

```text
keep API traffic under its documented limits
use a meaningful User-Agent
use HTTPS
use bulk data for large-scale datasets
avoid repeated redundant requests
```

For full-card datasets, prefer cached bulk data instead of thousands of individual card requests.

Create:

```text
CardDataProvider
```

with local caching.

---

# Meta Deck System

The platform needs current benchmark opponents.

Meta acquisition must be independent from simulation.

Create an interface such as:

```text
MetaDeckProvider
```

Potential adapters:

```text
ManualImportProvider
JsonImportProvider
CsvImportProvider
TournamentProvider
PublicMetagameProvider
CachedSnapshotProvider
```

The simulation layer should consume normalized snapshots only.

---

# Current Meta Sources — Research, Do Not Hard-Code Assumptions

Current public websites demonstrate that useful meta information exists.

Examples observed during project research include:

```text
MTGGoldfish
MTGTop8
EDHTop16
```

At the time of research:

- MTGGoldfish exposes format metagame breakdowns and recent decklists.
- MTGTop8 exposes format/event metagame breakdowns.
- EDHTop16 exposes cEDH tournament/metagame information including popularity and tournament statistics.

These are **research references, not automatic permission to scrape**.

Before building any importer:

1. check for a documented API/feed,
2. check current Terms of Service,
3. check robots rules where applicable,
4. avoid anti-bot bypasses,
5. avoid login bypasses,
6. use conservative request rates,
7. cache imported data.

If automated access is not clearly appropriate, use manual/JSON/CSV imports.

The product must function without scraping third-party sites.

---

# What “Top 50 Decks” Means

Do not naively select the latest 50 individual lists.

Define benchmark selection deliberately.

For constructed formats, “Top 50” should mean:

> Up to 50 representative current decks/archetypes selected from the chosen metagame snapshot according to a documented ranking/sampling methodology.

Possible sources of ranking:

```text
meta share
event results
recency
number of appearances
tournament placement
combined ranking score
```

Store the exact selection method.

---

# Archetype Deduplication

Do not accidentally test:

```text
20 almost-identical copies of the same tier-1 list
```

while excluding important archetypes.

Normalize/categorize lists by archetype where credible source data exists.

Allow benchmark modes such as:

```text
Top Archetypes
Top Individual Lists
Meta-Share Weighted Sample
Equal Archetype Weight
Custom Pool
```

Make weighting transparent.

---

# Meta Snapshot

All imported meta data must be immutable/versioned once used.

Create:

```text
MetaSnapshot
```

Suggested fields:

```text
id
format
name
createdAt
source
sourceDateFrom
sourceDateTo
selectionMethod
deckCount
metadata
```

Example UI:

```text
Modern Meta Snapshot
2026-11-06
50 decks
Last 30 days
```

Every simulation job references exactly one snapshot.

Do not mutate historical snapshots.

---

# Meta Deck Model

Each meta deck should store:

```text
id
snapshotId
format
archetype
deckName
decklist
mainboard
sideboard
commander
source
sourceUrl
eventName
eventDate
placement
metaShare
rankingScore
importedAt
```

Fields that are unavailable should be null.

Never invent missing statistics.

---

# Simulation Job Configuration

A user creates a benchmark with:

```text
submitted deck
format
meta snapshot
simulation depth
benchmark mode
game mode
play/draw strategy
```

Optional advanced controls:

```text
random seed
max per-game duration
specific archetypes
```

Do not expose dangerous server-level controls to normal users.

---

# Simulation Presets

Provide presets such as:

```text
Quick   = 50 games
Normal  = 250 games
Deep    = 1000 games
Custom
```

The UI must explain how games are distributed.

Example:

```text
50 opponents × 20 games = 1000 simulations
```

---

# Queue System

Use Redis/BullMQ.

Simulation job states:

```text
QUEUED
PREPARING
RUNNING
AGGREGATING
COMPLETED
FAILED
CANCELLED
```

Store:

```text
job id
requested games
completed games
failed games
current matchup
progress
created at
started at
finished at
error summary
```

---

# Queue Page

Create a dedicated Queue screen.

Show:

```text
queued jobs
currently running jobs
completed jobs
failed jobs
```

Each job row should show:

```text
deck name
format
meta snapshot
games
progress
state
created time
```

Allow:

```text
cancel queued job
cancel running job safely
open completed results
retry failed job where appropriate
```

---

# Concurrency and Backpressure

Worker concurrency must be configurable.

Example:

```text
SIMULATION_CONCURRENCY=4
MAX_FORGE_PROCESSES=4
MAX_GAMES_PER_JOB=5000
MAX_JOB_RUNTIME_SECONDS=21600
```

Never start unbounded JVMs/processes.

Do not allow:

```text
100 users × 1000 requested games
```

to spawn uncontrolled concurrent processes.

Implement:

```text
global concurrency
per-job concurrency
queue limits
rate limits for job creation
```

---

# Per-Game Timeout

Forge's simulation CLI currently documents a match clock/timeout option.

Use the real supported mechanism after verification.

Every simulation must have a maximum allowed runtime.

A stuck game must:

```text
terminate
produce timeout status
release resources
allow worker to continue
```

Do not permit one pathological game to block a worker forever.

---

# Forge Crash Handling

Forge crashes must not crash the whole application.

Capture:

```text
exit code
stderr
stdout
timeout
signal
```

Map these into structured errors.

Retry only transient failures.

No infinite retry loops.

---

# Reproducibility

Use explicit seeds where supported.

Store per simulation:

```text
gameId
seed
engine
engineVersion
format
deckSnapshot
opponentSnapshot(s)
metaSnapshotId
configuration
result
```

If Forge cannot accept a stable seed through its supported interface:

document that limitation.

Do not pretend deterministic replay is supported if it is not.

---

# Constructed 1v1 Simulation

For:

```text
Standard
Pioneer
Modern
Pauper
Legacy
Vintage
Duel Commander
```

initially simulate:

```text
AI vs AI
Best of One
```

This is the first production MVP.

---

# Play / Draw Fairness

Balance who goes first.

Default:

```text
50% submitted deck on play
50% submitted deck on draw
```

where Forge allows this to be controlled reliably.

Track separately:

```text
onPlayGames
onPlayWins
onDrawGames
onDrawWins
```

If Forge does not expose/control starting player reliably, document the limitation.

---

# Best of Three

Add later after BO1 is stable.

For BO3 report separately:

```text
Game Win Rate
Match Win Rate
```

Investigate Forge sideboarding AI before claiming realistic BO3 performance.

If Forge AI sideboarding is weak or unavailable, say so clearly.

Do not fake intelligent sideboarding.

---

# Commander / cEDH Architecture

Commander must not be treated as ordinary 1v1.

Standard benchmark:

```text
Submitted Deck
vs
Opponent A
vs
Opponent B
vs
Opponent C
```

Forge currently documents multiplayer Commander command-line simulation, but verify the actual current behavior before relying on it.

---

# Commander Pod Generation

Create a pod-generation strategy.

Possible modes:

```text
Meta-share weighted
Equal archetype
Random from snapshot
Fixed benchmark pod
User-selected opponents
```

Store the exact opponents for every game.

---

# cEDH

Treat cEDH separately from casual Commander.

For cEDH, use:

```text
competitive tournament-derived snapshots
```

where legally and technically available.

Research references include EDHTop16, which currently exposes cEDH metagame and tournament data.

Do not assume automated ingestion rights.

---

# Casual Commander

Do not label a casual Commander pool as "the top 50 meta".

Casual Commander has no single authoritative competitive metagame.

Use terminology such as:

```text
Curated Benchmark Pool
Popularity Sample
Community Benchmark Pool
Custom Opponent Pool
```

---

# Commander Metrics

Capture these where real engine events support them:

```text
win rate
placement distribution
average placement
game duration
turn count
first commander cast turn
commander cast count
commander recast count
mulligans
elimination order
```

Potentially useful later:

```text
commander damage
combo turn
cards drawn
mana development
interaction count
```

Do not implement metrics that cannot be measured reliably.

---

# Commander Cast Timing

This is an explicit product requirement.

If the Forge event system permits it, record per player:

```text
firstCommanderCastTurn
commanderCastCount
commanderRecastCount
```

Aggregate:

```text
average first cast turn
median first cast turn
turn distribution
percentage of games commander was cast
average commander casts
```

If this requires Forge instrumentation, isolate the patch cleanly and document it.

Do not scrape human-readable logs if a reliable structured event hook exists.

---

# Commander Placement

Commander results must support:

```text
1st
2nd
3rd
4th
draw / unresolved
```

Track:

```text
wins
top2
averagePlacement
placementDistribution
```

Do not force multiplayer results into a binary win/loss schema.

---

# Draws

Draws must be first-class results.

Possible causes:

```text
game rules
timeout
engine resolution
mutual draw
```

Distinguish:

```text
RULE_DRAW
TIMEOUT
ENGINE_ERROR
```

Do not count timeouts as normal draws unless benchmark methodology explicitly says so.

---

# Core Analytics

For constructed formats, report:

```text
Overall Win Rate
Games
Wins
Losses
Draws
95% Confidence Interval
Average Game Length
Median Game Length
Win Rate on Play
Win Rate on Draw
```

Where supported:

```text
Mulligan Rate
Average Mulligans
Cards Drawn
Cards Cast
```

---

# Matchup Matrix

For each opponent/archetype show:

| Opponent | Games | Wins | Losses | Draws | Win Rate |
|---|---:|---:|---:|---:|---:|

Support sorting by:

```text
win rate
games
meta share
best matchup
worst matchup
archetype
```

---

# Results Summary

The top section should answer:

```text
How did my deck perform?
```

Example:

```text
Overall Win Rate: 57.8%
95% CI: 54.7–60.8%
Games: 1000
Record: 578–417–5
```

Also show:

```text
Best Matchups
Worst Matchups
Most Common Opponents
AI Reliability Warning where relevant
```

---

# Confidence and Sample Size

Never show win rate without sample size.

Use an appropriate binomial confidence interval such as Wilson score.

For small samples display:

```text
Low confidence — only 8 games
```

---

# Forge AI Reliability Indicator

Because Forge AI strength differs by deck strategy, allow decks/archetypes to be tagged:

```text
AGGRO
MIDRANGE
CONTROL
COMBO
UNKNOWN
```

Do not pretend this classification proves AI competence.

Use it to display warnings such as:

```text
Forge's heuristic AI may underperform with complex combo decks.
Interpret this matchup cautiously.
```

Do not artificially alter results to compensate.

---

# Mana Screw / Flood Metrics

If implementing mana quality analytics, clearly define heuristics.

Do not display vague pseudo-scientific percentages.

Possible signals include:

```text
mana sources seen by turn N
castable spells
mana available vs expected
```

Label these values:

```text
heuristic
```

Document formulas.

---

# Game Result Schema

Create normalized structured results.

Minimum example:

```json
{
  "gameId": "uuid",
  "seed": 12345,
  "format": "modern",
  "durationMs": 1280,
  "turns": 9,
  "termination": "normal",
  "players": [
    {
      "seat": 1,
      "deckId": "submitted",
      "placement": 1,
      "mulligans": 1
    },
    {
      "seat": 2,
      "deckId": "opponent",
      "placement": 2,
      "mulligans": 0
    }
  ]
}
```

Commander extension:

```json
{
  "firstCommanderCastTurn": 3,
  "commanderCastCount": 2
}
```

Only include authoritative values.

---

# Raw Logs

Do not persist full verbose Forge logs for every game by default.

Store:

```text
normalized result
important events
error summary
```

Optionally retain compressed raw logs for:

```text
failed games
debug mode
sampled games
```

Set retention rules.

---

# Database Model

Create entities for at least:

```text
Deck
DeckVersion
DeckCard
Format
MetaSnapshot
MetaDeck
SimulationJob
SimulationMatchup
SimulationRun
AggregatedResult
EngineVersion
```

Potentially:

```text
SimulationEvent
ImportJob
```

Use snapshots/versioning so historical benchmarks remain reproducible.

---

# Submitted Deck Versioning

If a user edits a deck later, old results must remain tied to the exact original list.

Create immutable:

```text
DeckVersion
```

for simulation jobs.

---

# API Design

Use a versioned API.

Conceptual routes:

```text
POST /api/v1/decks/validate
POST /api/v1/decks
GET  /api/v1/formats

GET  /api/v1/meta/:format
GET  /api/v1/meta/:format/snapshots

POST /api/v1/simulations
GET  /api/v1/simulations
GET  /api/v1/simulations/:id
POST /api/v1/simulations/:id/cancel
POST /api/v1/simulations/:id/retry

GET  /api/v1/simulations/:id/results
GET  /api/v1/simulations/:id/matchups
GET  /api/v1/simulations/:id/runs
```

Generate OpenAPI/Swagger documentation.

---

# Live Progress

Use a simple reliable mechanism.

Preferred order:

```text
Server-Sent Events
WebSocket
reasonable polling
```

Show:

```text
427 / 1000 games complete
42.7%
Current matchup: Izzet Prowess
Workers active: 4
```

Do not fake ETA until enough real performance data exists.

---

# Cancellation

Users must be able to cancel:

```text
queued job
running job
```

Cancellation must:

```text
stop new games
terminate active Forge process safely where possible
persist completed results
mark job CANCELLED
release worker resources
```

---

# Restart / Recovery

If the worker/container restarts:

- completed simulation runs remain persisted,
- the system detects incomplete work,
- jobs resume safely or become explicitly recoverable/failed,
- duplicate runs are avoided through idempotency keys.

Every planned simulation run should have a stable identifier.

A retry must not count the same completed game twice.

---

# File and Process Safety

Decklists are untrusted input.

Never construct unsafe shell strings from user input.

Use:

```text
argument arrays
safe temporary directories
generated internal filenames
strict path normalization
```

Do not use raw deck names as filesystem paths.

Prevent path traversal.

---

# API Security

For an initial private/local deployment authentication may be optional, but architect for future auth.

At minimum implement:

```text
request validation
body-size limits
rate limits
CORS configuration
secure error responses
```

Do not expose internal stack traces in production.

---

# Simulation Abuse Protection

Set configurable limits:

```text
MAX_DECKLIST_BYTES
MAX_GAMES_PER_JOB
MAX_ACTIVE_JOBS_PER_CLIENT
MAX_JOB_RUNTIME
MAX_FORGE_PROCESSES
```

Do not allow one request to exhaust the server.

---

# UI Pages

Create at minimum:

## New Analysis

```text
Format
Decklist
Simulation preset
Meta snapshot
Benchmark mode
Start
```

## Queue

```text
Queued
Running
Completed
Failed
Cancelled
```

## Results

```text
Overall
Matchups
Performance
Game Length
Play/Draw
Commander metrics when applicable
```

## Meta Snapshot Browser

```text
format
snapshot date
source
deck count
archetypes
```

## Run Details

```text
seed
opponent(s)
winner
placement
turn count
duration
termination reason
```

---

# UX Requirements

Use a clean analytics-oriented interface.

Prioritize:

```text
readability
clear progress
clear errors
easy deck paste
useful tables
responsive charts
mobile compatibility
```

Dark mode is appropriate.

---

# Charts

Useful visualizations:

```text
overall win rate
matchup win-rate bar chart
placement distribution
commander cast-turn distribution
game-length distribution
play vs draw
```

Always include numeric values.

Charts must not hide sample size.

---

# Meta Import Administration

Create an admin/development import flow.

Support:

```text
JSON
CSV
```

before building fragile automatic scrapers.

Validate imported:

```text
format
archetype
deck list
date
source
```

Reject invalid decks.

---

# Meta Refresh Jobs

If automatic providers are eventually implemented:

```text
scheduler
      ↓
fetch
      ↓
normalize
      ↓
validate
      ↓
create new immutable snapshot
```

Never mutate the previous snapshot in place.

Display snapshot age and freshness warnings.

---

# Forge Deck Conversion

Create one isolated component responsible for translating normalized internal decks into the exact format Forge expects.

Conceptually:

```text
ForgeDeckSerializer
```

Test:

```text
mainboard
sideboard
commander
partners
companion
```

Do not scatter Forge deck formatting throughout the worker.

---

# Forge Result Parser

Create:

```text
ForgeResultParser
```

Do not parse Forge text output inside general queue logic.

Test against:

```text
normal win
draw
timeout
multiplayer
invalid deck
Forge crash
```

Prefer structured Forge integration if available.

---

# Forge Instrumentation

If commander timing, mulligans, or other metrics require code-level Forge events:

- inspect Forge event architecture,
- implement the smallest clean integration,
- keep changes isolated,
- maintain a documented patch/fork,
- add tests,
- track upstream Forge commit/version.

Create:

```text
docs/FORGE_INTEGRATION.md
```

Document:

```text
what is upstream
what is custom
why it is needed
how to update Forge
```

---

# Performance Benchmarking

After correctness is established, measure:

```text
Forge JVM startup time
games per minute
CPU usage
memory per Forge process
worker throughput
database write load
queue overhead
```

Create repeatable scenarios:

```text
100 Modern BO1 games
100 Pauper BO1 games
50 Commander four-player games
```

Do not optimize based on guesses.

---

# Statistical Aggregation

Create a dedicated analytics module.

Do not calculate statistics ad hoc in React components.

Input:

```text
SimulationRun[]
```

Output:

```text
overall summary
per-matchup summary
confidence intervals
play/draw summary
Commander placement
Commander timing
game length
```

Aggregates must be rebuildable from stored normalized run results.

Add deterministic tests with known datasets.

---

# Testing Strategy

## Unit Tests

Cover:

```text
deck parser
deck normalizer
format validation
meta snapshot normalization
Forge deck serialization
Forge result parsing
job planning
statistics
confidence intervals
Commander placements
Commander timing
```

## Queue Tests

Cover:

```text
enqueue
reserve
progress
completion
failure
retry
cancellation
idempotency
```

## API Tests

Cover:

```text
deck validation
simulation creation
invalid requests
job status
cancellation
results
```

## Forge Integration Test

At least one real test:

```text
load Deck A
load Deck B
run Forge
game finishes
winner/draw returned
turn count returned where available
structured result created
```

## Docker Smoke Test

From a clean environment:

```bash
docker compose up --build
```

Then verify:

```text
web
API
PostgreSQL
Redis
worker
Forge runner
one complete simulation job
```

---

# CI

Create CI that runs:

```text
lint
typecheck
unit tests
API tests
Docker build
```

Run Forge integration tests where practical.

If Forge integration is too heavy for every commit:

```text
normal CI
+
scheduled/manual Forge integration CI
```

Document the distinction.

---

# Observability

Use structured logs.

Include contextual IDs:

```text
jobId
runId
matchupId
engineVersion
```

Avoid per-action spam.

Provide health/readiness endpoints for:

```text
web
api
worker
forge runner
database
redis
```

Prepare operational metrics such as:

```text
queue depth
active jobs
games completed
games failed
Forge crashes
average game duration
worker throughput
```

Prometheus can be added later and must not block MVP.

---

# Legal / Trademark Presentation

This is an independent application.

Do not imply official affiliation with Wizards of the Coast.

Document third-party components and licenses.

Verify final trademark/disclaimer wording before public release.

Do not bundle copyrighted card artwork unnecessarily.

Card images are not required for the simulation MVP.

---

# Documentation

Create at minimum:

```text
README.md
docs/ARCHITECTURE.md
docs/FORGE_INTEGRATION.md
docs/META_DATA.md
docs/SIMULATION_MODEL.md
docs/STATISTICS.md
docs/DEPLOYMENT.md
docs/LICENSING.md
THIRD_PARTY.md
```

`SIMULATION_MODEL.md` must explicitly document:

```text
Forge AI limitations
benchmark methodology
opponent weighting
play/draw handling
game timeout
draw handling
Commander pod generation
sample sizes
confidence intervals
metrics available/unavailable
```

---

# MVP Scope

The first real MVP should focus on **one constructed format first**.

Recommended candidates:

```text
Modern
Pauper
```

Choose based on easiest verified meta import and Forge compatibility.

MVP:

```text
paste deck
validate deck
select one format
select fixed imported meta snapshot
queue simulations
run real Forge AI-vs-AI games
show progress
store results
show overall win rate
show per-matchup win rate
show play/draw if available
```

Do NOT start by supporting every format simultaneously.

---

# MVP Acceptance Criteria

The MVP is complete only when:

1. `docker compose up --build` starts the stack.
2. Web UI loads.
3. User can paste a deck.
4. Deck is parsed and validated.
5. One constructed format works end-to-end.
6. A real meta snapshot can be imported.
7. User can create a simulation job.
8. Job appears in the queue.
9. Worker claims the job.
10. Forge executes real games.
11. Multiple opponent decks work.
12. Progress is visible.
13. Results persist in PostgreSQL.
14. Overall win rate is displayed.
15. Per-opponent/archetype results are displayed.
16. Failed games are separately counted.
17. Container restart does not remove completed results.
18. A stuck Forge game cannot hang the system.
19. Forge AI limitations are visible.
20. Automated tests pass.

---

# Commander Milestone

Only begin Commander after the 1v1 MVP is stable.

Commander milestone requires:

```text
four-player Forge simulation
submitted Commander deck
three benchmark opponents
pod generator
multiplayer result parsing
placement
turn count
draw handling
```

Then instrument where supported:

```text
first Commander cast turn
Commander cast count
Commander recast count
mulligans
elimination order
```

---

# Commander Acceptance Criteria

A benchmark can run multiple real four-player games.

For each game store:

```text
four deck IDs
seat order
winner / draw
placements
turn count
duration
termination
```

Where technically verified:

```text
first commander cast turn
commander cast count
```

Results show:

```text
Win Rate
Placement Distribution
Average Placement
Average Game Length
Average End Turn
Average First Commander Cast Turn
Median First Commander Cast Turn
Commander Cast Frequency
```

Unavailable metrics must be explicitly marked unavailable.

---

# Advanced Features — Defer Until Core Works

Do not block MVP on:

```text
user accounts
social features
public leaderboards
deck recommendations
AI-generated deck improvements
interactive replays
full game-state visualization
cloud autoscaling
Kubernetes
billing
premium tiers
mobile apps
```

Prepare extension points, but finish the core first.

---

# Non-Goals

This application is not initially:

```text
a full MTG client
a human multiplayer client
a replacement rules engine
a deck marketplace
a collection manager
a card-price tracker
```

Forge handles rules/game execution.

The application handles:

```text
deck ingestion
benchmark orchestration
meta snapshots
queueing
simulation execution
analytics
presentation
```

---

# Required Execution Order

Follow this order unless repository inspection proves an item already exists:

```text
1. Inspect workspace.
2. Inspect Git status.
3. Read repository instructions.
4. Create architecture notes.

5. Research current Forge headless simulation.
6. Verify Forge version.
7. Verify CLI options.
8. Verify Linux/headless execution.
9. Verify multiplayer Commander support.
10. Verify result output behavior.
11. Verify AI limitations.

12. Create minimal Forge Docker spike.
13. Run Deck A vs Deck B.
14. Parse real result.
15. Add timeout.
16. Add error handling.
17. Document findings.

18. Scaffold services.
19. Add PostgreSQL.
20. Add Redis.
21. Add migrations.
22. Add API.
23. Add worker.

24. Implement Deck Parser.
25. Implement Card Data Provider.
26. Implement Format definitions.
27. Implement validation.
28. Add tests.

29. Implement MetaSnapshot.
30. Implement JSON/CSV import.
31. Import first fixed benchmark snapshot.
32. Validate imported decks.

33. Implement CardGameEngine abstraction.
34. Implement ForgeEngineAdapter.
35. Implement ForgeDeckSerializer.
36. Implement ForgeResultParser.
37. Add integration tests.

38. Implement simulation planning.
39. Implement BullMQ jobs.
40. Implement concurrency.
41. Implement timeout.
42. Implement cancellation.
43. Implement idempotency.

44. Persist SimulationRun results.
45. Implement aggregation.
46. Add confidence intervals.
47. Add matchup summaries.
48. Add analytics tests.

49. Build New Analysis UI.
50. Build Queue UI.
51. Add live progress.
52. Build Results UI.
53. Build matchup table.
54. Add charts.

55. Run full constructed-format end-to-end test.
56. Run 50-game benchmark.
57. Run 250-game benchmark.
58. Measure CPU/memory/throughput.
59. Fix correctness/performance problems.

60. Verify restart/recovery.
61. Complete MVP documentation.

62. Research Commander events in Forge.
63. Implement four-player simulation.
64. Implement pod generation.
65. Implement placement statistics.
66. Instrument Commander cast timing if supported.
67. Add Commander results UI.

68. Research legal/current meta ingestion options.
69. Add automated provider only where allowed.
70. Keep manual snapshot import as fallback.

71. Finalize security limits.
72. Finalize deployment docs.
73. Run final acceptance suite.
```

---

# Required Quality Gates

## Gate A — Real Forge Game

Do not build extensive product features until:

```text
real Forge game runs headlessly
result can be parsed
timeout works
errors are handled
```

## Gate B — Real Queue

Do not polish analytics until:

```text
job can be queued
worker processes it
multiple games run
progress works
results persist
```

## Gate C — Real Benchmark

Do not add Commander until:

```text
one constructed format works
multiple meta opponents work
results are correct
aggregation is tested
```

## Gate D — Commander

Do not expose Commander analytics until:

```text
real four-player Forge simulation works
placement parsing is verified
metrics are based on real events
```

---

# Research and Truthfulness Rules

Never invent:

```text
Forge CLI switches
Forge APIs
Forge game events
meta source APIs
format legality
card data
engine capabilities
```

When uncertain:

```text
inspect source
inspect current documentation
run a test
document the result
```

Use statuses such as:

```text
VERIFIED
SUPPORTED
PARTIALLY SUPPORTED
NOT SUPPORTED
NOT VERIFIED
```

Do not claim a metric works merely because the database has a field for it.

---

# Final Product Experience

The desired final experience is:

```text
Paste Deck
   ↓
Choose Format
   ↓
Choose Current Meta Snapshot
   ↓
Choose 50 / 250 / 1000 Games
   ↓
Analyze
   ↓
Queued
   ↓
Running 427 / 1000
   ↓
Results
```

For constructed formats:

```text
Overall Win Rate
Matchup Win Rates
Best Matchups
Worst Matchups
Play/Draw
Game Length
Mulligans where available
Confidence
```

For Commander/cEDH:

```text
Win Rate
Placement Distribution
Average Placement
Game Length
End Turn
First Commander Cast Turn
Commander Cast Frequency
Pod/Seat Statistics
```

All values must come from real engine executions or clearly labeled statistical derivations.

---

# Required Final Report

When implementation work is finished, report:

```text
Architecture:
Frontend:
API:
Queue:
Database:
Forge version:
Forge integration method:

Formats implemented:
Deck validation:
Meta providers:
Meta snapshots:

1v1 simulation:
Commander simulation:
BO3:
Sideboarding:

Metrics implemented:
Metrics unavailable:

Queue concurrency:
Timeout:
Cancellation:
Recovery:

Automated tests:
Forge integration tests:
Docker smoke tests:

50-game benchmark:
250-game benchmark:
1000-game benchmark:

Observed games/minute:
CPU:
Memory:
Forge process memory:

Known Forge AI limitations:
Known format limitations:
Known card compatibility issues:

Security limits:
Licensing notes:

Known issues:
Deferred work:
Next recommended milestone:
```

Use exact statuses:

```text
IMPLEMENTED
UNIT TESTED
INTEGRATION TESTED
RUNTIME VERIFIED
PARTIALLY VERIFIED
NOT VERIFIED
DEFERRED
```

Never overstate verification.

---

# Definition of Done

The project is not done until:

- Docker Compose starts the system.
- The frontend is usable.
- Deck parsing works.
- Deck validation works.
- At least one real format works end-to-end.
- Meta snapshots are versioned.
- A benchmark can be queued.
- Forge executes real AI-vs-AI games.
- Forge process failures are isolated.
- Game timeouts work.
- Simulation concurrency is bounded.
- Results persist.
- Jobs can be cancelled.
- Completed results survive restart.
- Overall statistics are correct.
- Per-matchup statistics are correct.
- Sample size is always visible.
- Confidence intervals are tested.
- Forge AI limitations are visible.
- No fabricated simulation data is used.
- API is documented.
- Tests pass.
- Deployment is documented.

Commander is complete only when:

- real four-player games run,
- pod composition is recorded,
- placements are reliable,
- Commander-specific metrics are based on real verified events,
- unavailable metrics are honestly marked unavailable.

---

# Final Instruction

Prioritize:

```text
correct simulations
reproducibility
clear limitations
queue safety
statistical honesty
maintainability
```

over:

```text
large feature count
premature optimization
fancy UI
fragile scraping
unsupported metrics
```

The key architectural principle is:

> **Forge owns the rules and game execution. The worker owns simulation orchestration. The database owns reproducible history. The web application owns the user experience and analytics.**

The key statistical principle is:

> **A Forge AI benchmark measures how decks perform under Forge's AI and simulation model. It is not automatically equivalent to real human tournament win rate.**

Begin now with:

```text
1. repository inspection
2. current Forge research
3. headless Forge Docker spike
4. one real Deck A vs Deck B simulation
5. structured result parsing
```

Do not proceed to extensive UI work until that technical foundation is runtime-verified.
