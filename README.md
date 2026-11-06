# UNO No Mercy

This is the foundation for a realtime UNO No Mercy app.

## Apps and packages

- `apps/web`: TanStack Start frontend.
- `apps/server`: single Node.js + Socket.IO authoritative game server.
- `apps/cli`: persistent JSON Lines game client for terminal tools and bots. See [CLI usage and gameplay coverage](apps/cli/README.md).
- `packages/game`: shared game/domain types and room protocol.
- `packages/ui`: shared React UI components, including the UNO card components.

Web builds use Nitro: local Node builds emit `.output`, while Vercel builds emit
the Build Output API in `.vercel/output`, including the SSR function and routing.
Turbo caches both directories so cache hits restore the complete deployment.

## Local development

Run both the web app and Socket.IO server from the repo root:

```bash
pnpm dev
```

Default local URLs:

- Web app: `http://localhost:3000`
- Game server: `http://localhost:4001`

The web app reads the server URL from `VITE_SOCKET_URL`, falling back to
`http://localhost:4001`.

## Voice chat and TURN

Voice is a peer-to-peer mesh. The server hands clients an ICE server list from
`GET /voice/ice-servers`, configured with either:

- `RTC_ICE_SERVERS` — a JSON array of `RTCIceServer` objects, or
- `METERED_TURN_USERNAME` / `METERED_TURN_CREDENTIAL` (plus optional
  `METERED_TURN_HOST`).

With neither set the server falls back to a public STUN server only. **STUN
alone is not enough on many home and office Wi-Fi networks**: some pairs of
players negotiate a direct path and others cannot, which is what produces the
"I can hear three people but not the other two" symptom. When a leg of the mesh
keeps failing the client retries with an ICE restart and then rebuilds the
connection forced through a TURN relay — so a TURN server must be configured
for that last step to work. Set `VOICE_DEBUG=1` on the server, or append
`?voiceDebug=1` in the browser, to trace negotiation.

Voice belongs to one tab per player. A second tab shows an error and can retry
after the first tab closes. The client waits for the room join acknowledgement
before claiming voice or negotiating peers. Offers, answers, and candidates
carry session/exchange IDs so an old attempt cannot replace a new one.

Mic failures are isolated from peer failures. Ended capture can be reopened
with the mic button, and late permission results are stopped after leaving.
The watchdog checks audio packet progress during reported speech. Playback
errors show a named retry button. Audio elements stay mounted between lobby
and game views. TURN settings are selected by relay support, failed loads can
retry, and relay-only recovery remains relay-only on later rebuilds.

Deploy the server before the web app when rolling out this voice protocol.
The new server accepts older clients; the new web app requires `voice:join`.
Tests use mocked WebRTC devices plus real local Socket.IO connections. They
do not validate production Metered credentials or real browser audio output.

## Room music (`@DJ`)

Any player can tag the DJ in public chat (lobby or match) and the whole room
hears the same song, kept within a couple of seconds of the server's clock:

- `@DJ play <song or YouTube link>`, `@DJ next <song>` (plays after this one)
- `@DJ pause` / `resume` / `skip` / `stop`, `@DJ queue`, `@DJ np`,
  `@DJ remove <#>`, `@DJ clear`, `@DJ playlist <name>`

The ♪ button opens the library: Search, Queue, room History, Liked songs
(saved in that browser, across rooms), and shared room Playlists. There are
no roles or votes; everyone can control playback. Each listener sets their
own volume. Music lives with the room in memory, like chat, so a server restart
clears queues and playlists.

Audio comes from a hidden YouTube player in each browser, so only sound plays.
YouTube's embed terms expect a visible player, which is worth revisiting before
a public launch. Browsers block sound until the page is touched; when that
happens the ♪ button shows a dot and one tap starts the music.

Searching by name needs `YOUTUBE_API_KEY` in `apps/server/.env` (Google Cloud
console → enable "YouTube Data API v3" → create an API key). A search costs
about 101 of the default 10,000 daily quota units, so the server caps uncached
searches at 95 per day (`YOUTUBE_SEARCHES_PER_DAY`) and 20 per player per hour
(`YOUTUBE_SEARCHES_PER_PLAYER_PER_HOUR`), and caches results for 24 hours.
Without a key, pasted YouTube links still play.

## GIPHY search

Copy `apps/server/.env.example` to `apps/server/.env`, then set
`GIPHY_API_KEY` to enable featured and searchable GIFs. The server dev and start
scripts load that file automatically. An optional `GIPHY_COUNTRY_CODE` may be
set to a two-letter country code and defaults to `US`. Without an API key, chat
falls back to the built-in curated GIF list. The server caps uncached upstream
calls at 90 per hour by default; override that with `GIPHY_REQUESTS_PER_HOUR`
after upgrading the key. Each player session is separately capped at 30
uncached searches per hour; configure that with
`GIPHY_REQUESTS_PER_PLAYER_PER_HOUR`.

```bash
GIPHY_API_KEY=your_key GIPHY_COUNTRY_CODE=IN pnpm dev
```

## Adding components

To add components to your app, run the following command at the root of your `web` app:

```bash
pnpm dlx shadcn@latest add button -c apps/web
```

This will place the ui components in the `packages/ui/src/components` directory.

## Using components

To use the components in your app, import them from the `ui` package.

```tsx
import { Button } from "@workspace/ui/components/button"
```

### Public chat and desktop controls

Public room messages support replies, emoji reactions, and transient typing
indicators. Replies keep their message ID; if the original leaves the room's
in-memory history, the quote is shown as unavailable. Closing chat preserves the
current draft/reply target. Incoming messages preserve your reading position;
use the new-messages button to return to the latest messages.

Desktop keyboard controls are available while a game is open:

| Key        | Action                                               |
| ---------- | ---------------------------------------------------- |
| Arrow keys | Move focus through your hand, including staged cards |
| Space      | Stage or unstage the focused card when legal         |
| D          | Draw, or accept the active draw penalty              |
| Enter      | Submit a legal selection, or pass after drawing      |
| C          | Open and focus chat                                  |
| Escape     | Close the top panel, or clear the selection          |
| ?          | Show the compact shortcut guide                      |

Space, D and Enter require your turn and synchronized state. Hand navigation,
chat, Escape and the guide remain available off turn. Shortcuts pause in text
fields, IME composition, dialogs and held repeats; browser modifier combinations
are preserved. Tab and Shift+Tab retain normal focus navigation. Pending actions
block duplicate submissions; an uncertain acknowledgement requires refreshing
the seat. Mobile keeps its touch controls. The browser title shows whose turn
it is.

Keyboard focus uses a yellow card outline above the overlapping fan. Space
keeps the current play unchanged when a focused card cannot join it and shows
a brief, accessible explanation. Click a staged card or focus it and press
Space to remove it; Tab only moves focus.
