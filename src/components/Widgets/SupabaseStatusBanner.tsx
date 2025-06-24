// /src/components/widgets/SupabaseStatusBanner.tsx
'use client';
import React from "react";

interface SupabaseStatusBannerProps {
  status: string;
}

const SupabaseStatusBanner: React.FC<SupabaseStatusBannerProps> = ({ status }) => {
  if (!status) return null;
  const isError = status.includes("failed");
  return (
    <div
      className={`fixed top-0 left-0 right-0 p-2 text-center text-white z-[100] ${
        isError ? 'bg-red-600' : 'bg-green-600'
      }`}
    >
      {status}
    </div>
  );
};

export default SupabaseStatusBanner;
