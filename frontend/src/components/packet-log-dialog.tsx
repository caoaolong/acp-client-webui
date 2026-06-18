import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useShikiHighlighter } from "react-shiki";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { usePacketLogStore, type PacketLogEntry } from "@/store/packet-log";
import { cn } from "@/lib/utils";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ZapIcon,
  TrashIcon,
} from "lucide-react";

function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setIsDark(root.classList.contains("dark"));
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

function DirectionIcon({ direction }: { direction: PacketLogEntry["direction"] }) {
  switch (direction) {
    case "request":
      return <ArrowUpIcon className="size-3.5 text-blue-500" />;
    case "response":
      return <ArrowDownIcon className="size-3.5 text-green-500" />;
    case "event":
      return <ZapIcon className="size-3.5 text-amber-500" />;
  }
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

function JsonViewer({ data }: { data: unknown }) {
  const isDark = useIsDark();
  const jsonString = useMemo(
    () => JSON.stringify(data, null, 2) ?? "null",
    [data],
  );

  const highlighted = useShikiHighlighter(
    jsonString,
    "json",
    isDark ? "github-dark-default" : "github-light-default",
  );

  if (!highlighted) {
    return (
      <pre className="text-sm font-mono whitespace-pre-wrap break-all text-muted-foreground">
        {jsonString}
      </pre>
    );
  }

  return (
    <div className="[&_pre]:!bg-transparent [&_pre]:!p-0 [&_pre]:!m-0 [&_pre]:overflow-visible [&_code]:text-sm [&_code]:font-mono">
      {highlighted}
    </div>
  );
}

function PacketListItem({
  entry,
  selected,
  onClick,
}: {
  entry: PacketLogEntry;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left transition-colors",
        selected
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "hover:bg-sidebar-accent/50 text-sidebar-foreground",
      )}
    >
      <div className="flex items-center gap-2">
        <DirectionIcon direction={entry.direction} />
        <span className="text-xs font-medium truncate">{entry.type}</span>
        {entry.chunkCount && entry.chunkCount > 1 && (
          <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400 tabular-nums">
            ×{entry.chunkCount}
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
          {formatTime(entry.timestamp)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground truncate">{entry.summary}</p>
    </button>
  );
}

export function PacketLogDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const entries = usePacketLogStore((state) => state.entries);
  const clearEntries = usePacketLogStore((state) => state.clearEntries);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedEntry = useMemo(
    () => entries.find((e) => e.id === selectedId) ?? null,
    [entries, selectedId],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex !h-[85vh] !w-[90vw] !max-h-[85vh] !max-w-[90vw] overflow-hidden p-0">
        <div className="flex w-72 shrink-0 flex-col border-r border-border bg-sidebar">
          <div className="flex items-center justify-between border-b border-border px-3 py-3">
            <DialogTitle className="text-sm font-medium">
              {t("packetLog.title")}
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={clearEntries}
              aria-label={t("packetLog.clear")}
            >
              <TrashIcon className="size-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {entries.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                {t("packetLog.empty")}
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {[...entries].reverse().map((entry) => (
                  <PacketListItem
                    key={entry.id}
                    entry={entry}
                    selected={entry.id === selectedId}
                    onClick={() => setSelectedId(entry.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <DialogHeader className="border-b border-border px-6 py-4 pr-10">
            {selectedEntry ? (
              <>
                <div className="flex items-center gap-2">
                  <DirectionIcon direction={selectedEntry.direction} />
                  <DialogTitle className="text-base">
                    {selectedEntry.type}
                  </DialogTitle>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {formatTime(selectedEntry.timestamp)}
                  </span>
                </div>
                <DialogDescription className="text-sm">
                  {selectedEntry.summary}
                </DialogDescription>
              </>
            ) : (
              <>
                <DialogTitle>{t("packetLog.detail")}</DialogTitle>
                <DialogDescription>
                  {t("packetLog.selectHint")}
                </DialogDescription>
              </>
            )}
          </DialogHeader>

          <div className="flex-1 overflow-auto px-6 py-4 bg-muted/20">
            {selectedEntry ? (
              <div className="flex flex-col gap-4">
                {selectedEntry.mergedText && (
                  <div className="rounded-lg border border-border bg-background p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        {t("packetLog.mergedText")}
                      </span>
                      {selectedEntry.chunkCount && (
                        <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-600 dark:text-amber-400 tabular-nums">
                          {selectedEntry.chunkCount} {t("packetLog.chunks")}
                        </span>
                      )}
                    </div>
                    <pre className="whitespace-pre-wrap break-all text-sm text-foreground">
                      {selectedEntry.mergedText}
                    </pre>
                  </div>
                )}
                <JsonViewer data={selectedEntry.data} />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  {t("packetLog.noSelection")}
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
