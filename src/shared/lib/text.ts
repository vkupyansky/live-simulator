function cleanUserText(value: string, maxLength: number): string {
  return [...value.normalize('NFKC')]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .slice(0, maxLength)
    .join('')
    .trim();
}

export function initials(value: string): string {
  const parts = cleanUserText(value, 50).split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? 'L') + (parts[1]?.[0] ?? '');
}
