import { useAcpPermissions } from "@/acp/use-acp-runtime";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEffect, useState } from "react";

export function AcpPermissionDialog() {
  const { pending, reply } = useAcpPermissions();
  const [currentId, setCurrentId] = useState<string | null>(null);

  useEffect(() => {
    if (pending.length === 0) {
      setCurrentId(null);
      return;
    }
    if (!currentId || !pending.some((item) => item.requestId === currentId)) {
      setCurrentId(pending[0]?.requestId ?? null);
    }
  }, [currentId, pending]);

  const current = pending.find((item) => item.requestId === currentId);

  if (!current) return null;

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Agent 请求权限</DialogTitle>
          <DialogDescription>
            {current.toolCall.title}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {current.options.map((option) => (
            <Button
              key={option.optionId}
              variant="outline"
              className="justify-start"
              onClick={() => void reply(current.requestId, option.optionId)}
            >
              {option.name}
              <span className="text-muted-foreground ms-auto text-xs">
                {option.kind}
              </span>
            </Button>
          ))}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => void reply(current.requestId)}
          >
            拒绝
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
