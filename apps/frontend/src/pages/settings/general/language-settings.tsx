import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@wealthfolio/ui/components/ui/card";
import { LanguageSelector } from "@/components/language-selector";
import { DEFAULT_LOCALE } from "@/i18n/locales";
import { useSettingsContext } from "@/lib/settings-provider";

export function LanguageSettings() {
  const { t } = useTranslation("settings");
  const { settings, updateSettings } = useSettingsContext();

  const current = settings?.language || DEFAULT_LOCALE;

  const handleChange = async (language: string) => {
    await updateSettings({ language });
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="text-lg">{t("languageSettings.title")}</CardTitle>
          <CardDescription>{t("languageSettings.description")}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <LanguageSelector
          value={current}
          onChange={handleChange}
          className="w-full max-w-[360px]"
        />
      </CardContent>
    </Card>
  );
}
