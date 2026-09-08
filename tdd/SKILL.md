---
name: tdd
description: Use to learn how to practice test-driven development, choose testing seams, and follow the red-green-refactor loop.
---

# Test-Driven Development

TDD is the red → green → refactor loop. This skill is the reference that makes that loop produce tests worth keeping: what a good test is, where tests go, the anti-patterns, and the rules of the loop. Every section applies on every cycle — consult them before and during the loop, not after.

Read `CONTEXT.md` and relevant linked documents before naming tests or interfaces. Respect applicable ADRs.

## What a good test is

Tests verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't. A good test reads like a specification — "user can checkout with valid cart" tells you exactly what capability exists — and survives refactors because it doesn't care about internal structure.

See [tests.md](tests.md) for examples and [mocking.md](mocking.md) for mocking guidelines.

## Seams — where tests go

A **seam** is where a module's interface lives and behavior can be varied without editing the caller. Before testing, identify the module under test. Exercise it through its interface and do not reach into its implementation. A seam may be internal to a larger module while remaining the external test surface of the smaller module that owns it.

**Test only at pre-agreed seams.** Before writing any test, write down the seams under test and confirm them with the user. No test is written at an unconfirmed seam. You can't test everything — agreeing the seams up front is how testing effort lands on the critical paths and complex logic instead of every edge case.

Ask: "What's the public interface, and which seams should we test?"

## Anti-patterns

- **Implementation-coupled** — mocks internal collaborators, tests private methods, or verifies through a side channel (querying the database instead of using the interface). The tell: the test breaks when you refactor but behavior hasn't changed.
- **Tautological** — the assertion recomputes the expected value the way the code does (`expect(add(a, b)).toBe(a + b)`, a snapshot derived by hand the same way, a constant asserted equal to itself), so it passes by construction and can never disagree with the code. Expected values must come from an independent source of truth — a known-good literal, a worked example, the spec.
- **Horizontal slicing** — writing all tests first, then all implementation. Bulk tests verify _imagined_ behavior: you test the _shape_ of things rather than user-facing behavior, the tests go insensitive to real changes, and you commit to test structure before understanding the implementation. Work in **vertical slices** instead — one test → one implementation → repeat, each test a **tracer bullet** that responds to what the last cycle taught you.

## Rules of the loop

- **Red before green.** Write the failing test first, then only enough code to pass it. Don't anticipate future tests or add speculative features.
- **One slice at a time.** One seam, one test, one minimal implementation per cycle.
- **Test retained behavior, not historical absence.** When removing a feature, delete or revise tests that specified the retired behavior. Do not add a test whose only contract is that the removed feature stays absent. Add negative coverage only when absence is itself a durable requirement, such as a safety, security, compatibility, or explicit business invariant. If no retained behavior changes and no such invariant exists, removal does not require a replacement test.
- **Refactor after green when the completed slice exposes duplication, poor names, or unnecessary structure.** Keep behavior unchanged, rerun the focused test after each refactor, and do not anticipate abstractions needed only by future slices.
