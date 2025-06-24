// src/components/Modals/FlexibleOtpModal.tsx

import React, { useState, useEffect, useRef } from "react";

// Dummy XMarkIcon component for demo; replace with your actual import
const XMarkIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg width={24} height={24} fill="none" viewBox="0 0 24 24" {...props}>
    <path
      d="M6 6l12 12M6 18L18 6"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

interface OtpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (otp: string) => void;
  attemptsLeft: number;
  errorMessage?: string;
  otpLength: number;
  title?: string;
  promptText?: string;
}

export const FlexibleOtpModal: React.FC<OtpModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  attemptsLeft,
  errorMessage,
  otpLength,
  title = "PIN CODE",
  promptText,
}) => {
  // State to hold each digit of the OTP
  const [otpDigits, setOtpDigits] = useState<string[]>(Array(otpLength).fill(""));

  // Refs array to focus inputs programmatically
  const inputRefs = useRef<Array<HTMLInputElement | null>>(Array(otpLength).fill(null));

  //
  // Whenever 'otpLength' changes, reinitialize both the refs array and the otpDigits array.
  //
  useEffect(() => {
    inputRefs.current = Array(otpLength).fill(null);
    setOtpDigits(Array(otpLength).fill(""));
  }, [otpLength]);

  //
  // Whenever the modal opens (or the length changes while it is already open), reset all digits
  // and focus the first input. We deliberately do NOT reference 'otpDigits' here, so ESLint stops complaining.
  //
  useEffect(() => {
    if (!isOpen) return;

    // Reset all digits
    setOtpDigits(Array(otpLength).fill(""));

    // Wait until DOM updates, then focus the first input
    requestAnimationFrame(() => {
      inputRefs.current[0]?.focus();
    });
  }, [isOpen, otpLength]);

  if (!isOpen) return null;

  const handleChange = (index: number, value: string) => {
    // Only allow a single numeric digit or empty
    if (!/^[0-9]?$/.test(value)) return;

    const newOtp = [...otpDigits];
    newOtp[index] = value;
    setOtpDigits(newOtp);

    // If we typed a digit and it wasn't the last slot, move focus forward
    if (value && index < otpLength - 1) {
      inputRefs.current[index + 1]?.focus();
    } else {
      // Check if all slots are now filled
      const filledOtp = newOtp.join("");
      if (!newOtp.includes("") && filledOtp.length === otpLength) {
        onSubmit(filledOtp);
      }
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const newOtp = [...otpDigits];

      if (newOtp[index]) {
        // If current slot has a digit, clear it
        newOtp[index] = "";
      } else if (index > 0) {
        // If current slot is already empty, clear the previous and move focus back
        newOtp[index - 1] = "";
        inputRefs.current[index - 1]?.focus();
      }

      setOtpDigits(newOtp);
    } else if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < otpLength - 1) {
      e.preventDefault();
      inputRefs.current[index + 1]?.focus();
    }
    // Allow digits, Tab, etc. otherwise
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData?.getData("text/plain").replace(/[^0-9]/g, "") || "";
    if (!pasted) return;

    // Fill as many slots as we can with the pasted string
    const newOtp = Array(otpLength).fill("");
    for (let i = 0; i < Math.min(pasted.length, otpLength); i++) {
      newOtp[i] = pasted[i];
    }
    setOtpDigits(newOtp);

    // If fully filled, submit immediately
    if (!newOtp.includes("") && pasted.length >= otpLength) {
      onSubmit(newOtp.join(""));
    } else {
      // Otherwise focus the first empty slot
      const firstEmpty = newOtp.findIndex((d) => d === "");
      const focusIndex = firstEmpty >= 0 ? firstEmpty : otpLength - 1;
      inputRefs.current[focusIndex]?.focus();
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const candidate = otpDigits.join("");
    if (candidate.length === otpLength && !otpDigits.includes("")) {
      onSubmit(candidate);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 font-sans">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl p-6 sm:p-8 w-full max-w-md sm:max-w-lg md:max-w-xl flex flex-col items-center">
        <div className="w-full flex justify-end mb-2">
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 p-2 rounded-full focus:outline-none focus:ring-2 focus:ring-sky-500"
            aria-label="Close OTP modal"
            type="button"
          >
            <XMarkIcon className="w-8 h-8 sm:w-10 sm:h-10" />
          </button>
        </div>

        <h3 className="text-3xl sm:text-4xl md:text-5xl font-bold text-slate-800 dark:text-slate-100 text-center mb-4">
          {title}
        </h3>

        {promptText && (
          <p className="text-md sm:text-lg text-slate-600 dark:text-slate-400 mb-6 text-center">
            {promptText}
          </p>
        )}

        <form onSubmit={handleFormSubmit} className="w-full flex flex-col items-center">
          <p className="text-xl sm:text-2xl text-slate-500 dark:text-slate-400 mb-8 text-center">
            Attempts left:{" "}
            <span className="font-semibold text-sky-600 dark:text-sky-400">
              {attemptsLeft}
            </span>
          </p>

          <div
            className="flex justify-center space-x-2 sm:space-x-3 md:space-x-4 mb-8 w-full"
            onPaste={handlePaste}
          >
            {otpDigits.map((digit, idx) => (
              <input
                key={idx}
                ref={(el) => {
                  inputRefs.current[idx] = el;
                }}
                type="password"                           // <–– Change here
                value={digit}
                onChange={(e) => handleChange(idx, e.target.value)}
                onKeyDown={(e) => handleKeyDown(idx, e)}
                maxLength={1}
                className="w-14 h-16 sm:w-16 sm:h-20 md:w-20 md:h-24 text-center text-3xl sm:text-4xl md:text-5xl font-semibold bg-slate-100 dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500 caret-sky-500"
                inputMode="numeric"                       // keep numeric keypad
                pattern="[0-9]*"
                autoComplete="one-time-code"
                aria-label={`OTP digit ${idx + 1}`}
              />
            ))}
          </div>

          {errorMessage && (
            <p className="text-lg sm:text-xl text-red-500 dark:text-red-400 mt-4 mb-2 text-center min-h-[1.5rem] sm:min-h-[1.75rem]">
              {errorMessage}
            </p>
          )}

          <button
            type="submit"
            className="w-full mt-4 sm:mt-6 px-6 py-3 bg-sky-600 text-white text-lg sm:text-xl font-semibold rounded-lg hover:bg-sky-700 focus:outline-none focus:ring-4 focus:ring-sky-500 focus:ring-opacity-50 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={otpDigits.includes("") || otpDigits.join("").length !== otpLength}
          >
            Submit
          </button>
        </form>
      </div>
    </div>
  );
};
