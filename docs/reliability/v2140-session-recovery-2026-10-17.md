# Headless session recovery: v2.1.39–2.1.40 adaptations

Target: `PastaHimself/chat-on-steroids-Headless:main`, base
`8fcb271fdd5c47f621db78260427930d8c8e9409` (merged PR #23).
Work uses a new isolated worktree and branch. The original checkout and existing PR #24
are preserved. Upstream is read-only; there is no merge, deployment, service restart,
production-data edit, signed-in provider action or live Discord send in this work.

## Source and compatibility review

The supplied extracted `chat-on-steroids-2.1.40` tree matches **all 1,449 files**, with no
missing, changed or extra files, in upstream tag `v2.1.40`, commit
`429df1cdc7d4e0f7b47d8659af0f72037ec2b310`. Upstream `main` was also inspected read-only at
`855dede8d1eab15e95e5036e656d02c68447d747`. A separate bare comparison clone has a disabled
push URL. No upstream branches, issues or PRs were created.

The original v2.1.40 ZIP is not present in the accessible workspace; this verifies the
extracted snapshot against the tag, not the archive container. Its deterministic file-tree
SHA-256 is `c6091a1c7bee92923c4d1d3e1268cd1ba7e15fc1c277b3c9169bf21eeef31138`
(sorted path, NUL, binary SHA-256 of each file). The retained v2.1.38 ZIP is untouched.
MIT licensing and upstream authorship remain intact; CONTRIBUTORS and commit trailers credit
adapted work by @Maximapple and @Haz4rdovisk.

| Upstream provenance | Headless disposition |
| --- | --- |
| [a62b6bc3](https://github.com/totec448-spec/chat-on-steroids/commit/a62b6bc37e7dc04b9485a035f3ec7548b41a1c3d) — slow accepted native receipts | Adapted with unchanged exact input, native message, original witness, baseline, document and route checks. |
| [ac2cb868](https://github.com/totec448-spec/chat-on-steroids/commit/ac2cb86850e7b90928d745a690eefe492348f470), `baab1a0447c7646f1e88b2a02753dae0bcdde468` — lost acknowledgement replies | Adapted: initial ACK plus four bounded delayed ACKs. No repeated native Send, input claim or tab opening. Explicit refusal stops retries. |
| [de199695](https://github.com/totec448-spec/chat-on-steroids/commit/de199695ffc5f93c305f7f4b3387480b630fc049) — hidden-page Send / route communication | Adapted using existing document checks, page evidence listeners and exact Send epoch; no new polling timer. |
| [56c07dec](https://github.com/totec448-spec/chat-on-steroids/commit/56c07deccbcc6a422eeec28754aa588e4b994a41) — stale companion steals input election | Adapted before offer/election, using the existing stale-build policy. A lone older browser retains its existing grace. |
| [e417c18f](https://github.com/totec448-spec/chat-on-steroids/commit/e417c18fcb11ad0a1145f058dfaca772c215478c) — stale activity after batched fresh-turn transition | Diagnosis reproduced; repaired at the earlier ownership boundary. The recorder's live successor receives the grant. Do not consume an arbitrary old grant on another turn's final. |
| [45c5faa1](https://github.com/totec448-spec/chat-on-steroids/commit/45c5faa18113ef5260d95b79617ce2ce784674e5) — recovery opens in incognito | Adapted through existing normal-window selection for new foreground/revealed chats and deferred revivals. Existing tab elections and opening custody remain. |
| [e935ccef](https://github.com/totec448-spec/chat-on-steroids/commit/e935ccef6620781cc9496c22e8139a541b6527e5), [e9ba1266](https://github.com/totec448-spec/chat-on-steroids/commit/e9ba126682066f8118346949858701c6e9e58055) — Portuguese/German transport failures | Adapted measured exact timeout/interruption phrases and negative announcement tests. They grant no message or generation identity. |
| Source Compact & Resume receipt lifetime | Headless-specific extension of PR #23: the existing source Send witness retains its exact run/document/route lifetime beyond 30 seconds. Click/submit listeners cannot replace its pre-Send answer baseline. Cancellation and foreign navigation revoke it. |
| Fresh-turn Stop and memory-only retry counters | Not copied. Headless's durable one-row source custody, default Off, local-call drain and exact authorization remain. Native Stop must not bypass that owner, and missing Send/receipt cannot earn a second send. |
| Manual Send / legacy retry custody | Headless-specific: an old `Native Send did not take the message.` report also erased authorization and requeued manual inputs. It now retains unconfirmed custody. Existing positive `notTakenRetries` records stay held across restart/history trimming; no missing owner is invented. |
| DOM absence releases an uncertain source dispatch | Rejected: two idle DOM snapshots cannot establish that ChatGPT never accepted a message. Headless retains its fail-closed compatibility endpoint and source/destination dispatch fences. |
| Storage cleanup / larger quotas | Not copied: automatic removal of older chat assets conflicts with preserving user history and does not repair pre-storage truncation. |
| SSH projects, desktop permission/updater/UI changes, approval answering, connector-mention preference | Outside this focused Headless recovery change. No settings or permission defaults are silently migrated. |
| Runtime/package versions and dependencies | Kept Headless app/extension 2.1.34 and bridge protocol 14. Only recorder/background implementation version advances together to 26. No new dependency, AI framework, local model or durable format. |

## Confirmed regressions and safety evidence

Each affected boundary was exercised before its repair; these failures were observed against
the original Headless behavior:

- A 31-second delayed accepted input ACK produced **zero** local turn starts.
- A lost ACK reply returned unsuccessful delivery after one ACK despite an accepted native Send.
- A handoff request read back after 31 seconds, already present in the durable anchor list,
  produced **zero** generations. Its exact source Send happened once.
- A stale companion was offered and reserved an opening before the current companion could poll.
- A batch containing old interrupted end + fresh start left the activity grant on the old turn;
  the fresh final left `possible/exact` work true.
- Foreground recovery created a tab without a regular-window owner; incognito-only cases did
  not create a regular window. Four selected window assertions failed on base (one is the
  adjusted existing regular-window expectation).
- Four exact Portuguese/German transport cases were not recoverable. The two unrelated
  announcement cases already passed.

The hidden-page tests then reproduced six failures before that boundary was repaired: two
missing route-only receipts (both timed out at the unchanged 30-second test bound), one
unhandled background route notice, one final answer with no generation, one missing exact-document
route notification and one Core mention held behind a throttled timer. Two adjacent cases passed
on base. The patched eight selected hidden-page cases pass.

Review also found and reproduced a race in the first activity adaptation: pause old-end/fresh-start
processing at outbox revocation, record the fresh final, then release the paused callback. It
resurrected activity after completion. Publish the fresh owner before the await and recheck that
same grant after each revocation await. The regression and all eleven rotation/transition tests
pass, including a 48-cycle simulation representing 24.8 hours, one durable session and no duplicate
prompts. This is simulated time, not a live soak. Two full verification starts were deliberately
interrupted during review; their partial results are not counted as a completed run. Review's
source-identity negative also reproduced an unclicked prepared receipt taking another document's
already-recorded handoff as its own. The original source click/submit listener now marks actual
witnessed dispatch on that same receipt; insertion or refused authorization supplies no Send proof.
The new negative has zero native clicks and must produce zero local generations.

The new adjacent tests cover bounded lost-ACK exhaustion and explicit rejection with one Send,
identical receipt payloads and one authorization; cancellation/foreign-chat revocation of a
delayed handoff; old-final replay after a newer active turn; regular-window fallback and
windowless API compatibility. Existing suites retain strict duplicate-generation/duplicate-final
refusal, late UUID enrichment, stale/reopened boundary rejection, recorder capture after pickup
exhaustion, long local tools, crashes/restarts, WAL persistence failures, outbox fencing,
Goal/worker/session transfer and Discord controls. No permissive generation join was added.

The final Send audit reproduced **five** further fail-first cases: a legacy DOM non-delivery
report cleared the native owner and authorization and requeued a potentially delivered prompt
both warm and after restart; legacy queued/browser/failed rows with positive `notTakenRetries`
were mislabeled pending/not-sent. The outbox now retains original known receipts and treats that
existing counter as uncertainty evidence. Five new regressions plus the neighboring provably
pre-authorization failure and existing receipt cases pass. A 55-cancellation/cold-restore check
retains the original text and unknown receipt without inventing its erased owner. The native
page clears only its untouched draft and reports receipt uncertainty, not provider rejection.

## Changed files

| File | Responsibility |
| --- | --- |
| `src/main/bridge.ts` | Stale-companion offer gating and exact successor activity publication. |
| `src/main/session/input.ts` | Fence legacy DOM-based resend and retain restored uncertain retry rows without guessing missing ownership. |
| `extension/content.js` | Source receipt lifetime, slow/lost ACKs, route/Send epoch handling; recorder 26. |
| `extension/background.js` | Exact-document route notices, regular-window placement; recorder 26. |
| `extension/chatgpt-dom.js` | Message-task mention readiness and measured transport recognition. |
| `test/session-input.test.ts` | Warm/cold lost-receipt fencing, legacy retry holds, history retention and genuine pre-authorization failures. |
| `test/content-script.test.ts` | Shipped-recorder delayed receipts, bounded ACKs, cancellation/navigation, hidden final ownership. |
| `test/extension.test.ts` | Exact-document route notifications and implementation-version fixtures. |
| `test/chatgpt-dom-input.test.ts` | Throttled mention readiness and localized transport classification. |
| `test/background-window.test.ts` | Incognito exclusion, regular-window fallback and windowless API compatibility. |
| `test/bridge.test.ts` | Stale companion cannot reserve input before a current browser. |
| `test/bridge-turn-rotation.test.ts` | Ordinary/Goal/Loop batched transition, old replay, concurrent-final race and existing soak. |
| `test/compact-source-script.test.ts` | Existing native compaction fixture checks its revocable receipt lifetime. |
| `AGENTS.md` | Owning contracts and validation boundaries. |
| `CONTRIBUTORS.md` | Upstream authorship. |
| This worklog | Comparison, fail-first evidence, actual checks and limitations. |

## Validation

Node 24.19.0; full verification uses at most two Vitest workers. Tests use isolated
stores and `CLF_BRIDGE_PORTS=0`; production bridge ports and profiles are excluded.

- `npm run build`: pass.
- `npm run discord:build`: pass.
- `npm run verify:headless`: pass on real Electron/Xvfb and Brave, using a new private display,
  temporary data/profile and ephemeral bridge port. Authenticated local health, zero application
  windows, SIGTERM drain/endpoint removal, same-profile browser handoff and restart all passed.
  No provider account, Discord delivery or production service was involved. Xvfb was extracted
  into a temporary tool directory; no system package or service was installed.
- Initial `COS_TEST_WORKERS=2 npm run verify` before the final manual-Send fence: **8,740 passed, 140 skipped, 4 failed** across three files. All changed recovery suites passed.
  Privacy, production/Discord license notices, native-source metadata and both typechecks pass.
  Read-only sampling of an isolated test worker confirmed progress through
  renderer code; no assertion, timeout, retry or skip configuration was changed.

## Existing full-suite failure

The full run reports `renderer-timeline.test.ts`:
`retains the visible collapsed group beyond the normal resident target and still admits newer data`.
At its existing line 4524, the fixture expects 400 visible tool rows and sees 330. An isolated
rerun fails identically on this branch **and on unchanged main** at `8fcb271f` in a separate
baseline worktree using the same Node/dependencies. Renderer code and this test are unchanged.
This is a reproduced baseline failure, not a clean full-suite pass or a claimed live UI repair.
No assertion, timeout or skip list was changed to conceal it. The initial full run also failed the quick Disconnecting display case in `renderer-state.test.ts`
and two Windows sky cases in `code-mode-runtime.test.ts`. Baseline isolation reproduces the
Windows sky-values failure as well; the sky-error and Disconnecting cases pass in that isolated
baseline run. Patch isolation reproduces the sky-values and Disconnecting failures and passes
the sky-error case. These differing timing results do not establish an application regression. The second sky case's full-run output was `CODE_MODE_CPU_LIMIT` instead of the
expected error. No clean full-suite pass or definitive explanation for those transient failures
is claimed. Final post-fence full-suite totals are recorded in the PR description. The verification script stops before its final serial phase
on failure. That phase was run explicitly: **6 shutdown tests passed / 22 existing Linux platform
skips**. The final manual-Send fence also passes both builds and the isolated smoke again. Final full-suite totals are recorded in the PR description so this source report remains a stable record of the fail-first investigation.

## Remaining limitations

Historical finals without exact generation/terminal proof remain blocked. Multiple real
responses to one handoff remain ambiguous; the latest response is never selected. A source
reload cannot recover an unwitnessed Send by timing or missing DOM rows. Lost ACK exhaustion
retains uncertainty and existing durable custody rather than replaying the prompt.

The default-Off optional fresh-turn feature still requires the native Send path to accept it;
upstream's automatic Stop fallback is deliberately not enabled under Headless's current
ownership contract. Provider history cooldowns, local-tool drain, bounded pickup schedules and
uncertain dispatches retain their existing authority.

Automated page/extension fixtures and an isolated uncredentialed browser smoke cannot establish
signed-in ChatGPT compatibility, a live Discord delivery or a multi-day authenticated soak.
The user's restriction on active sessions takes precedence over AGENTS.md's live-provider
acceptance workflow. Those live gates require a separately authorized disposable test session;
this PR makes no live-production repair or deployment claim.
