import type { AcpServerType } from "@/lib/server-detection";
import type { SupportedLanguage } from "@/i18n";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AcpServer {
  id: string;
  name: string;
  type: AcpServerType;
  executablePath: string;
  args: string[];
}

export const SERVER_TYPE_LABELS: Record<AcpServerType, string> = {
  qwen: "Qwen",
  opencode: "OpenCode",
  cursor: "Cursor",
  custom: "Custom",
};

export type ThemeMode = "system" | "light" | "dark";

export interface SettingsState {
  servers: AcpServer[];
  selectedServerId: string | null;
  hasAutoDetected: boolean;
  language: SupportedLanguage | "system";
  theme: ThemeMode;
  addServer: (server: AcpServer) => void;
  updateServer: (id: string, updates: Partial<AcpServer>) => void;
  removeServer: (id: string) => void;
  setSelectedServer: (id: string) => void;
  setServers: (servers: AcpServer[]) => void;
  setHasAutoDetected: (value: boolean) => void;
  setLanguage: (language: SupportedLanguage | "system") => void;
  setTheme: (theme: ThemeMode) => void;
  getActiveServer: () => AcpServer | undefined;
}

const DEFAULT_SERVERS: AcpServer[] = [
  {
    id: "qwen",
    name: "Qwen",
    type: "qwen",
    executablePath: "qwen",
    args: ["--acp"],
  },
  {
    id: "opencode",
    name: "OpenCode",
    type: "opencode",
    executablePath: "opencode",
    args: ["acp"],
  },
  {
    id: "cursor",
    name: "Cursor",
    type: "cursor",
    executablePath: "cursor",
    args: [],
  },
];

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      servers: DEFAULT_SERVERS,
      selectedServerId: "qwen",
      hasAutoDetected: false,
      language: "system",
      theme: "system",
      addServer: (server) =>
        set((state) => ({
          servers: [...state.servers, server],
        })),
      updateServer: (id, updates) =>
        set((state) => ({
          servers: state.servers.map((server) =>
            server.id === id ? { ...server, ...updates } : server,
          ),
        })),
      removeServer: (id) =>
        set((state) => ({
          servers: state.servers.filter((server) => server.id !== id),
          selectedServerId:
            state.selectedServerId === id ? null : state.selectedServerId,
        })),
      setSelectedServer: (id) => set({ selectedServerId: id }),
      setServers: (servers) => set({ servers }),
      setHasAutoDetected: (value) => set({ hasAutoDetected: value }),
      setLanguage: (language) => set({ language }),
      setTheme: (theme) => set({ theme }),
      getActiveServer: () => {
        const { servers, selectedServerId } = get();
        return servers.find((server) => server.id === selectedServerId);
      },
    }),
    {
      name: "acp-client-settings",
    },
  ),
);
