import { useTranslation } from "react-i18next";
import { useSettingsStore, type ThemeMode } from "@/store/settings";
import { cn } from "@/lib/utils";

type ThemeOption = { value: ThemeMode; labelKey: string };

export function AppearanceModule() {
  const { t } = useTranslation();
  const { theme, setTheme } = useSettingsStore();

  const options: ThemeOption[] = [
    { value: "system", labelKey: "settings.appearance.themeSystem" },
    { value: "light", labelKey: "settings.appearance.themeLight" },
    { value: "dark", labelKey: "settings.appearance.themeDark" },
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="font-medium">{t("settings.appearance.title")}</h3>
        <p className="text-muted-foreground text-sm">
          {t("settings.appearance.description")}
        </p>
      </div>

      <div className="space-y-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setTheme(option.value)}
            className={cn(
              "flex w-full items-center justify-between rounded-lg border px-4 py-3 text-sm transition-colors",
              theme === option.value
                ? "border-primary bg-primary/5"
                : "border-border bg-background hover:bg-muted/50",
            )}
          >
            <span>{t(option.labelKey)}</span>
            <span
              className={cn(
                "flex size-4 items-center justify-center rounded-full border",
                theme === option.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/30",
              )}
            >
              {theme === option.value && (
                <span className="block size-1.5 rounded-full bg-current" />
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
