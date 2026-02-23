export type ScanStatus = 'draft' | 'processing' | 'model_created';

export type ScanCapture = {
  id: string;
  thumbnailColor: string;
  createdAt: string;
};

export type ScanSession = {
  id: string;
  dishSizeMeters: number;
  captures: ScanCapture[];
  status: ScanStatus;
  createdAt: string;
  updatedAt: string;
};
