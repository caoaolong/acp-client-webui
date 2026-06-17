import { useTranslation } from "react-i18next";
import { useAcpRuntime } from "@/acp/use-acp-runtime";
import { AcpPermissionDialog } from "@/components/acp-permission-dialog";
import { AcpStatus } from "@/components/acp-status";
import { SettingsButton } from "@/components/settings-button";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { Thread } from "@/components/thread";
import { ThreadList } from "@/components/thread-list";
import { useAutoDetectServers } from "@/hooks/use-auto-detect-servers";
import { useSettingsStore } from "@/store/settings";

const ACP_CWD = import.meta.env.VITE_ACP_CWD;

function App() {
  useAutoDetectServers();
  const { t } = useTranslation();
  const activeServer = useSettingsStore((state) => state.getActiveServer());

  const runtime = useAcpRuntime({
    cwd: ACP_CWD,
    agentCommand: activeServer?.executablePath,
    agentArgs: activeServer?.args,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AcpPermissionDialog />
      <div className="relative flex h-screen w-screen bg-background overflow-hidden">
        <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-sidebar p-3">
          <h1 className="mb-3 px-2 text-sm font-semibold text-sidebar-foreground">
            {t("app.title")}
          </h1>
          <p className="mb-1 px-2 text-xs text-muted-foreground">
            {t("app.subtitle")} · {activeServer?.name ?? t("app.noServer")}
          </p>
          <div className="mb-3">
            <AcpStatus />
          </div>
          <div className="flex-1 overflow-y-auto">
            <ThreadList />
          </div>
          <div className="mt-3 border-t border-border pt-3">
            <SettingsButton />
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <Thread />
        </main>
      </div>
    </AssistantRuntimeProvider>
  );
}

export default App;
