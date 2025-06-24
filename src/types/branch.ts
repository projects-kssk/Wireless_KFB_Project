// src/types/branch.ts

export interface Branch { id: number; name: string; }
export interface EspPinMapping { [pinNumber: string]: string; }
export interface Configuration { id: number; kfb: string; mac_address: string; branchPins: Branch[]; espPinMappings: EspPinMapping; }
export interface ConfigurationFormData { id?: number; kfb: string; mac_address: string; branchPins: string[]; espPinMappings: EspPinMapping; }
export interface SettingsPageContentProps { onNavigateBack?: () => void; }
export interface NotificationType { message: string | null; type: 'error' | 'success' | 'info' | null; }
