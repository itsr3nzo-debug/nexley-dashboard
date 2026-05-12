/**
 * /voice — admin voice channel (push-to-talk to Sage).
 *
 * Gating happens server-side on the token endpoint (/api/voice/token). The
 * page itself renders for any authenticated user; the connect attempt fails
 * if they're not super_admin. We don't render the button at all if the user
 * isn't super_admin so the UX is clean.
 *
 * Built 2026-05-12. See shared/memory/plans/2026-05-12-jarvis-admin-voice-plan.md.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useLocalParticipant,
} from "@livekit/components-react";
import { ConnectionState, Track } from "livekit-client";
import { createClient } from "@/lib/supabase/client";

type TokenResponse = {
  token: string;
  url: string;
  room: string;
  expiresInSeconds: number;
};

type Phase = "idle" | "requesting-token" | "ready" | "connecting" | "connected" | "error";

export default function VoicePage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [tokenData, setTokenData] = useState<TokenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      const role = data.user?.app_metadata?.role;
      setIsSuperAdmin(role === "super_admin");
    });
  }, []);

  const requestToken = useCallback(async () => {
    setPhase("requesting-token");
    setError(null);
    try {
      const res = await fetch("/api/voice/token", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `token request failed (${res.status})`);
      }
      const data = (await res.json()) as TokenResponse;
      setTokenData(data);
      setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, []);

  if (isSuperAdmin === null) {
    return <PageShell><p className="text-zinc-400">Checking access…</p></PageShell>;
  }

  if (!isSuperAdmin) {
    return (
      <PageShell>
        <p className="text-zinc-400">Voice channel is admin-only.</p>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <p className="text-zinc-300 text-sm mb-6">
        Push to talk to Sage. End the session by clicking End or closing this tab.
        Audio is processed live via the admin VPS — text channels (WhatsApp +
        dashboard chat) are unaffected.
      </p>

      {phase === "idle" && (
        <button
          type="button"
          onClick={requestToken}
          className="px-6 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
        >
          Talk to Sage
        </button>
      )}

      {phase === "requesting-token" && (
        <p className="text-zinc-400">Requesting session…</p>
      )}

      {phase === "error" && (
        <div className="space-y-3">
          <p className="text-red-400 text-sm">Error: {error}</p>
          <button
            type="button"
            onClick={requestToken}
            className="px-4 py-2 rounded bg-zinc-700 hover:bg-zinc-600 text-white text-sm"
          >
            Retry
          </button>
        </div>
      )}

      {(phase === "ready" || phase === "connecting" || phase === "connected") && tokenData && (
        <LiveKitRoom
          serverUrl={tokenData.url}
          token={tokenData.token}
          connect={true}
          audio={true}
          video={false}
          onConnected={() => setPhase("connected")}
          onDisconnected={() => {
            setPhase("idle");
            setTokenData(null);
          }}
          onError={(e) => {
            setError(e.message);
            setPhase("error");
          }}
          className="space-y-4"
        >
          <ActiveSession />
          <RoomAudioRenderer />
        </LiveKitRoom>
      )}
    </PageShell>
  );
}

function ActiveSession() {
  const state = useConnectionState();
  const { localParticipant } = useLocalParticipant();
  const [muted, setMuted] = useState(false);
  const mountedAt = useRef(Date.now());

  const toggleMute = useCallback(() => {
    if (!localParticipant) return;
    const next = !muted;
    localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
  }, [muted, localParticipant]);

  // Auto-enable mic on connect.
  useEffect(() => {
    if (state === ConnectionState.Connected && localParticipant) {
      localParticipant.setMicrophoneEnabled(true).catch(() => {
        /* user denied mic permission — handled by browser UI */
      });
    }
  }, [state, localParticipant]);

  const elapsedSec = Math.floor((Date.now() - mountedAt.current) / 1000);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className={`inline-block w-3 h-3 rounded-full ${state === ConnectionState.Connected ? "bg-emerald-500" : "bg-amber-500"}`} />
        <span className="text-sm text-zinc-300">
          {stateLabel(state)}
          {state === ConnectionState.Connected && ` · ${elapsedSec}s`}
        </span>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={toggleMute}
          className="px-4 py-2 rounded bg-zinc-700 hover:bg-zinc-600 text-white text-sm"
        >
          {muted ? "Unmute" : "Mute"}
        </button>
        <button
          type="button"
          onClick={() => {
            void localParticipant?.setMicrophoneEnabled(false);
            window.location.reload();
          }}
          className="px-4 py-2 rounded bg-red-700 hover:bg-red-600 text-white text-sm"
        >
          End
        </button>
      </div>

      <p className="text-zinc-500 text-xs">
        Tip: if Sage isn&apos;t responding, check that the browser tab has microphone permission.
      </p>
    </div>
  );
}

function stateLabel(state: ConnectionState): string {
  switch (state) {
    case ConnectionState.Connected: return "Connected";
    case ConnectionState.Connecting: return "Connecting…";
    case ConnectionState.Reconnecting: return "Reconnecting…";
    case ConnectionState.Disconnected: return "Disconnected";
    default: return state;
  }
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-semibold text-white mb-2">Talk to Sage</h1>
      <p className="text-zinc-500 text-sm mb-8">Admin-only voice channel.</p>
      {children}
    </main>
  );
}
