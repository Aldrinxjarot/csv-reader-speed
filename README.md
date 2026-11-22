[![make.fun bounty](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Aldrinxjarot/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Aldrinxjarot/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

# csv-reader-speed

A fast, dependency-free CSV reader for broken CSV files, built for the
[make.fun csv-reader-speed bounty](https://make.fun/bounty/csv-reader-speed-01-run-20261121).

`solve.js` exports `run({text, header})` and reproduces the csv-reader 1.0.0
result — `{columns, rows, errors}` — exactly, including its error codes
(`stray_cr`, `quote_junk`, `unterminated_quote`, `short_row`, `long_row`) and
their ordering, while parsing in a single slice-based pass. `main.ts` is the
harness driver: it reads cases from the input directory and writes answers as
JSON. Validated byte-exact on the practice set and against the reference
implementation on thousands of fuzzed malformed inputs, at several times the
reference's speed.
