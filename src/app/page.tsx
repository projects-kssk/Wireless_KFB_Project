// app/page.tsx    (or wherever your “Home” component lives)

'use client'
import MotionPage from './motion-page'
import React, { useEffect, useMemo, useState } from "react";
import MainApplicationUI from "@/components/Layout/MainApplicationUI";
import ZoomControls from "@/components/Controls/ZoomControls";
import SimulateCheckBar from "@/components/Dev/SimulateCheckBar";

export default function Home() {
  const [zoom, setZoom] = useState(1)
  // Ctrl/Cmd + wheel zoom like a browser, React-only
  useEffect(() => {
    const clamp = (v: number) => Math.min(2, Math.max(0.5, v))
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || (e as any).metaKey)) return
      try { e.preventDefault() } catch {}
      const step = 0.1
      setZoom((z) => clamp(z + (e.deltaY > 0 ? -step : step)))
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])
  const zoomStyle = useMemo(() => ({
    transform: `scale(${zoom})`,
    transformOrigin: '0 0',
    width: `${100 / zoom}%`,
    height: `${100 / zoom}%`,
  }), [zoom])
  return (
    <MotionPage>
      <SimulateCheckBar />
      <ZoomControls label="Dashboard" position="br" value={zoom} onChange={setZoom} />
      <div style={zoomStyle}>
        <main>
          <MainApplicationUI />
        </main>
      </div>
    </MotionPage>
  );
}
