import { Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ActivityButton } from "./header/activity-button";
import { ProjectTabs } from "./header/project-tabs";
import { HeaderUpdateButton } from "./header/update-button";
import { WindowControls } from "./header/window-controls";
import { useIdeStore } from "./ide-store";

export const IdeHeader = () => {
  const t = useTranslations("common");
  const appReady = useIdeStore((s) => s.appReady);
  const isMacOs = useIdeStore((s) => s.isMacOs);
  const isElectron = useIdeStore((s) => s.isElectron);
  const setSettingsOpen = useIdeStore((s) => s.setSettingsOpen);
  const setSettingsSection = useIdeStore((s) => s.setSettingsSection);

  const openSettings = () => {
    setSettingsSection("appearance");
    setSettingsOpen(true);
  };

  return (
    <header
      id="app-titlebar"
      className="flex shrink-0 flex-col text-foreground [-webkit-app-region:drag]"
    >
      <div className="flex h-12 items-center gap-2 [-webkit-app-region:drag]">
        <div
          className={cn(
            "h-8 shrink-0 [-webkit-app-region:drag]",
            isMacOs ? "w-24" : "w-0",
          )}
        />

        <ActivityButton />
        <ProjectTabs />

        <HeaderUpdateButton />

        <Button
          aria-label={t("settings")}
          className="mr-2 size-8 text-muted-foreground hover:text-foreground [-webkit-app-region:no-drag]"
          onClick={openSettings}
          size="icon"
          title={t("settings")}
          variant="ghost"
        >
          <Settings className="size-4" />
        </Button>

        {!isMacOs && isElectron && appReady ? <WindowControls /> : null}
      </div>
    </header>
  );
};
