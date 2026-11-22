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

- Unquoted field bodies are cut with one sticky-regex match per body
  (`/[^,\r\n]*/y`); the match is the value, no string is ever built a
  character at a time.
- Quoted fields are found with `indexOf('"')` and cut with slices; `""`
  escapes accumulate at most one segment array, and CRLF / lone CR inside
  quotes is normalized to LF with one replace.
- A record with no quote at all is cut in one go (find its line break,
  split on commas).
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
- Speed on the practice set (median of 9 timed runs, `run()` time only,
  `--no-incremental-marking`, as the harness measures it):
  **~354 ms vs csv-reader 1.0.0's ~1,214 ms — about 3.4x faster.**

## License

MIT — see `LICENSE`.
