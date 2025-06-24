// /src/components/widgets/TestSupabase.tsx
'use client';
import React, { useEffect } from "react";

interface TestSupabaseProps {
  onConnectionResult: (isConnected: boolean, message: string) => void;
}

// Example: Test connection and callback with result
const TestSupabase: React.FC<TestSupabaseProps> = ({ onConnectionResult }) => {
  useEffect(() => {
    // Replace with your Supabase check logic
    const check = async () => {
      try {
        // Example: Pretend to check connection
        // let { data, error } = await supabase.from('some_table').select().limit(1);
        await new Promise(res => setTimeout(res, 500)); // Fake delay
        onConnectionResult(true, "Supabase connected!");
      } catch (e: any) {
        onConnectionResult(false, e.message || "Unknown error");
      }
    };
    check();
    // eslint-disable-next-line
  }, []);

  return null; // This widget is invisible, for logic only
};

export default TestSupabase;
