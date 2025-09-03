// app/page.tsx    (or wherever your “Home” component lives)
'use client';
import MotionPage from './motion-page';
import React from "react";
import MainApplicationUI from "@/components/Layout/MainApplicationUI";
export default function Home() {
    return (<MotionPage> 
    <main>
      <MainApplicationUI />
    </main>
    </MotionPage>);
}
