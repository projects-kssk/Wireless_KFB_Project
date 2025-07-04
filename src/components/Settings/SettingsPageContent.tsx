import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  PencilSquareIcon,
  TrashIcon,
  ExclamationTriangleIcon,
  PlusIcon,
  XMarkIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@heroicons/react/24/outline';
import { BranchSelectorModal } from '../../components/Modals/BranchSelectorModal';
import {
  Branch,
  EspPinMapping,

} from '@/types/types'; 
import { BranchManagementModal } from '../../components/Modals/BranchManagementModal'; 

interface Configuration extends Omit<ConfigurationFormData, 'branchPins'> {
  id: number;
  kfb: string;
  mac_address: string;
  branchPins: Branch[]; // Array of Branch objects, not just names
  espPinMappings: EspPinMapping; // { [pin: string]: branchName }
  kfbInfo: string[]; // Array of KFB info string values
}
interface ConfigurationFormData {
  id?: number;
  kfb: string;
  mac_address: string;
  branchPins: string[]; // Array of branch names selected in the form
  espPinMappings: EspPinMapping;
  kfbInfo: string[]; // Array of KFB info string values from the form
}
interface NotificationType {
  message: string | null;
  type: 'success' | 'error' | 'info' | null;
}
interface SettingsPageContentProps {
  onNavigateBack?: () => void;
  onShowProgramForConfig: (configId: number) => void;
}
const initialFormState: ConfigurationFormData = {
  kfb: '',
  mac_address: '',
  branchPins: [],
  espPinMappings: {},
  kfbInfo: [''], // Initialize with one empty string for easier UI management
};

export const SettingsPageContent: React.FC<SettingsPageContentProps> = ({
  onNavigateBack,
  onShowProgramForConfig,
}) => {
  const [currentConfig, setCurrentConfig] =
    useState<ConfigurationFormData>(initialFormState);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [configurations, setConfigurations] = useState<Configuration[]>([]);
  const [allKnownBranches, setAllKnownBranches] = useState<Branch[]>([]);
  const [formNotification, setFormNotification] = useState<NotificationType>({
    message: null,
    type: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [filterText, setFilterText] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [configToDelete, setConfigToDelete] = useState<number | null>(null);
  const [showEspBranchModal, setShowEspBranchModal] = useState(false);
  const [pinToAssign, setPinToAssign] = useState<string | null>(null);
  const [isBranchManagerModalOpen, setIsBranchManagerModalOpen] =
    useState(false);

  const [collapsedKfbInfo, setCollapsedKfbInfo] = useState<Set<number>>(new Set());

  // Toggles the collapse state for a specific configuration's KFB Info list.
  const toggleKfbInfoCollapse = useCallback((configId: number) => {
    setCollapsedKfbInfo(prev => {
      const newSet = new Set(prev);
      if (newSet.has(configId)) {
        newSet.delete(configId);
      } else {
        newSet.add(configId);
      }
      return newSet;
    });
  }, []);

  // Toggles the collapse state for all configurations' KFB Info lists.
  const toggleAllKfbInfoCollapse = useCallback(() => {
    setCollapsedKfbInfo(prev => {
      if (prev.size === configurations.length && configurations.length > 0) {
        // If all are collapsed, expand all
        return new Set();
      } else {
        // Otherwise, collapse all
        return new Set(configurations.map(config => config.id));
      }
    });
  }, [configurations]);


  // const fetchData = useCallback(async () => {
  //   if (!supabase) {
  //     setFormNotification({
  //       message: 'Supabase client not initialized. Cannot fetch data.',
  //       type: 'error',
  //     });
  //     setIsLoading(false);
  //     return;
  //   }
  //   setIsLoading(true);
  //   setFormNotification({ message: null, type: null });

  //   try {
  //     // 1) Load all branches from 'branches' table
  //     const { data: branchesData, error: branchesError } = await supabase
  //       .from('branches')
  //       .select('id, name');
  //     if (branchesError) throw branchesError;
  //     const globalBranches = branchesData || [];
  //     setAllKnownBranches(globalBranches);
  //     // Create a map for quick lookup from branch ID to name
  //     const branchIdToNameMap = new Map(globalBranches.map(b => [b.id, b.name]));

  //     // 2) Load all configurations from 'configurations' table
  //     //    The 'kfb_info' column has been removed from this table.
  //     const { data: configsData, error: configsError } = await supabase
  //       .from('configurations')
  //       .select('id, kfb, mac_address');
  //     if (configsError) throw configsError;

  //     // 3) Load all kfb_info_details, which now holds the individual KFB info strings
  //     const { data: kfbDetailsData, error: kfbDetailsError } = await supabase
  //       .from('kfb_info_details')
  //       .select('id, config_id, kfb_info_value');
  //     if (kfbDetailsError) throw kfbDetailsError;
  //     // Map kfb_info_details by config_id for easy lookup
  //     const kfbDetailsByConfigId = new Map<number, { id: number; config_id: number; kfb_info_value: string; }[]>();
  //     kfbDetailsData.forEach(detail => {
  //       if (!kfbDetailsByConfigId.has(detail.config_id)) {
  //         kfbDetailsByConfigId.set(detail.config_id, []);
  //       }
  //       kfbDetailsByConfigId.get(detail.config_id)!.push(detail);
  //     });

  //     // 4) Load all config_branches, which now link kfb_info_detail_id to branch_id
  //     const { data: allConfigBranchesData, error: allConfigBranchesError } = await supabase
  //       .from('config_branches')
  //       .select('kfb_info_detail_id, branch_id');
  //     if (allConfigBranchesError) throw allConfigBranchesError;

  //     // 5) Load all esp_pin_mappings, which now link kfb_info_detail_id to pin_number and branch_id
  //     const { data: allEspMappingsData, error: allEspMappingsError } = await supabase
  //       .from('esp_pin_mappings')
  //       .select('kfb_info_detail_id, pin_number, branch_id');
  //     if (allEspMappingsError) throw allEspMappingsError;


  //     const loadedConfigurations: Configuration[] = [];
  //     if (configsData) {
  //       for (const dbConfig of configsData) {
  //         // Get KFB info strings for the current configuration
  //         const configKfbDetails = kfbDetailsByConfigId.get(dbConfig.id) || [];
  //         const kfbInfoStrings = configKfbDetails.map(detail => detail.kfb_info_value);
  //         const kfbInfoDetailIds = configKfbDetails.map(detail => detail.id);

  //         // Determine selected branches for this configuration
  //         // A branch is considered 'selected' for a config if any of its kfb_info_details
  //         // are linked to that branch in config_branches.
  //         const distinctBranchIdsForConfig = new Set<number>();
  //         if (kfbInfoDetailIds.length > 0) {
  //           allConfigBranchesData
  //             .filter(cb => kfbInfoDetailIds.includes(cb.kfb_info_detail_id))
  //             .forEach(cb => distinctBranchIdsForConfig.add(cb.branch_id));
  //         }
  //         const selectedBranchObjects: Branch[] = Array.from(distinctBranchIdsForConfig)
  //           .map(branchId => globalBranches.find(b => b.id === branchId))
  //           .filter((b): b is Branch => b !== undefined);

  //         // Determine ESP pin mappings for this configuration
  //         // A pin mapping is included if it's linked to any of this config's kfb_info_details.
  //         // Note: If the same pin is mapped differently across different kfb_info_details
  //         // within the same config, this simplified UI representation will show the last one processed.
  //         const uiEspMappings: EspPinMapping = {};
  //         if (kfbInfoDetailIds.length > 0) {
  //           allEspMappingsData
  //             .filter(em => kfbInfoDetailIds.includes(em.kfb_info_detail_id))
  //             .forEach(mapping => {
  //               const branchName = branchIdToNameMap.get(mapping.branch_id);
  //               if (branchName) {
  //                 uiEspMappings[mapping.pin_number.toString()] = branchName;
  //               }
  //             });
  //         }

  //         loadedConfigurations.push({
  //           id: dbConfig.id,
  //           kfb: dbConfig.kfb,
  //           mac_address: dbConfig.mac_address,
  //           branchPins: selectedBranchObjects,
  //           espPinMappings: uiEspMappings,
  //           kfbInfo: kfbInfoStrings,
  //         });
  //       }
  //     }
  //     setConfigurations(loadedConfigurations);
  //   } catch (error: any) {
  //     console.error('Error fetching data:', error);
  //     setFormNotification({
  //       message: `Error fetching data: ${error.message}`,
  //       type: 'error',
  //     });
  //   } finally {
  //     setIsLoading(false);
  //   }
  // }, []);

  // 1) FETCH ALL CONFIGS
  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setFormNotification({ message: null, type: null })

    try {
      const res = await fetch('/api/configurations')
      if (!res.ok) {
        throw new Error(`Error ${res.status}: ${await res.text()}`)
      }
      const configs: Configuration[] = await res.json()
      setConfigurations(configs)

      // Rebuild global branch list
      const branchMap = new Map<number, Branch>()
      configs.forEach((cfg) =>
        cfg.branchPins.forEach((b) => branchMap.set(b.id, b))
      )
      setAllKnownBranches(Array.from(branchMap.values()))
    } catch (err: any) {
      console.error('fetchData()', err)
      setFormNotification({ message: err.message, type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }, [])

  //useEffects
  useEffect(() => {
    fetchData();
  }, [fetchData]);
    useEffect(() => {
    if (editingId !== null) {
      const configToEdit = configurations.find((c) => c.id === editingId);
      if (configToEdit) {
        setCurrentConfig({
          id: configToEdit.id,
          kfb: configToEdit.kfb,
          mac_address: configToEdit.mac_address,
          branchPins: configToEdit.branchPins.map((b) => b.name), // Convert Branch objects to names for form
          espPinMappings: { ...configToEdit.espPinMappings },
          kfbInfo: configToEdit.kfbInfo.length > 0 ? [...configToEdit.kfbInfo] : [''], // Ensure at least one empty string if empty
        });
        setIsEditing(true);
        setFormNotification({ message: null, type: null });
      }
    } else {
      setCurrentConfig(initialFormState);
      setIsEditing(false);
    }
  }, [editingId, configurations]);

  //HANDLERS
  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setCurrentConfig((prev) => ({ ...prev, [name]: value }));
    setFormNotification({ message: null, type: null });
  };
  const handleKfbInfoChange = (index: number, value: string) => {
    setCurrentConfig((prev) => {
      const newKfbInfo = [...prev.kfbInfo];
      newKfbInfo[index] = value;
      return { ...prev, kfbInfo: newKfbInfo };
    });
    setFormNotification({ message: null, type: null });
  };
  const handleAddKfbInfo = () => {
    setCurrentConfig((prev) => ({
      ...prev,
      kfbInfo: [...prev.kfbInfo, ''],
    }));
  };
  const handleRemoveKfbInfo = (index: number) => {
    setCurrentConfig((prev) => {
      const newKfbInfo = prev.kfbInfo.filter((_, i) => i !== index);
      return { ...prev, kfbInfo: newKfbInfo.length > 0 ? newKfbInfo : [''] };
    });
  };
  const validateMacAddress = (mac: string): boolean =>
    /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(mac);
  // const handleSaveConfiguration = async () => {
  //   if (!supabase) {
  //     setFormNotification({
  //       message: 'Supabase client not initialized. Cannot save data.',
  //       type: 'error',
  //     });
  //     return;
  //   }
  //   setFormNotification({ message: null, type: null });

  //   const { kfb, mac_address, branchPins: branchNamesInForm, espPinMappings, kfbInfo } =
  //     currentConfig;

  //   // Basic form validation
  //   if (!kfb || !mac_address) {
  //     setFormNotification({
  //       message: 'KFB Number and MAC Address fields are required.',
  //       type: 'error',
  //     });
  //     return;
  //   }
  //   if (!validateMacAddress(mac_address)) {
  //     setFormNotification({
  //       message: 'Invalid MAC Address format. Example: 00:1A:2B:3C:4D:5E',
  //       type: 'error',
  //     });
  //     return;
  //   }

  //   // Prepare KFB Info for saving: trim whitespace and remove empty strings
  //   const trimmedKfbInfo = kfbInfo.map(info => info.trim()).filter(info => info !== '');
  //   // If all KFB info fields are empty, ensure it's saved as an empty array in the DB
  //   const kfbInfoToSave = trimmedKfbInfo.length === 0 && kfbInfo.length === 1 && kfbInfo[0].trim() === '' ? [] : trimmedKfbInfo;


  //   // Check for duplicate MAC address (case-insensitive)
  //   const normalizedNewMac = mac_address.trim().toLowerCase();
  //   const duplicate = configurations.find(
  //     (conf) =>
  //       conf.mac_address.trim().toLowerCase() === normalizedNewMac &&
  //       conf.id !== (isEditing && editingId !== null ? editingId : -1)
  //   );
  //   if (duplicate) {
  //     setFormNotification({
  //       message: `MAC Address "${mac_address}" is already in use by "${duplicate.kfb}".`,
  //       type: 'error',
  //     });
  //     return;
  //   }

  //   // Validate that ESP pin assigned branches are actually selected for the configuration
  //   for (const pin in espPinMappings) {
  //     if (!branchNamesInForm.includes(espPinMappings[pin])) {
  //       setFormNotification({
  //         message: `Error: Branch "${espPinMappings[pin]}" assigned to Pin ${pin} is not selected for this configuration. Please add it via 'Manage Branches' or unassign from the pin.`,
  //         type: 'error',
  //       });
  //       return;
  //     }
  //   }

  //   setIsLoading(true);
  //   try {
  //     let configIdToUse: number;

  //     // 1. Save or Update the main `configurations` entry
  //     if (isEditing && editingId !== null) {
  //       const { data, error } = await supabase
  //         .from('configurations')
  //         .update({ kfb, mac_address }) // 'kfb_info' column removed from configurations
  //         .eq('id', editingId)
  //         .select('id')
  //         .single();
  //       if (error) throw error;
  //       if (!data) throw new Error('Failed to update configuration.');
  //       configIdToUse = data.id;
  //     } else {
  //       const { data, error } = await supabase
  //         .from('configurations')
  //         .insert({ kfb, mac_address }) // 'kfb_info' column removed from configurations
  //         .select('id')
  //         .single();
  //       if (error) throw error;
  //       if (!data) throw new Error('Failed to insert configuration.');
  //       configIdToUse = data.id;
  //     }

  //     // 2. Manage `kfb_info_details` (new table for KFB info entries)
  //     // Fetch existing kfb_info_details for the current configuration
  //     const { data: existingKfbInfoDetails, error: fetchExistingKfbError } = await supabase
  //       .from('kfb_info_details')
  //       .select('id')
  //       .eq('config_id', configIdToUse);
  //     if (fetchExistingKfbError) throw fetchExistingKfbError;

  //     const existingKfbInfoDetailIds = existingKfbInfoDetails.map(d => d.id);

  //     // Delete all existing kfb_info_details linked to this config
  //     if (existingKfbInfoDetailIds.length > 0) {
  //       const { error: deleteKfbInfoDetailsError } = await supabase
  //         .from('kfb_info_details')
  //         .delete()
  //         .in('id', existingKfbInfoDetailIds);
  //       if (deleteKfbInfoDetailsError) throw deleteKfbInfoDetailsError;
  //     }

  //     // Insert new kfb_info_details based on form input
  //     const kfbInfoDetailInserts = kfbInfoToSave.map(value => ({
  //       config_id: configIdToUse,
  //       kfb_info_value: value,
  //     }));

  //     let newKfbInfoDetailIds: number[] = [];
  //     if (kfbInfoDetailInserts.length > 0) {
  //       const { data: insertedKfbDetails, error: insertKfbDetailsError } = await supabase
  //         .from('kfb_info_details')
  //         .insert(kfbInfoDetailInserts)
  //         .select('id'); // Select 'id' to get the IDs of the newly inserted rows
  //       if (insertKfbDetailsError) throw insertKfbDetailsError;
  //       newKfbInfoDetailIds = insertedKfbDetails.map(d => d.id);
  //     }

  //     // 3. Manage `config_branches`
  //     // Delete existing config_branches entries that were linked to the previous kfb_info_details
  //     // (which have now been deleted, but their association records might remain if not cascaded properly)
  //     // or to kfb_info_details for this config which are no longer valid.
  //     // This ensures a clean slate before re-inserting.
  //     if (existingKfbInfoDetailIds.length > 0) {
  //       const { error: deleteOldConfigBranchesError } = await supabase
  //         .from('config_branches')
  //         .delete()
  //         .in('kfb_info_detail_id', existingKfbInfoDetailIds);
  //       if (deleteOldConfigBranchesError) throw deleteOldConfigBranchesError;
  //     }

  //     // Ensure all selected branch names exist in the 'branches' table, creating new ones if necessary
  //     const branchObjectsForConfig: Branch[] = [];
  //     for (const branchName of branchNamesInForm) {
  //       let branch = allKnownBranches.find((b) => b.name === branchName);
  //       if (!branch) {
  //         const { data: newBranchData, error: newBranchError } = await supabase
  //           .from('branches')
  //           .insert({ name: branchName })
  //           .select()
  //           .single();
  //         if (newBranchError) throw newBranchError;
  //         if (!newBranchData) throw new Error(`Failed to create branch ${branchName}.`);
  //         branch = newBranchData;
  //         // Update local state with the new branch
  //         setAllKnownBranches((prev) =>
  //           [...prev, branch!].sort((a, b) => a.name.localeCompare(b.name))
  //         );
  //       }
  //       if (branch) branchObjectsForConfig.push(branch);
  //     }

  //     // Insert new config_branches entries:
  //     // Link *all* newly created kfb_info_detail_ids to *all* branches selected for the config.
  //     // This reflects the current UI's conceptual model where branches apply to the whole config.
  //       // 3. Manage `config_branches` (including the required config_id)
  //       const configBranchInserts: {
  //         config_id: number;
  //         kfb_info_detail_id: number;
  //         branch_id: number;
  //       }[] = [];

  //       // for each new detail × each selected branch, include the parent config_id
  //       for (const kfbid of newKfbInfoDetailIds) {
  //         for (const branch of branchObjectsForConfig) {
  //           configBranchInserts.push({
  //             config_id: configIdToUse,        // ← **here’s the missing piece**
  //             kfb_info_detail_id: kfbid,
  //             branch_id: branch.id,
  //           });
  //         }
  //       }

  //       if (configBranchInserts.length > 0) {
  //         const { error: insertConfigBranchesError } = await supabase
  //           .from('config_branches')
  //           .insert(configBranchInserts);
  //         if (insertConfigBranchesError) throw insertConfigBranchesError;
  //       }

  //     // 4. Manage `esp_pin_mappings`
  //     // Delete existing esp_pin_mappings entries that were linked to the previous kfb_info_details
  //     if (existingKfbInfoDetailIds.length > 0) {
  //       const { error: deleteOldEspMappingsError } = await supabase
  //         .from('esp_pin_mappings')
  //         .delete()
  //         .in('kfb_info_detail_id', existingKfbInfoDetailIds);
  //       if (deleteOldEspMappingsError) throw deleteOldEspMappingsError;
  //     }

  //     // Prepare new esp_pin_mappings inserts:
  //     // Link *all* newly created kfb_info_detail_ids to *all* specified ESP pin mappings.
  //     // This also reflects the current UI's conceptual model.
  //     const espPinMappingInserts: {
  //       kfb_info_detail_id: number;
  //       pin_number: number;
  //       branch_id: number;
  //     }[] = [];

  //     for (const kfbid of newKfbInfoDetailIds) {
  //       for (const pinStr in espPinMappings) {
  //         const branchName = espPinMappings[pinStr];
  //         const branch = allKnownBranches.find((b) => b.name === branchName);
  //         if (branch) {
  //           espPinMappingInserts.push({
  //             kfb_info_detail_id: kfbid,
  //             pin_number: parseInt(pinStr, 10),
  //             branch_id: branch.id,
  //           });
  //         }
  //       }
  //     }

  //     if (espPinMappingInserts.length > 0) {
  //       const { error: insertEspMappingsError } = await supabase
  //         .from('esp_pin_mappings')
  //         .insert(espPinMappingInserts);
  //       if (insertEspMappingsError) throw insertEspMappingsError;
  //     }

  //     setFormNotification({
  //       message: `Configuration ${isEditing ? 'updated' : 'saved'} successfully!`,
  //       type: 'success',
  //     });
  //     // Reset form state after successful save/update
  //     setCurrentConfig(initialFormState);
  //     setIsEditing(false);
  //     setEditingId(null);
  //     // Re-fetch all data to refresh the table with the latest changes
  //     await fetchData();
  //   } catch (error: any) {
  //     console.error('Error saving configuration:', error);
  //     setFormNotification({
  //       message: `Error saving configuration: ${error.message}`,
  //       type: 'error',
  //     });
  //   } finally {
  //     setIsLoading(false);
  //   }
  // };
  const handleSaveConfiguration = async () => {
    const payload = {
      kfb: currentConfig.kfb,
      mac_address: currentConfig.mac_address,
      kfbInfo: currentConfig.kfbInfo.filter((s) => s.trim() !== ''),
      branchPins: currentConfig.branchPins,
      espPinMappings: currentConfig.espPinMappings,
    }
  
    setFormNotification({ message: null, type: null })
    setIsLoading(true)
  
    try {
      const url = isEditing
        ? `/api/configurations/${currentConfig.id}`
        : '/api/configurations'
      const method = isEditing ? 'PUT' : 'POST'
  
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        throw new Error(`Error ${res.status}: ${await res.text()}`)
      }
  
      setFormNotification({
        message: `Configuration ${isEditing ? 'updated' : 'saved'}!`,
        type: 'success',
      })
      setCurrentConfig(initialFormState)
      setIsEditing(false)
      setEditingId(null)
      await fetchData()
    } catch (err: any) {
      console.error('handleSaveConfiguration()', err)
      setFormNotification({ message: err.message, type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }
  const handleModify = (config: Configuration) => {
    setEditingId(config.id);
    setFormNotification({ message: null, type: null });
    window.scrollTo({ top: 0, behavior: 'smooth' }); // Scroll to top for editing form
  };
  const requestDelete = (id: number) => {
    setConfigToDelete(id);
    setShowDeleteModal(true);
  };

  // const confirmDelete = async () => {
  //   if (!supabase || configToDelete === null) return;
  //   setIsLoading(true);
  //   try {
  //     // Deleting the configuration will automatically cascade delete
  //     // related kfb_info_details, config_branches, and esp_pin_mappings
  //     // due to ON DELETE CASCADE constraints defined in the schema.
  //     const { error } = await supabase
  //       .from('configurations')
  //       .delete()
  //       .eq('id', configToDelete);
  //     if (error) throw error;

  //     setFormNotification({
  //       message: 'Configuration deleted successfully.',
  //       type: 'success',
  //     });
  //     await fetchData(); // Re-fetch all data to refresh the UI
  //   } catch (error: any) {
  //     console.error('Error deleting configuration:', error);
  //     setFormNotification({
  //       message: `Error deleting configuration: ${error.message}`,
  //       type: 'error',
  //     });
  //   } finally {
  //     setShowDeleteModal(false);
  //     setConfigToDelete(null);
  //     setIsLoading(false);
  //   }
  // };
  const confirmDelete = async () => {
    if (configToDelete == null) return
    setFormNotification({ message: null, type: null })
    setIsLoading(true)
    try {
      const res = await fetch(`/api/configurations/${configToDelete}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        throw new Error(`Error ${res.status}: ${await res.text()}`)
      }
  
      setFormNotification({ message: 'Configuration deleted.', type: 'success' })
      setShowDeleteModal(false)
      setConfigToDelete(null)
      await fetchData()
    } catch (err: any) {
      console.error('confirmDelete()', err)
      setFormNotification({ message: err.message, type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }
  const cancelDelete = () => {
    setShowDeleteModal(false);
    setConfigToDelete(null);
  };
  const handleOpenEspBranchModal = (pinNumber: string) => {
    setPinToAssign(pinNumber);
    setShowEspBranchModal(true);
  };
  const handleAssignBranchToEspPin = (pin: string, branch: string) => {
    setCurrentConfig((prev) => ({
      ...prev,
      espPinMappings: { ...(prev.espPinMappings || {}), [pin]: branch },
    }));
  };
  const handleUnassignBranchFromEspPin = (pin: string) => {
    setCurrentConfig((prev) => {
      const newMappings = { ...(prev.espPinMappings || {}) };
      delete newMappings[pin];
      return { ...prev, espPinMappings: newMappings };
    });
  };
  const handleToggleBranchForConfig = (branchName: string) => {
    setCurrentConfig((prev) => {
      const isCurrentlySelected = prev.branchPins.includes(branchName);
      const newBranchPins = isCurrentlySelected
        ? prev.branchPins.filter((b) => b !== branchName)
        : [...prev.branchPins, branchName];

      const newEspPinMappings = { ...prev.espPinMappings };
      if (isCurrentlySelected) {
        // If branch is being deselected, remove it from any ESP pin assignments
        Object.keys(newEspPinMappings).forEach((pinKey) => {
          if (newEspPinMappings[pinKey] === branchName) {
            delete newEspPinMappings[pinKey];
          }
        });
      }

      return {
        ...prev,
        branchPins: newBranchPins,
        espPinMappings: newEspPinMappings,
      };
    });
    setFormNotification({ message: null, type: null });
  };
  // const handleAddNewGlobalBranch = async (
  //   branchName: string
  // ): Promise<Branch | null> => {
  //   if (!supabase) {
  //     setFormNotification({ message: 'Supabase client not initialized.', type: 'error' });
  //     return null;
  //   }
  //   const trimmedBranchName = branchName.trim();
  //   if (!trimmedBranchName) return null;

  //   // Check if branch already exists
  //   const existingBranch = allKnownBranches.find(
  //     (b) => b.name.toLowerCase() === trimmedBranchName.toLowerCase()
  //   );
  //   if (existingBranch) return existingBranch;

  //   try {
  //     const { data, error } = await supabase
  //       .from('branches')
  //       .insert({ name: trimmedBranchName })
  //       .select()
  //       .single();
  //     if (error) throw error;
  //     if (data) {
  //       // Update local state with the newly created branch
  //       setAllKnownBranches((prev) =>
  //         [...prev, data].sort((a, b) => a.name.localeCompare(b.name))
  //       );
  //       return data;
  //     }
  //     return null;
  //   } catch (error: any) {
  //     console.error('Error adding new global branch:', error);
  //     return null;
  //   }
  // };
  // Inside your component:
  const handleAddNewGlobalBranch = async (
    branchName: string
  ): Promise<Branch | null> => {
    const trimmedBranchName = branchName.trim();
    if (!trimmedBranchName) return null;

    // First check local state to avoid unnecessary requests:
    const existingBranch = allKnownBranches.find(
      (b) => b.name.toLowerCase() === trimmedBranchName.toLowerCase()
    );
    if (existingBranch) return existingBranch;

    try {
      // POST to your API route to create a new branch
      const res = await fetch('/api/branches', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: trimmedBranchName }),
      });

      if (res.status === 409) {
        // e.g., branch already exists on server side
        // we could fetch it or assume local state missing it; let's fetch all branches
        console.warn(`Branch "${trimmedBranchName}" already exists on server.`);
        // Optionally re-fetch full branch list from API:
        const listRes = await fetch('/api/branches');
        if (listRes.ok) {
          const branchList: Branch[] = await listRes.json();
          setAllKnownBranches(branchList);
          // find it now
          const found = branchList.find(
            (b) => b.name.toLowerCase() === trimmedBranchName.toLowerCase()
          );
          return found || null;
        }
        return null;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to add branch: ${res.status} ${text}`);
      }

      // Expect returned JSON: { id: number; name: string }
      const data: Branch = await res.json();
      // Update local state
      setAllKnownBranches((prev) =>
        [...prev, data].sort((a, b) => a.name.localeCompare(b.name))
      );
      return data;
    } catch (error: any) {
      console.error('Error adding new global branch via API:', error);
      setFormNotification({
        message: `Error adding branch: ${error.message}`,
        type: 'error',
      });
      return null;
    }
  };

  const filteredConfigurations = useMemo(() => {
    if (!filterText.trim()) return configurations;
    const lowerFilterText = filterText.toLowerCase();
    return configurations.filter(
      (config) =>
        config.kfb.toLowerCase().includes(lowerFilterText) ||
        config.mac_address.toLowerCase().includes(lowerFilterText) ||
        config.kfbInfo.some(info => info.toLowerCase().includes(lowerFilterText)) ||
        config.branchPins
          .map((b) => b.name)
          .join(', ')
          .toLowerCase()
          .includes(lowerFilterText) ||
        Object.entries(config.espPinMappings).some(
          ([pin, branch]) =>
            `pin ${pin}: ${branch}`.toLowerCase().includes(lowerFilterText) ||
            branch.toLowerCase().includes(lowerFilterText)
        )
    );
  }, [configurations, filterText]);

  // Tailwind CSS classes for consistent styling
  const inputBaseStyle =
    'block w-full px-8 py-6 bg-white dark:bg-slate-700 border-2 border-slate-400 dark:border-slate-500 rounded-2xl text-4xl placeholder-slate-400 dark:placeholder-slate-500 text-slate-900 dark:text-white focus:outline-none focus:border-sky-500 focus:ring-3 focus:ring-sky-500';
  const labelStyle =
    'block text-5xl font-semibold text-slate-800 dark:text-slate-200 mb-4';
  const thStyle =
    'px-10 py-0 text-left text-4xl font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider border-b-4 border-slate-300 dark:border-slate-600';
  const tdStyle =
    'px-10 py-0 whitespace-nowrap text-4xl text-slate-700 dark:text-slate-200 border-b-2 border-slate-300 dark:border-slate-600';
  const actionButtonBase =
    'p-4 rounded-xl transition-colors duration-150 focus:outline-none focus:ring-4 focus:ring-offset-2 dark:focus:ring-offset-slate-900';

  // Loading state display
  if (isLoading && configurations.length === 0 && !formNotification.message) {
    return (
      <div className="flex-grow w-full min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-10">
        <p className="text-slate-700 dark:text-slate-300 text-6xl animate-pulse">
          Loading configurations...
        </p>
      </div>
    );
  }

  return (
    <div className="flex-grow w-full min-h-screen bg-slate-50 dark:bg-slate-950 p-6 sm:p-10 lg:p-6 flex flex-col">
      {onNavigateBack && (
        <div className="flex mb-6">
          <button
            onClick={onNavigateBack}
            className="px-8 py-4 text-2xl font-medium text-sky-700 dark:text-sky-300 bg-sky-100 hover:bg-sky-200 dark:bg-sky-700/40 dark:hover:bg-sky-600/60 rounded-xl shadow-lg flex items-center"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2.5"
              stroke="currentColor"
              className="w-6 h-6 mr-3"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 19.5L8.25 12l7.5-7.5"
              />
            </svg>
            Back to Dashboard
          </button>
        </div>
      )}

      {/* Configuration Form Section */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 mb-6">
        <h2 className="text-5xl font-bold text-slate-800 dark:text-slate-100 mb-6">
          {isEditing ? 'Edit KFB' : 'New KFB'}
        </h2>

        {/* Notification Area */}
        {formNotification.message && (
          <div
            className={`p-6 mb-6 rounded-xl text-2xl ${
              formNotification.type === 'error'
                ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-200'
                : formNotification.type === 'success'
                ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-200'
                : 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-200'
            }`}
          >
            {formNotification.message}
          </div>
        )}

        {/* KFB Number and MAC Address Inputs */}
        <div className="flex flex-col md:flex-row md:items-end md:space-x-6 space-y-6 md:space-y-0 mb-6">
          <div className="flex-1">
            <label
              htmlFor="kfb"
              className={labelStyle.replace('text-5xl', 'text-4xl')}
            >
              KFB NUMBER
            </label>
            <input
              type="text"
              name="kfb"
              id="kfb"
              value={currentConfig.kfb || ''}
              onChange={handleInputChange}
              className={inputBaseStyle.replace('text-6xl', 'text-5xl')}
              placeholder="IW12345678"
            />
          </div>

          <div className="flex-1">
            <label
              htmlFor="mac_address"
              className={labelStyle.replace('text-5xl', 'text-4xl')}
            >
                          </label>
            <input
              type="text"
              name="mac_address"
              id="mac_address"
              value={currentConfig.mac_address || ''}
              onChange={handleInputChange}
              className={inputBaseStyle.replace('text-6xl', 'text-5xl')}
              placeholder="XX:XX:XX:XX:XX:XX"
            />
          </div>
        </div>

        {/* KFB INFO Section */}
        <div className="mb-8">
            <label className={labelStyle.replace('text-5xl', 'text-4xl')}>
                KFB INFO
            </label>
            <div className="space-y-4">
                {currentConfig.kfbInfo.map((info, index) => (
                    <div key={index} className="flex items-center space-x-4">
                        <input
                            type="text"
                            value={info}
                            onChange={(e) => handleKfbInfoChange(index, e.target.value)}
                            className={`${inputBaseStyle.replace('text-6xl', 'text-5xl')} flex-1`}
                            placeholder="E.g., 83AUDAU40X02-70"
                        />
                        {currentConfig.kfbInfo.length > 1 && (
                            <button
                                type="button"
                                onClick={() => handleRemoveKfbInfo(index)}
                                className="p-4 rounded-xl text-red-500 hover:bg-red-100 dark:hover:bg-red-900/20 transition-colors"
                                title="Remove KFB Info"
                            >
                                <XMarkIcon className="w-10 h-10" />
                            </button>
                        )}
                    </div>
                ))}
            </div>
            <button
                type="button"
                onClick={handleAddKfbInfo}
                className="mt-4 px-6 py-3 bg-sky-500 text-white text-3xl font-medium rounded-xl hover:bg-sky-600 transition-colors duration-150 flex items-center shadow-lg"
            >
                <PlusIcon className="w-8 h-8 mr-2" />
                Add KFB Info
            </button>
        </div>
        <div className="flex justify-end space-x-5">
            {(
              isEditing ||
              Object.values(currentConfig).some((val) =>
                Array.isArray(val)
                  ? val.length > 0 && !(val.length === 1 && val[0] === '')
                  : typeof val === 'object' && val !== null
                  ? Object.keys(val).length > 0
                  : typeof val === 'string' && val !== ''
              )
            ) && (
              <button
                type="button"
                onClick={() => {
                  setCurrentConfig(initialFormState);
                  setIsEditing(false);
                  setEditingId(null);
                  setFormNotification({ message: null, type: null });
                }}
                className="px-8 py-4 text-5xl font-medium text-slate-700 dark:text-slate-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-600 dark:hover:bg-slate-500 rounded-xl shadow-lg"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={handleSaveConfiguration}
              disabled={isLoading}
              className="px-16 py-6 text-5xl font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-lg focus:outline-none focus:ring-4 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 disabled:opacity-60"
            >
              {isLoading && isEditing
                ? 'Updating...'
                : isLoading
                ? 'Saving...'
                : isEditing
                ? 'Update'
                : 'Save'}
            </button>
        </div>
      </div>

      {/* Configurations Overview Table */}
      <div className="bg-white dark:bg-slate-800 shadow-2xl rounded-3xl flex flex-col flex-1 overflow-hidden">
        <div className="flex justify-between items-center px-8 py-6 border-b border-slate-200 dark:border-slate-600">
          <h2 className="text-5xl font-bold text-slate-800 dark:text-slate-100">
            Overview
          </h2>
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter configurations..."
            className={inputBaseStyle.replace('text-6xl', 'text-5xl') + ' max-w-lg'}
          />
        </div>

        {/* Table container: overflow-x for wide columns, overflow-y for tall table */}
        <div className="flex-1 overflow-y-auto overflow-x-auto">
          <table className="min-w-full divide-y-2 divide-slate-300 dark:divide-slate-600">
            <thead className="bg-slate-100 dark:bg-slate-700/50">
              <tr>
                <th className={thStyle.replace('text-6xl', 'text-5xl')}>KFB NUMBER</th>
                <th className={thStyle.replace('text-6xl', 'text-5xl')}>KFB INFO</th>
                <th className={thStyle.replace('text-6xl', 'text-5xl')}>
                  MAC Address
                </th>
                <th className={thStyle.replace('text-6xl', 'text-5xl')}>Actions</th>
                <th className={thStyle.replace('text-6xl', 'text-5xl')}>PROGRAM</th>
                <th className={thStyle.replace('text-6xl', 'text-5xl')}>SHOW KFB INFO</th>
              </tr>
            </thead>

            <tbody className="bg-white dark:bg-slate-800 divide-y-2 divide-slate-300 dark:divide-slate-600">
              {filteredConfigurations.length > 0 ? (
                filteredConfigurations.map((config) => (
                  <tr key={config.id}>
                    {/* KFB column */}
                    <td className={tdStyle.replace('text-6xl', 'text-5xl')}>
                      {config.kfb}
                    </td>

                    {/* KFB Info column with collapse/expand functionality */}
                    <td className={`${tdStyle.replace('text-6xl', 'text-5xl')} max-w-xs`}>
                      {config.kfbInfo.length > 0 ? (
                        <>
                          {collapsedKfbInfo.has(config.id) ? (
                            <div className="break-all whitespace-normal">
                              {config.kfbInfo[0]}
                              {config.kfbInfo.length > 1 && (
                                <span className="text-slate-500 dark:text-slate-400 text-2xl">
                                  {' '}
                                  (+{config.kfbInfo.length - 1})
                                </span>
                              )}
                            </div>
                          ) : (
                            config.kfbInfo.map((info, idx) => (
                              <div key={idx} className="break-all whitespace-normal">
                                {info}
                              </div>
                            ))
                          )}
                        </>
                      ) : (
                        '-'
                      )}
                    </td>

                    {/* MAC Address column */}
                    <td className={tdStyle.replace('text-6xl', 'text-5xl')}>
                      {config.mac_address}
                    </td>

                    {/* Actions column */}
                    <td
                      className={`${tdStyle.replace(
                        'text-6xl',
                        'text-5xl'
                      )} space-x-4`}
                    >
                      <button
                        onClick={() => handleModify(config)}
                        className={`${actionButtonBase} text-sky-600 hover:text-sky-800 dark:text-sky-400 dark:hover:text-sky-200`}
                        title="Modify"
                      >
                        <PencilSquareIcon className="w-12 h-12" />
                      </button>
                      <button
                        onClick={() => requestDelete(config.id)}
                        className={`${actionButtonBase} text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-200`}
                        title="Delete"
                      >
                        <TrashIcon className="w-12 h-12" />
                      </button>
                    </td>

                    {/* Program column */}
                    <td className={tdStyle.replace('text-6xl', 'text-5xl')}>
                      <button
                        onClick={() => onShowProgramForConfig(config.id)}
                        className="
                          px-6 py-4
                          bg-sky-600 text-white
                          text-2xl font-semibold
                          rounded-lg hover:bg-sky-700
                          transition-colors duration-150
                        "
                        title="Go to Program"
                      >
                        Program
                      </button>
                    </td>
                    {/* Toggle KFB Info Column */}
                    <td className={tdStyle.replace('text-6xl', 'text-5xl')}>
                      {config.kfbInfo.length > 1 && ( 
                        <button
                          onClick={() => toggleKfbInfoCollapse(config.id)}
                          className={`${actionButtonBase} text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100`}
                          title={collapsedKfbInfo.has(config.id) ? 'Expand KFB Info' : 'Collapse KFB Info'}
                        >
                          {collapsedKfbInfo.has(config.id) ? (
                            <ChevronDownIcon className="w-12 h-12" />
                          ) : (
                            <ChevronUpIcon className="w-12 h-12" />
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={6} 
                    className={`${tdStyle.replace(
                      'text-6xl',
                      'text-5xl'
                    )} text-center text-slate-500 dark:text-slate-400 py-16`}
                  >
                    No configurations found
                    {filterText ? ' matching your filter' : ''}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black bg-opacity-70 backdrop-blur-xl p-6">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-8 sm:p-12 w-full max-w-lg lg:max-w-xl">
            <div className="flex items-start">
              <div className="mx-auto flex-shrink-0 flex items-center justify-center h-16 w-16 rounded-full bg-red-100 dark:bg-red-900/50 sm:mx-0">
                <ExclamationTriangleIcon
                  className="h-8 w-8 text-red-600 dark:text-red-400"
                  aria-hidden="true"
                />
              </div>
              <div className="ml-4 text-left">
                <h3
                  className="text-4xl font-semibold leading-tight text-slate-900 dark:text-slate-100"
                  id="modal-title"
                >
                  Delete Configuration
                </h3>
                <div className="mt-2">
                  <p className="text-2xl text-slate-500 dark:text-slate-300">
                    Are you sure you want to delete this configuration? This
                    action cannot be undone.
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end space-x-5">
              <button
                type="button"
                onClick={cancelDelete}
                className="px-8 py-4 text-2xl font-medium text-slate-700 dark:text-slate-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-600 dark:hover:bg-slate-500 rounded-xl shadow-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={isLoading}
                className="px-8 py-4 text-2xl font-medium text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-lg disabled:opacity-60"
              >
                {isLoading ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Branch Selector Modal (for ESP pins) */}
      <BranchSelectorModal
        isOpen={showEspBranchModal}
        onClose={() => setShowEspBranchModal(false)}
        pinNumber={pinToAssign}
        currentPinAssignment={
          pinToAssign ? currentConfig.espPinMappings?.[pinToAssign] : undefined
        }
        availableBranches={currentConfig.branchPins}
        onAssignBranch={handleAssignBranchToEspPin}
        onUnassignBranch={handleUnassignBranchFromEspPin}
        espPinMappings={currentConfig.espPinMappings || {}}
      />

      {/* Branch Management Modal */}
      <BranchManagementModal
        isOpen={isBranchManagerModalOpen}
        onClose={() => setIsBranchManagerModalOpen(false)}
        allGlobalBranches={allKnownBranches}
        configSelectedBranches={currentConfig.branchPins}
        onToggleBranchForConfig={handleToggleBranchForConfig}
        onAddNewGlobalBranch={handleAddNewGlobalBranch}
      />
    </div>
  );
};

export default SettingsPageContent;
