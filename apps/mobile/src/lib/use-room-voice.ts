import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import InCallManager from 'react-native-incall-manager';
import {
  mediaDevices,
  MediaStream,
  MediaStreamTrack,
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
} from 'react-native-webrtc';

import type {
  Player,
  VoiceSignal,
  VoiceSignalEvent,
  VoiceStateEvent,
} from '@workspace/game';

import { getRealtimeUrl, type GameSocket } from '@/lib/realtime';

type VoicePeerState = {
  enabled: boolean;
  muted: boolean;
  speaking: boolean;
};

export type RoomVoiceController = {
  enabled: boolean;
  connecting: boolean;
  muted: boolean;
  error: string | null;
  voiceStates: Record<string, VoicePeerState>;
  toggle: () => void;
  stop: () => void;
};

type VoiceIceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

type VoicePeerConfig = {
  iceServers: VoiceIceServer[];
};

type VoiceIceCandidateInit = {
  candidate: string;
  sdpMLineIndex?: number | null;
  sdpMid?: string | null;
};

type VoiceDebugGlobal = typeof globalThis & {
  __unoMobileVoiceDebug?: () => unknown;
};

type VoicePeerEventMap = {
  icecandidate: {
    candidate: RTCIceCandidate | null;
  };
  track: {
    track: MediaStreamTrack | null;
    streams: MediaStream[];
  };
  connectionstatechange: unknown;
  iceconnectionstatechange: unknown;
  signalingstatechange: unknown;
};

type VoicePeerEventTarget = {
  addEventListener: <EventName extends keyof VoicePeerEventMap>(
    type: EventName,
    handler: (event: VoicePeerEventMap[EventName]) => void,
  ) => void;
};

const defaultIceServers: VoiceIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

let voicePeerConfig: VoicePeerConfig = {
  iceServers: defaultIceServers,
};
let voicePeerConfigPromise: Promise<VoiceIceServer[]> | null = null;

async function loadVoicePeerConfig(): Promise<VoiceIceServer[]> {
  if (voicePeerConfigPromise) return voicePeerConfigPromise;

  voicePeerConfigPromise = (async () => {
    const fallbackServers = voicePeerConfig.iceServers;

    try {
      const response = await fetch(`${getRealtimeUrl()}/voice/ice-servers`);
      if (!response.ok) return fallbackServers;

      const payload = (await response.json()) as { iceServers?: unknown };
      const runtimeServers = normalizeVoiceIceServers(payload.iceServers);
      if (runtimeServers.length > 0) {
        voicePeerConfig = { iceServers: runtimeServers };
      }
    } catch (cause) {
      logRoomVoiceDebug('ice server config fetch failed', { cause });
    }

    logRoomVoiceDebug('ice server config loaded', {
      iceServers: voicePeerConfig.iceServers.map((server) => server.urls),
    });
    return voicePeerConfig.iceServers.length > 0
      ? voicePeerConfig.iceServers
      : fallbackServers;
  })();

  return voicePeerConfigPromise;
}

function normalizeVoiceIceServers(value: unknown): VoiceIceServer[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((server) => {
    if (!server || typeof server !== 'object' || !('urls' in server)) return [];

    const urls = server.urls;
    const normalizedUrls =
      typeof urls === 'string'
        ? urls
        : Array.isArray(urls) && urls.every((url) => typeof url === 'string')
          ? urls
          : null;
    if (!normalizedUrls) return [];

    const username =
      'username' in server && typeof server.username === 'string'
        ? server.username
        : undefined;
    const credential =
      'credential' in server && typeof server.credential === 'string'
        ? server.credential
        : undefined;

    return [{ urls: normalizedUrls, username, credential }];
  });
}

function cloneVoicePeerConfig(): VoicePeerConfig {
  return {
    iceServers: voicePeerConfig.iceServers.map((server) => ({
      urls: Array.isArray(server.urls) ? [...server.urls] : server.urls,
      username: server.username,
      credential: server.credential,
    })),
  };
}

function isRoomVoiceDebugEnabled() {
  return __DEV__ || process.env.EXPO_PUBLIC_VOICE_DEBUG === 'true';
}

function startVoiceAudioRoute() {
  if (Platform.OS !== 'android') return;

  InCallManager.start({ media: 'audio', auto: true });
}

function stopVoiceAudioRoute() {
  if (Platform.OS !== 'android') return;

  InCallManager.stop();
}

function logRoomVoiceDebug(
  event: string,
  details?: Record<string, unknown>,
) {
  if (!isRoomVoiceDebugEnabled()) return;
  console.debug(`[uno mobile voice] ${event}`, details ?? {});
}

function describeTrack(track: MediaStreamTrack | null | undefined) {
  if (!track) return null;

  return {
    id: track.id,
    kind: track.kind,
    enabled: track.enabled,
    muted: track.muted,
    readyState: track.readyState,
  };
}

function describeCandidate(candidate: unknown) {
  const normalizedCandidate = normalizeIceCandidate(candidate);
  const candidateValue = normalizedCandidate?.candidate ?? '';

  return {
    type: candidateValue.match(/ typ ([a-z]+)/i)?.[1] ?? 'unknown',
    protocol:
      candidateValue.match(/ (udp|tcp) /i)?.[1]?.toLowerCase() ?? 'unknown',
  };
}

function describeSignal(signal: VoiceSignal) {
  if (signal.type === 'offer' || signal.type === 'answer') {
    return { type: signal.type, sdpLength: signal.sdp.length };
  }

  if (signal.type === 'leave') {
    return { type: signal.type };
  }

  return {
    type: signal.type,
    candidate: describeCandidate(signal.candidate),
  };
}

function normalizeIceCandidate(value: unknown): VoiceIceCandidateInit | null {
  if (!value || typeof value !== 'object') return null;
  if (!('candidate' in value) || typeof value.candidate !== 'string') {
    return null;
  }

  const sdpMLineIndex =
    'sdpMLineIndex' in value &&
    (typeof value.sdpMLineIndex === 'number' || value.sdpMLineIndex === null)
      ? value.sdpMLineIndex
      : undefined;
  const sdpMid =
    'sdpMid' in value &&
    (typeof value.sdpMid === 'string' || value.sdpMid === null)
      ? value.sdpMid
      : undefined;

  return {
    candidate: value.candidate,
    sdpMLineIndex,
    sdpMid,
  };
}

function isPermissionError(cause: unknown) {
  if (!cause || typeof cause !== 'object') return false;

  const name =
    'name' in cause && typeof cause.name === 'string' ? cause.name : '';
  const message =
    'message' in cause && typeof cause.message === 'string'
      ? cause.message
      : '';

  return (
    name === 'NotAllowedError' ||
    name === 'PermissionDeniedError' ||
    name === 'SecurityError' ||
    /permission denied/i.test(message)
  );
}

function addPeerEventListener<EventName extends keyof VoicePeerEventMap>(
  peer: RTCPeerConnection,
  type: EventName,
  handler: (event: VoicePeerEventMap[EventName]) => void,
) {
  (peer as unknown as VoicePeerEventTarget).addEventListener(type, handler);
}

export function useRoomVoice({
  socket,
  roomCode,
  selfPlayerId,
  players,
}: {
  socket: GameSocket | null;
  roomCode: string;
  selfPlayerId: string | null;
  players: Player[];
}): RoomVoiceController {
  const [enabled, setEnabled] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [muted, setMuted] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [voiceStates, setVoiceStates] = useState<
    Record<string, VoicePeerState>
  >({});
  const [remoteTracksByPlayerId, setRemoteTracksByPlayerId] = useState<
    Record<string, ReturnType<typeof describeTrack>>
  >({});

  const socketRef = useRef<GameSocket | null>(socket);
  const selfPlayerIdRef = useRef<string | null>(selfPlayerId);
  const playersRef = useRef<Player[]>(players);
  const enabledRef = useRef(enabled);
  const connectingRef = useRef(connecting);
  const mutedRef = useRef(muted);
  const voiceStatesRef = useRef(voiceStates);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const negotiatingPeersRef = useRef<Set<string>>(new Set());
  const pendingIceCandidatesRef = useRef<
    Map<string, VoiceIceCandidateInit[]>
  >(new Map());

  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  useEffect(() => {
    selfPlayerIdRef.current = selfPlayerId;
  }, [selfPlayerId]);

  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    connectingRef.current = connecting;
  }, [connecting]);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    voiceStatesRef.current = voiceStates;
  }, [voiceStates]);

  const setVoiceStateForPlayer = useCallback(
    (playerId: string, state: VoicePeerState) => {
      setVoiceStates((current) => {
        if (!state.enabled) {
          if (!current[playerId]) return current;
          const next = { ...current };
          delete next[playerId];
          return next;
        }

        const currentState = current[playerId];
        if (
          currentState?.enabled === state.enabled &&
          currentState.muted === state.muted &&
          currentState.speaking === state.speaking
        ) {
          return current;
        }

        return {
          ...current,
          [playerId]: state,
        };
      });
    },
    [],
  );

  const emitVoiceState = useCallback((state: VoicePeerState) => {
    socketRef.current?.emit('voice:setState', state);
  }, []);

  const emitSignal = useCallback(
    (targetPlayerId: string, signal: VoiceSignal) => {
      const activeSocket = socketRef.current;
      if (!activeSocket) return;

      logRoomVoiceDebug('signal sent', {
        targetPlayerId,
        signal: describeSignal(signal),
      });
      activeSocket.emit('voice:signal', { targetPlayerId, signal });
    },
    [],
  );

  const closePeer = useCallback((playerId: string) => {
    const peer = peersRef.current.get(playerId);
    if (peer) {
      logRoomVoiceDebug('peer closing', {
        remotePlayerId: playerId,
        signalingState: peer.signalingState,
        iceConnectionState: peer.iceConnectionState,
        connectionState: peer.connectionState,
      });
      if (peer.connectionState !== 'closed') peer.close();
    }

    peersRef.current.delete(playerId);
    negotiatingPeersRef.current.delete(playerId);
    pendingIceCandidatesRef.current.delete(playerId);
    setRemoteTracksByPlayerId((current) => {
      if (!current[playerId]) return current;
      const next = { ...current };
      delete next[playerId];
      return next;
    });
  }, []);

  const closeAllPeers = useCallback(
    (sendLeave = false) => {
      const playerIds = Array.from(peersRef.current.keys());
      if (sendLeave) {
        for (const playerId of playerIds) {
          emitSignal(playerId, { type: 'leave' });
        }
      }

      for (const playerId of playerIds) closePeer(playerId);
    },
    [closePeer, emitSignal],
  );

  const stopLocalStream = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
  }, []);

  const shouldCreateOffer = useCallback((remotePlayerId: string) => {
    const currentPlayerId = selfPlayerIdRef.current;
    if (!currentPlayerId) return false;
    return currentPlayerId < remotePlayerId;
  }, []);

  const shouldCreateInitialOffer = useCallback(
    (remotePlayerId: string, peer: RTCPeerConnection) => {
      if (!shouldCreateOffer(remotePlayerId)) return false;
      if (peer.signalingState !== 'stable') return false;
      if (peer.localDescription || peer.remoteDescription) return false;
      return true;
    },
    [shouldCreateOffer],
  );

  const setRemoteAudioTrack = useCallback(
    (remotePlayerId: string, track: MediaStreamTrack | null | undefined) => {
      if (!track || track.kind !== 'audio') return;

      logRoomVoiceDebug('remote audio track attached', {
        remotePlayerId,
        track: describeTrack(track),
      });
      setRemoteTracksByPlayerId((current) => ({
        ...current,
        [remotePlayerId]: describeTrack(track),
      }));
    },
    [],
  );

  const syncRemoteAudioFromPeer = useCallback(
    (remotePlayerId: string, peer: RTCPeerConnection) => {
      for (const receiver of peer.getReceivers()) {
        if (receiver.track?.kind === 'audio') {
          setRemoteAudioTrack(remotePlayerId, receiver.track);
        }
      }
    },
    [setRemoteAudioTrack],
  );

  const syncLocalAudioToPeer = useCallback(
    async (peer: RTCPeerConnection, remotePlayerId: string) => {
      const localStream = localStreamRef.current;
      const localTrack = localStream?.getAudioTracks()[0];
      const audioTransceiver = peer
        .getTransceivers()
        .find(
          (transceiver) =>
            transceiver.sender.track?.kind === 'audio' ||
            transceiver.receiver.track?.kind === 'audio',
        );

      if (localStream && localTrack?.readyState === 'live') {
        if (audioTransceiver) {
          if (audioTransceiver.sender.track !== localTrack) {
            await audioTransceiver.sender.replaceTrack(localTrack);
            logRoomVoiceDebug('sender track replaced', {
              remotePlayerId,
              track: describeTrack(localTrack),
              signalingState: peer.signalingState,
            });
          }
          if (audioTransceiver.direction !== 'sendrecv') {
            audioTransceiver.direction = 'sendrecv';
          }
        } else {
          peer.addTrack(localTrack, localStream);
          logRoomVoiceDebug('sender track added', {
            remotePlayerId,
            track: describeTrack(localTrack),
            signalingState: peer.signalingState,
          });
        }
        return;
      }

      if (audioTransceiver) {
        if (audioTransceiver.direction !== 'sendrecv') {
          audioTransceiver.direction = 'sendrecv';
        }
        return;
      }

      peer.addTransceiver('audio', { direction: 'sendrecv' });
      logRoomVoiceDebug('empty audio transceiver added', { remotePlayerId });
    },
    [],
  );

  const ensurePeer = useCallback(
    (remotePlayerId: string) => {
      const currentPlayerId = selfPlayerIdRef.current;
      if (!currentPlayerId || remotePlayerId === currentPlayerId) {
        return null;
      }

      const existingPeer = peersRef.current.get(remotePlayerId);
      if (existingPeer) return existingPeer;

      const peer = new RTCPeerConnection(cloneVoicePeerConfig());
      logRoomVoiceDebug('peer created', {
        remotePlayerId,
        iceServers: voicePeerConfig.iceServers.map((server) => server.urls),
      });
      void syncLocalAudioToPeer(peer, remotePlayerId);

      addPeerEventListener(peer, 'icecandidate', (event) => {
        if (!event.candidate) return;
        const candidate = event.candidate.toJSON();
        logRoomVoiceDebug('ice candidate sent', {
          remotePlayerId,
          candidate: describeCandidate(candidate),
        });
        emitSignal(remotePlayerId, {
          type: 'ice-candidate',
          candidate,
        });
      });

      addPeerEventListener(peer, 'track', (event) => {
        logRoomVoiceDebug('ontrack', {
          remotePlayerId,
          track: describeTrack(event.track),
          streamCount: event.streams.length,
        });
        setRemoteAudioTrack(remotePlayerId, event.track);
      });

      addPeerEventListener(peer, 'connectionstatechange', () => {
        logRoomVoiceDebug('connection state changed', {
          remotePlayerId,
          connectionState: peer.connectionState,
          iceConnectionState: peer.iceConnectionState,
        });
        if (
          peer.connectionState === 'failed' ||
          peer.connectionState === 'closed'
        ) {
          closePeer(remotePlayerId);
        }
      });

      addPeerEventListener(peer, 'iceconnectionstatechange', () => {
        logRoomVoiceDebug('ice state changed', {
          remotePlayerId,
          iceConnectionState: peer.iceConnectionState,
          connectionState: peer.connectionState,
        });
      });

      addPeerEventListener(peer, 'signalingstatechange', () => {
        logRoomVoiceDebug('signaling state changed', {
          remotePlayerId,
          signalingState: peer.signalingState,
        });
      });

      peersRef.current.set(remotePlayerId, peer);
      return peer;
    },
    [closePeer, emitSignal, setRemoteAudioTrack, syncLocalAudioToPeer],
  );

  const flushPendingIceCandidates = useCallback(
    async (remotePlayerId: string, peer: RTCPeerConnection) => {
      const pendingCandidates =
        pendingIceCandidatesRef.current.get(remotePlayerId);
      if (!pendingCandidates?.length || !peer.remoteDescription) return;

      pendingIceCandidatesRef.current.delete(remotePlayerId);
      for (const candidate of pendingCandidates) {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      }
      logRoomVoiceDebug('queued ice candidates flushed', {
        remotePlayerId,
        count: pendingCandidates.length,
      });
    },
    [],
  );

  const createOffer = useCallback(
    async (remotePlayerId: string) => {
      if (negotiatingPeersRef.current.has(remotePlayerId)) return;
      const peer = ensurePeer(remotePlayerId);
      if (!peer) return;

      if (!shouldCreateInitialOffer(remotePlayerId, peer)) {
        logRoomVoiceDebug('initial offer skipped', {
          remotePlayerId,
          signalingState: peer.signalingState,
          connectionState: peer.connectionState,
          localDescription: peer.localDescription?.type ?? null,
          remoteDescription: peer.remoteDescription?.type ?? null,
        });
        return;
      }

      negotiatingPeersRef.current.add(remotePlayerId);
      try {
        await syncLocalAudioToPeer(peer, remotePlayerId);
        if (!shouldCreateInitialOffer(remotePlayerId, peer)) {
          logRoomVoiceDebug('initial offer skipped after sync', {
            remotePlayerId,
            signalingState: peer.signalingState,
            connectionState: peer.connectionState,
            localDescription: peer.localDescription?.type ?? null,
            remoteDescription: peer.remoteDescription?.type ?? null,
          });
          return;
        }

        const offer = await peer.createOffer();
        if (peer.signalingState !== 'stable') return;
        await peer.setLocalDescription(offer);
        if (!peer.localDescription?.sdp) return;

        logRoomVoiceDebug('offer sent', {
          remotePlayerId,
          signalingState: peer.signalingState,
          localDescriptionType: peer.localDescription.type,
        });
        emitSignal(remotePlayerId, {
          type: 'offer',
          sdp: peer.localDescription.sdp,
        });
      } catch (cause) {
        console.error('Voice offer failed', cause);
      } finally {
        negotiatingPeersRef.current.delete(remotePlayerId);
      }
    },
    [emitSignal, ensurePeer, shouldCreateInitialOffer, syncLocalAudioToPeer],
  );

  const connectToEnabledPeers = useCallback(() => {
    const currentPlayerId = selfPlayerIdRef.current;
    if (!currentPlayerId || !enabledRef.current) return;

    for (const candidate of playersRef.current) {
      if (candidate.id === currentPlayerId) continue;
      if (!voiceStatesRef.current[candidate.id]?.enabled) continue;

      const peer = ensurePeer(candidate.id);
      if (peer && shouldCreateInitialOffer(candidate.id, peer)) {
        void createOffer(candidate.id);
      }
    }
  }, [createOffer, ensurePeer, shouldCreateInitialOffer]);

  const syncAllPeers = useCallback(async () => {
    const tasks: Promise<void>[] = [];
    for (const [playerId, peer] of peersRef.current) {
      tasks.push(syncLocalAudioToPeer(peer, playerId));
    }
    await Promise.all(tasks);
  }, [syncLocalAudioToPeer]);

  const publishLocalVoiceState = useCallback(
    (state: VoicePeerState) => {
      const currentPlayerId = selfPlayerIdRef.current;
      if (!currentPlayerId) return;

      setVoiceStateForPlayer(currentPlayerId, state);
      emitVoiceState(state);
    },
    [emitVoiceState, setVoiceStateForPlayer],
  );

  const setLocalMuted = useCallback(
    async (nextMuted: boolean) => {
      const currentPlayerId = selfPlayerIdRef.current;
      if (!currentPlayerId || !enabledRef.current || !localStreamRef.current) {
        return;
      }

      for (const track of localStreamRef.current.getAudioTracks()) {
        track.enabled = !nextMuted;
      }

      mutedRef.current = nextMuted;
      setMuted(nextMuted);
      publishLocalVoiceState({
        enabled: true,
        muted: nextMuted,
        speaking: false,
      });
      logRoomVoiceDebug('local mute changed', {
        selfPlayerId: currentPlayerId,
        muted: nextMuted,
        localTrack: describeTrack(localStreamRef.current.getAudioTracks()[0]),
      });
      await syncAllPeers();
    },
    [publishLocalVoiceState, syncAllPeers],
  );

  const stop = useCallback(() => {
    const currentPlayerId = selfPlayerIdRef.current;
    connectingRef.current = false;
    enabledRef.current = false;
    mutedRef.current = true;
    setConnecting(false);
    setEnabled(false);
    setMuted(true);
    stopVoiceAudioRoute();
    stopLocalStream();
    closeAllPeers(true);
    emitVoiceState({ enabled: false, muted: true, speaking: false });
    if (currentPlayerId) {
      setVoiceStateForPlayer(currentPlayerId, {
        enabled: false,
        muted: true,
        speaking: false,
      });
    }
  }, [
    closeAllPeers,
    emitVoiceState,
    setVoiceStateForPlayer,
    stopLocalStream,
  ]);

  const start = useCallback(async () => {
    const currentPlayerId = selfPlayerIdRef.current;
    if (!currentPlayerId || connectingRef.current) return;

    if (enabledRef.current && localStreamRef.current) {
      await setLocalMuted(false);
      return;
    }

    if (!mediaDevices?.getUserMedia) {
      setError('Voice chat needs the development build. Expo Go cannot run mobile voice.');
      return;
    }

    connectingRef.current = true;
    setConnecting(true);
    setError(null);

    try {
      await loadVoicePeerConfig();
      startVoiceAudioRoute();
      const stream = await mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      for (const track of stream.getAudioTracks()) {
        track.enabled = true;
      }

      localStreamRef.current = stream;
      enabledRef.current = true;
      mutedRef.current = false;
      setEnabled(true);
      setMuted(false);
      publishLocalVoiceState({
        enabled: true,
        muted: false,
        speaking: false,
      });
      logRoomVoiceDebug('local mic started', {
        selfPlayerId: currentPlayerId,
        localTrack: describeTrack(stream.getAudioTracks()[0]),
      });
      socketRef.current?.emit('voice:requestStates');
      await syncAllPeers();
      connectToEnabledPeers();
    } catch (cause) {
      stopVoiceAudioRoute();
      stopLocalStream();
      enabledRef.current = false;
      mutedRef.current = true;
      setEnabled(false);
      setMuted(true);
      setError(
        isPermissionError(cause)
          ? 'Mic permission was blocked. Enable microphone permission and try again.'
          : 'Could not start voice chat.',
      );
      console.error('Voice start failed', cause);
    } finally {
      connectingRef.current = false;
      setConnecting(false);
    }
  }, [
    connectToEnabledPeers,
    publishLocalVoiceState,
    setLocalMuted,
    stopLocalStream,
    syncAllPeers,
  ]);

  const handleIncomingSignal = useCallback(
    async (event: VoiceSignalEvent) => {
      const currentPlayerId = selfPlayerIdRef.current;
      if (
        !currentPlayerId ||
        event.targetPlayerId !== currentPlayerId ||
        event.fromPlayerId === currentPlayerId ||
        !enabledRef.current
      ) {
        return;
      }

      const peer = ensurePeer(event.fromPlayerId);
      if (!peer) return;

      try {
        logRoomVoiceDebug('signal received', {
          fromPlayerId: event.fromPlayerId,
          signal: describeSignal(event.signal),
          signalingState: peer.signalingState,
          connectionState: peer.connectionState,
        });

        switch (event.signal.type) {
          case 'offer': {
            if (peer.signalingState !== 'stable') {
              try {
                await peer.setLocalDescription({ type: 'rollback', sdp: '' });
                logRoomVoiceDebug('rolled back local description', {
                  remotePlayerId: event.fromPlayerId,
                });
              } catch (cause) {
                console.error('Voice rollback failed', cause);
              }
            }

            await peer.setRemoteDescription(
              new RTCSessionDescription({
                type: 'offer',
                sdp: event.signal.sdp,
              }),
            );
            await syncLocalAudioToPeer(peer, event.fromPlayerId);
            syncRemoteAudioFromPeer(event.fromPlayerId, peer);
            await flushPendingIceCandidates(event.fromPlayerId, peer);

            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            if (!peer.localDescription?.sdp) return;

            logRoomVoiceDebug('answer sent', {
              remotePlayerId: event.fromPlayerId,
              signalingState: peer.signalingState,
              localDescriptionType: peer.localDescription.type,
            });
            emitSignal(event.fromPlayerId, {
              type: 'answer',
              sdp: peer.localDescription.sdp,
            });
            break;
          }
          case 'answer':
            if (peer.signalingState !== 'have-local-offer') {
              logRoomVoiceDebug('stale answer ignored', {
                remotePlayerId: event.fromPlayerId,
                signalingState: peer.signalingState,
              });
              break;
            }
            await peer.setRemoteDescription(
              new RTCSessionDescription({
                type: 'answer',
                sdp: event.signal.sdp,
              }),
            );
            logRoomVoiceDebug('answer applied', {
              remotePlayerId: event.fromPlayerId,
              signalingState: peer.signalingState,
            });
            syncRemoteAudioFromPeer(event.fromPlayerId, peer);
            await flushPendingIceCandidates(event.fromPlayerId, peer);
            break;
          case 'ice-candidate': {
            const candidate = normalizeIceCandidate(event.signal.candidate);
            if (!candidate) break;

            if (peer.remoteDescription) {
              await peer.addIceCandidate(new RTCIceCandidate(candidate));
              logRoomVoiceDebug('ice candidate applied', {
                remotePlayerId: event.fromPlayerId,
                candidate: describeCandidate(candidate),
              });
            } else {
              const pendingCandidates =
                pendingIceCandidatesRef.current.get(event.fromPlayerId) ?? [];
              pendingCandidates.push(candidate);
              pendingIceCandidatesRef.current.set(
                event.fromPlayerId,
                pendingCandidates,
              );
              logRoomVoiceDebug('ice candidate queued', {
                remotePlayerId: event.fromPlayerId,
                candidate: describeCandidate(candidate),
                pendingCount: pendingCandidates.length,
              });
            }
            break;
          }
          case 'leave':
            closePeer(event.fromPlayerId);
            break;
        }
      } catch (cause) {
        console.error('Voice signal failed', cause);
      }
    },
    [
      closePeer,
      emitSignal,
      ensurePeer,
      flushPendingIceCandidates,
      syncLocalAudioToPeer,
      syncRemoteAudioFromPeer,
    ],
  );

  useEffect(() => {
    if (!socket) return;
    const activeSocket = socket;

    function handleVoiceState(event: VoiceStateEvent) {
      const currentPlayerId = selfPlayerIdRef.current;
      if (event.playerId === currentPlayerId) return;

      setVoiceStateForPlayer(event.playerId, {
        enabled: event.enabled,
        muted: event.muted,
        speaking: event.speaking,
      });

      if (!currentPlayerId) return;

      if (!event.enabled) {
        closePeer(event.playerId);
        return;
      }

      if (enabledRef.current) {
        const peer = ensurePeer(event.playerId);
        if (peer && shouldCreateInitialOffer(event.playerId, peer)) {
          void createOffer(event.playerId);
        }
      }
    }

    function handleSignal(event: VoiceSignalEvent) {
      void handleIncomingSignal(event);
    }

    function handleConnect() {
      activeSocket.emit('voice:requestStates');
      if (!enabledRef.current) return;

      emitVoiceState({
        enabled: true,
        muted: mutedRef.current,
        speaking: false,
      });
      connectToEnabledPeers();
    }

    function handleDisconnect() {
      closeAllPeers();
    }

    activeSocket.on('voice:state', handleVoiceState);
    activeSocket.on('voice:signal', handleSignal);
    activeSocket.on('connect', handleConnect);
    activeSocket.on('disconnect', handleDisconnect);
    activeSocket.emit('voice:requestStates');

    return () => {
      activeSocket.off('voice:state', handleVoiceState);
      activeSocket.off('voice:signal', handleSignal);
      activeSocket.off('connect', handleConnect);
      activeSocket.off('disconnect', handleDisconnect);
    };
  }, [
    closeAllPeers,
    closePeer,
    connectToEnabledPeers,
    createOffer,
    emitVoiceState,
    ensurePeer,
    handleIncomingSignal,
    setVoiceStateForPlayer,
    shouldCreateInitialOffer,
    socket,
  ]);

  useEffect(() => {
    const validPlayerIds = new Set(players.map((candidate) => candidate.id));
    for (const playerId of peersRef.current.keys()) {
      if (!validPlayerIds.has(playerId)) closePeer(playerId);
    }

    setVoiceStates((current) => {
      let changed = false;
      const next: Record<string, VoicePeerState> = {};
      for (const [playerId, state] of Object.entries(current)) {
        if (!validPlayerIds.has(playerId)) {
          changed = true;
          continue;
        }
        next[playerId] = state;
      }
      return changed ? next : current;
    });

    connectToEnabledPeers();
  }, [closePeer, connectToEnabledPeers, players]);

  useEffect(() => {
    if (!selfPlayerId || !socket) stop();
  }, [selfPlayerId, socket, stop]);

  useEffect(() => stop, [roomCode, stop]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') return;
      stop();
    });

    return () => {
      subscription.remove();
    };
  }, [stop]);

  useEffect(() => {
    const debugSnapshot = () => ({
      selfPlayerId: selfPlayerIdRef.current,
      enabled: enabledRef.current,
      muted: mutedRef.current,
      localTrack: describeTrack(localStreamRef.current?.getAudioTracks()[0]),
      iceServers: voicePeerConfig.iceServers.map((server) => server.urls),
      voiceStates: voiceStatesRef.current,
      remoteTracks: remoteTracksByPlayerId,
      peers: Object.fromEntries(
        Array.from(peersRef.current.entries()).map(([playerId, peer]) => [
          playerId,
          {
            signalingState: peer.signalingState,
            iceConnectionState: peer.iceConnectionState,
            iceGatheringState: peer.iceGatheringState,
            connectionState: peer.connectionState,
            localDescription: peer.localDescription?.type ?? null,
            remoteDescription: peer.remoteDescription?.type ?? null,
            transceivers: peer.getTransceivers().map((transceiver) => ({
              mid: transceiver.mid,
              direction: transceiver.direction,
              currentDirection: transceiver.currentDirection,
              senderTrack: describeTrack(transceiver.sender.track),
              receiverTrack: describeTrack(transceiver.receiver.track),
            })),
          },
        ]),
      ),
    });

    (globalThis as VoiceDebugGlobal).__unoMobileVoiceDebug = debugSnapshot;

    return () => {
      const targetGlobal = globalThis as VoiceDebugGlobal;
      if (targetGlobal.__unoMobileVoiceDebug === debugSnapshot) {
        delete targetGlobal.__unoMobileVoiceDebug;
      }
    };
  }, [remoteTracksByPlayerId]);

  const toggle = useCallback(() => {
    if (enabledRef.current && localStreamRef.current) {
      void setLocalMuted(!mutedRef.current);
    } else {
      void start();
    }
  }, [setLocalMuted, start]);

  return useMemo(
    () => ({
      enabled,
      connecting,
      muted,
      error,
      voiceStates,
      toggle,
      stop,
    }),
    [connecting, enabled, error, muted, stop, toggle, voiceStates],
  );
}
