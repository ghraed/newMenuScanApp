import RNFS from 'react-native-fs';
import { createMMKV } from 'react-native-mmkv';
import { getDefaultCapturePattern } from '../lib/captureGuidance';
import { createUuid } from '../utils/uuid';
import { ScanCaptureMode, ScanSession, ScanTargetType } from '../types/scanSession';

const storage = createMMKV({ id: 'scans-storage' });

const SCANS_STORAGE_KEY = 'scans:sessions:v1';
const DEFAULT_SCALE_METERS = 0.24;
const DEFAULT_SLOTS_TOTAL = getDefaultCapturePattern().totalShots;
const DEFAULT_TARGET_TYPE: ScanTargetType = 'dish';
const DEFAULT_CAPTURE_MODE: ScanCaptureMode = 'orbit';
const SCANS_ROOT_PATH = `${RNFS.DocumentDirectoryPath}/scans`;
let scansRootEnsured = false;
const ensuredScanDirectoryIds = new Set<string>();

function normalizeSession(session: ScanSession): ScanSession {
  return {
    ...session,
    targetType: session.targetType ?? DEFAULT_TARGET_TYPE,
    captureMode: session.captureMode ?? DEFAULT_CAPTURE_MODE,
  };
}

function parseSessions(raw: string | undefined): ScanSession[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ScanSession[]).map(normalizeSession) : [];
  } catch {
    return [];
  }
}

function serializeSessions(sessions: ScanSession[]) {
  storage.set(SCANS_STORAGE_KEY, JSON.stringify(sessions));
}

function readSessions(): ScanSession[] {
  return parseSessions(storage.getString(SCANS_STORAGE_KEY));
}

async function ensureDir(path: string) {
  const exists = await RNFS.exists(path);
  if (!exists) {
    await RNFS.mkdir(path);
  }
}

async function ensureScansRootDir() {
  if (scansRootEnsured) {
    return;
  }

  await ensureDir(SCANS_ROOT_PATH);
  scansRootEnsured = true;
}

async function ensureScanDirectories(scanId: string) {
  if (ensuredScanDirectoryIds.has(scanId)) {
    return;
  }

  await ensureScansRootDir();
  await ensureDir(getScanDirectoryPath(scanId));
  await ensureDir(getScanImagesDirectoryPath(scanId));
  await ensureDir(getScanBgDirectoryPath(scanId));
  ensuredScanDirectoryIds.add(scanId);
}

function sortSessionsNewestFirst(sessions: ScanSession[]) {
  return [...sessions].sort((a, b) => b.createdAt - a.createdAt);
}

export function getScansRootPath() {
  return SCANS_ROOT_PATH;
}

export function getScanDirectoryPath(scanId: string) {
  return `${SCANS_ROOT_PATH}/${scanId}`;
}

export function getScanImagesDirectoryPath(scanId: string) {
  return `${getScanDirectoryPath(scanId)}/images`;
}

export function getScanImagePath(scanId: string, slot: number) {
  return `${getScanImagesDirectoryPath(scanId)}/${slot}.jpg`;
}

export function getScanBgDirectoryPath(scanId: string) {
  return `${getScanDirectoryPath(scanId)}/bg-removed`;
}

export function getScanBgPreviewPath(scanId: string, slot: number) {
  return `${getScanBgDirectoryPath(scanId)}/slot-${slot}-preview.png`;
}

export function getScanBgFinalPath(scanId: string, slot: number) {
  return `${getScanBgDirectoryPath(scanId)}/slot-${slot}-final.png`;
}

export async function ensureScanSessionDirectories(scanId: string) {
  await ensureScanDirectories(scanId);
}

export async function createScanSession(
  scaleMeters: number = DEFAULT_SCALE_METERS,
  slotsTotal: number = DEFAULT_SLOTS_TOTAL,
  targetType: ScanTargetType = DEFAULT_TARGET_TYPE,
  captureMode: ScanCaptureMode = DEFAULT_CAPTURE_MODE,
): Promise<ScanSession> {
  const session: ScanSession = {
    id: createUuid(),
    createdAt: Date.now(),
    targetType,
    captureMode,
    scaleMeters,
    slotsTotal,
    images: [],
    status: 'draft',
  };

  await ensureScanDirectories(session.id);
  await upsertScanSession(session);

  return session;
}

export function getScanSession(id: string): ScanSession | undefined {
  return readSessions().find(session => session.id === id);
}

export function listScanSessions(): ScanSession[] {
  return sortSessionsNewestFirst(readSessions());
}

export async function upsertScanSession(session: ScanSession): Promise<ScanSession> {
  await ensureScanDirectories(session.id);

  const sessions = readSessions();
  const index = sessions.findIndex(item => item.id === session.id);

  if (index >= 0) {
    sessions[index] = session;
  } else {
    sessions.push(session);
  }

  serializeSessions(sortSessionsNewestFirst(sessions));
  return session;
}

export async function deleteScanSession(id: string): Promise<void> {
  const sessions = readSessions();
  const nextSessions = sessions.filter(session => session.id !== id);

  if (nextSessions.length !== sessions.length) {
    serializeSessions(sortSessionsNewestFirst(nextSessions));
  }

  const scanDirPath = getScanDirectoryPath(id);
  const exists = await RNFS.exists(scanDirPath);

  if (exists) {
    await RNFS.unlink(scanDirPath);
  }

  ensuredScanDirectoryIds.delete(id);
}

export async function deleteScanBackgroundOutputs(scanId: string): Promise<void> {
  const bgDirPath = getScanBgDirectoryPath(scanId);
  const exists = await RNFS.exists(bgDirPath);

  if (exists) {
    await RNFS.unlink(bgDirPath);
  }

  await ensureDir(bgDirPath);
}
