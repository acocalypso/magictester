# Completion worklist

User instruction: finish the remaining core work, push each completed change individually, then move to the next task. Each task below is a separate verified commit/push; fixes discovered during verification belong to that task.

| Order | Task                                                                                                                                                                      | State                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1     | Research comparable products and replace the generic UI with an original charcoal workbench design; add repeatable browser acceptance checks                              | PUSHED `94d7940`                                                    |
| 2     | Enable and validate all requested constructed formats, including restricted cards and centralized format rules                                                            | PUSHED `70955a9`                                                    |
| 3     | Implement complete Commander/cEDH/Duel deck validation, color identity, legal commander/partner/companion configuration                                                   | PUSHED `5d72512`                                                    |
| 4     | Add a minimal maintained Forge bridge using real structured game events; verify four-player execution, placements and commander timing                                    | PUSHED `e8c07fc`                                                    |
| 5     | Connect multiplayer pod planning, stable run identities, queue execution, API results and Commander/cEDH UI                                                               | PUSHED `acd813b`                                                    |
| 5b    | Enable Duel execution with 20 life, no commander-damage win and first-cast partner lock; verify against current rules                                                     | VERIFIED — rules contracts, four real engine games, API and browser |
| 6     | Verify and implement real BO3 match execution and actual Forge sideboarding behavior; distinguish game and match rates                                                    | PENDING                                                             |
| 7     | Research permitted metagame sources; implement versioned remote feed ingestion, source-backed pools, scheduling and freshness reporting without bypassing access controls | PENDING                                                             |
| 8     | Finish custom/weighted benchmark selection and opponent/pod controls with transparent methodology                                                                         | PENDING                                                             |
| 9     | Complete operations: metadata refresh, bounded log retention, per-game watchdogs, observability and restart/cancellation acceptance                                       | PENDING                                                             |
| 10    | Run all-format acceptance, real 1000-game benchmark where appropriate, final CI and documentation                                                                         | PENDING                                                             |

Original advanced non-goals (billing, social features, mobile apps, Kubernetes and a human MTG client) remain outside this project. Unsupported engine measurements must be investigated or explicitly reported as unavailable; no fake game statistics or claimed sideboarding intelligence are permitted.

The managed executor has an 8 GB VFS Docker disk. See `docs/VERIFICATION.md` for its established runtime image/cache adaptation. Keep testing against the real services; use the clean GitHub Actions Compose workflow to verify a source-only installation.
