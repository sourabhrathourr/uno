# UNO No Mercy

This is the foundation for a realtime UNO No Mercy app.

## Apps and packages

- `apps/web`: TanStack Start frontend.
- `apps/server`: single Node.js + Socket.IO authoritative game server.
- `packages/game`: shared game/domain types and room protocol.
- `packages/ui`: shared React UI components, including the UNO card components.

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
import { Button } from "@workspace/ui/components/button";
```
