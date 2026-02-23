import { ScanSession } from '../types/scan';

export async function create3DModel(scan: ScanSession) {
  try {
    await fetch('https://example.com/api/models', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        scanId: scan.id,
        dishSizeMeters: scan.dishSizeMeters,
        captureCount: scan.captures.length,
      }),
    });
    return { ok: true as const, mocked: false as const };
  } catch {
    await new Promise<void>(resolve => setTimeout(() => resolve(), 700));
    return { ok: true as const, mocked: true as const };
  }
}
