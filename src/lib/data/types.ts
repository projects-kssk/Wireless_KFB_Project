import type {
    Configuration,
    ConfigurationFormData,
    BranchDisplayData
  } from '@/types/types';
  
  export interface ConfigRepo {
    getAll(): Promise<Configuration[]>;
    getById(id: number): Promise<Configuration | null>;
    upsert(data: ConfigurationFormData): Promise<number>;
    delete(id: number): Promise<void>;
  }
  
  // for /api/branches
  export interface BranchRepo {
    getByKfb(kfb: string): Promise<BranchDisplayData[]>;
  }
  