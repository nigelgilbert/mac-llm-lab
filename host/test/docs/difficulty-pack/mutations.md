# P1 mutation specs — Sprint 1.21

Per-pick mutation specifications for the 7 locked Aider/Exercism JS ports
([`p1-picks.md`](p1-picks.md)). Each spec lists the rename map, edge-case
shifts, and return-shape changes that get applied before the test ships.
Mutation depth (HEAVY / STANDARD) follows from the contamination flag in
the picks table.

**Goal of mutation:** defeat surface-level recall ("I've seen this exact
problem") while preserving the underlying capability test (spec_precision
under non-greedy edge cases, stack interpreter with redefinition, etc.).
Mutations should *not* change which axis the test probes.

**Calibration interaction:** R8 calibration check fires if t16 ≥ 70% — if
the produced model solution is structurally identical to the canonical
upstream at [`canonicals/<slug>/proof.ci.js`](canonicals/), we mutate
harder and re-pilot.

**Open question for staff scientist** ([`PLAN.md`](PLAN.md) §Open
questions Q3): at what mutation depth does the test transition from
`adapted_from` to `inspired_by` for attribution purposes? Heavy mutations
below intentionally sit at the boundary; flag in PR for review.

---

## 1. book-store — HEAVY mutation

**Why heavy:** Source attribution explicitly says "Inspired by the harry
potter kata from Cyber-Dojo." The discount-tier puzzle has appeared in
Pragmatic Programmer kata-of-the-month rotations and dozens of TDD
walkthroughs. Direct surface recall is plausible.

### Rename map

| Canonical | Mutated |
|---|---|
| `cost(books)` | `totalPrice(packageIds)` |
| `BOOK_PRICE = 800` | `UNIT_PRICE = 1200` (cents per package) |
| `DISCOUNTS = [1, 0.95, 0.9, 0.8, 0.75]` | `DISCOUNTS = [1, 0.93, 0.85, 0.76, 0.66, 0.55]` (6 tiers, not 5) |
| Domain: "5-book series" | Domain: "6-tier subscription bundles" or "6-product license packs" |

### Edge-case shifts

- **6th tier** is the central spec change: with 6 distinct items at the deepest discount, the non-greedy `4+4 > 3+5` trap from the canonical example becomes the `5+5 > 4+6` trap (or analogous). Specific basket required to land in the tested band depends on the new DISCOUNTS array; verify `4+4`-class trap still exists by hand-solving 2 baskets before commit.
- Unit price 1200 (cents) means the "non-greedy beats greedy" inequality changes by exactly the multiplier; algorithm is unchanged but the canonical *numbers* in proof.ci.js are now wrong.

### Return-shape changes

- Canonical returns plain integer cents. Mutated returns `{ totalCents: number, groupingChoice: number[] }` where `groupingChoice` is the array of group sizes the optimal solution used (e.g., `[5,5]` or `[4,6]`).
- Forces the model to expose its solution structure, not just the price.

### Verifier sanity baskets (hand-verify before commit)

| Basket | Expected `totalCents` | Why |
|---|---|---|
| `[]` | 0 | Empty case |
| `[1]` | 1200 | Singleton, no discount |
| `[1,1,1,1,1,1]` | 7200 | All same item, no group available |
| `[1,2,3,4,5,6]` | (compute) | All 6 distinct → maximum tier |
| `[1,1,2,2,3,3,4,4,5,5]` | (compute) | The non-greedy trap basket — must NOT collapse to two size-5 groups if size-3+3+2+2 or similar beats it |

---

## 2. wordy — STANDARD mutation

**Why standard:** Less-famous than `poker` or `zebra-puzzle`; some recall
risk via the canonical English-arithmetic phrasing but not severe.

### Rename map

| Canonical | Mutated |
|---|---|
| `answer(question)` | `evaluate(query)` |
| Question prefix: "What is " | Prefix: "Compute " (and end with "." not "?") |
| `plus / minus / multiplied by / divided by` | `added to / decreased by / scaled by / divided by` |
| Throw `'Unknown operation'` / `'Syntax error'` | Throw `'UnsupportedOp'` / `'MalformedInput'` |

### Edge-case shifts

- "Compute 5 added to 13." → 18 (changed from "What is 5 plus 13?")
- Operator precedence twist: keep left-to-right (the canonical's defining quirk) — preserves the capability under test.
- New invalid case: trailing whitespace inside the expression (`"Compute 5 added to  13."` with double space) — should still parse. Tests robust whitespace handling, not in canonical.
- Reject as before: empty operations, unknown ops, leading/trailing junk.

### Return-shape changes

- Keep returning a number on success; throws stay throws (Error subclasses), but error messages distinct from canonical.

### Verifier sanity

| Input | Expected | Why |
|---|---|---|
| `"Compute 5."` | 5 | Iteration 0 analog |
| `"Compute 5 added to 13."` | 18 | Iteration 1 analog |
| `"Compute 7 decreased by 5."` | 2 | Iteration 2, renamed op |
| `"Compute 3 added to 2 scaled by 3."` | 15 | Left-to-right (NOT 9 — the precedence twist) |
| `"Compute 52 cubed."` | throws `UnsupportedOp` | Error path |
| `"Compute 1 added to added to 2."` | throws `MalformedInput` | Syntax error path |

---

## 3. alphametics — HEAVY mutation

**Why heavy:** Classic cryptarithmetic puzzle; SEND+MORE=MONEY is in
Knuth TAOCP and dozens of intro-AI textbooks. Heavy mutation is the only
defense.

### Rename map

| Canonical | Mutated |
|---|---|
| `solve(puzzle)` | `assignDigits(equation)` |
| Result key: digit (number) | Result key: `code` (number 0–9) |
| Result value: letter | Wrap: `[{ symbol: 'A', code: 0 }, ...]` array of objects |

### Edge-case shifts and spec extension

- **Spec extension:** support multiplication in addition to addition. The equation grammar becomes `TERM (+|*) TERM (+|*) ... = TOTAL` where each term is a word. This is a meaningful mutation: the constraint solver must handle non-linear contributions, not just `sum of weights × digit = 0`. **This shifts complexity** — must re-confirm hand-solvability under <10 min on at least one mixed `+`/`*` case before commit.
- Equation may appear with `=` on either side (`"WORD1 + WORD2 = TOTAL"` or `"TOTAL = WORD1 + WORD2"`); both must parse.
- Avoid the SEND+MORE=MONEY puzzle in the verifier — use deliberately non-canonical word sets.

### Return-shape changes

- Canonical: `{ S: 9, E: 5, ... }` (object map)
- Mutated: `[{ symbol: 'S', code: 9 }, { symbol: 'E', code: 5 }, ... ]` (array of objects, sorted by symbol)
- This breaks any direct serialization recall.

### Verifier sanity

| Equation | Expected (assuming valid solution exists) |
|---|---|
| `"CAT + DOG = PET"` | array of 6–7 letter assignments OR null if unsolvable |
| `"AB = BA"` | null (no valid distinct-digit assignment, since AB ≡ 10a+b and BA ≡ 10b+a are equal only when a=b which violates distinctness) |
| `"A * B = AB"` | array satisfying single-digit × single-digit = two-digit |
| `"A + B + C = ABC"` (small mixed addition) | (compute) |

Hand-verify each before commit.

### Mutation-depth gate

The `+`/`*` extension is intentionally aggressive. If pilot shows
unexpected floor (t32 < 25%), drop the `*` extension and revert to
addition-only — keep the rename + return-shape changes only. Document the
revert in the PR.

**Gate fired (Sprint 1.21 cycle 1+2 pilot, 2026-05-02):** alphametics
floored 0/3 t32 + 0/2 t16 — `*` extension dropped per gate. Test now
addition-only; rename, bidirectional `=`, and `[{symbol,code}]` return
shape retained. The 7-iteration confused-solver trace that triggered
the revert is in `explore/c2/snapshots/alphametics.t16.jsonl`
(gitignored; regenerable from the c2 registry JSONL).

---

## 4. word-search — STANDARD mutation

**Why standard:** Multi-direction search is a canonical interview pattern
but not heavily discussed at the granularity of Exercism's specific
return shape. Rename + axis shift is sufficient.

### Rename map

| Canonical | Mutated |
|---|---|
| `find(words)` (method on a class) | `locate(targets, board)` (free function) |
| Result: `{ start: [r,c], end: [r,c] }` (1-indexed) | Result: `{ begin: { row, col }, finish: { row, col } }` (0-indexed, named axes) |
| Class `Wordsearch` | n/a — flat function |

### Edge-case shifts

- **Axis restriction:** drop diagonal directions. Mutated only supports horizontal (L→R, R→L) + vertical (T→B, B→T). Reduces from 8 directions to 4. Tests the same coordinate-precision capability without the full direction stencil.
  - Trade-off: the diagonal-handling complexity is part of what makes word-search difficulty 8. Removing it likely *reduces* difficulty — possibly into ceiling-risk band on t32. Calibrate at pilot.
  - **Alternative if pilot floors:** keep all 8 directions but flip the index convention (1-indexed → 0-indexed) only.

### Return-shape changes

- 0-indexed coordinates with named keys (`{ row, col }`) instead of `[r, c]` arrays.
- Absent words return explicit `null` (canonical returns `undefined`).

### Verifier sanity

| Grid | Targets | Expected |
|---|---|---|
| 3×3 trivial grid with "CAT" L→R in row 0 | `["CAT"]` | `{ CAT: { begin: { row: 0, col: 0 }, finish: { row: 0, col: 2 } } }` |
| 3×3 grid with no match | `["DOG"]` | `{ DOG: null }` |
| Vertical-only target | `["RUN"]` (only present T→B in column 1) | computed |
| R→L target | `["TAC"]` (i.e., "CAT" reversed in same row) | computed (begin > finish on col axis) |

---

## 5. forth — STANDARD mutation

**Why standard:** Forth interpreters are heavily documented, but the
Exercism subset (`+ - * / DUP DROP SWAP OVER` plus `: ... ;`) is
specifically narrowed; surface recall is moderate.

### Rename map

| Canonical | Mutated |
|---|---|
| `Forth` class with `evaluate(input)` and `stack` getter | `StackMachine` class with `run(program)` and `state` getter (returns array, not space-joined string) |
| `:` ... `;` colon definition syntax | `def` ... `end` syntax (different keywords) |

### Edge-case shifts

- **Word redefinition semantics:** keep the canonical's "redefining `:` looks up the OLD word at parse time" — this is the canonical correctness trap and is precisely the capability we're testing.
- Add operator: introduce `MOD` (modulo, integer remainder) alongside `+ - * /`. Forth purists would call it `MOD` already, so this isn't *wildly* divergent, but it adds a new word the model must implement.
- Remove operator: drop `OVER` from the supported set. Mutated only requires `DUP DROP SWAP`. Reduces stack-manipulation complexity slightly; pair with the MOD addition to keep difficulty roughly preserved.

### Return-shape changes

- `state` returns `[1, 2, 3]` (array of numbers) not `"1 2 3"` (space-separated string).
- Empty stack → `[]` not `""`.

### Verifier sanity

| Program | Expected `state` |
|---|---|
| `"1 2 3"` | `[1, 2, 3]` |
| `"1 2 +"` | `[3]` |
| `"7 3 MOD"` | `[1]` (new operator) |
| `"1 2 SWAP"` | `[2, 1]` |
| `"def square dup * end 5 square"` | `[25]` (new def syntax) |
| `"def + - end 1 1 +"` | `[0]` (redefinition semantic — `+` becomes `-`) |
| Case-insensitive: `"DEF SQUARE DUP * END 4 square"` | `[16]` |

---

## 6. grade-school — STANDARD mutation (with ceiling-risk caveat)

**Why standard:** Roster-keeping is a generic OOP-101 pattern; recall
risk is moderate, but the spec is simple enough that recall isn't the
main concern — *saturation* is. This pick is flagged for ceiling risk on
t32 in [`p1-picks.md`](p1-picks.md). Mutation should add complexity, not
just surface noise.

### Rename map

| Canonical | Mutated |
|---|---|
| `GradeSchool` class | `ClassRoster` class |
| `add(student, level)` | `enroll(name, year)` |
| `grade(level)` | `cohort(year)` |
| `roster()` | `everyone()` |

### Edge-case shifts (this is where the ceiling defense lives)

- **Grade transfers:** `enroll('Anna', 1)` followed by `enroll('Anna', 2)` should *move* Anna from grade 1 to grade 2 (not throw, not silently no-op). Canonical refuses re-add anywhere. The transfer semantic is the core capability extension — tests state-transition correctness.
- **Withdrawal:** add a new method `withdraw(name)` that removes a student from whatever grade they're in (returns `false` if not enrolled). Canonical has no withdraw.
- Sort order for `cohort()` is reverse-alphabetic (Z→A), not forward. Sort order for `everyone()` stays year-ascending then alpha-ascending within a year.

### Return-shape changes

- `enroll()` returns `{ enrolled: true, transferredFrom: null | year }` (informs caller whether this was an enrollment or a transfer). Canonical returns plain `boolean`.
- `cohort(year)` returns `[]` for unknown years (same as canonical).
- `everyone()` returns `[{ name, year }]` (array of objects), not flat `[name]`.

### Verifier sanity

Tests must exercise:
1. enroll Anna in grade 1 → `{ enrolled: true, transferredFrom: null }`
2. enroll Anna in grade 2 → `{ enrolled: true, transferredFrom: 1 }`
3. cohort(1) is now `[]`, cohort(2) is `["Anna"]`
4. enroll Bob, Charlie in grade 2; cohort(2) → `["Charlie", "Bob", "Anna"]` (reverse alpha)
5. everyone() → `[{ name: "Anna", year: 2 }, { name: "Bob", year: 2 }, { name: "Charlie", year: 2 }]` (year asc, alpha asc)
6. withdraw("Anna") → `true`; withdraw("Anna") → `false`

The transfer + withdraw + reverse-alpha-cohort combination should keep
this off the t32 ceiling. If pilot still saturates, the runner-up swap
([`memos/aider-calibration-note.md`](memos/aider-calibration-note.md)) is
`robot-name`.

---

## 7. two-bucket — HEAVY mutation

**Why heavy:** Classic water-jug problem appears in Russell-Norvig AIMA,
Udacity Intro to CS, multiple textbooks. The (3,5,4) and (3,5,1) capacity
triples are textbook-canonical. Heavy mutation needed.

### Rename map

| Canonical | Mutated |
|---|---|
| `solve(bucketOneCapacity, bucketTwoCapacity, goalAmount, startingBucket)` | `findShortestPath(vesselA, vesselB, target, primary)` |
| `moves` | `actionCount` |
| `goalBucket: 'one' \| 'two'` | `holder: 'A' \| 'B'` |
| `otherBucket: number` | `residual: number` |

### Edge-case shifts and spec twist

- **Avoid textbook capacities:** never use `(3, 5, ...)` or `(3, 7, ...)`. Sample tests use `(4, 9, target)`, `(5, 11, target)`, `(7, 13, target)`. Hand-verify each.
- **Spec twist on rule 3:** canonical forbids the state where "starting bucket is empty AND other bucket is full." Mutated forbids the state where "both buckets are at capacities equal to each other and that capacity is < target" (a *different* sentinel, requires re-derivation, not direct lookup).
  - Honest disclosure: this changes the problem's solvability surface non-trivially. Hand-solve at least 3 cases before commit; if the new rule makes too many inputs unsolvable, revert to canonical rule 3 and rely on rename + capacity shift only.
- **Unsolvable input handling:** instead of throwing, return `null`. Tests must include at least one unsolvable case.

### Return-shape changes

- Canonical: `{ moves, goalBucket, otherBucket }`
- Mutated: `{ actionCount, holder, residual, path: Array<[a, b]> }` — adds explicit `path` array of (a,b) state pairs from start to goal. This forces the model to reconstruct the BFS path, not just count moves.
- Unsolvable: `null`

### Verifier sanity

| (a, b, target, primary) | Expected |
|---|---|
| `(4, 9, 6, 'A')` | `{ actionCount, holder, residual, path }` (compute by hand) |
| `(5, 11, 7, 'B')` | (compute) |
| `(2, 6, 5, 'A')` | `null` (5 unreachable: gcd(2,6)=2 doesn't divide 5) |
| `(2, 4, 3, 'A')` | `null` (gcd doesn't divide target) |

GCD-divides-target is the standard solvability check. Good for
constructing unsolvable cases deterministically.

### Mutation-depth gate

If the rule-3 twist introduces ambiguity that pilot can't resolve in 5
attempts (R4 trips: `passed=null` rate > 20%), revert to canonical rule 3
and rely on rename + capacity shift + return-shape changes only.

---

## Application order during step 5 authoring

For each pick:

1. Read [`canonicals/<slug>/instructions.md`](canonicals/) and [`proof.ci.js`](canonicals/) once.
2. Apply rename map verbatim from this doc to your authored prompt + verify.js.
3. Implement edge-case shifts and return-shape changes in the verify.js assertion suite.
4. Hand-solve at least 3 verifier cases — if you can't solve them in <10 min, the mutation is too aggressive; back off.
5. Author the test file using [`authoring-template.md`](authoring-template.md).
6. In the manifest `notes` field, write `"adapted_from Exercism JS '<slug>' (MIT); mutation depth: HEAVY|STANDARD; key changes: <rename, edge shift, shape change list>; canonical at canonicals/<slug>/"`.
7. Verify the test runs locally before pilot kickoff.

## Open authoring decisions

These are deliberately deferred to step 5 (authoring) where the verify.js
shape becomes concrete:

- For book-store, the exact 6-tier discount values — the table above lists candidate `[1, 0.93, 0.85, 0.76, 0.66, 0.55]` but each value should land at non-round percentages to defeat memorization. Final values picked at authoring.
- For alphametics, whether to ship the `+`/`*` mixed-operator extension or revert to addition-only. Mutation-depth gate above.
- For two-bucket, whether to keep the rule-3 twist or revert. Mutation-depth gate above.
