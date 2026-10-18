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
pnpm --filter @workspace/cli exec tsx src/main.ts --server http://localhost:4001
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
Commands are serialized. Malformed input produces an error result and the
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
  `eligibleRecipientIds` for the donor, and `remainingMs`; trades include
  `remainingMs`. Remaining time is computed when a status/notice is produced,
  not a periodic ticker. Absolute `expiresAt` is authoritative from the server.

A synchronized state pairs the public room version with this seat's private
snapshot. Wait for synchronization before choosing a move. `myTurn` alone does
not override a pending gift, roulette, or other server rule.

## Commands

| Action             | Fields                                                      | Behavior                                                                                                    |
| ------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `help`, `status`   | None                                                        | List actions or read the local latest snapshot.                                                             |
| `watch`            | `enabled`: boolean                                          | Toggle unsolicited state/connection output.                                                                 |
| `create`           | `name`                                                      | Create a room and join its host seat using one in-memory session.                                           |
| `join`             | `code`, `name`                                              | Join a room; cannot change this process to a different room/name.                                           |
| `ready`            | `ready`: boolean                                            | Set lobby readiness.                                                                                        |
| `start`, `restart` | None                                                        | Server checks host/crown, readiness and match state. `restart` immediately deals the next match.            |
| `play`             | `cardIds`; optional play decisions below                    | Submit the entire play atomically.                                                                          |
| `stage`            | `cardIds`; optional play decisions                          | Optional public preview. An empty list clears staging. Staging does not play cards.                         |
| `draw`             | None                                                        | Draw one when permitted, including the final draw-card escape during a stack.                               |
| `pass`             | None                                                        | Pass after drawing. It **does not commit staged cards**. Use `play` to commit.                              |
| `penalty`          | None                                                        | Take the accumulated draw penalty.                                                                          |
| `roulette`         | None                                                        | Reveal one roulette card; repeat from the updated pending state until resolved.                             |
| `catch-uno`        | `targetPlayerId`                                            | Catch a player listed in your `catchablePlayerIds`.                                                         |
| `trade-offer`      | `cardId`, `targetPlayerId`                                  | Offer your own card to an eligible target.                                                                  |
| `trade-respond`    | `offerId`, `accept`; `cardId` when accepting                | Accept with your own card, or decline.                                                                      |
| `trade-cancel`     | `offerId`                                                   | Cancel your own offer.                                                                                      |
| `gift`             | `giftId`; optionally `cardId` and `targetPlayerId` together | Send a card from your own frozen gift hand, or omit both optional fields to skip.                           |
| `resync`           | None                                                        | Rejoin the same seat and receive an authoritative public/private snapshot. Clears the unknown-outcome lock. |
| `quit`             | None                                                        | Disconnect and exit.                                                                                        |

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
| Wild colors and color roulette                                                | `chosenColor` on play; `roulette` one reveal at a time; CLI tests.                                        |
| Discard All extras/top card/action suppression/finish                         | Explicit discard fields; CLI and engine tests.                                                            |
| Optional single 0 cycle / single 7 swap                                       | Play decisions; CLI tests. Grouped 0/7 does not activate transfers, following the server.                 |
| Draw once, pass, forbidden power-card finish, final draw-card stack escape    | CLI tests and existing game suites.                                                                       |
| UNO declaration and catching                                                  | `declaredUno`, `catch-uno`; deterministic CLI tests.                                                      |
| Trade offer/accept/decline/cancel/expiry                                      | Commands and countdown supported; CLI accept/decline/cancel tests, existing party expiry tests.           |
| Mercy elimination, gift/skip/recipient constraints/expiry/disconnect          | CLI tests for all these cases plus existing party/roulette/socket suites.                                 |
| Match victory and subsequent match                                            | Seeded CLI finish/restart test and real-server subprocess full-match test.                                |
| Reconnect/resync, serialized commands, uncertain/duplicate sends              | Dedicated CLI tests; no exactly-once claim or blind replay.                                               |
| Seat ordering, chat, vote-kicks, avatar reactions                             | Deliberately not exposed. Public effects remain visible; existing server permissions/rules are unchanged. |
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
port, run the actual CLI, and play alongside a browser-protocol client through a
complete match. They do not open a browser, read a production hand, request media
permissions, or contact a live room. There are no required server, web, or mobile
runtime changes for this CLI.
