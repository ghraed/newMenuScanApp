export type ScanImageSlot = {
  slot: number;
  path: string;
  heading: number;
  timestamp: number;
};

export type ScanTargetType = 'dish' | 'juice';
export type ScanCaptureMode = 'orbit' | 'turntable';

export type ObjectSelectionMethod = 'tap' | 'box';

export type ObjectSelectionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ObjectSelectionPoint = {
  x: number;
  y: number;
};

export type ObjectSelectionViewport = {
  width: number;
  height: number;
};

export type ObjectSelection = {
  method: ObjectSelectionMethod;
  bbox: ObjectSelectionRect;
  point?: ObjectSelectionPoint;
  viewportSize?: ObjectSelectionViewport;
  selectedAt: number;
};

export type BackgroundJobStatus =
  | 'idle'
  | 'uploading'
  | 'queued'
  | 'processing'
  | 'partial'
  | 'ready'
  | 'canceled'
  | 'error';

export type BackgroundOutput = {
  slot: number;
  previewPath?: string;
  finalPath?: string;
  updatedAt: number;
};

export type ScanSessionStatus =
  | 'draft'
  | 'uploading'
  | 'processing'
  | 'canceled'
  | 'ready'
  | 'error';

export type ScanSession = {
  id: string;
  createdAt: number;
  targetType: ScanTargetType;
  captureMode: ScanCaptureMode;
  scaleMeters: number;
  slotsTotal: number;
  images: ScanImageSlot[];
  objectSelection?: ObjectSelection;
  status: ScanSessionStatus;
  progress?: number;
  message?: string;
  uploadCompleted?: number;
  uploadTotal?: number;
  remoteScanId?: string;
  jobId?: string;
  bgJobId?: string;
  bgStatus?: BackgroundJobStatus;
  bgProgress?: number;
  bgMessage?: string;
  bgAvailableSlots?: number[];
  bgPreviewReadyAt?: number;
  bgPreviewAvailable?: boolean;
  bgUploadCompleted?: number;
  bgUploadTotal?: number;
  bgOutputs?: Record<string, BackgroundOutput>;
  outputs?: {
    glbUrl?: string;
    usdzUrl?: string;
  };
};
