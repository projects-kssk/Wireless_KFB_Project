import React, {
  useState,
  useEffect,
  useCallback,
  FormEvent,
} from 'react'

import type { TestStatus, BranchDisplayData } from '@/types/types'
import { appConfig }                       from '@/components/config/appConfig'
import { Header }                          from '@/components/Header/Header'
import { SettingsRightSidebar }            from '@/components/Settings/SettingsRightSidebar'
import { SettingsPageContent }             from '@/components/Settings/SettingsPageContent'
import { SettingsBranchesPageContent }     from '@/components/Settings/SettingsBranchesPageContent'
import { BranchControlSidebar }            from '@/components/Program/BranchControlSidebar'
import { BranchDashboardMainContent }      from '@/components/Program/BranchDashboardMainContent'

const SIDEBAR_WIDTH = '24rem'
type MainView = 'dashboard' | 'settingsConfiguration' | 'settingsBranches'

const MainApplicationUI: React.FC = () => {
  // navigation
  const [isLeftSidebarOpen, setIsLeftSidebarOpen]       = useState(false)
  const [isSettingsSidebarOpen, setIsSettingsSidebarOpen] = useState(false)
  const [mainView, setMainView]                         = useState<MainView>('dashboard')

  // data
  const [branchesData, setBranchesData] = useState<BranchDisplayData[]>([])
  const [kfbNumber, setKfbNumber]       = useState<string>('')
  const [macAddress, setMacAddress]     = useState<string>('')
  const [isScanning, setIsScanning]     = useState(false)

  // settings view
  const [currentConfigIdForProgram, setCurrentConfigIdForProgram] =
    useState<number | null>(null)

  // KFB input
  const [kfbInput, setKfbInput] = useState<string>('IW0160029')

  //
  // 1) LOAD + MONITOR
  //
  const loadBranchesData = useCallback(async () => {
    if (!kfbInput) return
    setIsScanning(true)

    try {
      // a) fetch branches
      const br = await fetch(`/api/branches?kfb=${encodeURIComponent(kfbInput)}`)
      if (!br.ok) throw new Error(await br.text())
      const branches: BranchDisplayData[] = await br.json()
      setBranchesData(branches)
      setKfbNumber(kfbInput)

      // b) fetch config → MAC
      const cfg = await fetch(`/api/configurations?kfb=${encodeURIComponent(kfbInput)}`)
      if (!cfg.ok) throw new Error(await cfg.text())
      const { mac_address } = await cfg.json()
      setMacAddress(mac_address)

      // c) extract pins
      const pins = branches
        .map(b => b.pinNumber)
        .filter((p): p is number => typeof p === 'number')

      console.log('▶️ MONITOR pins:', pins, 'MAC:', mac_address)

      // d) POST /api/serial → MONITOR
      await fetch('/api/serial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pins, mac: mac_address }),
      })
    } catch (err: any) {
      console.error('Load/MONITOR error:', err)
      // clear on failure
      setBranchesData([])
      setKfbNumber('')
      setMacAddress('')
    } finally {
      setTimeout(() => setIsScanning(false), 500)
    }
  }, [kfbInput])

  //
  // 2) ON-DEMAND CHECK
  //
  const handleCheck = useCallback(async () => {
    if (!macAddress) return
    setIsScanning(true)

    try {
      // same pin list
      const pins = branchesData
        .map(b => b.pinNumber)
        .filter((p): p is number => typeof p === 'number')

      const res = await fetch('/api/serial/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pins, mac: macAddress }),
      })
      if (!res.ok) throw new Error(await res.text())
      const { failures }: { failures: number[] } = await res.json()

      if (failures.length === 0) {
        // total success → briefly mark OK, then reset everything
        setBranchesData(prev =>
          prev.map(b => ({ ...b, testStatus: 'ok' }))
        )
        await new Promise(r => setTimeout(r, 1000))
        // clear UI
        setBranchesData([])
        setKfbNumber('')
        setMacAddress('')
      } else {
        // mark individual not-ok vs ok
        setBranchesData(prev =>
          prev.map(b => ({
            ...b,
            testStatus: failures.includes(b.pinNumber ?? -1) ? 'nok' : 'ok',
          }))
        )
      }
    } catch (err) {
      console.error('CHECK error:', err)
    } finally {
      setTimeout(() => setIsScanning(false), 500)
    }
  }, [branchesData, macAddress])

  // auto-load on KFB change
  useEffect(() => {
    loadBranchesData()
  }, [loadBranchesData])

  // manual override
  const handleSetBranchStatus = useCallback(
    (branchId: string, newStatus: TestStatus) => {
      setBranchesData(prev =>
        prev.map(b => (b.id === branchId ? { ...b, testStatus: newStatus } : b))
      )
    },
    []
  )

  // form submit
  const handleKfbSubmit = (e: FormEvent) => {
    e.preventDefault()
    loadBranchesData()
  }

  // navigation / resizing…
  const toggleLeftSidebar     = () => setIsLeftSidebarOpen(v => !v)
  const toggleSettingsSidebar = () => setIsSettingsSidebarOpen(v => !v)
  const showDashboard         = () => setMainView('dashboard')
  const showConfigurationInMain = () => {
    setMainView('settingsConfiguration')
    setIsLeftSidebarOpen(false)
  }
  const showBranchesSettingsInMain = (configId?: number) => {
    if (typeof configId === 'number') setCurrentConfigIdForProgram(configId)
    setMainView('settingsBranches')
    setIsLeftSidebarOpen(false)
  }

  const [windowWidth, setWindowWidth] = useState(0)
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const appCurrentViewType =
    mainView === 'settingsConfiguration' || mainView === 'settingsBranches'
      ? 'settings'
      : 'main'

  const handleHeaderMainButtonClick = () => {
    if (appCurrentViewType === 'settings') {
      showDashboard()
      setIsSettingsSidebarOpen(false)
    } else {
      toggleSettingsSidebar()
    }
  }

  const actualHeaderHeight = appConfig.hideHeader ? '0rem' : '0rem'
  const shouldLeftSidebarAffectLayout =
    mainView === 'dashboard' && isLeftSidebarOpen && windowWidth >= 1024

  return (
    <div className="relative min-h-screen w-full bg-slate-100 dark:bg-slate-900 flex overflow-hidden">
      {mainView === 'dashboard' && (
        <BranchControlSidebar
          isOpen={isLeftSidebarOpen}
          toggleSidebar={toggleLeftSidebar}
          branches={branchesData}
          onSetStatus={handleSetBranchStatus}
          sidebarWidthProvided={SIDEBAR_WIDTH}
          appHeaderHeight={actualHeaderHeight}
        />
      )}

      <div
        className="flex flex-1 flex-col transition-all duration-300 ease-in-out overflow-hidden"
        style={{ marginLeft: shouldLeftSidebarAffectLayout ? SIDEBAR_WIDTH : 0 }}
      >
        <Header
          onSettingsClick={handleHeaderMainButtonClick}
          currentView={appCurrentViewType}
          isSidebarOpen={isLeftSidebarOpen && mainView === 'dashboard'}
          onToggleSidebar={toggleLeftSidebar}
        />

        {mainView === 'dashboard' && (
          <form
            onSubmit={handleKfbSubmit}
            className="p-4 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 flex gap-2 items-center"
          >
            <label className="font-medium text-gray-700 dark:text-slate-200">
              KFB:
            </label>
            <input
              type="text"
              value={kfbInput}
              onChange={e => setKfbInput(e.target.value)}
              placeholder="IW0160029"
              className="
                px-2 py-1 bg-gray-100 dark:bg-slate-700
                text-gray-900 dark:text-gray-100
                border border-gray-300 dark:border-slate-600
                rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500
                placeholder-gray-500
              "
            />
            <button
              type="submit"
              className="px-3 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-60"
              disabled={isScanning}
            >
              {isScanning ? 'Loading…' : 'Load'}
            </button>
            <button
              type="button"
              onClick={handleCheck}
              className="px-3 py-1 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-60"
              disabled={isScanning || !macAddress}
            >
              {isScanning ? 'Checking…' : 'Check'}
            </button>
            <span className="ml-auto font-semibold text-gray-700 dark:text-slate-200">
              Loaded KFB: {kfbNumber || '—'}
            </span>
          </form>
        )}

        <main
          className="flex-1 bg-gray-50 dark:bg-slate-900 overflow-y-auto"
          style={{ overflowX: 'hidden' }}
        >
          {mainView === 'dashboard' ? (
            <BranchDashboardMainContent
              appHeaderHeight={actualHeaderHeight}
              branchesData={branchesData}
              kfbNumber={kfbNumber}
              onScanAgainRequest={loadBranchesData}
              isScanning={isScanning}
            />
          ) : mainView === 'settingsConfiguration' ? (
            <SettingsPageContent
              onNavigateBack={showDashboard}
              onShowProgramForConfig={showBranchesSettingsInMain}
            />
          ) : (
            <SettingsBranchesPageContent
              onNavigateBack={showDashboard}
              configId={currentConfigIdForProgram}
            />
          )}
        </main>
      </div>

      <SettingsRightSidebar
        isOpen={isSettingsSidebarOpen}
        onClose={() => setIsSettingsSidebarOpen(false)}
        appHeaderHeight={actualHeaderHeight}
        onShowConfigurationInMain={showConfigurationInMain}
        onShowBranchesSettingsInMain={() => showBranchesSettingsInMain()}
      />
    </div>
  )
}

export default MainApplicationUI
