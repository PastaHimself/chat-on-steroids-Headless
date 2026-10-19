# Goal post-final settlement, issue #32

## Confirmed incident

Read-only inspection of the reported production session on 2026-10-19 found its
Goal switch still enabled and its exact reply still pending in `goal-replies`.
There was no decision draft or uncertain Goal delivery. The backend reported zero
running/settling tools and MCP requests, and no active workers. The native page was
inspected without attachment, input, reload or navigation; its composer was empty.
Private task text, account details and production identities are not reproduced here.

The durable sequence explains the failure:

1. The final assistant row retained original position **2096** and was revised to
   final content at **2123**, observed at **11:41:27.895 UTC**.
2. The exact completed native `turn_end` was **2124**, naming the same provider
   terminal message and local response. Goal accepted its durable reply at
   **11:41:27.960 UTC**. Turn completion did not discharge the Goal objective.
3. At **11:41:32.628 UTC**, a subsequent Fiber scan first recorded three earlier
   native progress paragraphs at **2125–2127**. All belonged to that same response,
   were nonterminal, and carried their own provider message identities. The
   recorder correctly kept the response closed, but their work cursors were newer.
4. `readCompletedFinal()` treated every later assistant work cursor as fresh work
   and returned null. `chatStillWorking()` therefore refused Goal drafting. The
   existing pickup/recovery projection also requires that shared completed-final
   proof and could not collect the saved obligation. `goalWaitFor()` exposed only
   `settling`, with no deadline. No helper decision was reached, so this incident
   was not a helper classifying partial work or a technical subtask blocker as done.

The previous completed compaction/delivery job and the final turn outcome were
separate facts. Neither proves a continuation after this final, or completion of
the six-stage objective. Likewise `canSendDirectly:false` describes absence of a
running-turn direct-send target; it is not itself an idle-browser delivery failure.

## Repair and invariants

The shared completion reader now recognizes the exact native terminal message
plus its matching completed lifecycle as settlement of native nonterminal prose
in that same response, even when a later scan first writes that prose. This also
reads already persisted affected sessions correctly. No ledger rewriting, migration,
provider-time execution clock, competing timer or additional recovery owner is used.

A bare turn end, missing/mismatched terminal identity, unowned or different-response
prose, a new question/generation, and independent native/MCP tool work retain their
vetoes. Running calls and owned-worker gates remain with their existing owners.
Stop/Off, helper ownership, input priority, the durable pre-Send uncertainty barrier,
pickup budget and twelve-hour source lifetime are unchanged.

`goalStatus` is an optional read-only control projection of the saved reply/source,
canonical-final proof, decision stage/error, waiting owner, existing next-check time
and manual-attention condition. The control API explicitly allowlists its fields
and redacts diagnostics. Discord `/status` and `/goal action:status` display this
projection, label the final outcome as a turn outcome, and distinguish no-reply
from independent verification of the whole objective. Unknown reevaluation times
remain unknown; status reads never authorize retries or create a clock.

## Validation

The new recorder regression failed on the original completion reader both with
and without a simulated restart: the exact final was returned as null. Negative
controls for missing terminal proof, another response, unowned prose and fresh tool
work remained refused. The new bridge regression exercises two provider decisions:
a saved partial final and late progress backfill, restored Goal debt, one prepared
continuation with stable duplicate-request identity, durable possible-Send evidence,
browser acknowledgement, a successor turn, and a no-reply decision.

The provider responses and browser acknowledgements in these tests are simulated.
They prove the real recorder/HTTP bridge/Goal ledger behavior, not authenticated
ChatGPT execution. The recorder, bridge and Discord suites passed 831 tests before
adding the separate control-projection privacy regression. Further full verification,
build, CI and deployment evidence is recorded in the PR and deployment report.
