/** A locale's name in its own language, e.g. "ca" → "Català". */
export function localeName(locale: string) {
  const name = new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
}
