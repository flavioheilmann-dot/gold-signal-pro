import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a USD value with de-CH grouping. */
export function fmtUsd(n: number, decimals = 0): string {
  return n.toLocaleString("de-CH", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format a Swiss-franc value. */
export function fmtFr(n: number, decimals = 2): string {
  return (
    (n >= 0 ? "" : "-") +
    "Fr " +
    Math.abs(n).toLocaleString("de-CH", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  );
}

export function fmtPct(n: number, decimals = 2): string {
  return (n >= 0 ? "+" : "") + n.toFixed(decimals) + "%";
}

export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
