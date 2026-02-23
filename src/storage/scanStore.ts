import { ScanCapture, ScanSession, ScanStatus } from '../types/scan';

type Listener = () => void;

let scans: ScanSession[] = [];
const listeners = new Set<Listener>();

const colors = ['#5CB4FF', '#A78BFA', '#34D399', '#F59E0B', '#FB7185', '#22D3EE'];

function emit() {
  listeners.forEach(listener => listener());
}

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function updateScan(scanId: string, updater: (scan: ScanSession) => ScanSession): ScanSession | null {
  let updated: ScanSession | null = null;
  scans = scans.map(scan => {
    if (scan.id !== scanId) {
      return scan;
    }
    updated = updater(scan);
    return updated;
  });
  if (updated) {
    emit();
  }
  return updated;
}

export function subscribeToScans(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getScansSnapshot() {
  return scans;
}

export function createScanSession(dishSizeMeters: number): ScanSession {
  const timestamp = nowIso();
  const newScan: ScanSession = {
    id: uid('scan'),
    dishSizeMeters,
    captures: [],
    status: 'draft',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  scans = [newScan, ...scans];
  emit();
  return newScan;
}

export function getScanById(scanId: string) {
  return scans.find(scan => scan.id === scanId) ?? null;
}

export function addPlaceholderCapture(scanId: string): ScanCapture | null {
  const capture: ScanCapture = {
    id: uid('cap'),
    createdAt: nowIso(),
    thumbnailColor: colors[Math.floor(Math.random() * colors.length)],
  };

  const updated = updateScan(scanId, scan => ({
    ...scan,
    captures: [capture, ...scan.captures],
    updatedAt: nowIso(),
  }));

  return updated ? capture : null;
}

export function setScanStatus(scanId: string, status: ScanStatus) {
  return updateScan(scanId, scan => ({
    ...scan,
    status,
    updatedAt: nowIso(),
  }));
}

export function deleteScan(scanId: string) {
  const next = scans.filter(scan => scan.id !== scanId);
  if (next.length !== scans.length) {
    scans = next;
    emit();
  }
}
