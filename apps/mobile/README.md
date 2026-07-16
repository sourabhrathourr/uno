# UNO No Mercy mobile

The Expo development app joins the same Socket.IO rooms as the web client. It
supports gameplay, WebRTC room voice, public and squad chat, vote-kicks,
support squads, GIF chat, avatar reactions, waiting/vote-kicked states, and
match support recaps.

## Local configuration

Create `apps/mobile/.env.local` with the server URL visible to the target
device. Android Studio emulators reach the host machine through `10.0.2.2`:

```dotenv
EXPO_PUBLIC_SOCKET_URL=http://10.0.2.2:4001
```

Do not put API secrets in an `EXPO_PUBLIC_` variable. GIPHY credentials belong
only in `apps/server/.env`; mobile requests GIF results through the game server.

Restart Metro after changing the env file because Expo inlines public variables
into the client bundle.

## Run locally

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm --filter server dev
```

After adding or changing a native dependency, build and install the development
app once:

```bash
pnpm --filter mobile exec expo run:android
```

For normal development after the app is installed:

```bash
pnpm --filter mobile exec expo start --dev-client --android --localhost --clear
```

## Validation

```bash
pnpm --filter mobile typecheck
pnpm --filter mobile lint
pnpm test
pnpm --filter server typecheck
```

The cross-client checks that still require two running clients are public chat,
squad privacy, vote-kick resolution, waiting-player rollover, support hand
visibility, GIF validation, and voice reconnect/background behavior.
