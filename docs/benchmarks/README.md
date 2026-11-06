# Real 1,000-game workload

[Machine-readable evidence](1000-games.json), job `f1fd7acd-e761-43da-9b8a-0ae44eaf26ff`, 6 November 2026, 20:43:57–21:04:57 UTC.

The submitted Pauper Burn list played 500 actual BO1 games against each of the two project-authored reference lists. This is a fixed integration/performance workload, not a current tournament metagame or a human win-rate estimate.

| Measurement                           |             Observed |
| ------------------------------------- | -------------------: |
| Valid games / unique run identities   |        1,000 / 1,000 |
| Wins–losses–draws                     |            537–463–0 |
| Timeouts / engine errors              |                0 / 0 |
| Wall time                             |    1,260.103 seconds |
| Throughput                            |  47.615 games/minute |
| Win rate, Wilson 95% interval         | 53.7%, 50.60%–56.77% |
| Burn reference                        |   260–240, 500 games |
| Stompy reference                      |   277–223, 500 games |
| Observed starts first / second        |            502 / 498 |
| Mean / median individual player turns |          19.424 / 18 |
| Mean engine game duration             |        1.233 seconds |
| Sampled peak Java high-water RSS      |            936.9 MiB |
| Observed Java CPU, lower bound        |  1,236.6 CPU-seconds |
| Resource samples, nominal interval    |      122, 10 seconds |

Configuration: Forge 2.0.15, Default AI, London mulligans, 20 life, 30-second per-game clock, one active JVM, 1,024 MiB Java heap, runner limited to two CPUs and 2 GiB. Matchup seeds are 12345 and 112348; unit seeds retain absolute batch indices. The JSON records exact rules, execution plan, source hashes, deck hash and metadata provenance.

The engine fingerprint remained `a6b75c4bb8248bdda19d3efd827bfcba7bd4bcfabf20cd2bfcc4b21e719558da` throughout. The later pregame wild-commander color correction was tested in an isolated runtime and deployed only after this job completed; it is not represented as part of the measured run. After the upgrade, all 1,000 stored identities, seeds and fingerprints were checked and the aggregate summary remained identical.

RSS comes from the Java process's `/proc` high-water mark at sample time. CPU sums the highest observed user/system ticks per JVM, so samples can miss its last CPU usage before exit. These are measured process values, not claimed total application/cgroup utilization. Isolated rules-audit JVMs and verification clients ran concurrently in this executor; throughput is indicative of this workload, not an isolated performance certification. The full local report with samples remains under ignored `data/benchmark-1000.json`.

Reproduce with an idle Compose stack:

```sh
BENCHMARK_RESOURCES=1 node scripts/benchmark.mjs 1000
```

The manual **Real Forge benchmark** workflow supports 50, 250 or 1,000 games and uploads its own commit-specific report. Historical 50/250-game measurements in [verification](../VERIFICATION.md) predate this structured bridge and are not controlled performance comparisons.
