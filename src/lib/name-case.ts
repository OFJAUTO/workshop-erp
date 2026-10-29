/**
 * A person's or company's name as it shows on a card (29 October 2026): every word starts with a capital
 * ("hazem al ali" → "Hazem Al Ali"); a word typed with capitals inside it keeps them ("McLaren", "OFJ", "LLC").
 * Display only: what was typed stays stored as it is.
 */
export function nameCase(name: string): string {
  return name.replace(/(^|[\s\-'(/])(\p{Ll})/gu, (_, before: string, letter: string) => `${before}${letter.toUpperCase()}`);
}
