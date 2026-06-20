# Mobile Live Voice Context, Implementation, and QA Handoff

## Purpose

This document is the handoff spec for a later Codex/LLM goal that will implement
mobile live voice in the UNO mobile app. This document is intentionally
documentation-only; it does not implement code.

The next implementation agent should be able to use this file as the source of
truth for context, scope, commands, and QA. If the agent cannot satisfy the
audio verification requirements below, it must stop and report the blocker
instead of claiming the feature is complete.

## Current Context

- The repo is a pnpm monorepo at `/Users/shadevkumar/projects/uno`.
- Web app lives in `apps/web`.
- Mobile app lives in `apps/mobile`.
- Server lives in `apps/server`.
- Shared realtime event types live in `packages/game/src/realtime.ts`.
- The web app already has live voice implemented with browser WebRTC in
  `apps/web/src/lib/use-room-voice.ts`.
- The server already supports voice signaling and ICE config fetch:
  - `voice:requestStates`
  - `voice:setState`
  - `voice:signal`
  - `GET /voice/ice-servers`
- The mobile app currently has only a placeholder mic button in
  `apps/mobile/src/app/room/[roomCode].tsx`.
- The mobile app already uses Socket.IO through `apps/mobile/src/lib/realtime.ts`.
- There is no login/auth flow. Joining a room uses a player name and local
  session state.

Expo Go is not enough for this work. Mobile WebRTC requires native code through
`react-native-webrtc`, so the mobile app must run as an Expo development build
with `expo-dev-client`.

## Issue Flow

Current problem:

```text
web supports live voice
mobile joins the same game room but has no real voice implementation
mobile mic button is only a placeholder
```

Desired success flow:

```text
mobile joins room
web joins same room
mobile user taps mic
mobile requests microphone permission
mobile emits voice:setState
web and mobile exchange offer / answer / ICE through voice:signal
WebRTC peer connection reaches connected/completed
audio works between web and mobile
mute/unmute state syncs across both clients
```

Required state flow:

```text
room join -> tap mic -> permission -> voice:setState -> offer/answer/ICE -> audio connected
```

Required failure flow:

```text
permission denied -> show mic error
socket disconnect -> close peers
app background -> mute/leave voice and close peers
remote leaves -> close peer
room changes -> close peers and reset voice state
```

## Scope Of Work

Implement Android-first mobile live voice.

In scope:

- Add mobile WebRTC dependencies.
- Configure Expo dev-client/native WebRTC plugin.
- Add a mobile `useRoomVoice` hook.
- Reuse the existing server voice events only:
  ```text
  voice:requestStates
  voice:setState
  voice:signal
  ```
- Reuse the existing shared signal types:
  ```text
  offer
  answer
  ice-candidate
  leave
  ```
- Fetch ICE servers from existing `GET /voice/ice-servers`.
- Wire the mic button in mobile lobby and game UI.
- Show voice state for players where the mobile UI already shows player rows or
  seats.
- Test with Android Studio Emulator and web browser.
- Use tap-to-join voice UX on mobile.
- Use manual audio verification plus logs for QA.

Out of scope:

- No backend protocol changes.
- No new server routes.
- No database changes.
- No deployment changes.
- No TURN setup in this pass.
- No LiveKit, Daily, Agora, SFU, or other voice infra.
- No Expo Go support for voice.
- No production release work.

## Implementation Guide

### 1. Install Native WebRTC Dependencies

From repo root:

```bash
cd /Users/shadevkumar/projects/uno
pnpm --filter mobile exec expo install react-native-webrtc@124.0.7 @config-plugins/react-native-webrtc@14.0.0
```

Keep `expo-dev-client` installed in `apps/mobile/package.json`. If it is
missing, add it with:

```bash
pnpm --filter mobile exec expo install expo-dev-client
```

### 2. Configure Mobile Native App

Update `apps/mobile/app.json`.

Add the WebRTC config plugin to the `plugins` array:

```json
"@config-plugins/react-native-webrtc"
```

Keep the existing plugins:

```json
"expo-router"
"expo-splash-screen"
"expo-audio"
```

Add microphone permission metadata as needed by the plugin/app config. The
minimum expected behavior is:

- Android requests `RECORD_AUDIO`.
- iOS has a microphone usage description, even though QA is Android-first.

Do not add TURN credentials or new infra env vars in this pass.

### 3. Add Mobile Voice Hook

Create:

```text
apps/mobile/src/lib/use-room-voice.ts
```

The hook should mirror the web hook behavior from:

```text
apps/web/src/lib/use-room-voice.ts
```

Expected public controller shape:

```ts
type RoomVoiceController = {
  enabled: boolean;
  connecting: boolean;
  muted: boolean;
  error: string | null;
  voiceStates: Record<
    string,
    { enabled: boolean; muted: boolean; speaking: boolean }
  >;
  toggle: () => void;
  stop: () => void;
};
```

Expected input:

```ts
useRoomVoice({
  socket,
  roomCode,
  selfPlayerId,
  players,
});
```

The hook must:

- Use `react-native-webrtc` for `mediaDevices.getUserMedia`,
  `RTCPeerConnection`, `RTCSessionDescription`, and `RTCIceCandidate`.
- Use the existing Socket.IO instance passed from the room screen.
- Fetch ICE server config from `${getRealtimeUrl()}/voice/ice-servers`.
- Create one peer connection per remote voice-enabled player.
- Use deterministic offer ownership compatible with web. Match web behavior:
  the lexicographically smaller player id creates the initial offer.
- Queue ICE candidates until `remoteDescription` exists.
- Emit `voice:setState` when local enabled/muted state changes.
- Emit `voice:requestStates` after joining voice and after socket reconnect.
- Close all peers on socket disconnect.
- Close one peer when a remote player leaves or disables voice.
- Stop local audio tracks when voice stops.
- On app background, stop or mute local voice and close peers.
- Avoid speaking detection for mobile v1 unless it is trivial and reliable.
  Mobile can publish `speaking: false` for local state.

### 4. Wire Mobile UI

Update `apps/mobile/src/app/room/[roomCode].tsx`.

Use the mobile voice hook after the room/player/socket state is available.

Mic UX:

- Before voice is enabled: mic tap starts voice and asks for permission.
- While connecting: button is disabled or shows loading state.
- While enabled and unmuted: mic tap mutes.
- While enabled and muted: mic tap unmutes.
- If permission is denied: show an actionable error in the existing error UI.

Lobby UI:

- Show each player's voice state in the player row:
  - voice off
  - muted
  - mic on
- Do not add a large new panel unless necessary.

Game UI:

- Replace the placeholder mic control in `TableControls`.
- Show local mic state using existing icon button styling.
- Show remote player mic states in `SeatRing` or the closest existing player
  seat UI.

Keep the mobile visual style consistent with the existing compact game chrome.

### 5. Rebuild And Run Dev Client

Expo Go must not be used for this feature.

Android emulator path:

```bash
cd /Users/shadevkumar/projects/uno
printf 'EXPO_PUBLIC_SOCKET_URL=http://10.0.2.2:4001\n' > apps/mobile/.env.local
pnpm --filter mobile exec expo run:android
pnpm --filter mobile exec expo start --dev-client --android --clear
```

Physical Android phone path, if needed:

```bash
cd /Users/shadevkumar/projects/uno
MAC_IP="$(ipconfig getifaddr en0)"
printf "EXPO_PUBLIC_SOCKET_URL=http://${MAC_IP}:4001\n" > apps/mobile/.env.local
adb devices -l
pnpm --filter mobile exec expo run:android --device CPH2717
pnpm --filter mobile exec expo start --dev-client --lan --clear
```

Use the physical path only if emulator audio input/output cannot be made
reliable enough to manually verify audio.

## QA Guide

### Required Terminals

Terminal 1, server:

```bash
cd /Users/shadevkumar/projects/uno
VOICE_DEBUG=1 PORT=4001 CORS_ORIGIN=http://localhost:3000 pnpm --filter server dev
```

Verify:

```bash
curl http://localhost:4001/health
curl http://localhost:4001/voice/ice-servers
```

Terminal 2, web:

```bash
cd /Users/shadevkumar/projects/uno
printf 'VITE_SOCKET_URL=http://localhost:4001\n' > apps/web/.env.local
pnpm --filter web dev -- --host 0.0.0.0
```

Open:

```text
http://localhost:3000
```

Terminal 3, mobile:

```bash
cd /Users/shadevkumar/projects/uno
printf 'EXPO_PUBLIC_SOCKET_URL=http://10.0.2.2:4001\n' > apps/mobile/.env.local
pnpm --filter mobile exec expo run:android
pnpm --filter mobile exec expo start --dev-client --android --clear
```

### Android Studio Emulator Setup

Use Android Studio Emulator for the primary QA pass.

Before testing voice:

1. Start the emulator from Android Studio.
2. Confirm it appears in ADB:
   ```bash
   adb devices -l
   ```
3. Open emulator extended controls.
4. Enable virtual microphone / host audio input.
5. Make sure macOS has granted microphone access to Android Studio and/or the
   emulator process.
6. Keep host volume reasonable and preferably use headphones to avoid feedback.

### Room Join QA

There is no login flow. Use player names.

1. In web, open `http://localhost:3000`.
2. Create a room as `Web Tester`.
3. Copy the room code.
4. In mobile emulator, open the same room or create/join with the room code as
   `Mobile Tester`.
5. Confirm both clients show the same room code.
6. Confirm room status shows `2/8 seated` or equivalent two-player state.
7. Confirm server logs show both sockets joined.

### Voice State QA

1. On mobile, tap the mic button.
2. Accept microphone permission.
3. Confirm mobile mic button changes to enabled/unmuted.
4. Confirm web shows mobile voice state as mic on or unmuted.
5. On web, tap the voice/mic button.
6. Accept browser microphone permission.
7. Confirm mobile shows web voice state as mic on or unmuted.
8. Toggle mute on mobile.
9. Confirm web updates mobile state to muted.
10. Toggle mute on web.
11. Confirm mobile updates web state to muted.

### Manual Audio QA

Logs are not enough to prove audible audio. Manual listening is required.

Web to mobile:

1. Keep web mic enabled and unmuted.
2. Keep mobile voice enabled and unmuted/listening.
3. Speak into the browser/Mac microphone.
4. Confirm the audio is heard from the Android emulator output.

Mobile to web:

1. Keep mobile mic enabled and unmuted.
2. Keep web voice enabled and unmuted/listening.
3. With emulator virtual microphone using host input, speak into the Mac
   microphone as emulator input.
4. Confirm the audio is heard in the browser output.

If both web and emulator share the same host mic/speakers and feedback makes the
test unreliable:

- Use headphones.
- Lower speaker volume.
- Test one direction at a time.
- If still unreliable, use the physical OnePlus wireless ADB path and repeat
  the same web + mobile test.

If audible audio cannot be verified manually, stop and report the exact blocker.
Do not mark QA as passed based only on WebRTC logs or UI state.

### Debug Evidence To Capture

ADB device list:

```bash
adb devices -l
```

Android logcat:

```bash
adb -s <serial> logcat -c
# Run the voice test now.
adb -s <serial> logcat -d > /tmp/uno-mobile-voice-logcat.txt
```

Emulator screenshot:

```bash
adb -s <serial> exec-out screencap -p > /tmp/uno-mobile-voice.png
```

Web debug snapshot:

1. Open browser devtools on the web room page.
2. Run:
   ```js
   window.__unoVoiceDebug?.()
   ```
3. Confirm peer state, remote streams, and audio tracks exist after voice
   connects.

Server logs:

- Run server with `VOICE_DEBUG=1`.
- Confirm voice state broadcasts.
- Confirm `offer`, `answer`, and `ice-candidate` signals are relayed.

### Background And Disconnect QA

Mobile background:

1. Enable voice on mobile and web.
2. Press Home on the emulator.
3. Confirm mobile voice stops/mutes.
4. Confirm web no longer shows mobile as active/unmuted.
5. Reopen the mobile app.
6. Confirm tapping mic can reconnect voice.

Socket reconnect:

1. Stop Metro or briefly disable/re-enable the mobile app connection.
2. Confirm the app does not crash.
3. Restore the connection.
4. Confirm voice can be re-enabled.

Remote leave:

1. Leave or close the web room.
2. Confirm mobile closes the web peer and does not show stale voice state.

### Pass Criteria

The implementation is complete only if all of these pass:

- Android dev-client build succeeds.
- Mobile app launches in Android Studio Emulator.
- Web and mobile can join the same room.
- The room shows both players.
- Mobile mic permission appears on first mic tap.
- Mobile handles permission denied with a visible error.
- Web and mobile exchange voice states.
- WebRTC offer/answer/ICE exchange completes.
- Mute/unmute state syncs both directions.
- Manual listener confirms web-to-mobile audio.
- Manual listener confirms mobile-to-web audio.
- Backgrounding mobile stops/mutes voice cleanly.
- No stale active mic state remains after disconnect/leave/background.
- No backend protocol or infra changes were made.

### Stop And Cleanup

Stop dev servers:

```bash
kill $(lsof -tiTCP:3000 -sTCP:LISTEN) 2>/dev/null || true
kill $(lsof -tiTCP:4001 -sTCP:LISTEN) 2>/dev/null || true
kill $(lsof -tiTCP:8081 -sTCP:LISTEN) 2>/dev/null || true
```

Stop Gradle daemon if a native build was run:

```bash
(cd apps/mobile/android && ./gradlew --stop) 2>/dev/null || true
```

Disconnect wireless devices if used:

```bash
adb disconnect
```

## Known Limitations

- No TURN is configured in this pass.
- Local emulator/web testing can pass while remote internet users may still fail
  behind strict NATs.
- Manual listening is required for audio proof.
- Emulator microphone routing depends on Android Studio/emulator host audio
  settings and macOS microphone permissions.
- Mobile speaking detection is not required for v1.
- iOS config may be prepared, but QA is Android-first only.

## Acceptance Criteria For This Document

- The next implementation agent can run from this document without asking
  architecture questions.
- The document clearly says this pass is Android-first.
- The document clearly says no infra/backend protocol changes.
- The document clearly says audio cannot be fully proven by logs alone.
- The document includes exact QA steps for web + mobile room testing.
- The document includes stop/cleanup commands.
- The document includes known limitations: no TURN, local network only, manual
  listen required.

## Assumptions Locked For Implementation

- This document is the only artifact for the documentation pass.
- Implementation starts in a later Codex goal.
- Tap-to-join voice is the selected mobile UX.
- Manual audio verification plus logs is the selected QA approach.
- Existing server voice events remain the compatibility contract.
