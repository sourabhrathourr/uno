# UNO CLI

A persistent JSON Lines client for the existing UNO No Mercy server. It opens one
ordinary player seat, receives public room state and its own hand, and submits
commands through the same typed Socket.IO protocol used by the web/mobile apps.
It does not choose moves autonomously. A terminal tool or bot can use it without
screen coordinates, card animations, or multiple staging clicks.

## Run

Requires the repository checkout, Node 24 and pnpm 9.15.9. Install dependencies
with `pnpm install --frozen-lockfile`. Start a local server in another terminal:

```sh
pnpm --filter server start
```

Start the client from the repository root:

```sh
pnpm cli --server http://localhost:4001
pnpm cli --server http://localhost:4001 --create --name "CLI host"
pnpm cli --server http://localhost:4001 --room ABC123 --name "CLI player"
pnpm cli --help
```

The default server is localhost. Connecting to another server requires explicitly
passing its origin. Do not point test clients at an ongoing match. The server URL
must be an HTTP(S) origin without credentials, paths, query parameters or fragments.
For raw JSON output without pnpm's command banner, use:

```sh
pnpm --filter @workspace/cli exec node --import tsx src/main.ts --server http://localhost:4001
```

Keep the process and stdin open for the duration of play. Each process generates
a fresh session in memory: it never reads browser storage, accepts a borrowed
session, saves credentials, or takes over an existing browser seat. Network
reconnections restore this same in-memory seat. Exiting loses that session; a
new process gets a new seat. A new seat joining a match in progress waits for the
next match, following existing room rules. After a confirmed or uncertain join,
one process is restricted to that room and name. A definitive first-join rejection
allows correcting the room/name in the same process. EOF, `quit`, SIGINT, or
SIGTERM disconnects it.

## Input and output

Send one JSON object per line. Optional string/number `id` values are echoed for
correlation; they are **not** server idempotency keys. Every input command is a
new request, so do not resend a mutation just because its reply was missed.
Mutations are serialized. Read-only `status`, `wait-for-action`, and `quit` remain
responsive during another request; `quit` immediately closes the seat and may
interrupt an in-flight action. Malformed input produces an error result and the
process remains usable. The line limit is 64 KiB.

```json
{"id":1,"action":"join","code":"ABC123","name":"CLI player"}
{"id":2,"action":"watch","enabled":true}
{"id":3,"action":"ready","ready":true}
{"id":4,"action":"status"}
```

Stdout from the client is JSON Lines: a `ready` header, `result` responses, and
`state`/`connection` notices. Errors include a code and message. Disable unsolicited
state/connection notices with `watch` set to false; errors and command replies
remain enabled. No voice connections are opened.

`status` and notices include:

- `connected`, `joined`, `synchronized`, `myTurn`, and `needsResync`.
- `room`: public players/counts, rules, turn, color, top card, draw stack, staged
  public cards, choices, events, and results.
- `self`: this seat's hand and exact card IDs, playable **single** card IDs,
  UNO catches, action flags, frozen gift cards, and eligible trade/gift targets.
- `pending`: public roulette/trade/gift choices. Gifts include `isMine`,
  `actionable`, `eligibleCardIds`, `eligibleRecipientIds`, a ready-to-send
  `skipCommand`, and `remainingMs`. Actionable IDs/skip are exposed only for a
  synchronized donor before expiry, with no uncertain action; trades include
  `remainingMs`. Remaining time is computed when a status/notice is produced,
  not a periodic ticker. Absolute `expiresAt` is authoritative from the server.

A synchronized state pairs the public room version with this seat's private
snapshot. Wait for synchronization before choosing a move. `myTurn` alone does
not override a pending gift, roulette, or other server rule.

## Commands

| Action             | Fields                                                        | Behavior                                                                                                    |
| ------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `help`, `status`   | None                                                          | List actions or read the local latest snapshot.                                                             |
| `watch`            | `enabled`: boolean                                            | Toggle unsolicited state/connection output.                                                                 |
| `create`           | `name`                                                        | Create a room and join its host seat using one in-memory session.                                           |
| `join`             | `code`, `name`                                                | Join a room; cannot change this process to a different room/name.                                           |
| `ready`            | `ready`: boolean                                              | Set lobby readiness.                                                                                        |
| `start`, `restart` | None                                                          | Server checks host/crown, readiness and match state. `restart` immediately deals the next match.            |
| `play`             | `cardIds`; optional play decisions below                      | Submit the entire play atomically.                                                                          |
| `stage`            | `cardIds`; optional play decisions                            | Optional public preview. An empty list clears staging. Staging does not play cards.                         |
| `draw`             | None                                                          | Draw one when permitted, including the final draw-card escape during a stack.                               |
| `pass`             | None                                                          | Pass after drawing. It **does not commit staged cards**. Use `play` to commit.                              |
| `penalty`          | None                                                          | Take the accumulated draw penalty.                                                                          |
| `resolve-roulette` | None                                                          | Resolve your pending roulette sequentially, awaiting each acknowledgement and synchronized state.           |
| `wait-for-action`  | Optional `afterVersion`, `timeoutMs` (1–60000, default 60000) | Wait without polling; return actionable reasons and current state, or `timedOut: true`.                     |
| `roulette`         | None                                                          | Reveal one roulette card; repeat from the updated pending state until resolved.                             |
| `catch-uno`        | `targetPlayerId`                                              | Catch a player listed in your `catchablePlayerIds`.                                                         |
| `trade-offer`      | `cardId`, `targetPlayerId`                                    | Offer your own card to an eligible target.                                                                  |
| `trade-respond`    | `offerId`, `accept`; `cardId` when accepting                  | Accept with your own card, or decline.                                                                      |
| `trade-cancel`     | `offerId`                                                     | Cancel your own offer.                                                                                      |
| `gift`             | `giftId`; optionally `cardId` and `targetPlayerId` together   | Send a card from your own frozen gift hand, or omit both optional fields to skip.                           |
| `resync`           | None                                                          | Rejoin the same seat and receive an authoritative public/private snapshot. Clears the unknown-outcome lock. |
| `quit`             | None                                                          | Disconnect and exit.                                                                                        |

Play/stage decisions: `chosenColor` (`red`, `green`, `blue`, `yellow`),
`declaredUno` (boolean), `rotateHands` (boolean), `swapWithPlayerId`.
`play` also accepts `discardCardIds` and `topCardId`. Exact card IDs come from
`self.hand`; indices are deliberately unsupported because a draw/swap can change
hand order. The server validates combinations and turn rights. A `play` can
include cards not individually playable when a matching group allows them.

Examples (replace placeholder IDs with your own current IDs):

```json
{"action":"start"}
{"action":"play","cardIds":["red-five","blue-five"],"declaredUno":true}
{"action":"play","cardIds":["wild-six"],"chosenColor":"blue"}
{"action":"play","cardIds":["red-seven"],"swapWithPlayerId":"eligible-player"}
{"action":"play","cardIds":["red-zero"],"rotateHands":true}
{"action":"play","cardIds":["red-discard"],"discardCardIds":["red-two","red-reverse"],"topCardId":"red-two"}
{"action":"draw"}
{"action":"pass"}
{"action":"gift","giftId":"pending-gift","cardId":"my-frozen-card","targetPlayerId":"eligible-recipient"}
{"action":"gift","giftId":"pending-gift"}
```

Wild color is part of the atomic `play`, not a later pending-color command. For
Discard All, `cardIds` contains the primary discard card only; explicitly name
same-color extras in `discardCardIds`. Extra cards' action effects do not fire.
The `declaredUno` decision must accompany the play that leaves one card.

## Last gift and deadlines

Mercy elimination can produce a last gift while at least two active players
remain. All normal play pauses while gifts are pending. Only the front gift's
donor sees its frozen cards and `giftTargetPlayerIds`/`eligibleRecipientIds`.
Choose one of these server-provided targets: it must be active, connected, and
have fewer cards than the room's mercy limit. At the default limit, a 24-card
recipient can receive one card; a 25-card recipient cannot. Gifts do not play
the donated card or trigger its action.

The server starts a ten-second deadline for the front gift, validates the choice,
and acknowledges success or rejection. Send promptly; `remainingMs` is an
estimate based on the local clock and must not be used to extend a deadline.
The CLI never auto-selects a recipient or auto-skips. Server expiry removes the
choice and resumes play or advances the gift queue. A resync on the existing
connection preserves the deadline. **A donor losing its final connection causes
the server to skip the gift**; reconnecting restores the seat, not the old gift.
Stale gift IDs are rejected. These are existing rules, not CLI changes.

## Connection safety

A mutation is sent once while connected; there is no automatic mutation retry or
offline buffering. If acknowledgement times out or the connection drops before
confirmation, the result is `outcome-unknown`: the move may already have applied.
Further queued mutations fail with `resync-required`. Inspect `status`, then
explicitly `resync`, inspect again and choose a new move. Automatic reconnect
alone does not clear this lock. Acknowledged moves return `confirmed: true` even
if a subsequent private snapshot is delayed; their `state.synchronized` may then
be false. Never replay a move solely because the old hand remains visible.

`expectedVersion` is an optional field on commands, checked immediately before a
mutation is sent. A mismatch returns `stale-version`. This is a local stale-choice
check, **not** an atomic server compare-and-swap or exactly-once guarantee.

This client exposes no raw socket events, spectator/support views, squad chat,
other-player sessions or analysis endpoints. This is a client-side allowlist;
it does not add a server-enforced bot role or change other clients' permissions.
Own-hand output is private: do not publish CLI logs to opponents or shared logs.

## Gameplay coverage and deliberate exclusions

| Existing capability/rule                                                      | CLI support / verification                                                                                |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Create/join/readiness/start/restart; waiting players and crown/host authority | Commands supported; CLI lifecycle/match tests and existing server next-match/waiting suites.              |
| Public state and own private hand; snapshots/turn watching                    | Supported; cross-player/foreign/stale-state isolation and subprocess tests.                               |
| Numbers, same-number groups, legal/illegal color/symbol matching              | Atomic `play`; deterministic CLI tests plus game suites.                                                  |
| Skip, Skip Everyone, Reverse, grouped actions, two-player Reverse             | `play`; deterministic CLI effect matrix plus existing engine coverage.                                    |
| Colored +2/+4, wild +4/+6/+10, Reverse +4/+10, cumulative stacks              | `play`/`penalty`; CLI matrix/stack tests and draw-stack/reverse-ten suites.                               |
| Wild colors and color roulette                                                | `chosenColor` on play; `roulette` once or sequential `resolve-roulette`; CLI tests.                       |
| Discard All extras/top card/action suppression/finish                         | Explicit discard fields; CLI and engine tests.                                                            |
| Optional single 0 cycle / single 7 swap                                       | Play decisions; CLI tests. Grouped 0/7 does not activate transfers, following the server.                 |
| Draw once, pass, forbidden power-card finish, final draw-card stack escape    | CLI tests and existing game suites.                                                                       |
| UNO declaration and catching                                                  | `declaredUno`, `catch-uno`; deterministic CLI tests.                                                      |
| Trade offer/accept/decline/cancel/expiry                                      | Commands and countdown supported; CLI accept/decline/cancel tests, existing party expiry tests.           |
| Mercy elimination, gift/skip/recipient constraints/expiry/disconnect          | CLI tests for all these cases plus existing party/roulette/socket suites.                                 |
| Match victory and subsequent match                                            | Seeded CLI finish/restart test and real-server subprocess full-match test.                                |
| Reconnect/resync, serialized commands, uncertain/duplicate sends              | Dedicated CLI tests; no exactly-once claim or blind replay.                                               |
| Public chat, replies, reactions, typing and mentions                          | Explicit `chat-*` commands; deduplicated notices and off-turn mention wakeups.                            |
| Seat ordering, vote-kicks, avatar reactions                                   | Deliberately not exposed. Public effects remain visible; existing server permissions/rules are unchanged. |
| Support/spectator private-hand reads and squad operations                     | Deliberately excluded to keep the client own-hand/public-state only.                                      |
| Voice join/state/signaling and microphones                                    | Deferred; never opened by this client.                                                                    |
| Autonomous strategy, paid model integration, persisted sessions               | Not included. A controller supplies the CLI's commands; no API/model costs are introduced.                |

## Test and check

Run from the repository root with local loopback networking permitted:

```sh
pnpm exec vitest run --project cli
pnpm test
pnpm --filter @workspace/cli typecheck
pnpm --filter server typecheck
pnpm --filter web typecheck
```

CLI integration fixtures use real Socket.IO/RoomManager with deterministic local
hands. Subprocess tests start the actual server entrypoint on an ephemeral local
port, build/copy the standalone bundle to an isolated temporary directory, launch
it with Node only, and play alongside a browser-protocol client through a
complete match. They do not open a browser, read a production hand, request media
permissions, or contact a live room. There are no required server, web, or mobile
runtime changes for this CLI.

## Quiet controller loop

Disable watch notices once, then request a bounded event-driven wait:

```json
{"id":"quiet","action":"watch","enabled":false}
{"id":"next","action":"wait-for-action","afterVersion":42,"timeoutMs":60000}
```

`wait-for-action` returns `{timedOut, reasons, state}`. Reasons include `turn`,
`roulette`, `gift`, `trade-response`, `catch-uno`, `eliminated`, `finished`,
`join-required`, `disconnected`, `resync-required`, `cancelled` (stdin EOF), and `closed`. It only uses
public state and this seat's private snapshot. `afterVersion` requires a newer
room version for gameplay reasons, so pass the version already handled to avoid
returning the same opportunity repeatedly. Connection/closed/resync reasons
always wake the wait. Omit `afterVersion` to return an existing opportunity
immediately. A lobby without gameplay opportunities waits for a change or timeout.
Only one wait may be outstanding; it does not block mutations, status or quit.
After a timeout, issue another wait. Timed gift/trade choices pause turn notices;
expired choices are never reported as actionable. Server updates remain authoritative.

Resolve roulette without a request for each reveal:

```json
{ "id": "roulette", "action": "resolve-roulette", "expectedVersion": 43 }
```

This client operation sends the existing `game:drawRouletteCard` API one at a time.
It stops when the chosen color resolves, the player is eliminated, the turn/match
changes, the transport disconnects, synchronization is missing, or an outcome is
uncertain. It never retries or pipelines draws. The result includes `complete`,
`confirmedDraws`, `stopReason`, and `state`; an interrupted operation has
`complete: false` even though the JSON command returned a result. An uncertain
reveal is **not** included in `confirmedDraws` even if a snapshot shows it.
Inspect the returned state, explicitly `resync` after `outcome-unknown`, and choose
a fresh command; reconnect alone does not restart the operation. `expectedVersion`
checks only the initial choice; each later reveal uses acknowledged current state.
Penalty acceptance still uses `penalty`, and multi-card plays still use `play`.
These helpers choose no strategy, cards, colors or recipients.

## Portable non-container launch

Build once in a checkout with Node 24 and pinned pnpm 9.15.9:

```sh
pnpm install --frozen-lockfile --filter uno --filter @workspace/cli...
pnpm --filter @workspace/cli build
node apps/cli/dist/uno-cli.cjs --help
```

Copy **only `apps/cli/dist/uno-cli.cjs`** to a Node 24 cloud machine, then launch:

```sh
node /opt/uno/uno-cli.cjs --server https://YOUR_GAME_SERVER_ORIGIN
```

The CommonJS bundle includes Socket.IO and its JavaScript transport dependencies.
Runtime needs Node 24 built-ins, outbound HTTP(S)/WebSocket access, and an open
stdin/stdout connection to one controller. No repository, pnpm, tsx, native
accelerators, browser, container, or extra runtime npm install is needed. The
build metadata `dist/meta.json` is for inspection, not runtime. `start` also uses
`node --import tsx` to avoid the tsx executable's helper IPC socket in restricted
cloud shells; this development path still needs the checkout and dev dependencies.

Use a long-lived worker/VM process connected to a trusted JSONL controller; the
CLI is not an HTTP service or a serverless function. Keep stdin open and drain
stdout continuously. EOF, `quit`, SIGINT and SIGTERM terminate the process and
close the socket; signal/quit wakes pending waits. Run one controller and one
CLI process per seat, serialize decisions, and wait for replies before choosing
another mutation. Do not let another controller drive the same seat concurrently.
Restrict stdout logs: they contain this player's own hand, although no session
credential is printed. No controller, hosting account, credentials, supervisor,
or cloud deployment is provisioned by this package.

A transport reconnect within the same process restores its in-memory seat.
Unknown acknowledgements still require explicit resync and new decisions.
Process exit/restart loses that session: a supervisor restart starts a **new**
seat and must not replay old commands or try to migrate an existing browser/Mac
seat. Start a fresh room/seat on the cloud worker when coordinated with players;
this package does not transfer live sessions. Validate on a local test server
before connecting a new cloud seat to a real game.

The launcher honors `HTTPS_PROXY`/`https_proxy` for HTTPS servers,
`HTTP_PROXY`/`http_proxy` for HTTP servers, and `ALL_PROXY`/`all_proxy` as a
fallback. Lowercase values take precedence. Both room creation and Socket.IO
WebSocket/polling use the same HTTP(S) CONNECT agent. `NO_PROXY`/`no_proxy`
bypasses the proxy for comma/space-separated exact hosts, optional ports,
leading-dot or `*.` domain suffixes, bracketed IPv6, or `*` for all hosts.
Use `NO_PROXY=localhost,127.0.0.1,[::1]` for direct local testing when a proxy is
configured. Proxy credentials stay in the environment and never appear in
JSONL output; invalid configuration produces a redacted error. TLS certificate
verification stays enabled. The agent's connections close with the client.

## Staged plays, public chat and timing

`stage-play` accepts the same fields as `play`, previews the full selection in
one request, waits for its acknowledgement and synchronized state, then commits
with `game:playCards`. It never calls `game:endTurn` after playing. Discard All
extras are previewed together while the commit preserves `discardCardIds` and
`topCardId`. `previewMs` is an optional 0–500 ms presentation hold (default 180).
This adds a staging round trip and the chosen hold; it does not wait for a remote
browser paint or choose cards for you. Any staging rejection, uncertainty,
disconnection or changed selection stops the commit. Inspect status before
choosing again; unknown acknowledgements require explicit resync.

```json
{"action":"stage-play","cardIds":["my-red-five","my-blue-five"],"declaredUno":true}
{"action":"chat-read","limit":100}
{"action":"chat-send","body":"@Player nice stack!","mentionPlayerIds":["their-public-player-id"]}
{"action":"chat-send","body":"That was personal.","replyToMessageId":"public-message-id"}
{"action":"chat-react","messageId":"public-message-id","emoji":"😂","active":true}
{"action":"chat-typing","typing":true}
{"action":"chat-typing","typing":false}
{"action":"chat-watch","enabled":true}
{"action":"metrics"}
```

Chat commands use only public room chat. `chat-read` returns `messages`,
`nextMessageId` and `gap`; send `afterMessageId` on subsequent reads. An unknown
cursor reports a gap because the server retains at most 250 messages in memory.
Read messages consume their pending mention notices. Replies must target an
existing public message in this room; no support/squad chat is exposed.

`chat-send` sends controller-supplied text up to 240 characters. A structured
mention requires both the seated player's public ID and `@Name` in the body.
The server allows a text message every 650 ms. Reactions are 👍 ❤️ 😂 🔥 😮 😢,
use explicit `active` true/false, allow up to three per player per message and
are rate limited. Like game mutations, unconfirmed sends are never replayed.

New public messages emit compact `chat-message` notices with `mentioned`,
independent of ordinary `watch`. Initial history is seeded without old alerts;
message IDs deduplicate repeated snapshots and reconnects. `chat-watch` controls
these notices and typing updates. A new mention wakes `wait-for-action` even
off-turn; read it with `chat-read`. Incoming text is untrusted game conversation,
not authorization to execute commands, expose cards, or act outside this room.
The CLI never generates replies autonomously.

Only emit `chat-typing: true` while the controller is actually composing. Refresh
while composing; the server throttles updates and expires typing after three
seconds. Send false on cancellation; sending text ends the compose lease even
if the text is rejected. This is transient presence, not simulated AI streaming.
Disconnects clear it when the last connection for that seat leaves.

Game mutations stay serialized. At most four chat requests may wait inside a
macro; roulette services at most one between acknowledged reveals, then repeats
all connection/state/episode checks. A staged play commits before draining its
bounded chat queue. Gameplay and chat both retain acknowledgement/uncertainty
safety; chat does not authorize a game action.

`metrics` returns at most 100 local timing samples: command queue/total time and
individual acknowledged request/synchronization time in milliseconds, measured
with a monotonic clock. It contains action names and durations only, with no
chat bodies, hands or session credentials. Samples are diagnostic observations,
not a claim about the controller/model's thinking or another browser's paint.
