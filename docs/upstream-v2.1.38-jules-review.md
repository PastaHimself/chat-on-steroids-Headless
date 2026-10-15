# Upstream Chat On Steroids v2.1.38 — Jules comparison brief

This is a **reference and review task**, not an automatic upstream merge. The upstream source is already public and pinned at an immutable revision, so no 66 MB ZIP archive is duplicated into the Headless repository.

## Exact upstream source

- Original project: https://github.com/totec448-spec/chat-on-steroids
- Release: https://github.com/totec448-spec/chat-on-steroids/releases/tag/v2.1.38
- Browse source at version: https://github.com/totec448-spec/chat-on-steroids/tree/v2.1.38
- Version tag: `v2.1.38`
- Resolved upstream commit: `84ecbd69f36e44b8207ab458d73433d56a74d0ee`
- Source changelog: https://github.com/totec448-spec/chat-on-steroids/blob/v2.1.38/CHANGELOG.md
- Local uploaded source archive was named `chat-on-steroids-2.1.38.zip` and its `package.json` declares version `2.1.38`; compare against the pinned upstream source rather than assuming archives are byte-identical.

## User objective

Review new upstream v2.1.38 changes and selectively adopt improvements that make `PastaHimself/chat-on-steroids-Headless` more stable and reliable for multi-hour/multi-day tasks controlled via Discord on Ubuntu VPS with Brave/Xvfb. Do **not** overwrite the Headless-specific implementation with desktop upstream code.

Relevant upstream v2.1.38 release notes include:
- **Fresh turns for long work**: after approximately 30 minutes, continue in a fresh turn following the next tool result. **Upstream explicitly excludes Pro models, Goal, Loop, and sub-agents**; investigate applicability to the actual Headless workflows instead of promising this will solve all long-running tasks.
- **Worker readiness**: delayed wake when a worker's page is not ready.
- **Timeout recovery**: recognize translated ChatGPT error messages and avoid reload loops.
- **Long-running plugin calls**: avoid taking an entire plugin offline after a tool timeout.
- **Concurrent worktree edits**: avoid collisions.
- Other changes: Firefox support, UI approval handling, updates, Usage, sidebar performance — assess relevance but do not indiscriminately port desktop UI features.

## Jules implementation instructions

1. Inspect current `main`, outstanding PRs, HEADLESS-specific architecture, tests, and the pinned original v2.1.38 code/changelog. Review the actual source-level diff, not release notes alone.
2. Identify upstream improvements missing in Headless and assess integration costs, backward compatibility, and whether the feature already exists under a different implementation.
3. Prioritize **correct generation identity, durable message delivery, compaction handoffs, safe rate-limit/backoff, browser reconnect/reload recovery, prevention of duplicate prompts, and multi-hour session health**.
4. Investigate the previously observed logs: `compaction ... refused capture: The handoff response has no exact generation identity`; `Message delivery timed out`; temporary conversation-history access restrictions; exhausted handoff pickups. Separate provider restrictions from actual Headless bugs; fix demonstrated root causes only.
5. For each chosen fix: reproduce, add failing tests, implement a focused change, and validate. Test at-least-once tool delivery vs **at-most-once prompt submission** under ambiguous receipts and session restarts.
6. Preserve VPS/Ubuntu, Brave/Xvfb, Discord, persisted worker/session/queue state, and permissions. No production service restarts, force pushes, secret disclosure, profile deletion, or destructive state migration.
7. Run existing test suites plus relevant fault injection/stress/soak simulations; report which browser tests require a real authenticated session.
8. Deliver a **separate unmerged PR targeting `PastaHimself/chat-on-steroids-Headless:main`** documenting upstream inspiration, behavior changes, test evidence and remaining risks. Do not merge automatically.

## Source-use and licensing

Respect the upstream LICENSE and preserve any required attribution/notices if code is adapted. Avoid copying binary assets or unrelated UI code. This branch only records the review brief.
