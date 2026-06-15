import { useAcpRuntime } from "@/acp/use-acp-runtime";
import { AcpPermissionDialog } from "@/components/acp-permission-dialog";
import { AcpStatus } from "@/components/acp-status";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { Thread } from "@/components/thread";
import { ThreadList } from "@/components/thread-list";

const ACP_CWD = import.meta.env.VITE_ACP_CWD;
const ACP_AGENT_COMMAND = import.meta.env.VITE_ACP_AGENT_COMMAND;
const ACP_AGENT_ARGS = import.meta.env.VITE_ACP_AGENT_ARGS
  ? (JSON.parse(import.meta.env.VITE_ACP_AGENT_ARGS) as string[])
  : undefined;

function App() {
  const runtime = useAcpRuntime({
    cwd: ACP_CWD,
    agentCommand: ACP_AGENT_COMMAND,
    agentArgs: ACP_AGENT_ARGS,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AcpPermissionDialog />
      <div className="flex h-full min-h-screen bg-background">
        <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-sidebar p-3">
          <h1 className="mb-3 px-2 text-sm font-semibold text-sidebar-foreground">
            Vac Agent
          </h1>
          <p className="mb-1 px-2 text-xs text-muted-foreground">
            ACP Client · opencode acp (stdio)
          </p>
          <div className="mb-3">
            <AcpStatus />
          </div>
          <ThreadList />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <Thread />
        </main>
      </div>
    </AssistantRuntimeProvider>
  );
}

export default App;
