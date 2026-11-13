#!/usr/bin/env python3
"""Run a head-to-head AI league and report whether one policy really plays better.

Two policies swap decks in mirrored pairs with a shared seed, so a result cannot come from one
side simply holding the stronger list. The report gives the candidate's share of decided matches
with a Wilson 95% interval, an exact paired sign test, a per-deck breakdown, and for best-of-three
the game-one and post-sideboard game rates separately. Unfinished legs are counted and excluded,
never guessed.
"""
import argparse
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
FINISHED = ('normal', 'rule_draw')


def wilson(wins, total):
    if total == 0:
        return None
    z = 1.959963984540054
    p = wins / total
    d = 1 + z * z / total
    middle = (p + z * z / (2 * total)) / d
    radius = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / d
    return [round(max(0.0, middle - radius), 4), round(min(1.0, middle + radius), 4)]


def sign_test(better, worse):
    """Exact two-sided binomial probability of a split at least this uneven if both are equal."""
    n = better + worse
    if n == 0:
        return None
    k = min(better, worse)
    tail = sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n
    return round(min(1.0, 2 * tail), 6)


def rate(wins, total):
    return None if total == 0 else round(wins / total, 4)


def leg_outcome(row):
    """1 candidate won, 0 baseline won, 0.5 rule draw, None unfinished."""
    if row['termination'] not in FINISHED:
        return None
    if row['termination'] == 'rule_draw' or row['winner'] is None:
        return 0.5
    return 1.0 if row['winner'] == row['candidateSeat'] else 0.0


def summarize(config, rows):
    legs = {}
    for row in rows:
        legs.setdefault(row['unit'], {})[row['candidateSeat']] = row
    decided = wins = draws = unfinished = 0
    both = neither = split = incomplete_pairs = 0
    decks = {}
    games = {'gameOne': [0, 0], 'afterSideboard': [0, 0]}
    notes = {}
    exchanged = {'candidate': 0, 'baseline': 0}
    durations = []
    for unit in sorted(legs):
        pair = legs[unit]
        outcomes = [leg_outcome(pair[s]) if s in pair else None for s in (0, 1)]
        for row in pair.values():
            outcome = leg_outcome(row)
            if row.get('durationMs') is not None:
                durations.append(row['durationMs'])
            if outcome is None:
                unfinished += 1
        if None in outcomes:
            incomplete_pairs += 1
            continue  # A pair only counts when both mirrored legs finished.
        for seat, outcome in zip((0, 1), outcomes):
            row = pair[seat]
            for role, deck, won in (('candidate', row['candidateDeck'], outcome), ('baseline', row['baselineDeck'], 1 - outcome)):
                entry = decks.setdefault(deck, {'candidate': [0.0, 0], 'baseline': [0.0, 0]})
                entry[role][0] += won
                entry[role][1] += 1
            if outcome == 0.5:
                draws += 1
            else:
                decided += 1
                wins += int(outcome)
            for index, game in enumerate(row.get('games', [])):
                if game.get('termination') != 'normal' or game.get('winner') is None:
                    continue
                bucket = games['gameOne' if index == 0 else 'afterSideboard']
                bucket[1] += 1
                bucket[0] += int(game['winner'] == row['candidateSeat'])
                for key, value in (game.get('candidateNotes') or {}).items():
                    notes[key] = notes.get(key, 0) + value
                for side in exchanged:
                    exchanged[side] += sum(change['quantity'] for change in game.get(side + 'In') or [])
        total = sum(outcomes)
        if total == 2:
            both += 1
        elif total == 0:
            neither += 1
        else:
            split += 1
    per_deck = {}
    for name, entry in sorted(decks.items()):
        c, b = entry['candidate'], entry['baseline']
        per_deck[name] = {
            'candidatePilot': {'score': c[0], 'matches': c[1], 'rate': rate(c[0], c[1])},
            'baselinePilot': {'score': b[0], 'matches': b[1], 'rate': rate(b[0], b[1])},
            'difference': None if not c[1] or not b[1] else round(c[0] / c[1] - b[0] / b[1], 4),
        }
    durations.sort()
    return {
        'schemaVersion': 1,
        'candidate': config['candidate'], 'baseline': config['baseline'], 'bestOf': config['bestOf'],
        'seed': config['seed'], 'repeats': config['repeats'], 'clockSeconds': config['clockSeconds'],
        'decks': [deck['name'] for deck in config['decks']],
        'method': 'Mirrored pairs: both policies pilot both decks of every pairing with one seed. Draws count as neither a win nor a loss.',
        'legsPlayed': len(rows), 'legsUnfinished': unfinished, 'pairsExcludedForUnfinishedLeg': incomplete_pairs,
        'decidedMatches': decided, 'candidateWins': wins, 'baselineWins': decided - wins, 'draws': draws,
        'candidateShare': rate(wins, decided), 'candidateShareWilson95': wilson(wins, decided),
        'pairs': {'candidateWonBoth': both, 'baselineWonBoth': neither, 'split': split,
                  'signTestTwoSidedP': sign_test(both, neither)},
        'games': {key: {'candidateWins': value[0], 'decided': value[1], 'candidateShare': rate(*value),
                        'wilson95': wilson(*value)} for key, value in games.items()},
        'sideboardCardsBroughtIn': exchanged,
        'candidatePlanningNotes': dict(sorted(notes.items())),
        'perDeck': per_deck,
        'matchDurationMs': {'median': durations[len(durations) // 2] if durations else None,
                            'max': durations[-1] if durations else None},
        'interpretation': 'Evidence for this deck pool, engine build and clock only. A share near 50% with an interval that '
                          'spans 50% shows no measured difference. Host durations are not a phone measurement.',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--forge-jar', required=True, type=Path)
    parser.add_argument('--native-home', required=True, type=Path)
    parser.add_argument('--bridge-classes', required=True, type=Path)
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('--rows', type=Path, help='also keep every leg as JSON lines')
    parser.add_argument('--jobs', type=int, default=max(1, (os.cpu_count() or 2) // 2))
    parser.add_argument('--java', default='java')
    parser.add_argument('--override', action='append', default=[], metavar='KEY=JSON', help='replace one config value, e.g. bestOf=1')
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding='utf-8'))
    for item in args.override:
        key, value = item.split('=', 1)
        try:
            config[key] = json.loads(value)
        except json.JSONDecodeError:
            config[key] = value
    dependencies = [str(args.bridge_classes.resolve(strict=True)), str(args.forge_jar.resolve(strict=True))]
    with tempfile.TemporaryDirectory(prefix='magictester-league-') as work:
        work = Path(work)
        effective = args.config.resolve().parent / ('.league-' + str(os.getpid()) + '.json')
        try:
            effective.write_text(json.dumps(config), encoding='utf-8')
            subprocess.run([args.java, '-m', 'jdk.compiler/com.sun.tools.javac.Main', '--release', '17', '-nowarn',
                            '-cp', os.pathsep.join(dependencies), '-d', str(work / 'classes'), str(ROOT / 'tests/AiLeague.java')], check=True)
            cp = os.pathsep.join([str(work / 'classes'), *dependencies])
            workers = []
            for shard in range(args.jobs):
                log = open(work / f'worker-{shard}.log', 'w', encoding='utf-8')
                workers.append((subprocess.Popen([args.java, '-Xmx768m', '-cp', cp, 'AiLeague', str(args.native_home.resolve(strict=True)),
                                                  str(effective), str(work / f'rows-{shard}.jsonl'), str(shard), str(args.jobs)],
                                                 stdout=log, stderr=subprocess.STDOUT), log))
            failed = 0
            for process, log in workers:
                failed += process.wait() != 0
                log.close()
            rows = []
            for shard in range(args.jobs):
                path = work / f'rows-{shard}.jsonl'
                if path.exists():
                    rows += [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()]
            if failed:
                for shard in range(args.jobs):
                    print((work / f'worker-{shard}.log').read_text(encoding='utf-8', errors='replace')[-2000:], file=sys.stderr)
        finally:
            effective.unlink(missing_ok=True)
    rows.sort(key=lambda row: (row['unit'], row['candidateSeat']))
    report = summarize(config, rows)
    report['workersFailed'] = failed
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    if args.rows:
        args.rows.write_text(''.join(json.dumps(row) + '\n' for row in rows), encoding='utf-8')
    share = report['candidateShare']
    print(f"{report['candidate']} vs {report['baseline']} (best of {report['bestOf']}): "
          f"{report['candidateWins']}-{report['baselineWins']} in decided matches, {report['draws']} draws, "
          f"{report['legsUnfinished']} unfinished legs")
    print(f"candidate share {share} Wilson95 {report['candidateShareWilson95']}; pairs both/split/neither "
          f"{report['pairs']['candidateWonBoth']}/{report['pairs']['split']}/{report['pairs']['baselineWonBoth']} "
          f"sign-test p={report['pairs']['signTestTwoSidedP']}")
    for key, value in report['games'].items():
        print(f"  {key}: {value['candidateWins']}/{value['decided']} share {value['candidateShare']} {value['wilson95']}")
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
