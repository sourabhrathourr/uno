# GIPHY Chat Search

- Public and Squad Chat share one GIF picker with featured results, debounced
  search, pagination, loading, empty, and failure states.
- GIPHY credentials remain on the server. Search requests use a `pg` content
  rating, a configured country code, short-lived response caching, and an
  upstream request budget. Only a session joined to the requested room may
  search, and each joined session has a separate uncached-search limit.
- The picker displays the official GIPHY attribution mark whenever results come
  from GIPHY.
- Selecting a GIPHY result sends its provider and ID, never an arbitrary media
  URL. The room server accepts only IDs approved by its recent search results
  and broadcasts the resolved trusted media URL.
- Without `GIPHY_API_KEY`, the picker remains functional using the curated GIF
  catalog and local label filtering.
