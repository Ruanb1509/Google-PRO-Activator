import ptBR from "./pt-BR/bot.json";
import enUS from "./en-US/bot.json";
import type { Locale } from "@/generated/prisma/enums";

export type MessageKey = keyof typeof ptBR;

// en-US must have exactly the same keys as pt-BR (enforced at compile time and by tests).
const dictionaries: Record<Locale, Record<MessageKey, string>> = {
  pt_BR: ptBR,
  en_US: enUS satisfies Record<MessageKey, string>,
};

export const LOCALES: Locale[] = ["pt_BR", "en_US"];
export const DEFAULT_LOCALE: Locale = "en_US";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Translate a key. Variables are HTML-escaped (bot messages use parse_mode HTML), so user-controlled
 * content (product names, codes) can never inject markup.
 */
export function t(locale: Locale, key: MessageKey, vars: Record<string, string | number> = {}): string {
  const template = dictionaries[locale]?.[key] ?? dictionaries[DEFAULT_LOCALE][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? escapeHtml(String(vars[name])) : match,
  );
}

/** Maps Telegram's `language_code` (e.g. "pt", "pt-br", "en") to a supported locale. */
export function detectLocale(languageCode: string | undefined | null): Locale {
  if (languageCode?.toLowerCase().startsWith("pt")) return "pt_BR";
  return "en_US";
}

/** All translations of a key - used to match reply-keyboard buttons regardless of language. */
export function allTranslations(key: MessageKey): string[] {
  return LOCALES.map((l) => dictionaries[l][key]);
}

export function dictionary(locale: Locale): Record<MessageKey, string> {
  return dictionaries[locale];
}
