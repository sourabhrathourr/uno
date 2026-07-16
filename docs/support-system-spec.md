# Support System

## Match language

- A match is one deal from its start until no player can make another play.
- A hand is the set of cards currently held by one player.
- Starting a new match resets support links, support blocks, avatar emoji reactions, Waiting Player state, and the support recap source data.
- A Waiting Player joins while a match is actively playing, is inactive during that match, and becomes active automatically when the next match starts.
- A player who joins after a match has finished but before the next match starts is not a Waiting Player; they are a normal seated participant for the next match.
- A Waiting Player is visually distinct from eliminated and Vote-Kicked Players, using a waiting or next-match treatment rather than eliminated/out treatment.
- A Waiting Player who disconnects remains seated and is still included when the next match starts, following the same room membership rule as other disconnected players.
- A Waiting Player is blocked from gameplay mechanics, including turns, card play, drawing, missed-UNO calls, draw penalties, and hand swap or rotation effects.
- The room's maximum player count applies to all seated participants, including Waiting Players.

## Support links

- A player who has won, been eliminated, or is waiting for the next match is inactive and may optionally support one active player.
- Choosing support requires an explicit confirmation and does not reveal candidate hands before confirmation.
- The server owns and enforces the support link.
- A supporter cannot switch while the supported player remains active.
- The link survives disconnects and ends when the supported player wins, is eliminated, kicks the supporter, or the match finishes.
- When a supported player becomes inactive, released supporters may choose another active player.
- Multiple supporters may back the same active player.
- Allegiances, supporter identities, and supporter counts are public.
- A supported player may kick a supporter. The kicked player becomes free to support another active player but cannot rejoin the player who kicked them during that match.
- Supporters cannot invoke match mechanics, including calling a missed UNO.

## Support View

- The normal table remains visible.
- The bottom hand area shows the supported player’s complete hand.
- Support View is read-only and mirrors playable cards, staged cards, and pending color, UNO, swap, or rotate intent.
- Full-hand access begins only after server-confirmed lock-in and ends immediately with the support link.

## Support Squads and chat

- A Support Squad contains one active player and all current supporters of that player.
- Public Chat remains available to the room.
- Squad Chat is private to current squad members; room voice stays public.
- New squad members receive the squad’s existing messages.
- When the active player becomes inactive, the squad disbands and its chat becomes inaccessible.
- Kicking removes future access without deleting messages already sent from the remaining squad history.
- Public Chat can mention any room player; Squad Chat can mention only current squad members.
- Mentions bind to player IDs, support multiple recipients, display an unread `@` badge, and play one subtle sound distinct from gameplay audio.

## Avatar reactions and results

- Every player may send a curated emoji reaction.
- A supporter’s reaction is visually directed toward their supported player; other reactions originate from the sender.
- Emoji reactions use a short anti-spam cooldown and never affect gameplay.
- The finished match displays a Support Recap with the allegiance journey and cosmetic titles.
- Waiting Player support activity appears in the finished match's Support Recap.
