import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
// Supabase client is imported from a CDN to resolve the module error.
import { createClient } from "@supabase/supabase-js";
import {
  XMarkIcon,
  CheckCircleIcon,
  PencilSquareIcon,
  PlusIcon,
} from "@heroicons/react/24/solid";

// Supabase Client Initialization (as provided by the user)
// In a real app, you'd use environment variables.
// For this example, replace with your actual Supabase URL and Anon Key.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'YOUR_SUPABASE_URL';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// -----------------------------
// Type definitions
// -----------------------------
interface Configuration {
  id: number;
  kfb: string;
  mac_address: string;
  kfbInfo: string[]; // This will store the string values from kfb_info_details
}

interface Branch {
  id: number;
  name: string;
  created_at?: string;
}

// Updated interfaces to reflect the new database schema (using kfb_info_detail_id)
interface EspPinMappingRow {
  config_id:            number;
  kfb_info_detail_id: number;
  branch_id: number;
  pin_number: number;
}

interface ConfigBranch {
  config_id:          number;
  kfb_info_detail_id: number;
  branch_id: number;
  not_tested: boolean; // <-- NEW: Added not_tested flag
}

// -----------------------------
// Props for this component
// -----------------------------
interface SettingsBranchesPageContentProps {
  onNavigateBack: () => void;
  configId: number | null;
}

// -----------------------------
// Component
// -----------------------------
const SettingsBranchesPageContent: React.FC<
  SettingsBranchesPageContentProps
> = ({ onNavigateBack, configId }) => {
  // ─── 1) State for configurations (KFBs) ──────────────────────────────────────
  const [configs, setConfigs] = useState<Configuration[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<Configuration | null>(
    null
  );
  const [loadingConfigs, setLoadingConfigs] = useState(true);

  // ─── NEW: State for selected KFB Info ────────────────────────────────────────
  const [selectedKfbInfo, setSelectedKfbInfo] = useState<string | null>(null);

  // ─── 2) State for “create/link/filter” input under Step 2 ─────────────────────
  const [unifiedInput, setUnifiedInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  // ─── 3) State for all existing branches (global) ─────────────────────────────
  const [allBranches, setAllBranches] = useState<Branch[]>([]);

  // ─── 4) State for “linked” branches overview ────────────────────────
  const [linkedBranches, setLinkedBranches] = useState<Branch[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);

  // ─── 5) State for pins: map of branchId→pinNumber (or null if none) ────────
  const [pinMap, setPinMap] = useState<Record<number, number | null>>({});
  const [loadingPinMap, setLoadingPinMap] = useState<Record<number, boolean>>(
    {}
  );
  const [newPinInputs, setNewPinInputs] = useState<Record<number, string>>({});
  
  // ─── NEW: State for 'not tested' toggle ───────────────────────────────────────
  const [notTestedMap, setNotTestedMap] = useState<Record<number, boolean>>({});


  // ─── 6) Inline-edit state for branch naming ──────────────────────────────────
  const [editingBranchId, setEditingBranchId] = useState<number | null>(null);
  const [editBranchInputs, setEditBranchInputs] = useState<
    Record<number, string>
  >({});

  // ─── 7) Error & “refresh” triggers ─────────────────────────────────────────
  const [error, setError] = useState<string | null>(null);
  const [refreshConfigKey, setRefreshConfigKey] = useState(0);
  const [refreshBranchesKey, setRefreshBranchesKey] = useState(0);
  const [refreshPinsKey, setRefreshPinsKey] = useState(0);

  // A ref to close the dropdown suggestions when clicking outside
  const suggestionBoxRef = useRef<HTMLDivElement | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // Helper to get kfb_info_detail_id from config_id and kfb_info_value
  const getKfbInfoDetailId = useCallback(async (configId: number, kfbInfoValue: string): Promise<number | null> => {
    const { data, error: supaErr } = await supabase
      .from("kfb_info_details")
      .select("id")
      .eq("config_id", configId)
      .eq("kfb_info_value", kfbInfoValue)
      .single();
    if (supaErr && supaErr.code !== 'PGRST116') {
      console.error("Error fetching kfb_info_detail_id:", supaErr);
      setError(`Failed to retrieve KFB Info detail ID: ${supaErr.message}`);
      return null;
    }
    return data?.id || null;
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Fetch all KFB configurations on mount
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchAllConfigs = async () => {
      setLoadingConfigs(true);
      setError(null);
      try {
        const { data: configsData, error: supaErrConfigs } = await supabase
          .from("configurations")
          .select("id, kfb, mac_address")
          .order("kfb", { ascending: true });
        if (supaErrConfigs) throw supaErrConfigs;

        const { data: kfbDetailsData, error: supaErrKfbDetails } = await supabase
          .from("kfb_info_details")
          .select("config_id, kfb_info_value");
        if (supaErrKfbDetails) throw supaErrKfbDetails;

        const kfbInfoMap = new Map<number, string[]>();
        (kfbDetailsData || []).forEach(detail => {
          if (!kfbInfoMap.has(detail.config_id)) {
            kfbInfoMap.set(detail.config_id, []);
          }
          kfbInfoMap.get(detail.config_id)!.push(detail.kfb_info_value);
        });

        const loadedConfigs: Configuration[] = (configsData || []).map(config => ({
          ...config,
          kfbInfo: kfbInfoMap.get(config.id) || [],
        }));

        setConfigs(loadedConfigs);
      } catch (err: any) {
        console.error("Error loading configurations:", err);
        setError(`Failed to load configurations: ${err.message}`);
      } finally {
        setLoadingConfigs(false);
      }
    };
    fetchAllConfigs();
  }, [refreshConfigKey]);

  // Auto-select a configuration if configId prop is provided
  useEffect(() => {
    if (!loadingConfigs && configId !== null) {
      const found = configs.find((c) => c.id === configId) ?? null;
      setSelectedConfig(found);
      setLinkedBranches([]);
      setPinMap({});
      setNotTestedMap({});
      setUnifiedInput("");
      setEditingBranchId(null);
      setSelectedKfbInfo(null);
    }
  }, [configs, loadingConfigs, configId]);

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Fetch all existing branches (once on mount)
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchAllBranches = async () => {
      try {
        const { data, error: supaErr } = await supabase
          .from("branches")
          .select("id, name, created_at")
          .order("name", { ascending: true });
        if (supaErr) throw supaErr;
        setAllBranches(data ?? []);
      } catch (err: any) {
        console.error("Error loading all branches:", err);
        setError(`Failed to load all branches: ${err.message}`);
      }
    };
    fetchAllBranches();
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. When selectedConfig/KfbInfo change, reload linked branches and their 'not_tested' status
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedConfig || selectedKfbInfo === null) {
      setLinkedBranches([]);
      setPinMap({});
      setNotTestedMap({});
      return;
    }
    const fetchLinkedBranches = async () => {
      setLoadingBranches(true);
      setError(null);
      try {
        const kfbInfoDetailId = await getKfbInfoDetailId(selectedConfig.id, selectedKfbInfo);
        if (kfbInfoDetailId === null) {
          setLinkedBranches([]);
          setPinMap({});
          setNotTestedMap({});
          setLoadingBranches(false);
          return;
        }

        // Fetch config_branches entries, including the new 'not_tested' flag
        const { data: joinRows } = await supabase
          .from("config_branches")
          .select("branch_id, not_tested")
          .eq("config_id", selectedConfig.id)
          .eq("kfb_info_detail_id", kfbInfoDetailId);


        const branchIds: number[] = (joinRows ?? []).map(
          (jr: { branch_id: number }) => jr.branch_id
        );
        
        // Build the 'not tested' map from the fetched data
        const newNotTestedMap: Record<number, boolean> = {};
        (joinRows ?? []).forEach((row: { branch_id: number, not_tested: boolean}) => {
            newNotTestedMap[row.branch_id] = row.not_tested;
        });
        setNotTestedMap(newNotTestedMap);

        if (branchIds.length === 0) {
          setLinkedBranches([]);
          setPinMap({});
          setLoadingBranches(false);
          return;
        }

        const { data: branchRows, error: branchErr } = await supabase
          .from("branches")
          .select("id, name, created_at")
          .in("id", branchIds)
          .order("name", { ascending: true });
        if (branchErr) throw branchErr;

        setLinkedBranches(branchRows ?? []);
      } catch (err: any) {
        console.error("Error loading linked branches:", err);
        setError(`Failed to load branches: ${err.message}`);
      } finally {
        setLoadingBranches(false);
      }
    };
    fetchLinkedBranches();
  }, [selectedConfig, selectedKfbInfo, refreshBranchesKey, getKfbInfoDetailId]);

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Whenever linkedBranches changes, fetch each branch’s PIN
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedConfig || selectedKfbInfo === null || linkedBranches.length === 0) {
      setPinMap({});
      return;
    }
    const fetchAllPinsForLinkedBranches = async () => {
      const newLoading: Record<number, boolean> = {};
      linkedBranches.forEach((b) => {
        newLoading[b.id] = true;
      });
      setLoadingPinMap(newLoading);

      try {
        const kfbInfoDetailId = await getKfbInfoDetailId(selectedConfig.id, selectedKfbInfo);
        if (kfbInfoDetailId === null) {
          setPinMap({});
          const clearedLoading: Record<number, boolean> = {};
          linkedBranches.forEach((b) => { clearedLoading[b.id] = false; });
          setLoadingPinMap(clearedLoading);
          return;
        }

        const { data, error: supaErr } = await supabase
          .from("esp_pin_mappings")
          .select("branch_id, pin_number")
          .eq("kfb_info_detail_id", kfbInfoDetailId);
        if (supaErr) throw supaErr;

        const newMap: Record<number, number | null> = {};
        linkedBranches.forEach((b) => {
          newMap[b.id] = null;
        });
        (data ?? []).forEach(
          (row: { branch_id: number; pin_number: number }) => {
            newMap[row.branch_id] = row.pin_number;
          }
        );
        setPinMap(newMap);
      } catch (err: any) {
        console.error("Error loading all pins:", err);
        setError(`Failed to load pins: ${err.message}`);
      } finally {
        const clearedLoading: Record<number, boolean> = {};
        linkedBranches.forEach((b) => {
          clearedLoading[b.id] = false;
        });
        setLoadingPinMap(clearedLoading);
      }
    };
    fetchAllPinsForLinkedBranches();
  }, [linkedBranches, selectedConfig, selectedKfbInfo, refreshPinsKey, getKfbInfoDetailId]);

  // Handlers for selection changes
  const handleSelectConfig = useCallback(
    (cfgIdStr: string) => {
      const cfgId = Number(cfgIdStr);
      const found = configs.find((c) => c.id === cfgId) ?? null;
      setSelectedConfig(found);
      setLinkedBranches([]);
      setPinMap({});
      setNotTestedMap({});
      setUnifiedInput("");
      setEditingBranchId(null);
      setSelectedKfbInfo(null);
    },
    [configs]
  );

  const handleSelectKfbInfo = useCallback(
    (kfbInfoValue: string) => {
      // reset everything for the _new_ KFB-info
      setSelectedKfbInfo(kfbInfoValue);
      setLinkedBranches([]);
      setPinMap({});
      setNotTestedMap({});
      setUnifiedInput("");
      // trigger our effects
      setRefreshBranchesKey((k) => k + 1);
      setRefreshPinsKey((k) => k + 1);
    },
    []
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // NEW Handler: Toggle the 'not_tested' status for a branch
  // ─────────────────────────────────────────────────────────────────────────────
  const handleToggleNotTested = async (branchId: number) => {
      if (!selectedConfig || !selectedKfbInfo) {
          setError("Cannot change status without a selected KFB and KFB Info.");
          return;
      };

      const currentStatus = notTestedMap[branchId] ?? false;
      const newStatus = !currentStatus;

      // Optimistic UI update for instant feedback
      setNotTestedMap(prev => ({ ...prev, [branchId]: newStatus }));

      try {
          const kfbInfoDetailId = await getKfbInfoDetailId(selectedConfig.id, selectedKfbInfo);
          if (kfbInfoDetailId === null) {
              throw new Error("Could not find the specific KFB Info ID to update.");
          }

          const { error: updateError } = await supabase
              .from("config_branches")
              .update({ not_tested: newStatus })
              .match({ kfb_info_detail_id: kfbInfoDetailId, branch_id: branchId });

          if (updateError) throw updateError;

      } catch (err: any) {
          console.error("Error updating 'not tested' status:", err);
          setError(`Failed to update status: ${err.message}`);
          // Revert the optimistic update if the database call fails
          setNotTestedMap(prev => ({ ...prev, [branchId]: currentStatus }));
      }
  };

  const linkExistingBranch = async (b: Branch) => {
    if (!selectedConfig || selectedKfbInfo === null) {
      setError("Please select a KFB configuration and KFB Info first.");
      return;
    }
    if (linkedBranches.find((lb) => lb.id === b.id)) {
      setShowSuggestions(false);
      return;
    }

    try {
      const kfbInfoDetailId = await getKfbInfoDetailId(selectedConfig.id, selectedKfbInfo);
      if (kfbInfoDetailId === null) {
        setError("Could not find KFB Info detail ID for selected KFB Info.");
        return;
      }

      const { error: insertErr } = await supabase
        .from("config_branches")
        .insert([{  config_id: selectedConfig.id, kfb_info_detail_id: kfbInfoDetailId, branch_id: b.id, not_tested: false }]);

      if (insertErr) {
        if (insertErr.code === '23505') {
          setError(`Branch '${b.name}' is already linked to this KFB Info.`);
        } else {
          throw insertErr;
        }
      } else {
        setLinkedBranches((prev) => [...prev, b]);
        setPinMap((prev) => ({ ...prev, [b.id]: null }));
        setNotTestedMap(prev => ({ ...prev, [b.id]: false })); // Default to false
        setUnifiedInput("");
        setShowSuggestions(false);
        setEditingBranchId(null);
        setRefreshBranchesKey(prev => prev + 1);
      }
    } catch (err: any) {
      console.error("Error linking branch:", err);
      setError(`Failed to link branch: ${err.message}`);
    }
  };

  const createAndLinkBranch = async () => {
    if (!selectedConfig || selectedKfbInfo === null) {
      setError("Please select a KFB configuration and KFB Info first.");
      return;
    }
    const trimmed = unifiedInput.trim();
    if (!trimmed) {
      setError("Please type a branch name.");
      return;
    }

    if (allBranches.find((b) => b.name.toLowerCase() === trimmed.toLowerCase())) {
      setError("That branch already exists—click its name to link.");
      return;
    }

    try {
      const { data: newBr, error: insertBrErr } = await supabase
        .from("branches")
        .insert([{ name: trimmed }])
        .select("id, name, created_at")
        .single();
      if (insertBrErr) throw insertBrErr;
      if (!newBr) throw new Error("Failed to create branch.");

      const kfbInfoDetailId = await getKfbInfoDetailId(selectedConfig.id, selectedKfbInfo);
      if (kfbInfoDetailId === null) {
        setError("Could not find KFB Info detail ID. Branch created but not linked.");
        return;
      }

      const { error: insertLinkErr } = await supabase
      .from("config_branches")
      .insert([{
        config_id:           selectedConfig.id,
        kfb_info_detail_id: kfbInfoDetailId,
        branch_id:           newBr.id,
        not_tested:          false
      }]);


      if (insertLinkErr) {
        if (insertLinkErr.code === '23505') {
          setError(`Branch '${newBr.name}' is already linked to this KFB Info.`);
        } else {
          throw insertLinkErr;
        }
      } else {
        setAllBranches((prev) => [...prev, newBr]);
        setLinkedBranches((prev) => [...prev, newBr]);
        setPinMap((prev) => ({ ...prev, [newBr.id]: null }));
        setNotTestedMap(prev => ({ ...prev, [newBr.id]: false })); // Default to false
        setUnifiedInput("");
        setShowSuggestions(false);
        setEditingBranchId(null);
        setRefreshBranchesKey(prev => prev + 1);
      }
    } catch (err: any) {
      console.error("Error creating/linking branch:", err);
      setError(`Failed to create or link branch: ${err.message}`);
    }
  };

  const handleEditBranch = (branch: Branch) => {
    setEditingBranchId(branch.id);
    setEditBranchInputs((prev) => ({
      ...prev,
      [branch.id]: branch.name,
    }));
    setError(null);
  };

  const handleSaveBranchName = async (branchId: number) => {
    const trimmed = (editBranchInputs[branchId] || "").trim();
    if (!trimmed) {
      setError("Branch name cannot be empty.");
      return;
    }
    const branchObj = linkedBranches.find((b) => b.id === branchId);
    if (!branchObj || trimmed === branchObj.name) {
      setEditingBranchId(null);
      setError(null);
      return;
    }

    try {
      const { error: updateErr } = await supabase
        .from("branches")
        .update({ name: trimmed })
        .eq("id", branchId);
      if (updateErr) throw updateErr;

      setLinkedBranches((prev) =>
        prev.map((b) => (b.id === branchId ? { ...b, name: trimmed } : b))
      );
      setAllBranches((prev) =>
        prev.map((b) => (b.id === branchId ? { ...b, name: trimmed } : b))
      );

      setEditingBranchId(null);
      setError(null);
    } catch (err: any)      {
      console.error("Error renaming branch:", err);
      setError(`Failed to rename branch: ${err.message}`);
    }
  };

  const handleDeletePin = async (branchId: number) => {
    if (!selectedConfig || selectedKfbInfo === null) return;
    const thePin = pinMap[branchId];
    if (thePin == null) return;
    setError(null);

    try {
      const kfbInfoDetailId = await getKfbInfoDetailId(selectedConfig.id, selectedKfbInfo);
      if (kfbInfoDetailId === null) throw new Error("Could not find KFB Info detail ID.");

      await supabase
        .from("esp_pin_mappings")
        .delete()
        .eq("kfb_info_detail_id", kfbInfoDetailId)
        .eq("branch_id", branchId)
        .eq("pin_number", thePin);

      setPinMap((prev) => ({ ...prev, [branchId]: null }));
    } catch (err: any) {
      console.error("Error deleting pin:", err);
      setError(`Failed to delete pin: ${err.message}`);
    }
  };

  const handleAddPin = async (branchId: number) => {
    if (!selectedConfig || selectedKfbInfo === null) return;
    if (pinMap[branchId] != null) {
      setError("That branch already has a pin. Delete it first to assign a new one.");
      return;
    }
    const trimmedPin = (newPinInputs[branchId] || "").trim();
    if (!trimmedPin) {
      setError("Please enter a pin number.");
      return;
    }
    const pinNum = parseInt(trimmedPin, 10);
    if (isNaN(pinNum)) {
      setError("Pin number must be a valid integer.");
      return;
    }
    setError(null);
    setLoadingPinMap(prev => ({ ...prev, [branchId]: true }));
  
    try {
      const kfbInfoDetailId = await getKfbInfoDetailId(selectedConfig.id, selectedKfbInfo);
      if (kfbInfoDetailId === null) throw new Error("Could not find KFB Info detail ID.");
  
      const { error: insertErr } = await supabase
        .from("esp_pin_mappings")
        .insert([{
          config_id: selectedConfig.id,
          kfb_info_detail_id: kfbInfoDetailId,
          branch_id: branchId,
          pin_number: pinNum,
        }]);
  
      if (insertErr) {
        if (insertErr.code === '23505') {
          setError(`Pin ${pinNum} is already assigned to another branch.`);
        } else {
          throw insertErr;
        }
      } else {
        setPinMap(prev => ({ ...prev, [branchId]: pinNum }));
        setNewPinInputs(prev => ({ ...prev, [branchId]: "" }));
      }
    } catch (err: any) {
      console.error("Error adding pin:", err);
      setError(`Failed to add pin: ${err.message}`);
    } finally {
      setLoadingPinMap(prev => ({ ...prev, [branchId]: false }));
    }
  };
  
  const handleDeleteBranch = async (branchId: number) => {
    if (!selectedConfig || selectedKfbInfo === null) return;
    setError(null);
    try {
      const kfbInfoDetailId = await getKfbInfoDetailId(selectedConfig.id, selectedKfbInfo);
      if (kfbInfoDetailId === null) throw new Error("Could not find KFB Info detail ID.");

      await supabase
        .from("config_branches")
        .delete()
        .eq("kfb_info_detail_id", kfbInfoDetailId)
        .eq("branch_id", branchId);

      await supabase
        .from("esp_pin_mappings")
        .delete()
        .eq("kfb_info_detail_id", kfbInfoDetailId)
        .eq("branch_id", branchId);

      setLinkedBranches((prev) => prev.filter((b) => b.id !== branchId));
      const newPinMap = { ...pinMap };
      delete newPinMap[branchId];
      setPinMap(newPinMap);
      const newNotTestedMap = { ...notTestedMap };
      delete newNotTestedMap[branchId];
      setNotTestedMap(newNotTestedMap);

      setRefreshBranchesKey(prev => prev + 1);
    } catch (err: any) {
      console.error("Error unlinking branch:", err);
      setError(`Failed to unlink branch: ${err.message}`);
    }
  };

  const suggestionsToLink = useMemo(() => {
    const term = unifiedInput.trim().toLowerCase();
    if (!term || !selectedConfig || selectedKfbInfo === null) return [];
    const linkedIds = new Set(linkedBranches.map((b) => b.id));
    return allBranches
      .filter((b) => !linkedIds.has(b.id) && b.name.toLowerCase().includes(term))
      .slice(0, 5);
  }, [allBranches, linkedBranches, unifiedInput, selectedConfig, selectedKfbInfo]);

  const filteredLinkedBranches = useMemo(() => {
    const term = unifiedInput.trim().toLowerCase();
    if (!term) return linkedBranches;
    return linkedBranches.filter((b) => b.name.toLowerCase().includes(term));
  }, [linkedBranches, unifiedInput]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (suggestionBoxRef.current && !suggestionBoxRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (loadingConfigs) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-900 text-white">
        <p className="text-xl animate-pulse">Loading configurations…</p>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MAIN JSX
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen w-full flex-col dark:bg-slate-950 px-4 sm:px-6 md:px-8 py-5 font-sans items-center">
    <div className="w-full flex-grow dark:bg-slate-900/50 p-6 lg:p-8 rounded-2xl shadow-2xl flex flex-col gap-6">
      <h1 className="text-5xl font-bold text-slate-800 dark:text-slate-100">Program</h1>

      {error && (
        <div className="rounded-xl border border-red-400 bg-red-100 p-5 text-red-700 dark:border-red-600 dark:bg-red-900/50 dark:text-red-200" role="alert">
          <div className="flex justify-between items-start gap-4">
            <div>
              <p className="font-bold text-xl">Error:</p>
              <p className="break-words text-xl">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-2xl text-red-700 dark:text-red-200 hover:text-red-900 dark:hover:text-red-100 font-bold">&times;</button>
          </div>
        </div>
      )}

      <section className="rounded-2xl bg-white shadow-lg dark:bg-slate-800 p-6">
        <h2 className="pb-3 text-3xl font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
          1. Select KFB Number
        </h2>
        <select id="configSelect" value={selectedConfig ? String(selectedConfig.id) : ""} onChange={(e) => handleSelectConfig(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white p-4 text-2xl text-slate-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100">
          <option disabled value="">-- Select a KFB Number --</option>
          {configs.map((c) => (<option key={c.id} value={c.id}>{c.kfb}</option>))}
        </select>
      </section>

      {selectedConfig && (
        <section className="rounded-2xl bg-white shadow-lg dark:bg-slate-800 p-6">
          <h2 className="pb-3 text-3xl font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
            1.1. Select KFB Info for: <span className="font-bold text-sky-600 dark:text-sky-400">{selectedConfig.kfb}</span>
          </h2>
          <select
            id="kfbInfoSelect"
            value={selectedKfbInfo || ""}
            onChange={(e) => handleSelectKfbInfo(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white p-4 text-2xl text-slate-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
            disabled={!selectedConfig || selectedConfig.kfbInfo?.length === 0}
          >
            <option disabled value="">-- Select a KFB Info --</option>
            {selectedConfig.kfbInfo?.length > 0 ? (
              selectedConfig.kfbInfo.map((info, index) => (
                <option key={index} value={info}>{info}</option>
              ))
            ) : (
              <option disabled>No KFB Info available for this KFB</option>
            )}
          </select>
        </section>
      )}
        {selectedConfig && selectedKfbInfo && (
          <section className="rounded-2xl bg-white dark:bg-slate-800 shadow-lg p-6 flex-1 flex flex-col overflow-hidden">
            <h2 className="text-3xl font-semibold text-slate-700 dark:text-slate-200 mb-4">
              2. Branches for <span className="font-bold text-sky-600 dark:text-sky-400">{selectedConfig.kfb}</span> 
              (Info: <span className="font-bold text-sky-600 dark:text-sky-400">{selectedKfbInfo}</span>)
            </h2>

            {/* filter / link input */}
            <div className="relative mb-6">
              <input
                type="text"
                value={unifiedInput}
                onChange={e => { setUnifiedInput(e.target.value); setShowSuggestions(true) }}
                onFocus={() => setShowSuggestions(true)}
                placeholder="Filter, Link, or Create Branch…"
                className="w-full rounded-2xl border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-6 py-4 text-2xl placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              {/* … your suggestion dropdown here … */}
            </div>

            <div className="flex-1 overflow-auto">
              <table className="min-w-full divide-y divide-slate-300 dark:divide-slate-600">
                <thead className="bg-slate-100 dark:bg-slate-700">
                  <tr>
                    <th className="px-6 py-4 text-left text-2xl font-semibold text-slate-600 dark:text-slate-300 uppercase">
                      Branch
                    </th>
                    <th className="px-6 py-4 text-center text-2xl font-semibold text-slate-600 dark:text-slate-300 uppercase">
                      Not Tested
                    </th>
                    <th className="px-6 py-4 text-center text-2xl font-semibold text-slate-600 dark:text-slate-300 uppercase">
                      PIN
                    </th>
                    <th className="px-6 py-4 text-center text-2xl font-semibold text-slate-600 dark:text-slate-300 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>

                        <tbody className="bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-600">
          {loadingBranches ? (
            <tr>
              <td colSpan={4} className="p-6 text-center text-2xl text-slate-500 dark:text-slate-400">
                Loading branches…
              </td>
            </tr>
          ) : filteredLinkedBranches.length === 0 ? (
            <tr>
              <td colSpan={4} className="p-6 text-center text-2xl text-slate-500 dark:text-slate-400">
                No branches linked.
              </td>
            </tr>
          ) : (
            filteredLinkedBranches.map((b) => (
              <tr key={b.id}>
                {/* BRANCH */}
                <td className="px-6 py-4 text-2xl text-slate-800 dark:text-slate-200">
                  {b.name}
                </td>

                {/* NOT TESTED */}
                <td className="px-6 py-4 text-center">
                  <button
                    onClick={() => handleToggleNotTested(b.id)}
                    className={`
                      relative inline-flex h-8 w-16 items-center rounded-full transition
                      ${notTestedMap[b.id] ? 'bg-yellow-500' : 'bg-gray-300 dark:bg-slate-600'}
                    `}
                    role="switch"
                    aria-checked={notTestedMap[b.id] ?? false}
                  >
                    <span
                      className={`
                        inline-block h-7 w-7 transform rounded-full bg-white shadow transition
                        ${notTestedMap[b.id] ? 'translate-x-8' : 'translate-x-0'}
                      `}
                    />
                  </button>
                </td>

                {/* PIN */}
                <td className="px-6 py-4 text-center">
                  {loadingPinMap[b.id] ? (
                    <span className="animate-pulse text-2xl text-gray-500 dark:text-gray-400">…</span>
                  ) : pinMap[b.id] != null ? (
                    <div className="inline-flex items-center space-x-2">
                      <code className="font-mono text-2xl  text-gray-500 dark:text-gray-400">PIN {pinMap[b.id]}</code>
                      <button
                        onClick={() => handleDeletePin(b.id)}
                        className="text-red-500 hover:text-red-700"
                        title="Remove PIN"
                      >
                        <XMarkIcon className="h-6 w-6" />
                      </button>
                    </div>
                  ) : (
                    <div className="inline-flex items-center space-x-2">
                      <input
                        type="text"
                        value={newPinInputs[b.id] || ""}
                        onChange={e => setNewPinInputs(p => ({ ...p, [b.id]: e.target.value }))}
                        onKeyDown={e => e.key === 'Enter' && handleAddPin(b.id)}
                        placeholder="Add"
                        className="w-20 rounded-xl  text-gray-500 dark:text-gray-400 border px-3 py-2 text-2xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                      <button
                        onClick={() => handleAddPin(b.id)}
                        disabled={!newPinInputs[b.id]}
                        className="text-teal-600 hover:text-teal-800 disabled:opacity-50"
                        title="Add PIN"
                      >
                        <PlusIcon className="h-6 w-6" />
                      </button>
                    </div>
                  )}
                </td>

                {/* ACTIONS */}
                <td className="px-6 py-4 text-center">
                  {confirmDeleteId === b.id ? (
                    <div className="inline-flex space-x-2">
                      <button
                        onClick={() => { handleDeleteBranch(b.id); setConfirmDeleteId(null); }}
                        className="px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded-xl hover:bg-gray-300 transition"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(b.id)}
                      className="px-6 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition"
                    >
                      Unlink
                    </button>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>

              </table>
            </div>
          </section>
        )}


    </div>
  </div>
  );
};

export { SettingsBranchesPageContent };
export default SettingsBranchesPageContent;
