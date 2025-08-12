'use client'

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  FormEvent,
} from 'react'
import {
  XMarkIcon,
  CheckCircleIcon,
  PencilSquareIcon,
  PlusIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  TrashIcon,
  ArrowUpIcon,
  ArrowDownIcon,
} from '@heroicons/react/24/solid'

// -----------------------------
// Type definitions
// -----------------------------
interface Configuration {
  id: number
  kfb: string
  mac_address: string
  kfbInfo: string[]
}

interface Branch {
  id: number
  name: string
}

interface BranchApiResponse {
  id: string
  branchName: string
  [key: string]: any
}

interface EspPinMappingRow {
  branch_id: number
  pin_number: number
}

interface ConfigBranchRow {
  branch_id: number
  not_tested?: boolean
}

// -----------------------------
// Helper: fetch + JSON wrapper
// -----------------------------
async function fetchJSON<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...opts })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(
      (err as any).error || res.statusText || `Request failed with status ${res.status}`
    )
  }
  return res.json()
}

// -----------------------------
// Small UI helpers
// -----------------------------
function clsx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

type SortKey = 'index' | 'name' | 'pin' | 'not' | 'loose'
type SortDir = 'asc' | 'desc'

// -----------------------------
// Demo wrapper (optional)
// -----------------------------
const App: React.FC = () => {
  const [configId, setConfigId] = useState<number | null>(1)
  const handleNavigateBack = () => setConfigId(null)
  return (
    <SettingsBranchesPageContent onNavigateBack={handleNavigateBack} configId={configId} />
  )
}

// -----------------------------
// Main Page
// -----------------------------
const SettingsBranchesPageContent: React.FC<{
  onNavigateBack: () => void
  configId: number | null
}> = ({ onNavigateBack, configId }) => {
  // --- STATE ---
  const [configs, setConfigs] = useState<Configuration[]>([])
  const [selectedConfig, setSelectedConfig] = useState<Configuration | null>(null)
  const [loadingConfigs, setLoadingConfigs] = useState(true)
  const [selectedKfbInfo, setSelectedKfbInfo] = useState<string | null>(null)
  const [kfbInfoDetails, setKfbInfoDetails] = useState<
    { id: number; kfb_info_value: string }[]
  >([])
  const [unifiedInput, setUnifiedInput] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [allBranches, setAllBranches] = useState<Branch[]>([])
  const [linkedBranches, setLinkedBranches] = useState<Branch[]>([])
  const [loadingBranches, setLoadingBranches] = useState(false)
  const [pinMap, setPinMap] = useState<Record<number, number | null>>({})
  const [loadingPinMap, setLoadingPinMap] = useState<Record<number, boolean>>({})
  const [newPinInputs, setNewPinInputs] = useState<Record<number, string>>({})
  const [notTestedMap, setNotTestedMap] = useState<Record<number, boolean>>({})
  const [looseContactMap, setLooseContactMap] = useState<Record<number, boolean>>({})
  const [editingBranchId, setEditingBranchId] = useState<number | null>(null)
  const [editBranchInputs, setEditBranchInputs] = useState<Record<number, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  // Excel-ish bits
  const [sortKey, setSortKey] = useState<SortKey>('index')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [dense, setDense] = useState(true)

  const suggestionBoxRef = useRef<HTMLDivElement | null>(null)

  // --- EFFECTS ---

  // 1) Load configs
  useEffect(() => {
    setLoadingConfigs(true)
    setError(null)
    fetchJSON<Configuration[]>('/api/configurations')
      .then((data) => setConfigs(data))
      .catch((err) => setError(`Failed to load configurations: ${err.message}`))
      .finally(() => setLoadingConfigs(false))
  }, [])

  // 1.2) Auto-select config by prop
  useEffect(() => {
    if (!loadingConfigs && configId !== null) {
      const found = configs.find((c) => c.id === configId) ?? null
      setSelectedConfig(found)
      setSelectedKfbInfo(null)
      setLinkedBranches([])
      setPinMap({})
      setNotTestedMap({})
      setLooseContactMap({})
      setUnifiedInput('')
      setEditingBranchId(null)
    }
  }, [configs, loadingConfigs, configId])

  // 1.3) Load KFB info for selected config
  useEffect(() => {
    if (!selectedConfig) {
      setKfbInfoDetails([])
      return
    }
    setError(null)
    fetchJSON<{ id: number; kfb_info_value: string }[]>(
      `/api/kfb_info_details?configId=${selectedConfig.id}`
    )
      .then((rows) => setKfbInfoDetails(rows))
      .catch((err) => setError(`Failed to load KFB info details: ${err.message}`))
  }, [selectedConfig])

  // 2) Load all branches (for linking suggestions)
  useEffect(() => {
    if (!selectedConfig) {
      setAllBranches([])
      return
    }
    setError(null)
    fetchJSON<BranchApiResponse[]>(`/api/branches?kfb=${selectedConfig.kfb}`)
      .then((data) => {
        const adapted: Branch[] = data.map((b) => ({ id: Number(b.id), name: b.branchName }))
        setAllBranches(adapted)
      })
      .catch((err) => setError(`Failed to load branch list: ${err.message}`))
  }, [selectedConfig])

  // 3) Load linked branches & pins when selection changes
  useEffect(() => {
    if (!selectedConfig || !selectedKfbInfo) {
      setLinkedBranches([])
      setPinMap({})
      setNotTestedMap({})
      setLooseContactMap({})
      return
    }
    const detail = kfbInfoDetails.find((d) => d.kfb_info_value === selectedKfbInfo)
    if (!detail) return

    setLoadingBranches(true)
    setError(null)

    const run = async () => {
      try {
        const configBranchRows = await fetchJSON<ConfigBranchRow[]>(
          `/api/config_branches?configId=${selectedConfig.id}&detailId=${detail.id}`
        )

        const notMap: Record<number, boolean> = {}
        const branchIds = configBranchRows.map((r) => {
          notMap[r.branch_id] = r.not_tested ?? false
          return r.branch_id
        })
        setNotTestedMap(notMap)

        if (branchIds.length === 0) {
          setLinkedBranches([])
          setPinMap({})
          setLooseContactMap({})
          setLoadingBranches(false)
          return
        }

        const linked = await fetchJSON<BranchApiResponse[]>(
          `/api/branches?ids=${branchIds.join(',')}`
        )
        const adaptedLinked: Branch[] = linked.map((b) => ({
          id: Number(b.id),
          name: b.branchName,
        }))
        setLinkedBranches(adaptedLinked)

        const loose: Record<number, boolean> = {}
        linked.forEach((b) => {
          loose[Number(b.id)] = !!b.looseContact
        })
        setLooseContactMap(loose)

        const pinRows = await fetchJSON<EspPinMappingRow[]>(
          `/api/esp_pin_mappings?detailId=${detail.id}`
        )
        const newPinMap: Record<number, number | null> = {}
        adaptedLinked.forEach((b) => (newPinMap[b.id] = null))
        pinRows.forEach((r) => {
          newPinMap[r.branch_id] = r.pin_number
        })
        setPinMap(newPinMap)
      } catch (err: any) {
        setError(`Failed to load branch data: ${err.message}`)
        setLinkedBranches([])
        setPinMap({})
        setNotTestedMap({})
        setLooseContactMap({})
      } finally {
        setLoadingBranches(false)
      }
    }
    run()
  }, [selectedConfig, selectedKfbInfo, kfbInfoDetails, refreshKey])

  // --- MEMO ---

  const suggestionsToLink = useMemo(() => {
    const term = unifiedInput.trim().toLowerCase()
    if (!term || !selectedConfig || !selectedKfbInfo) return []
    const linkedIds = new Set(linkedBranches.map((b) => b.id))
    return allBranches
      .filter((b) => !linkedIds.has(b.id) && b.name.toLowerCase().includes(term))
      .slice(0, 6)
  }, [allBranches, linkedBranches, unifiedInput, selectedConfig, selectedKfbInfo])

  const filteredLinkedBranches = useMemo(() => {
    const term = unifiedInput.trim().toLowerCase()
    if (!term) return linkedBranches
    return linkedBranches.filter((b) => b.name.toLowerCase().includes(term))
  }, [linkedBranches, unifiedInput])

  const areAllNotTested = useMemo(() => {
    if (filteredLinkedBranches.length === 0) return false
    return filteredLinkedBranches.every((b) => notTestedMap[b.id])
  }, [filteredLinkedBranches, notTestedMap])

  const displayRows = useMemo(() => {
    const rows = filteredLinkedBranches.map((b, idx) => ({
      index: idx + 1,
      id: b.id,
      name: b.name,
      pin: pinMap[b.id] ?? null,
      not: !!notTestedMap[b.id],
      loose: !!looseContactMap[b.id],
    }))
    const dir = sortDir === 'asc' ? 1 : -1

    rows.sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return a.name.localeCompare(b.name) * dir
        case 'pin':
          return ((a.pin ?? Number.POSITIVE_INFINITY) - (b.pin ?? Number.POSITIVE_INFINITY)) * dir
        case 'not':
          return (Number(a.not) - Number(b.not)) * dir
        case 'loose':
          return (Number(a.loose) - Number(b.loose)) * dir
        default:
          return (a.index - b.index) * dir
      }
    })
    return rows
  }, [filteredLinkedBranches, pinMap, notTestedMap, looseContactMap, sortKey, sortDir])

  // --- ACTIONS ---

  const triggerRefresh = () => setRefreshKey((k) => k + 1)

  const handleSelectConfig = useCallback(
    (idStr: string) => {
      const id = Number(idStr)
      const c = configs.find((x) => x.id === id) ?? null
      setSelectedConfig(c)
      setSelectedKfbInfo(null)
      setLinkedBranches([])
      setUnifiedInput('')
    },
    [configs]
  )

  const handleSelectKfbInfo = useCallback((val: string) => {
    setSelectedKfbInfo(val)
    setUnifiedInput('')
  }, [])

  const handleToggleNotTested = useCallback(
    async (branchId: number) => {
      const detail = kfbInfoDetails.find((d) => d.kfb_info_value === selectedKfbInfo)
      if (!detail) return
      const oldState = notTestedMap[branchId] || false
      const newState = !oldState
      setNotTestedMap((m) => ({ ...m, [branchId]: newState }))

      try {
        await fetchJSON(`/api/config_branches/${detail.id}/${branchId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ not_tested: newState }),
        })
      } catch (err: any) {
        setError(err.message)
        setNotTestedMap((m) => ({ ...m, [branchId]: oldState }))
      }
    },
    [selectedKfbInfo, kfbInfoDetails, notTestedMap]
  )

  const handleToggleAllNotTested = useCallback(async () => {
    const detail = kfbInfoDetails.find((d) => d.kfb_info_value === selectedKfbInfo)
    if (!detail || filteredLinkedBranches.length === 0) return
    const newGlobalState = filteredLinkedBranches.some((b) => !notTestedMap[b.id])
    const originalMap = { ...notTestedMap }
    const newMap = { ...notTestedMap }
    filteredLinkedBranches.forEach((b) => {
      newMap[b.id] = newGlobalState
    })
    setNotTestedMap(newMap)

    try {
      await Promise.all(
        filteredLinkedBranches.map((b) =>
          fetchJSON(`/api/config_branches/${detail.id}/${b.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ not_tested: newGlobalState }),
          })
        )
      )
    } catch (err: any) {
      setError(`Failed to update all branches: ${err.message}. Reverting.`)
      setNotTestedMap(originalMap)
    }
  }, [filteredLinkedBranches, notTestedMap, kfbInfoDetails, selectedKfbInfo])

  const handleToggleLooseContact = useCallback(
    async (branchId: number) => {
      const detail = kfbInfoDetails.find((d) => d.kfb_info_value === selectedKfbInfo)
      if (!detail) return
      const oldLoose = looseContactMap[branchId]
      const newLoose = !oldLoose
      const currentNot = notTestedMap[branchId] ?? false
      setLooseContactMap((m) => ({ ...m, [branchId]: newLoose }))

      try {
        await fetchJSON(`/api/config_branches/${detail.id}/${branchId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ loose_contact: newLoose, not_tested: currentNot }),
        })
      } catch (err: any) {
        setError(err.message)
        setLooseContactMap((m) => ({ ...m, [branchId]: oldLoose }))
      }
    },
    [looseContactMap, notTestedMap, kfbInfoDetails, selectedKfbInfo]
  )

  const handleToggleAllLooseContact = useCallback(async () => {
    const detail = kfbInfoDetails.find((d) => d.kfb_info_value === selectedKfbInfo)
    if (!detail || filteredLinkedBranches.length === 0) return
    const newLoose = filteredLinkedBranches.some((b) => !looseContactMap[b.id])
    const origLoose = { ...looseContactMap }

    setLooseContactMap((m) => {
      filteredLinkedBranches.forEach((b) => (m[b.id] = newLoose))
      return { ...m }
    })

    try {
      await Promise.all(
        filteredLinkedBranches.map((b) =>
          fetchJSON(`/api/config_branches/${detail.id}/${b.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              loose_contact: newLoose,
              not_tested: notTestedMap[b.id] ?? false,
            }),
          })
        )
      )
    } catch (err: any) {
      setError(`Failed to update loose-contact: ${err.message}`)
      setLooseContactMap(origLoose)
    }
  }, [filteredLinkedBranches, looseContactMap, notTestedMap, kfbInfoDetails, selectedKfbInfo])

  const linkExistingBranch = async (b: Branch) => {
    const detail = kfbInfoDetails.find((d) => d.kfb_info_value === selectedKfbInfo)
    if (!selectedConfig || !detail) return setError('A KFB and Info must be selected.')
    if (linkedBranches.some((x) => x.id === b.id)) return

    try {
      await fetchJSON('/api/config_branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config_id: selectedConfig.id,
          kfb_info_detail_id: detail.id,
          branch_id: b.id,
        }),
      })
      setUnifiedInput('')
      setShowSuggestions(false)
      triggerRefresh()
    } catch (err: any) {
      setError(`Failed to link branch: ${err.message}`)
    }
  }

  const createAndLinkBranch = async () => {
    const detail = kfbInfoDetails.find((d) => d.kfb_info_value === selectedKfbInfo)
    if (!selectedConfig || !detail) return setError('A KFB and Info must be selected.')
    const name = unifiedInput.trim()
    if (!name) return setError('Branch name cannot be empty.')
    if (allBranches.some((b) => b.name.toLowerCase() === name.toLowerCase())) {
      return setError(
        'A branch with this name already exists. Please select it from the suggestions to link it.'
      )
    }

    try {
      const newBranchData = await fetchJSON<BranchApiResponse>('/api/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const newBranch = { id: Number(newBranchData.id), name: newBranchData.branchName }
      setAllBranches((a) => [...a, newBranch])

      await fetchJSON('/api/config_branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config_id: selectedConfig.id,
          kfb_info_detail_id: detail.id,
          branch_id: newBranch.id,
        }),
      })

      setUnifiedInput('')
      setShowSuggestions(false)
      triggerRefresh()
    } catch (err: any) {
      setError(`Failed to create and link branch: ${err.message}`)
    }
  }

  const handleEditBranch = (b: Branch) => {
    setEditingBranchId(b.id)
    setEditBranchInputs((m) => ({ ...m, [b.id]: b.name }))
    setError(null)
  }

  const handleSaveBranchName = async (branchId: number) => {
    const name = (editBranchInputs[branchId] || '').trim()
    if (!name) return setError('Branch name cannot be empty.')

    const originalBranch = allBranches.find((b) => b.id === branchId)
    if (!originalBranch || originalBranch.name === name) {
      setEditingBranchId(null)
      return
    }

    try {
      await fetchJSON(`/api/branches/${branchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      setAllBranches((arr) => arr.map((b) => (b.id === branchId ? { ...b, name } : b)))
      setLinkedBranches((arr) => arr.map((b) => (b.id === branchId ? { ...b, name } : b)))
      setEditingBranchId(null)
    } catch (err: any) {
      setError(`Failed to rename branch: ${err.message}`)
    }
  }

  const handleDeletePin = async (branchId: number) => {
    const detail = kfbInfoDetails.find((d) => d.kfb_info_value === selectedKfbInfo)
    const pin = pinMap[branchId]
    if (!detail || pin == null) return
    try {
      await fetch(`/api/esp_pin_mappings?detailId=${detail.id}&branchId=${branchId}&pinNumber=${pin}`, {
        method: 'DELETE',
      })
      setPinMap((m) => ({ ...m, [branchId]: null }))
    } catch (err: any) {
      setError(`Failed to delete PIN: ${err.message}`)
    }
  }

  const handleAddPin = async (branchId: number) => {
    const detail = kfbInfoDetails.find((d) => d.kfb_info_value === selectedKfbInfo)
    if (!selectedConfig || !detail) return
    if (pinMap[branchId] != null) return setError('A PIN is already assigned. Please delete it first.')
    const pinValue = (newPinInputs[branchId] || '').trim()
    if (!pinValue) return setError('PIN number cannot be empty.')
    const pinNumber = parseInt(pinValue, 10)
    if (isNaN(pinNumber)) return setError('Invalid PIN. Must be an integer.')

    setLoadingPinMap((m) => ({ ...m, [branchId]: true }))
    try {
      await fetchJSON('/api/esp_pin_mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config_id: selectedConfig.id,
          kfb_info_detail_id: detail.id,
          branch_id: branchId,
          pin_number: pinNumber,
        }),
      })
      setPinMap((m) => ({ ...m, [branchId]: pinNumber }))
      setNewPinInputs((m) => ({ ...m, [branchId]: '' }))
    } catch (err: any) {
      setError(`Failed to add PIN: ${err.message}`)
    } finally {
      setLoadingPinMap((m) => ({ ...m, [branchId]: false }))
    }
  }

  const handleUnlinkBranch = async (branchId: number) => {
    const detail = kfbInfoDetails.find((d) => d.kfb_info_value === selectedKfbInfo)
    if (!detail) return
    try {
      await fetch(`/api/config_branches?detailId=${detail.id}&branchId=${branchId}`, {
        method: 'DELETE',
      })
      await fetch(`/api/esp_pin_mappings?detailId=${detail.id}&branchId=${branchId}`, {
        method: 'DELETE',
      })
      triggerRefresh()
    } catch (err: any) {
      setError(`Failed to unlink branch: ${err.message}`)
    } finally {
      setConfirmDeleteId(null)
    }
  }

  // UX: hide suggestion box when clicking away
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (suggestionBoxRef.current && !suggestionBoxRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  // --- RENDER ---

  if (loadingConfigs) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-100 text-gray-800">
        <ArrowPathIcon className="h-10 w-10 animate-spin mr-4" />
        <p className="text-2xl">Loading Configurations…</p>
      </div>
    )
  }

  const headerCell =
    'px-3 py-2 text-[13px] font-medium text-slate-700 bg-slate-50 border-b border-slate-200 sticky top-0 z-10'
  const cellBase = clsx(
    'px-3',
    dense ? 'py-1.5' : 'py-2.5',
    'text-[13px] text-slate-900 bg-white border-b border-slate-200'
  )

  const SortIcon = ({ active }: { active: boolean }) =>
    active ? (
      sortDir === 'asc' ? (
        <ArrowUpIcon className="ml-1 h-3.5 w-3.5 opacity-70" />
      ) : (
        <ArrowDownIcon className="ml-1 h-3.5 w-3.5 opacity-70" />
      )
    ) : (
      <span className="ml-1 inline-block w-3.5" />
    )

  const clickSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  return (
    <div className="flex h-screen w-full flex-col bg-slate-100 text-slate-900 p-3 sm:p-6">
      <div className="w-full mx-auto flex-grow bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 px-3 sm:px-4 py-2 border-b border-slate-200 bg-slate-50">
          <h1 className="text-xl font-semibold">Branch Configuration</h1>
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 text-[13px] text-slate-600">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={dense}
                onChange={() => setDense((v) => !v)}
              />
              Compact rows
            </label>
          </div>
        </div>

        {/* Pickers */}
        <div className="grid md:grid-cols-2 gap-3 sm:gap-4 p-3 sm:p-4">
          <section className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-[13px] mb-1 text-slate-600">1. Select KFB Number</div>
            <select
              className="w-full rounded border border-slate-300 bg-white text-[14px] p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedConfig ? String(selectedConfig.id) : ''}
              onChange={(e) => handleSelectConfig(e.target.value)}
            >
              <option disabled value="">
                -- Select a KFB --
              </option>
              {configs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.kfb}
                </option>
              ))}
            </select>
          </section>

          <section
            className={clsx(
              'rounded-lg p-3 border',
              selectedConfig ? 'bg-white border-slate-200' : 'bg-slate-100 border-slate-200/60'
            )}
          >
            <div className="text-[13px] mb-1 text-slate-600">2. Select KFB Info</div>
            <select
              className="w-full rounded border border-slate-300 bg-white text-[14px] p-2 disabled:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedKfbInfo || ''}
              onChange={(e) => handleSelectKfbInfo(e.target.value)}
              disabled={!selectedConfig || kfbInfoDetails.length === 0}
            >
              <option disabled value="">
                {selectedConfig
                  ? kfbInfoDetails.length > 0
                    ? '-- Select Info --'
                    : 'No info available'
                  : 'Select KFB first'}
              </option>
              {kfbInfoDetails.map((d) => (
                <option key={d.id} value={d.kfb_info_value}>
                  {d.kfb_info_value}
                </option>
              ))}
            </select>
          </section>
        </div>

        {error && (
          <div className="mx-3 sm:mx-4 -mt-1 mb-2 rounded-md border border-red-300 bg-red-50 p-3 text-red-800 text-sm">
            <div className="flex items-start gap-2">
              <ExclamationTriangleIcon className="h-5 w-5 mt-0.5" />
              <div className="flex-1">
                <div className="font-medium">An error occurred</div>
                <div>{error}</div>
              </div>
              <button onClick={() => setError(null)} className="text-red-600 hover:text-red-800">
                &times;
              </button>
            </div>
          </div>
        )}

        {/* Grid */}
        {selectedConfig && selectedKfbInfo && (
          <section className="flex-1 flex flex-col min-h-0 px-3 sm:px-4 pb-3 sm:pb-4">
            {/* Filter / create */}
            <div className="relative mb-2" ref={suggestionBoxRef}>
              <form
                onSubmit={(e: FormEvent) => {
                  e.preventDefault()
                  createAndLinkBranch()
                }}
              >
                <input
                  type="text"
                  className="w-full rounded border border-slate-300 bg-white text-[14px] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Filter, link, or create branch…"
                  value={unifiedInput}
                  onChange={(e) => {
                    setUnifiedInput(e.target.value)
                    setShowSuggestions(true)
                  }}
                  onFocus={() => setShowSuggestions(true)}
                />
                {showSuggestions && (
                  <div className="absolute top-full left-0 right-0 bg-white border border-slate-200 mt-1 rounded shadow-sm max-h-60 overflow-auto z-20">
                    {suggestionsToLink.map((b) => (
                      <div
                        key={b.id}
                        className="px-3 py-2 text-[14px] hover:bg-blue-50 cursor-pointer"
                        onClick={() => linkExistingBranch(b)}
                      >
                        Link existing: <span className="font-medium">{b.name}</span>
                      </div>
                    ))}
                    {unifiedInput.trim() &&
                      !suggestionsToLink.some(
                        (s) => s.name.toLowerCase() === unifiedInput.trim().toLowerCase()
                      ) && (
                        <div className="px-3 py-2 border-t border-slate-200 text-center">
                          <button type="submit" className="text-[14px] hover:text-blue-700">
                            Create new branch: “<strong className="text-green-700">{unifiedInput}</strong>”
                          </button>
                        </div>
                      )}
                  </div>
                )}
              </form>
            </div>

            <div className="relative flex-1 min-h-0 overflow-auto border border-slate-200 rounded">
              <table className="min-w-full table-fixed text-[13px]">
                <colgroup>
                  <col className="w-14" />
                  <col />
                  <col className="w-36" />
                  <col className="w-40" />
                  <col className="w-40" />
                  <col className="w-44" />
                </colgroup>
                <thead>
                  <tr className="select-none">
                    <th className={headerCell}>
                      <button
                        type="button"
                        onClick={() => clickSort('index')}
                        className="inline-flex items-center"
                        title="Sort by row #"
                      >
                        #
                        <SortIcon active={sortKey === 'index'} />
                      </button>
                    </th>
                    <th className={headerCell}>
                      <button
                        type="button"
                        onClick={() => clickSort('name')}
                        className="inline-flex items-center"
                        title="Sort by branch"
                      >
                        Branch
                        <SortIcon active={sortKey === 'name'} />
                      </button>
                    </th>
                    <th className={headerCell}>
                      <label className="flex items-center justify-center gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300"
                          checked={areAllNotTested}
                          onChange={handleToggleAllNotTested}
                          disabled={filteredLinkedBranches.length === 0}
                          title="Toggle all (filtered)"
                        />
                        <span className="inline-flex items-center">
                          Not tested
                          <button
                            type="button"
                            onClick={() => clickSort('not')}
                            className="ml-1 inline-flex items-center"
                            title="Sort by Not tested"
                          >
                            <SortIcon active={sortKey === 'not'} />
                          </button>
                        </span>
                      </label>
                    </th>
                    <th className={headerCell}>
                      <label className="flex items-center justify-center gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300"
                          checked={
                            filteredLinkedBranches.length > 0 &&
                            filteredLinkedBranches.every((b) => looseContactMap[b.id])
                          }
                          onChange={handleToggleAllLooseContact}
                          disabled={filteredLinkedBranches.length === 0}
                          title="Toggle all (filtered)"
                        />
                        <span className="inline-flex items-center">
                          Loose contact
                          <button
                            type="button"
                            onClick={() => clickSort('loose')}
                            className="ml-1 inline-flex items-center"
                            title="Sort by Loose contact"
                          >
                            <SortIcon active={sortKey === 'loose'} />
                          </button>
                        </span>
                      </label>
                    </th>
                    <th className={headerCell}>
                      <button
                        type="button"
                        onClick={() => clickSort('pin')}
                        className="inline-flex items-center"
                        title="Sort by PIN"
                      >
                        PIN
                        <SortIcon active={sortKey === 'pin'} />
                      </button>
                    </th>
                    <th className={headerCell}>Actions</th>
                  </tr>
                </thead>

                <tbody className="[&_tr:nth-child(odd)]:bg-slate-50/40">
                  {loadingBranches ? (
                    <tr>
                      <td colSpan={6} className="text-center py-6 text-slate-500">
                        <ArrowPathIcon className="h-5 w-5 animate-spin inline mr-2" />
                        Loading branches…
                      </td>
                    </tr>
                  ) : displayRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-6 text-slate-500">
                        No branches linked. Use the input above to add one.
                      </td>
                    </tr>
                  ) : (
                    displayRows.map((r) => (
                      <tr
                        key={r.id}
                        className="hover:bg-emerald-50/70 transition-colors"
                      >
                        <td className={clsx(cellBase, 'text-slate-500 text-right pr-4 font-mono')}>
                          {r.index}
                        </td>

                        <td className={cellBase}>
                          {editingBranchId === r.id ? (
                            <div className="flex items-center gap-2">
                              <input
                                className="border border-blue-500 bg-white rounded px-2 py-1 w-full text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={editBranchInputs[r.id] ?? ''}
                                onChange={(e) =>
                                  setEditBranchInputs((m) => ({ ...m, [r.id]: e.target.value }))
                                }
                                onKeyDown={(e) => e.key === 'Enter' && handleSaveBranchName(r.id)}
                                onBlur={() => setEditingBranchId(null)}
                                autoFocus
                              />
                              <button
                                onClick={() => handleSaveBranchName(r.id)}
                                className="text-green-600 hover:text-green-500"
                                title="Save"
                              >
                                <CheckCircleIcon className="h-5 w-5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="truncate">{r.name}</span>
                              <button
                                onClick={() =>
                                  handleEditBranch({ id: r.id, name: r.name })
                                }
                                className="text-slate-400 hover:text-slate-700"
                                title="Rename"
                              >
                                <PencilSquareIcon className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </td>

                        <td className={clsx(cellBase, 'text-center')}>
                          <input
                            type="checkbox"
                            checked={r.not}
                            onChange={() => handleToggleNotTested(r.id)}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                        </td>

                        <td className={clsx(cellBase, 'text-center')}>
                          <input
                            type="checkbox"
                            checked={r.loose}
                            onChange={() => handleToggleLooseContact(r.id)}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                        </td>

                        <td className={clsx(cellBase, 'text-center font-mono')}>
                          {loadingPinMap[r.id] ? (
                            <ArrowPathIcon className="h-4 w-4 animate-spin mx-auto text-slate-400" />
                          ) : r.pin != null ? (
                            <div className="inline-flex items-center gap-2">
                              <code className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200">
                                PIN {r.pin}
                              </code>
                              <button
                                onClick={() => handleDeletePin(r.id)}
                                className="text-red-600 hover:text-red-700"
                                title="Remove PIN"
                              >
                                <XMarkIcon className="h-4 w-4" />
                              </button>
                            </div>
                          ) : (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault()
                                handleAddPin(r.id)
                              }}
                              className="inline-flex items-center gap-1"
                            >
                              <input
                                type="text"
                                className="w-16 text-center bg-white border border-slate-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Add"
                                value={newPinInputs[r.id] || ''}
                                onChange={(e) =>
                                  setNewPinInputs((m) => ({ ...m, [r.id]: e.target.value }))
                                }
                              />
                              <button
                                type="submit"
                                className="text-green-600 hover:text-green-500"
                                title="Add PIN"
                              >
                                <PlusIcon className="h-5 w-5" />
                              </button>
                            </form>
                          )}
                        </td>

                        <td className={clsx(cellBase, 'text-center')}>
                          {confirmDeleteId === r.id ? (
                            <div className="inline-flex items-center gap-2">
                              <span className="text-amber-700 font-medium">Unlink?</span>
                              <button
                                onClick={() => handleUnlinkBranch(r.id)}
                                className="bg-red-600 text-white px-2 py-1 rounded hover:bg-red-500 text-[12px]"
                              >
                                Yes
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="bg-slate-200 text-slate-800 px-2 py-1 rounded hover:bg-slate-300 text-[12px]"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(r.id)}
                              className="mx-auto inline-flex items-center gap-1.5 bg-red-50 text-red-700 px-3 py-1.5 rounded border border-red-200 hover:bg-red-100 text-[12px] font-medium"
                            >
                              <TrashIcon className="h-4 w-4" /> Unlink
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Status bar */}
            <div className="mt-2 text-[12px] text-slate-600 flex items-center justify-between">
              <div>
                Rows: <span className="font-medium">{displayRows.length}</span>{' '}
                {unifiedInput ? (
                  <span className="text-slate-500">
                    (filtered from {linkedBranches.length})
                  </span>
                ) : null}
              </div>
              <div className="text-slate-500">
                Sort: <span className="font-medium">{sortKey}</span> ({sortDir})
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

export { SettingsBranchesPageContent }
export default SettingsBranchesPageContent
