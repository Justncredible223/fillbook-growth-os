# External Write Firewall

The single most important rule in this system: **Fillbook Growth OS never
autonomously publishes, sends, submits, replies, comments, DMs, likes,
reposts, follows, or otherwise communicates externally on behalf of
FillbookHQ.** The human owner always performs the final public action.

This already matches how growth work has actually been done on FillbookHQ
(see `docs/social/MASTER_SOCIAL_STRATEGY.md` and `docs/CLAUDE_HANDOFF.md` in
the `fillbookhq` repo) — this system formalizes existing practice as a
technical control, not a new restriction.

## Classification

Every operation the backend can perform is classified into exactly one of:

| Class | Meaning | Examples |
|---|---|---|
| `READ` | Reads public or authorized data. No side effects outside Growth OS. | Fetch Search Console data, read X mentions via API, crawl a public page, read aggregated product analytics. |
| `INTERNAL_WRITE` | Writes only inside Growth OS's own database/storage. | Save a signal, score an opportunity, save a draft, write an audit log row. |
| `EXTERNAL_DRAFT` | Prepares a draft or opens an officially-supported handoff that still requires the human to deliberately publish. | Render a video to storage, open TikTok's composer with content pre-filled, generate a YouTube upload payload staged as private/draft. |
| `EXTERNAL_WRITE` | Communicates externally / changes external public state. | Post, reply, comment, DM, like, follow, repost, public upload, submit a form, modify a public profile, start an ad, buy promotion. |

## Enforcement

- `backend/src/firewall/externalWriteFirewall.ts` is the **only** code path
  allowed to call any external-platform client (X, TikTok, YouTube, etc.).
  No other module may import a platform SDK/client directly — enforced by
  code review and by an eslint boundary rule (added when platform
  integrations land in later phases).
- The firewall's `authorize(action)` function is a pure classifier +
  guard: given an action's declared class, it throws for any class
  `=== 'EXTERNAL_WRITE'`, unconditionally, with no config flag, no admin
  override, no environment variable, and no "autopilot" mode that changes
  this behavior. This is enforced in code, not configuration — there is
  nothing to misconfigure into an unsafe state.
- Every call through the firewall is recorded in `audit_logs` regardless of
  outcome (allowed, drafted, or rejected).

## What "no override" means concretely

There is intentionally no code path, table flag, environment variable, or
admin API that flips `EXTERNAL_WRITE` to allowed. Search
`backend/test/firewall.test.ts` for the enumerated list of prohibited
actions this is tested against — that test file is the living contract.

## Later-phase platform integrations must fit this model

When X/TikTok/YouTube integrations are built (later phases), their code
must express every capability as one of the four classes above and route
through the firewall. If a platform's official mechanism blurs the line
(e.g. an API that can create a "private" YouTube upload), the default is to
classify conservatively as `EXTERNAL_WRITE` unless it can be shown the
object is not publicly reachable and requires a further explicit human
action to become public — see `docs/ARCHITECTURE.md`'s YouTube section
placeholder for the decision to make when that phase starts.
