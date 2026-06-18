import { create } from "zustand";

export type PacketDirection = "request" | "response" | "event";

export type PacketLogEntry = {
  id: string;
  timestamp: number;
  direction: PacketDirection;
  type: string;
  summary: string;
  data: unknown;
  mergeKey?: string;
  chunkCount?: number;
  mergedText?: string;
};

type PacketLogState = {
  entries: PacketLogEntry[];
  addEntry: (entry: Omit<PacketLogEntry, "id" | "timestamp">) => void;
  mergeEntry: (
    mergeKey: string,
    entry: Omit<PacketLogEntry, "id" | "timestamp">,
    chunkText: string,
  ) => void;
  clearEntries: () => void;
};

let counter = 0;

export const usePacketLogStore = create<PacketLogState>((set) => ({
  entries: [],
  addEntry: (entry) =>
    set((state) => ({
      entries: [
        ...state.entries,
        {
          ...entry,
          id: `${Date.now()}-${counter++}`,
          timestamp: Date.now(),
        },
      ],
    })),
  mergeEntry: (mergeKey, entry, chunkText) =>
    set((state) => {
      const existingIndex = state.entries.findIndex(
        (e) => e.mergeKey === mergeKey,
      );
      if (existingIndex === -1) {
        return {
          entries: [
            ...state.entries,
            {
              ...entry,
              id: `${Date.now()}-${counter++}`,
              timestamp: Date.now(),
              mergeKey,
              chunkCount: 1,
              mergedText: chunkText,
            },
          ],
        };
      }
      const updated = [...state.entries];
      const existing = updated[existingIndex];
      updated[existingIndex] = {
        ...existing,
        chunkCount: (existing.chunkCount ?? 1) + 1,
        mergedText: (existing.mergedText ?? "") + chunkText,
        timestamp: Date.now(),
        data: entry.data,
      };
      return { entries: updated };
    }),
  clearEntries: () => set({ entries: [] }),
}));

export function logPacket(
  direction: PacketDirection,
  type: string,
  summary: string,
  data: unknown,
) {
  usePacketLogStore.getState().addEntry({ direction, type, summary, data });
}

export function logMergedPacket(
  mergeKey: string,
  direction: PacketDirection,
  type: string,
  summary: string,
  data: unknown,
  chunkText: string,
) {
  usePacketLogStore
    .getState()
    .mergeEntry(mergeKey, { direction, type, summary, data }, chunkText);
}
