import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"

import appCss from "@workspace/ui/globals.css?url"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        name: "theme-color",
        content: "#0A0A0A",
      },
      {
        name: "description",
        content:
          "Create a private UNO No Mercy room, share an invite code, and play live with friends using stacked draw cards, house rules, and table chat.",
      },
      {
        title: "UNO No Mercy Online | Private Multiplayer Rooms",
      },
      {
        property: "og:title",
        content: "UNO No Mercy Online",
      },
      {
        property: "og:description",
        content:
          "Start a private No Mercy table, send the code, and play live with friends.",
      },
      {
        property: "og:type",
        content: "website",
      },
      {
        name: "twitter:card",
        content: "summary",
      },
      {
        name: "twitter:title",
        content: "UNO No Mercy Online",
      },
      {
        name: "twitter:description",
        content:
          "Private live rooms for stacked draw cards, house rules, and table chat.",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  notFoundComponent: () => (
    <main className="container mx-auto p-4 pt-16">
      <h1>404</h1>
      <p>The requested page could not be found.</p>
    </main>
  ),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
