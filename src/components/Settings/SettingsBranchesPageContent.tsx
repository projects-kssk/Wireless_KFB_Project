'use client'
import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  FormEvent,
} from "react"
import {
  XMarkIcon,
  CheckCircleIcon,
  PencilSquareIcon,
  PlusIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  TrashIcon,
} from "@heroicons/react/24/solid"

// -----------------------------
// Type definitions
// -----------------------------
interface Configuration {
  id: number
  kfb: string
  mac_address: string
  kfbInfo: string[]
}

// Frontend's internal representation of a branch
interface Branch {
  id: number
  name: string
}

// Shape of data received from the /api/branches endpoint
interface BranchApiResponse {
    id: string;
    branchName: string;
    // other fields from the API we don't need on the frontend
    [key: string]: any; 
}


interface EspPinMappingRow {
  branch_id: number
  pin_number: number
}

interface ConfigBranchRow {
  branch_id: number
  not_tested: boolean
}

// -----------------------------
// Helper: fetch + JSON wrapper
// -----------------------------
async function fetchJSON<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...opts })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || res.statusText || `Request failed with status ${res.status}`)
  }
  return res.json()
}


// -----------------------------
// Main Application Component
// -----------------------------
const App: React.FC = () => {
    // This state would typically be managed by a router.
    // For this example, we'll simulate navigation.
    const [configId, setConfigId] = useState<number | null>(1); // Example: Start with a pre-selected config ID.
    
    const handleNavigateBack = () => {
        console.log("Navigating back...");
        // In a real app, you'd use your router's back function.
        // For now, we can just clear the selection.
        setConfigId(null); 
    };

    return (
        <SettingsBranchesPageContent
            onNavigateBack={handleNavigateBack}
            configId={configId}
        />
    )
}


// -----------------------------
// Settings Page Component
// -----------------------------
const SettingsBranchesPageContent: React.FC<{
  onNavigateBack: () => void
  configId: number | null
}> = ({
  onNavigateBack,
  configId,
}) => {
  // --- STATE MANAGEMENT ---
  
  const [configs, setConfigs] = useState<Configuration[]>([])
  const [selectedConfig, setSelectedConfig] = useState<Configuration | null>(null)
  const [loadingConfigs, setLoadingConfigs] = useState(true)
  const [selectedKfbInfo, setSelectedKfbInfo] = useState<string | null>(null)
  const [kfbInfoDetails, setKfbInfoDetails] = useState<{ id: number; kfb_info_value: string }[]>([])
  const [unifiedInput, setUnifiedInput] = useState("")
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [allBranches, setAllBranches] = useState<Branch[]>([])
  const [linkedBranches, setLinkedBranches] = useState<Branch[]>([])
  const [loadingBranches, setLoadingBranches] = useState(false)
  const [pinMap, setPinMap] = useState<Record<number, number | null>>({})
  const [loadingPinMap, setLoadingPinMap] = useState<Record<number, boolean>>({})
  const [newPinInputs, setNewPinInputs] = useState<Record<number, string>>({})
  const [notTestedMap, setNotTestedMap] = useState<Record<number, boolean>>({})
  const [editingBranchId, setEditingBranchId] = useState<number | null>(null)
  const [editBranchInputs, setEditBranchInputs] = useState<Record<number, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const suggestionBoxRef = useRef<HTMLDivElement | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  // --- DATA FETCHING EFFECTS ---

  // 1. Load all configurations on initial mount
  useEffect(() => {
    setLoadingConfigs(true)
    setError(null)
    fetchJSON<Configuration[]>("/api/configurations")
      .then(data => setConfigs(data))
      .catch(err => setError(`Failed to load configurations: ${err.message}`))
      .finally(() => setLoadingConfigs(false))
  }, [])

  // 1.2 Auto-select config based on prop
  useEffect(() => {
    if (!loadingConfigs && configId !== null) {
      const found = configs.find(c => c.id === configId) ?? null
      setSelectedConfig(found)
      setSelectedKfbInfo(null)
      setLinkedBranches([])
      setPinMap({})
      setNotTestedMap({})
      setUnifiedInput("")
      setEditingBranchId(null)
    }
  }, [configs, loadingConfigs, configId])

  // 1.3 Load KFB info details for the selected config
  useEffect(() => {
    if (!selectedConfig) {
      setKfbInfoDetails([])
      return
    }
    setError(null);
    fetchJSON<{ id: number; kfb_info_value: string }[]>(
      `/api/kfb_info_details?configId=${selectedConfig.id}`
    )
      .then(rows => setKfbInfoDetails(rows))
      .catch(err => setError(`Failed to load KFB info details: ${err.message}`))
  }, [selectedConfig])
  
  // 2. Load all branches for the selected KFB (to suggest for linking)
  useEffect(() => {
    if (!selectedConfig) {
        setAllBranches([]);
        return;
    }
    setError(null);
    // FIX: Adapt the API response to the frontend's internal Branch type.
    fetchJSON<BranchApiResponse[]>(`/api/branches?kfb=${selectedConfig.kfb}`)
        .then(data => {
            const adaptedData: Branch[] = data.map(b => ({
                id: Number(b.id),
                name: b.branchName,
            }));
            setAllBranches(adaptedData);
        })
        .catch(err => setError(`Failed to load branch list: ${err.message}`))
  }, [selectedConfig]);

  // 3. Load linked branches & pins when selection changes
  useEffect(() => {
    if (!selectedConfig || !selectedKfbInfo) {
      setLinkedBranches([])
      setPinMap({})
      setNotTestedMap({})
      return
    }
    const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo)
    if (!detail) return

    setLoadingBranches(true)
    setError(null)

    const fetchLinkedData = async () => {
        try {
            const configBranchRows = await fetchJSON<ConfigBranchRow[]>(
                `/api/config_branches?configId=${selectedConfig.id}&detailId=${detail.id}`
            );

            const notMap: Record<number, boolean> = {};
            const branchIds = configBranchRows.map(r => {
                notMap[r.branch_id] = r.not_tested;
                return r.branch_id;
            });
            setNotTestedMap(notMap);

            if (branchIds.length === 0) {
                setLinkedBranches([]);
                setPinMap({});
                setLoadingBranches(false);
                return;
            }

            // FIX: Adapt API response for linked branches
            const linkedBranchData = await fetchJSON<BranchApiResponse[]>(`/api/branches?ids=${branchIds.join(",")}`);
            const adaptedLinkedData: Branch[] = linkedBranchData.map(b => ({
                id: Number(b.id),
                name: b.branchName
            }));
            setLinkedBranches(adaptedLinkedData);

            const pinMappingRows = await fetchJSON<EspPinMappingRow[]>(`/api/esp_pin_mappings?detailId=${detail.id}`);
            const newPinMap: Record<number, number | null> = {};
            adaptedLinkedData.forEach(b => newPinMap[b.id] = null);
            pinMappingRows.forEach(r => { newPinMap[r.branch_id] = r.pin_number });
            setPinMap(newPinMap);

        } catch (err: any) {
            setError(`Failed to load branch data: ${err.message}`);
            setLinkedBranches([]);
            setPinMap({});
            setNotTestedMap({});
        } finally {
            setLoadingBranches(false);
        }
    };

    fetchLinkedData();

  }, [selectedConfig, selectedKfbInfo, kfbInfoDetails, refreshKey])

  
  // --- MEMOIZED VALUES & DERIVED STATE ---
  // FIX: Moved these useMemo hooks before the useCallback hooks that depend on them.
  const suggestionsToLink = useMemo(() => {
    const term = unifiedInput.trim().toLowerCase()
    if (!term || !selectedConfig || !selectedKfbInfo) return []
    const linkedIds = new Set(linkedBranches.map(b => b.id))
    return allBranches
      .filter(b => !linkedIds.has(b.id) && b.name.toLowerCase().includes(term))
      .slice(0, 5)
  }, [allBranches, linkedBranches, unifiedInput, selectedConfig, selectedKfbInfo])

  const filteredLinkedBranches = useMemo(() => {
    const term = unifiedInput.trim().toLowerCase()
    if (!term) return linkedBranches
    return linkedBranches.filter(b => b.name.toLowerCase().includes(term))
  }, [linkedBranches, unifiedInput])

  const areAllNotTested = useMemo(() => {
    if (filteredLinkedBranches.length === 0) return false;
    return filteredLinkedBranches.every(b => notTestedMap[b.id]);
  }, [filteredLinkedBranches, notTestedMap]);


  // --- HANDLERS & ACTIONS ---

  const handleSelectConfig = useCallback((idStr: string) => {
    const id = Number(idStr)
    const c = configs.find(x => x.id === id) ?? null
    setSelectedConfig(c)
    setSelectedKfbInfo(null)
    setLinkedBranches([])
  }, [configs])

  const handleSelectKfbInfo = useCallback((val: string) => {
    setSelectedKfbInfo(val)
    setUnifiedInput("")
  }, [])
  
  const triggerRefresh = () => setRefreshKey(k => k + 1);

  const handleToggleNotTested = useCallback(async (branchId: number) => {
    const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo)
    if (!detail) return

    const oldState = notTestedMap[branchId] || false
    const newState = !oldState
    setNotTestedMap(m => ({ ...m, [branchId]: newState }))

    try {
      await fetchJSON(`/api/config_branches/${detail.id}/${branchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ not_tested: newState }),
      })
    } catch (err: any) {
      setError(err.message)
      setNotTestedMap(m => ({ ...m, [branchId]: oldState }))
    }
  }, [selectedKfbInfo, kfbInfoDetails, notTestedMap])

  // NEW: Handler for the "Toggle All" checkbox
  const handleToggleAllNotTested = useCallback(async () => {
    const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo);
    if (!detail || filteredLinkedBranches.length === 0) return;

    // Determine the new state: if any are unchecked, the action is to check all.
    // If all are already checked, the action is to uncheck all.
    const newGlobalState = filteredLinkedBranches.some(b => !notTestedMap[b.id]);

    const originalMap = { ...notTestedMap };
    
    // Optimistically update UI
    const newMap = { ...notTestedMap };
    filteredLinkedBranches.forEach(b => {
      newMap[b.id] = newGlobalState;
    });
    setNotTestedMap(newMap);

    // Create all API requests
    const updatePromises = filteredLinkedBranches.map(b => 
      fetchJSON(`/api/config_branches/${detail.id}/${b.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ not_tested: newGlobalState }),
      })
    );

    try {
      await Promise.all(updatePromises);
    } catch (err: any) {
      setError(`Failed to update all branches: ${err.message}. Reverting.`);
      setNotTestedMap(originalMap); // Revert on failure
    }
  }, [filteredLinkedBranches, notTestedMap, kfbInfoDetails, selectedKfbInfo]);


  const linkExistingBranch = async (b: Branch) => {
    const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo)
    if (!selectedConfig || !detail) return setError("A KFB and Info must be selected.")
    if (linkedBranches.some(x => x.id === b.id)) return

    try {
      await fetchJSON("/api/config_branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config_id: selectedConfig.id,
          kfb_info_detail_id: detail.id,
          branch_id: b.id,
        }),
      })
      setUnifiedInput("")
      setShowSuggestions(false)
      triggerRefresh();
    } catch (err: any) {
      setError(`Failed to link branch: ${err.message}`)
    }
  }

  const createAndLinkBranch = async () => {
    const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo)
    if (!selectedConfig || !detail) return setError("A KFB and Info must be selected.")
    const name = unifiedInput.trim()
    if (!name) return setError("Branch name cannot be empty.")
    if (allBranches.some(b => b.name.toLowerCase() === name.toLowerCase())) {
      return setError("A branch with this name already exists. Please select it from the suggestions to link it.")
    }

    try {
      const newBranchData = await fetchJSON<BranchApiResponse>("/api/branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const newBranch = { id: Number(newBranchData.id), name: newBranchData.branchName };
      setAllBranches(a => [...a, newBranch]);

      await fetchJSON("/api/config_branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config_id: selectedConfig.id,
          kfb_info_detail_id: detail.id,
          branch_id: newBranch.id,
        }),
      })

      setUnifiedInput("")
      setShowSuggestions(false)
      triggerRefresh()
    } catch (err: any) {
      setError(`Failed to create and link branch: ${err.message}`)
    }
  }

    const handleEditBranch = (b: Branch) => {
        setEditingBranchId(b.id);
        setEditBranchInputs(m => ({ ...m, [b.id]: b.name }));
        setError(null);
    }

    const handleSaveBranchName = async (branchId: number) => {
        const name = (editBranchInputs[branchId] || "").trim();
        if (!name) return setError("Branch name cannot be empty.");

        const originalBranch = allBranches.find(b => b.id === branchId);
        if (!originalBranch || originalBranch.name === name) {
            setEditingBranchId(null);
            return;
        }

        try {
            await fetchJSON(`/api/branches/${branchId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
            });
            setAllBranches(arr => arr.map(b => (b.id === branchId ? { ...b, name } : b)));
            setLinkedBranches(arr => arr.map(b => (b.id === branchId ? { ...b, name } : b)));
            setEditingBranchId(null);
        } catch (err: any) {
            setError(`Failed to rename branch: ${err.message}`);
        }
    };

    const handleDeletePin = async (branchId: number) => {
        const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo);
        const pin = pinMap[branchId];
        if (!detail || pin == null) return;

        try {
            await fetch(`/api/esp_pin_mappings?detailId=${detail.id}&branchId=${branchId}&pinNumber=${pin}`, {
                method: 'DELETE'
            });
            setPinMap(m => ({ ...m, [branchId]: null }));
        } catch (err: any) {
            setError(`Failed to delete PIN: ${err.message}`);
        }
    };

    const handleAddPin = async (branchId: number) => {
        const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo);
        if (!selectedConfig || !detail) return;
        if (pinMap[branchId] != null) return setError("A PIN is already assigned. Please delete it first.");

        const pinValue = (newPinInputs[branchId] || "").trim();
        if (!pinValue) return setError("PIN number cannot be empty.");
        
        const pinNumber = parseInt(pinValue, 10);
        if (isNaN(pinNumber)) return setError("Invalid PIN. Must be an integer.");

        setLoadingPinMap(m => ({ ...m, [branchId]: true }));
        try {
            await fetchJSON('/api/esp_pin_mappings', {
                method: 'POST',
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    config_id: selectedConfig.id,
                    kfb_info_detail_id: detail.id,
                    branch_id: branchId,
                    pin_number: pinNumber,
                }),
            });
            setPinMap(m => ({ ...m, [branchId]: pinNumber }));
            setNewPinInputs(m => ({ ...m, [branchId]: "" }));
        } catch (err: any) {
            setError(`Failed to add PIN: ${err.message}`);
        } finally {
            setLoadingPinMap(m => ({ ...m, [branchId]: false }));
        }
    };
    
    const handleUnlinkBranch = async (branchId: number) => {
        const detail = kfbInfoDetails.find(d => d.kfb_info_value === selectedKfbInfo);
        if (!detail) return;

        try {
            await fetch(`/api/config_branches?detailId=${detail.id}&branchId=${branchId}`, {
                method: 'DELETE'
            });
            await fetch(`/api/esp_pin_mappings?detailId=${detail.id}&branchId=${branchId}`, {
                method: 'DELETE'
            });
            
            triggerRefresh();
        } catch (err: any) {
            setError(`Failed to unlink branch: ${err.message}`);
        } finally {
            setConfirmDeleteId(null);
        }
    };


  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (suggestionBoxRef.current && !suggestionBoxRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])


  // --- RENDER ---

  if (loadingConfigs) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-100 text-gray-800">
        <ArrowPathIcon className="h-12 w-12 animate-spin mr-4" />
        <p className="text-5xl font-light">Loading Configurations…</p>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-full flex-col bg-gray-50 text-gray-900 px-2 sm:px-4 py-6">
      <div className="w-full mx-auto flex-grow bg-white p-6 rounded-2xl shadow-xl flex flex-col gap-6">

        <header>
            <h1 className="text-6xl font-bold text-gray-900 tracking-tight">Branch Configuration</h1>
            <p className="text-xl text-gray-600 mt-2">Manage branches, pins, and test status for KFB devices.</p>
        </header>

        {error && (
          <div className="rounded-xl border border-red-400 bg-red-100 p-4 text-red-800">
            <div className="flex justify-between items-start gap-4">
                <ExclamationTriangleIcon className="h-7 w-7 text-red-600 mt-1 flex-shrink-0" />
              <div className="flex-grow">
                <p className="font-bold text-xl">An Error Occurred:</p>
                <p className="text-lg">{error}</p>
              </div>
              <button onClick={() => setError(null)} className="text-2xl text-red-700 hover:text-red-900 transition-colors">&times;</button>
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6">
            <section className="rounded-xl bg-white p-6 shadow-md border">
                <h2 className="text-3xl font-semibold text-gray-800">1. Select KFB Number</h2>
                <select
                    className="w-full rounded-lg border-2 border-gray-300 bg-gray-50 text-gray-900 text-xl p-3 mt-4 focus:ring-blue-500 focus:border-blue-500 transition"
                    value={selectedConfig ? String(selectedConfig.id) : ""}
                    onChange={e => handleSelectConfig(e.target.value)}
                >
                    <option disabled value="">-- Select a KFB --</option>
                    {configs.map(c => <option key={c.id} value={c.id}>{c.kfb}</option>)}
                </select>
            </section>

            <section className={`rounded-xl p-6 transition-opacity duration-500 ${selectedConfig ? 'opacity-100 bg-white shadow-md border' : 'opacity-50 bg-gray-100'}`}>
                <h2 className="text-3xl font-semibold text-gray-800">
                    2. Select KFB Info
                </h2>
                <select
                    className="w-full rounded-lg border-2 border-gray-300 bg-gray-50 text-gray-900 text-xl p-3 mt-4 focus:ring-blue-500 focus:border-blue-500 transition"
                    value={selectedKfbInfo || ""}
                    onChange={e => handleSelectKfbInfo(e.target.value)}
                    disabled={!selectedConfig || kfbInfoDetails.length === 0}
                >
                    <option disabled value="">
                        {selectedConfig ? (kfbInfoDetails.length > 0 ? '-- Select Info --' : 'No info available') : 'Select KFB first'}
                    </option>
                    {kfbInfoDetails.map(d => (
                        <option key={d.id} value={d.kfb_info_value}>{d.kfb_info_value}</option>
                    ))}
                </select>
            </section>
        </div>


        {selectedConfig && selectedKfbInfo && (
          <section className="rounded-xl bg-white p-6 flex-1 flex flex-col overflow-hidden shadow-md border">
            <h2 className="text-4xl font-semibold text-gray-800 mb-5">
              3. Manage Branches
            </h2>

            <div className="relative mb-5" ref={suggestionBoxRef}>
              <form onSubmit={(e: FormEvent) => { e.preventDefault(); createAndLinkBranch(); }}>
                <input
                    type="text"
                    className="w-full rounded-lg border-2 border-gray-300 bg-white text-gray-900 text-xl px-5 py-3 focus:ring-blue-500 focus:border-blue-500 transition placeholder-gray-400"
                    placeholder="Filter, Link, or Create New Branch…"
                    value={unifiedInput}
                    onChange={e => { setUnifiedInput(e.target.value); setShowSuggestions(true); }}
                    onFocus={() => setShowSuggestions(true)}
                />
                 {showSuggestions && (
                    <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 mt-1 rounded-lg shadow-lg max-h-60 overflow-auto z-20">
                        {suggestionsToLink.map(b => (
                            <div
                                key={b.id}
                                className="px-4 py-2 text-lg hover:bg-blue-100 cursor-pointer transition-colors"
                                onClick={() => linkExistingBranch(b)}
                            >
                                Link existing: <span className="font-semibold">{b.name}</span>
                            </div>
                        ))}
                        {unifiedInput.trim() && !suggestionsToLink.some(s => s.name.toLowerCase() === unifiedInput.trim().toLowerCase()) && (
                            <div className="px-4 py-3 text-center text-gray-500 border-t border-gray-200">
                                <button type="submit" className="w-full text-left hover:text-blue-600">
                                    Create new branch: “<strong className="text-green-600">{unifiedInput}</strong>”
                                </button>
                            </div>
                        )}
                    </div>
                )}
              </form>
            </div>

            <div className="flex-1 overflow-auto -mx-6 px-6">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-100 sticky top-0">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Branch</th>
                    {/* NEW: Toggle all checkbox in header */}
                    <th className="px-6 py-3 text-center text-sm font-semibold text-gray-600 uppercase tracking-wider">
                      <label className="flex items-center justify-center gap-2 cursor-pointer">
                        <input 
                            type="checkbox"
                            className="form-checkbox h-5 w-5 rounded border-gray-300 text-yellow-500 focus:ring-yellow-500"
                            checked={areAllNotTested}
                            onChange={handleToggleAllNotTested}
                            disabled={filteredLinkedBranches.length === 0}
                         />
                        Not Tested
                      </label>
                    </th>
                    <th className="px-6 py-3 text-center text-sm font-semibold text-gray-600 uppercase tracking-wider">PIN</th>
                    <th className="px-6 py-3 text-center text-sm font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {loadingBranches ? (
                    <tr><td colSpan={4} className="p-8 text-center text-xl text-gray-500"><ArrowPathIcon className="h-7 w-7 animate-spin inline mr-3" />Loading Branches...</td></tr>
                  ) : filteredLinkedBranches.length === 0 ? (
                    <tr><td colSpan={4} className="p-8 text-center text-xl text-gray-500">No branches linked. Use the input above to add one.</td></tr>
                  ) : filteredLinkedBranches.map(b => (
                    <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-lg">
                        {editingBranchId === b.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              className="border-2 border-blue-500 bg-white rounded px-2 py-1 w-full"
                              value={editBranchInputs[b.id] ?? ""}
                              onChange={e => setEditBranchInputs(m => ({ ...m, [b.id]: e.target.value }))}
                              onKeyDown={e => e.key === 'Enter' && handleSaveBranchName(b.id)}
                              onBlur={() => setEditingBranchId(null)}
                              autoFocus
                            />
                            <button onClick={() => handleSaveBranchName(b.id)} className="text-green-600 hover:text-green-500"><CheckCircleIcon className="h-6 w-6" /></button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            {/* FIX: Use `b.name` which is now correctly mapped */}
                            <span>{b.name}</span>
                            <button onClick={() => handleEditBranch(b)} className="text-gray-400 hover:text-gray-700 transition-colors"><PencilSquareIcon className="h-5 w-5" /></button>
                          </div>
                        )}
                      </td>

                      <td className="px-6 py-4 text-center">
                        <label className="inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={notTestedMap[b.id] ?? false}
                            onChange={() => handleToggleNotTested(b.id)}
                            className="form-checkbox h-6 w-6 rounded border-gray-300 text-yellow-500 focus:ring-yellow-500"
                          />
                        </label>
                      </td>

                      <td className="px-6 py-4 text-center text-lg">
                        {loadingPinMap[b.id] ? (
                          <ArrowPathIcon className="h-5 w-5 animate-spin mx-auto text-gray-400" />
                        ) : pinMap[b.id] != null ? (
                          <div className="flex items-center justify-center gap-2">
                            <code className="bg-gray-200 text-teal-700 px-2 py-1 rounded-md text-base">PIN {pinMap[b.id]}</code>
                            <button onClick={() => handleDeletePin(b.id)} className="text-red-500 hover:text-red-700 transition-colors">
                              <XMarkIcon className="h-5 w-5" />
                            </button>
                          </div>
                        ) : (
                          <form onSubmit={(e) => {e.preventDefault(); handleAddPin(b.id)}} className="inline-flex items-center gap-1">
                            <input
                              type="text"
                              className="w-20 bg-white border-2 border-gray-300 rounded px-2 py-1 text-center focus:border-blue-500"
                              placeholder="Add"
                              value={newPinInputs[b.id] || ""}
                              onChange={e => setNewPinInputs(m => ({ ...m, [b.id]: e.target.value }))}
                            />
                            <button type="submit" className="text-green-600 hover:text-green-500 transition-colors">
                              <PlusIcon className="h-6 w-6" />
                            </button>
                          </form>
                        )}
                      </td>
                      
                      <td className="px-6 py-4 text-center">
                         {confirmDeleteId === b.id ? (
                           <div className="flex justify-center items-center gap-2">
                             <span className="text-yellow-600 font-semibold">Unlink?</span>
                             <button onClick={() => handleUnlinkBranch(b.id)} className="bg-red-600 text-white px-3 py-1 text-sm rounded-md hover:bg-red-500 transition">Yes</button>
                             <button onClick={() => setConfirmDeleteId(null)} className="bg-gray-300 text-gray-800 px-3 py-1 text-sm rounded-md hover:bg-gray-400 transition">No</button>
                           </div>
                         ) : (
                           <button onClick={() => setConfirmDeleteId(b.id)} className="bg-red-100 text-red-700 px-3 py-2 text-sm rounded-lg hover:bg-red-200 hover:text-red-800 transition flex items-center gap-2 mx-auto font-semibold">
                             <TrashIcon className="h-4 w-4" /> Unlink
                           </button>
                         )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}


export { SettingsBranchesPageContent }
export default SettingsBranchesPageContent
