// types.ts

export type StatusType =
  | 'default'
  | 'connected'
  | 'active'
  | 'error'
  | 'offline'
  | 'warning'
  | 'degraded'
  | 'maintenance'
  | string;

export type TestStatus = 'not_tested' | 'ok' | 'nok';

export interface SubStatus {
  label: string;
  value: string;
  status: 'ok' | 'nok' | 'warning' | 'info';
}

export interface BranchDisplayData {
  /** stringified PK */
  id: string
  /** human-readable */
  branchName: string
  /** drives the UI badge color */
  testStatus: TestStatus
  /** optional, if your query returned a pin */
  pinNumber?: number
  /** optional kfb_info_details.value */
  kfbInfoValue?: string
    /** UI: is this branch marked as loose contact? */
  looseContact?: boolean

  /** UI: is this branch marked as not tested? */
  notTested?: boolean
  /** Internal: pin behaves as latch/contactless in its group */
  isLatch?: boolean
}
export interface Branch {
  id: number;
  name: string;
}

/** NEW: Detailed information for a fetched KFB board */
export interface KfbInfo {
  /** Board model identifier */
  board: string;
  /** Project name or description */
  projectName: string;
  /** Unique KFB ID */
  kfbId: string;
}

export interface EspPinMapping {
  [pinNumber: string]: string;
}

export interface ConfigurationFormData {
  id?: number; // Optional for new configurations
  kfb: string;
  mac_address: string;
  branchPins: string[]; // branchPins is an array of branch names for form
  espPinMappings: EspPinMapping;
  kfbInfo: string[]; // New field for KFB Info
}

export interface Configuration {
  id: number;
  kfb: string;
  mac_address: string;
  branchPins: Branch[]; // branchPins is an array of Branch objects when fetched
  espPinMappings: EspPinMapping;
  kfbInfo: string[]; // New field for KFB Info
}

export interface NotificationType {
  message: string | null;
  type: 'success' | 'error' | 'info' | null;
}

export interface SettingsPageContentProps {
  onNavigateBack?: () => void; // Made optional as per SettingsPageContent.tsx
  onShowProgramForConfig: (configId: number) => void;
}
