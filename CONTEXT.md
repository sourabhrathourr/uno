# UNO No Mercy

The language used to describe a room, its matches, and the players participating in them.

## Language

**Match**:
A single deal of cards that begins when play starts and ends when no player can make another play. Starting a new match resets all match-scoped choices, including whom a player supports.
_Avoid_: Round, game, hand

**Hand**:
The cards currently held by one player during a match.
_Avoid_: Match, round

**Active Player**:
A player who can still take turns in the current match because they have neither won nor been eliminated.
_Avoid_: Contender, playing player

**Inactive Player**:
A player who has won or been eliminated and can no longer take turns in the current match. An inactive player may remain neutral or choose an active player to support.
_Avoid_: Spectator

**Supporter**:
An inactive player who has publicly chosen one active player to support. A supporter participates socially without changing match rules or outcomes and cannot end their own support link.
_Avoid_: Spectator, watcher

**Supported Player**:
The active player chosen unilaterally by one or more supporters. Each support link survives disconnection and ends when this player wins, is eliminated, kicks the supporter, or the match finishes.
_Avoid_: Supporter, spectated player, target

**Support Kick**:
The supported player's removal of one supporter from their support squad, immediately revoking Support View and Squad Chat access. The kicked player may support someone else but cannot support the player who kicked them again during the same match.
_Avoid_: Ban, leave squad

**Support View**:
The read-only perspective unlocked after a support link is confirmed, from which a supporter sees their supported player's full hand and live decision state. Information learned in this view may be discussed through the room's social channels.
_Avoid_: Public view, neutral spectator view

**Support Squad**:
An active player together with all players currently supporting them. The squad disbands when its active player wins or is eliminated.
_Avoid_: Team, party

**Squad Chat**:
The private match chat shared by the current members of one support squad, including its existing messages. Access ends when the squad disbands or a member leaves it, while messages already sent remain in the squad's history.
_Avoid_: Team chat, supporter chat

**Mention**:
A reference in a chat message to one or more players by identity, displayed with `@` and accompanied by a subtle notification for each recipient. Public Chat may mention anyone in the room, while Squad Chat may mention only current squad members.
_Avoid_: Tag, label

**Table Reaction**:
A public, cosmetic emoji or preset phrase that any player may send during a match. A supporter's reaction is visually directed toward their supported player.
_Avoid_: Chat message, supporter power

**Hype Meter**:
A table-wide cosmetic celebration meter built through reactions from all players. It never changes cards, turns, penalties, or match outcomes.
_Avoid_: Power meter, supporter meter

**Support Recap**:
The end-of-match summary of how supporters moved between supported players, together with cosmetic titles earned from that activity.
_Avoid_: Match result, supporter leaderboard
