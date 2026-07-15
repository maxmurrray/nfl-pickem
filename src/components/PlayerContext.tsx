"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { isPlayerId, type PlayerId } from "@/lib/types";

const STORAGE_KEY = "pickem-player";

interface PlayerContextValue {
  /** null until chosen (first visit) or while reading localStorage. */
  player: PlayerId | null;
  /** true once localStorage has been read on the client. */
  ready: boolean;
  setPlayer: (player: PlayerId) => void;
}

const PlayerContext = createContext<PlayerContextValue>({
  player: null,
  ready: false,
  setPlayer: () => {},
});

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [player, setPlayerState] = useState<PlayerId | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isPlayerId(saved)) setPlayerState(saved);
    setReady(true);
  }, []);

  const setPlayer = useCallback((next: PlayerId) => {
    setPlayerState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  return (
    <PlayerContext.Provider value={{ player, ready, setPlayer }}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  return useContext(PlayerContext);
}
