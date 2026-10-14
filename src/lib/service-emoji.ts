/**
 * Plain Unicode emoji for a service, guessed from the product name. Used in the bot when Telegram refuses
 * the real logos (custom emoji need a Premium bot owner), so the menu still has a visual cue per service.
 */
const SERVICE_EMOJIS: [RegExp, string][] = [
  [/chat\s?gpt|openai/i, "🤖"],
  [/gemini/i, "✨"],
  [/grok/i, "⚡"],
  [/claude/i, "🧠"],
  [/perplexity/i, "🔎"],
  [/copilot/i, "👨‍💻"],
  [/cursor/i, "💻"],
  [/youtube/i, "▶️"],
  [/crunchyroll/i, "🍥"],
  [/capcut/i, "🎬"],
  [/netflix|prime\s?video|disney|hbo|\bmax\b/i, "🍿"],
  [/spotify|deezer|music/i, "🎧"],
  [/canva|figma|adobe/i, "🎨"],
  [/duolingo/i, "🦉"],
  [/coursera|udemy/i, "🎓"],
  [/telegram/i, "✈️"],
  [/linkedin/i, "💼"],
  [/notion/i, "📝"],
  [/microsoft|office|365/i, "🪟"],
  [/vpn/i, "🔐"],
  [/google/i, "🔵"],
  [/elevenlabs|suno/i, "🎙️"],
];

export const DEFAULT_SERVICE_EMOJI = "🔹";

export function serviceEmoji(name: string): string {
  return SERVICE_EMOJIS.find(([re]) => re.test(name))?.[1] ?? DEFAULT_SERVICE_EMOJI;
}
