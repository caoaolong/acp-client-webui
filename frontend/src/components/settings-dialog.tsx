import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ServersModule } from "@/components/settings/servers-module";
import { LanguageModule } from "@/components/settings/language-module";
import { AppearanceModule } from "@/components/settings/appearance-module";
import { cn } from "@/lib/utils";
import { GlobeIcon, MonitorIcon, ServerIcon } from "lucide-react";

type SettingsModule = "servers" | "language" | "appearance";

const MODULES: {
  id: SettingsModule;
  icon: React.ReactNode;
  labelKey: string;
}[] = [
  {
    id: "servers",
    icon: <ServerIcon className="size-4" />,
    labelKey: "settings.modules.servers",
  },
  {
    id: "language",
    icon: <GlobeIcon className="size-4" />,
    labelKey: "settings.modules.language",
  },
  {
    id: "appearance",
    icon: <MonitorIcon className="size-4" />,
    labelKey: "settings.modules.appearance",
  },
];

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [activeModule, setActiveModule] = useState<SettingsModule>("servers");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex !h-[90vh] !w-[90vw] !max-h-[90vh] !max-w-[90vw] overflow-hidden p-0">
        {/* Sidebar */}
        <div className="flex w-48 shrink-0 flex-col border-r border-border bg-sidebar p-3">
          <div className="mb-4 px-2">
            <DialogTitle className="text-base">
              {t("settings.title")}
            </DialogTitle>
          </div>
          <nav className="flex flex-col gap-1">
            {MODULES.map((module) => (
              <button
                key={module.id}
                type="button"
                onClick={() => setActiveModule(module.id)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                  activeModule === module.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                )}
              >
                {module.icon}
                {t(module.labelKey)}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <DialogHeader className="border-b border-border px-6 py-4">
            <DialogTitle>{t("settings.title")}</DialogTitle>
            <DialogDescription>{t("settings.description")}</DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {activeModule === "servers" && <ServersModule />}
            {activeModule === "language" && <LanguageModule />}
            {activeModule === "appearance" && <AppearanceModule />}
          </div>

          <DialogFooter
            className="border-t border-border bg-popover px-6 py-4 !mb-1"
            showCloseButton
          >
            <DialogClose render={<Button variant="default" />}>
              {t("settings.done")}
            </DialogClose>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
