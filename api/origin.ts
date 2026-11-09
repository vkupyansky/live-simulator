function singleHeader(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value.split(',')[0]?.trim() || null;
  return value?.[0]?.trim() || null;
}

export function isSameHttpOrigin(
  originHeader: string | string[] | undefined,
  hostHeader: string | string[] | undefined,
): boolean {
  const origin = singleHeader(originHeader);
  const host = singleHeader(hostHeader)?.toLowerCase();
  if (!origin || !host) return false;
  try {
    const url = new URL(origin);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') && url.host.toLowerCase() === host
    );
  } catch {
    return false;
  }
}
