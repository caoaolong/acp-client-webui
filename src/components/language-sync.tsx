import { useEffect } from "react";
import i18n, { SUPPORTED_LANGUAGES } from "@/i18n";
import { useSettingsStore } from "@/store/settings";

export function LanguageSync({ children }: { children: React.ReactNode }) {
  const language = useSettingsStore((state) => state.language);

  useEffect(() => {
    const resolved =
      language === "system"
        ? i18n.services.languageDetector?.detect?.() ?? "en"
        : language;

    const target = SUPPORTED_LANGUAGES.includes(resolved as never)
      ? resolved
      : "en";

    if (i18n.language !== target) {
      void i18n.changeLanguage(target);
    }
  }, [language]);

  return <>{children}</>;
}
