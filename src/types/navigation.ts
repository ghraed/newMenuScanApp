export type RootStackParamList = {
  Home: undefined;
  Settings: undefined;
  Setup: undefined;
  Scan: { scanId: string };
  Preview: { scanId: string };
  CreateDish: { scanId?: string } | undefined;
  MyScans: undefined;
};
