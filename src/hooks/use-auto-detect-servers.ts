import { detectAcpServer } from "@/lib/server-detection";
import { useSettingsStore } from "@/store/settings";
import { useEffect, useRef } from "react";

export function useAutoDetectServers() {
  const { servers, hasAutoDetected, updateServer, setHasAutoDetected } =
    useSettingsStore();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    if (hasAutoDetected) return;

    const detectAll = async () => {
      for (const server of servers) {
        const detected = await detectAcpServer(server.type);
        if (detected) {
          updateServer(server.id, { executablePath: detected });
        }
      }
      setHasAutoDetected(true);
    };

    void detectAll();
  }, [servers, hasAutoDetected, updateServer, setHasAutoDetected]);
}
