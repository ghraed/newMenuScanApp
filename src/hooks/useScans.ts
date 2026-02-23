import { useSyncExternalStore } from 'react';
import {
  getScanById,
  getScansSnapshot,
  subscribeToScans,
} from '../storage/scanStore';

export function useScans() {
  return useSyncExternalStore(subscribeToScans, getScansSnapshot, getScansSnapshot);
}

export function useScan(scanId: string) {
  useScans();
  return getScanById(scanId);
}
