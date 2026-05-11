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
