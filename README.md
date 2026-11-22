[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/DanuMahiru/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/DanuMahiru/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

# csv-reader-speed-01 — a faster drop-in for csv-reader 1.0.0

A fast replacement for make.fun's own `csv-reader` 1.0.0, written for the
[csv-reader-speed-01-run-20261121](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
bounty. `solve.js` exports `run(input)`, which returns exactly csv-reader's
answer `{columns, rows, errors}` for every input `{text, header}` — the same
broken-row policy, the same errors in the same order, the same line and row
numbers — only faster.

## How it is fast

One left-to-right pass, but no per-character work:

- Unquoted fields are cut with `indexOf` — a field ends at the first
  comma or LF (a CR just before the LF is the CRLF ending; any other CR
  in the body is a stray CR, dropped with one error each). The next LF is
  cached across the unquoted fields of a record, since it cannot move
  until a quoted field or a skipped blank line moves the cursor past it.
- Quoted fields are found with `indexOf('"')` and cut with slices; `""`
  escapes accumulate at most one segment array, and CRLF / lone CR inside
  quotes is normalized to LF with one replace.
- No record fast path and no manual inlining: v2 had both and was ~60%
  faster than v1 on a local Node 24 bench, but scored *worse* on the
  site (1,570,000 cpu_us vs v1's 1,440,000) — measured under the site's
  Node 22 / V8 12.4, v2's inlined function and its fast path are both
  slower than v1's small helpers. v3 is built and measured for Node 22.
- No WebAssembly, no native code, no dependencies — pure JavaScript.

## Layout

- `solve.js` — the fast reader (`run(input)`).
- `main.ts` — the driver the harness runs: reads `/input/cases.json`,
  answers each case with `run`, writes `/output/answers.json`.
- `package.json` — `{"type": "module"}`.

## Verification (local)

- Practice set (6 cases, ~10.2 MB of CSV): **6/6 answers byte-identical**
  to the oracle, end to end through `main.ts`; two runs write byte-identical
  `answers.json`.
- Differential test against the oracle: **8,318 cases, 0 mismatches**
  (hand-written edge cases, 8,000 random fuzz cases, and 60 cases drawn
  with the kit's own generator from fresh seeds).
- Speed on the practice set (fresh process per run, full `main.ts`
  execution — startup + JSON.parse + `run()` + JSON.stringify + write —
  measured as process CPU time, the same quantity the site calls
  `cpu_us`, under the site's Node 22): **run phase ~375 ms vs v1's
  ~405 ms and v2's ~532 ms** (trimmed mean of 15 interleaved rounds;
  full-process total ~630 ms vs v1's ~638 ms). v3 is also faster than
  v1 under Node 24 (run ~252 ms vs ~423 ms) and Node 26 (~305 ms vs
  ~396 ms), so the win does not depend on the exact Node version.
  Site projection is roughly 1.28–1.34M cpu_us (v1: 1.44M, v2: 1.57M;
  top-1000 cutoff 1.26M) — a clear improvement on both live versions,
  top 1000 borderline.

## License

MIT — see `LICENSE`.
