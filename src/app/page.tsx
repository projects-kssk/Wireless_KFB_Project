// app/page.tsx    (or wherever your “Home” component lives)

'use client'

import React from "react";
import MainApplicationUI from "@/components/Layout/MainApplicationUI";

export default function Home() {
  return (
    <main>
      <MainApplicationUI />
    </main>
  );
}
