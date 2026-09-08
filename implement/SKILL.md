---
name: implement
description: Use to learn how to implement, verify, review, and commit agreed specs or tickets.
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

Before editing, record the current `HEAD` as the implementation baseline.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once implementation and verification are complete, use /code-review with the recorded baseline and tell it to review the working tree. Address accepted findings and rerun affected verification.

Commit the reviewed work to the current branch.
