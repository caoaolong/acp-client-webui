import { useTranslation } from "react-i18next";
import { useSettingsStore, type SettingsState } from "@/store/settings";
import { cn } from "@/lib/utils";

type LanguageOption = SettingsState["language"];

const OPTIONS: { value: LanguageOption; labelKey: string }[] = [
  { value: "system", labelKey: "settings.language.system" },
  { value: "en", labelKey: "settings.language.en" },
  { value: "zh", labelKey: "settings.language.zh" },
];

export function LanguageModule() {
  const { t } = useTranslation();
  const { language, setLanguage } = useSettingsStore();

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="font-medium">{t("settings.language.title")}</h3>
        <p className="text-muted-foreground text-sm">
          {t("settings.language.description")}
        </p>
      </div>

      <div className="space-y-2">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setLanguage(option.value)}
            className={cn(
              "flex w-full items-center justify-between rounded-lg border px-4 py-3 text-sm transition-colors",
              language === option.value
                ? "border-primary bg-primary/5"
                : "border-border bg-background hover:bg-muted/50",
            )}
          >
            <span>{t(option.labelKey)}</span>
            <span
              className={cn(
                "flex size-4 items-center justify-center rounded-full border",
                language === option.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/30",
              )}
            >
              {language === option.value && (
                <span className="block size-1.5 rounded-full bg-current" />
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
