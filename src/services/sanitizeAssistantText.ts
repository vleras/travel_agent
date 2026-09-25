/** Display-only cleanup; user messages and extracted trip data stay unchanged. */
export function sanitizeAssistantText(text: string): string {
  return text
    .replace(/(\d)\s*[—–]\s*(?=\d)/g, '$1 to ')
    .replace(/[—–]/g, ', ')
    .replace(/ {2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,(?:\s*,)+/g, ',')
    .replace(/,\s*\./g, '.')
    .trim();
}
