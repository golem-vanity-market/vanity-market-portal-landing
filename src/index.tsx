import { createRoot } from "react-dom/client";
import "./index.css";
import React from "react";
import { ThemeProvider } from "./components/theme-provider";
const container = document.getElementById("root") as HTMLDivElement;
const root = createRoot(container);

import { Toaster } from "@/components/ui/sonner";

root.render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="system" storageKey="ui-theme">
      <Toaster />
    </ThemeProvider>
  </React.StrictMode>,
);
