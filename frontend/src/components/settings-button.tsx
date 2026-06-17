import { useState } from "react";
import { SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsDialog } from "@/components/settings-dialog";

export function SettingsButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="w-full justify-start gap-2"
        aria-label="Settings"
      >
        <SettingsIcon className="size-4" />
        <span>Settings</span>
      </Button>
      <SettingsDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
