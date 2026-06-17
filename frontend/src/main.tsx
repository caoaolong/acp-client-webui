import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { LanguageSync } from "@/components/language-sync";
import i18n from "@/i18n";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <LanguageSync>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </LanguageSync>
      </ThemeProvider>
    </I18nextProvider>
  </StrictMode>,
);
