# Vote-Kick

## Problem

Players need a public way to remove a disruptive or inactive participant from active gameplay without giving sole authority to a host or admin.

## Match vote-kick

- A Vote-Kick appears in Public Chat.
- Any seated participant who is not currently in Vote-Kicked Player state may initiate a Vote-Kick, including active players, players inactive due to winning or elimination, supporters, and players in the lobby.
- In the lobby, a Vote-Kick may target any seated player who is not already vote-kicked for the upcoming match.
- During a match, a Vote-Kick targets an active player who is not already inactive, eliminated, winner-finished, or vote-kicked.
- The target receives a soft kick when the vote passes: they become inactive for the rest of the current match, can no longer participate in gameplay, and may still remain socially present and use other app features.
- A player made inactive by Vote-Kick enters the Vote-Kicked Player state.
- Vote-Kicked Player state is stored separately from normal elimination state so the UI can distinguish the red vote-kicked treatment from regular UNO elimination.
- A Vote-Kicked Player is shown with a red outline or similar visual treatment.
- A Vote-Kicked Player can act like other inactive players socially: they may chat, use voice, support an active player, and use Support View.
- A Vote-Kicked Player can be mentioned in Public Chat. If they are in a Support Squad, Squad Chat mentions follow normal squad membership rules.
- A Vote-Kicked Player cannot participate in gameplay, initiate Vote-Kicks, or vote in Vote-Kicks until their Vote-Kick effect clears.
- If the target is taking their turn when the Vote-Kick passes, they immediately become inactive, any staged action is cleared, their cards are removed from active play, and play advances to the next active player.
- If the target has a pending draw penalty, roulette choice, or other pending obligation when the Vote-Kick passes, that obligation is cleared as part of making the target inactive.
- In the lobby, if the Vote-Kick passes, that player enters Vote-Kicked Player state, does not need to ready up, does not block the match from starting, and starts the upcoming match inactive.
- A lobby Vote-Kick effect lasts through the next match after the lobby vote. It clears when that match finishes, so the player can participate again in the following match.
- An in-match Vote-Kick effect lasts through the current match. It clears when that match finishes, so the player can participate again in the following match.
- A player who is already inactive because they won or were eliminated is disabled as a Vote-Kick target.
- Each eligible voter gets one vote.
- A voter may switch between Yes and No while the Vote-Kick is open. Only their latest choice counts, and their avatar moves to the currently selected option.
- Starting a Vote-Kick records the initiator's vote as Yes immediately. The initiator may still switch to No while the Vote-Kick is open.
- Votes are public and show voter avatars beside the selected option.
- Each option row shows up to 6 voter avatars, followed by `+N` for additional voters.
- After the Vote-Kick resolves, the Public Chat poll remains visible with final Yes and No counts, voter avatars under each option, and a final status of Kicked or Not kicked.
- Resolved Vote-Kick polls remain in Public Chat history after the match ends. Their gameplay effect still resets when the next match starts.
- A resolved lobby Vote-Kick poll remains visible after the match starts so players can see why the target started the match as a Vote-Kicked Player.
- Voting lasts 25 seconds.
- The Public Chat poll shows a countdown timer with the seconds remaining.
- A Vote-Kick always stays open for the full 25 seconds and resolves only when the timer expires.
- A reconnecting player who was included in the original eligible-voter snapshot sees an in-progress Vote-Kick with the remaining shared countdown and may vote.
- A player who joins the lobby after a Vote-Kick starts can see the in-progress poll but cannot vote in it.
- The target sees the Public Chat poll but cannot vote on their own Vote-Kick. Until the Vote-Kick resolves and passes, the target remains fully active.
- A Vote-Kick passes when more than 50% of eligible voters choose Yes before the vote resolves.
- During a match, eligible voters are seated participants who are not in Vote-Kicked Player state, excluding the target.
- In the lobby, eligible voters are seated players who have not already been vote-kicked for the upcoming match, excluding the target.
- Eligible voters are snapshotted when the Vote-Kick starts. The pass threshold does not change if player connection, room, or match state changes during the 20-second window.
- No votes and non-votes do not kick the target unless Yes crosses the threshold.
- Only one Vote-Kick may be open in a room at a time.
- After a Vote-Kick fails, the same target cannot be targeted by another Vote-Kick for 60 seconds.
- The Vote-Kick target picker shows eligible targets and targets currently under the 60-second same-target cooldown.
- Cooldown targets are disabled and show the remaining cooldown time beside their name.
- Inactive players and already vote-kicked players are hidden from the target picker.
- Public Chat has a small vote or poll icon in the composer. Selecting it opens the Vote-Kick target picker, and selecting a target creates the Vote-Kick poll in Public Chat.
- The poll title is `Kick {playerName}?` and the only options are `Yes` and `No`.
- The initiator is visible through the normal chat message ownership and avatar, without extra explanatory copy inside the poll.
- Creating a Vote-Kick plays the normal Public Chat notification sound.
- Voting does not play a sound.
- Resolution plays a subtle state-change sound only when the Vote-Kick passes. Failed Vote-Kicks do not play a special sound.
