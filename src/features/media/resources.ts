export function stopMediaStream(stream: MediaStream | null): void {
  if (!stream) return;
  try {
    for (const track of stream.getTracks())
      try {
        track.stop();
      } catch {
        // Continue releasing every remaining track even if a browser track misbehaves.
      }
  } catch {
    // A detached or partially initialized stream may reject track enumeration.
  }
}

export class ObjectUrlRegistry {
  private readonly urls = new Set<string>();

  create(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.urls.add(url);
    return url;
  }

  revokeAll(): void {
    try {
      for (const url of this.urls)
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Continue revoking the rest of the registry.
        }
    } finally {
      this.urls.clear();
    }
  }

  get size(): number {
    return this.urls.size;
  }
}
