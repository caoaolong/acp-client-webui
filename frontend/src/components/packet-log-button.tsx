import { useState } from "react";
import { ScrollTextIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PacketLogDialog } from "@/components/packet-log-dialog";
import { usePacketLogStore } from "@/store/packet-log";

export function PacketLogButton() {
  const [open, setOpen] = useState(false);
  const count = usePacketLogStore((state) => state.entries.length);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="w-full justify-start gap-2"
        aria-label="Packet Log"
      >
        <ScrollTextIcon className="size-4" />
        <span>Packet Log</span>
        {count > 0 && (
          <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">
            {count}
          </span>
        )}
      </Button>
      <PacketLogDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
