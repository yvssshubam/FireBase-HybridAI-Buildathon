// Demo-data switch. Only `npm run dev:web` with VITE_DEMO_DATA=true turns it on;
// `import.meta.env.DEV` is false in production builds, so the demo module is dropped.
import { createContext, useContext } from "react";
import type { DemoData } from "./demoData.ts";

export const DEMO_ENABLED = import.meta.env.DEV && import.meta.env.VITE_DEMO_DATA === "true";

export const DemoContext = createContext<DemoData | null>(null);

/** The sample dataset when demo mode is on, else null (real Firebase data). */
export const useDemo = (): DemoData | null => useContext(DemoContext);
