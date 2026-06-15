/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ACP_CWD?: string;
  readonly VITE_ACP_AGENT_COMMAND?: string;
  readonly VITE_ACP_AGENT_ARGS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
