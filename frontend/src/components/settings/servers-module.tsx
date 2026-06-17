import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { detectAcpServer } from "@/lib/server-detection";
import { useSettingsStore, SERVER_TYPE_LABELS, type AcpServer } from "@/store/settings";
import { cn } from "@/lib/utils";
import {
  CheckIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";

function generateId() {
  return `server-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function formatArgs(args: string[]) {
  return args.join(" ");
}

function parseArgs(value: string): string[] {
  return value
    .split(" ")
    .map((arg) => arg.trim())
    .filter(Boolean);
}

function ServerRow({
  server,
  isSelected,
  onSelect,
  onUpdate,
  onRemove,
}: {
  server: AcpServer;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<AcpServer>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [detecting, setDetecting] = useState(false);

  const handleDetect = useCallback(async () => {
    setDetecting(true);
    try {
      const path = await detectAcpServer(server.type);
      if (path) {
        onUpdate({ executablePath: path });
      }
    } finally {
      setDetecting(false);
    }
  }, [server.type, onUpdate]);

  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-colors",
        isSelected
          ? "border-primary bg-primary/5"
          : "border-border bg-background",
      )}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            "mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border",
            isSelected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-muted-foreground/30",
          )}
          aria-label={
            isSelected ? t("settings.servers.selected") : t("settings.servers.select")
          }
        >
          {isSelected && <CheckIcon className="size-3" />}
        </button>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-medium">
                {SERVER_TYPE_LABELS[server.type]}
              </span>
              <span className="text-muted-foreground text-xs">
                {server.name}
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={onRemove}
              aria-label={t("settings.servers.remove")}
            >
              <Trash2Icon className="size-3.5" />
            </Button>
          </div>
          <div className="space-y-1">
            <label
              htmlFor={`server-name-${server.id}`}
              className="text-muted-foreground text-xs"
            >
              {t("settings.servers.name")}
            </label>
            <input
              id={`server-name-${server.id}`}
              type="text"
              value={server.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor={`server-path-${server.id}`}
              className="text-muted-foreground text-xs"
            >
              {t("settings.servers.executablePath")}
            </label>
            <div className="flex gap-2">
              <input
                id={`server-path-${server.id}`}
                type="text"
                value={server.executablePath}
                onChange={(e) =>
                  onUpdate({ executablePath: e.target.value })
                }
                placeholder={t("settings.servers.executablePath")}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring"
              />
              {server.type !== "custom" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDetect}
                  disabled={detecting}
                >
                  {detecting ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCwIcon className="size-3.5" />
                  )}
                  <span className="sr-only">{t("settings.servers.autoDetect")}</span>
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <label
              htmlFor={`server-args-${server.id}`}
              className="text-muted-foreground text-xs"
            >
              {t("settings.servers.arguments")}
            </label>
            <input
              id={`server-args-${server.id}`}
              type="text"
              value={formatArgs(server.args)}
              onChange={(e) => onUpdate({ args: parseArgs(e.target.value) })}
              placeholder={t("settings.servers.argumentsPlaceholder")}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ServersModule() {
  const { t } = useTranslation();
  const {
    servers,
    selectedServerId,
    addServer,
    updateServer,
    removeServer,
    setSelectedServer,
    setHasAutoDetected,
  } = useSettingsStore();
  const [detectingAll, setDetectingAll] = useState(false);

  const handleAddCustomServer = useCallback(() => {
    const id = generateId();
    addServer({
      id,
      name: "Custom Server",
      type: "custom",
      executablePath: "",
      args: [],
    });
    setSelectedServer(id);
  }, [addServer, setSelectedServer]);

  const handleDetectAll = useCallback(async () => {
    setDetectingAll(true);
    try {
      const results = await Promise.all(
        servers.map(async (server) => ({
          id: server.id,
          path: await detectAcpServer(server.type),
        })),
      );
      for (const { id, path } of results) {
        if (path) {
          updateServer(id, { executablePath: path });
        }
      }
      setHasAutoDetected(true);
    } finally {
      setDetectingAll(false);
    }
  }, [servers, updateServer, setHasAutoDetected]);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="font-medium">{t("settings.servers.title")}</h3>
        <p className="text-muted-foreground text-sm">
          {t("settings.servers.description")}
        </p>
      </div>

      <div className="space-y-3">
        {servers.length === 0 && (
          <p className="text-muted-foreground py-4 text-center text-sm">
            {t("settings.servers.noServers")}
          </p>
        )}
        {servers.map((server) => (
          <ServerRow
            key={server.id}
            server={server}
            isSelected={server.id === selectedServerId}
            onSelect={() => setSelectedServer(server.id)}
            onUpdate={(updates) => updateServer(server.id, updates)}
            onRemove={() => removeServer(server.id)}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddCustomServer}
        >
          <PlusIcon className="size-3.5" />
          {t("settings.servers.addCustom")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleDetectAll}
          disabled={detectingAll || servers.length === 0}
          className="ms-auto"
        >
          {detectingAll ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <RefreshCwIcon className="size-3.5" />
          )}
          {t("settings.servers.autoDetectAll")}
        </Button>
      </div>
    </div>
  );
}
