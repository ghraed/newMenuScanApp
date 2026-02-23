export type ScanImageSlot = {
  slot: number;
  path: string;
  heading: number;
  timestamp: number;
};

export type ScanSessionStatus =
  | 'draft'
  | 'uploading'
  | 'processing'
  | 'ready'
  | 'error';

export type ScanSession = {
  id: string;
  createdAt: number;
  targetType: 'dish';
  scaleMeters: number;
  slotsTotal: number;
  images: ScanImageSlot[];
  status: ScanSessionStatus;
  progress?: number;
  message?: string;
  uploadCompleted?: number;
  uploadTotal?: number;
  remoteScanId?: string;
  jobId?: string;
  outputs?: {
    glbUrl?: string;
    usdzUrl?: string;
  };
};
