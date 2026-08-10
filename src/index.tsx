import { createRoot } from "react-dom/client";
import "./index.css";
import React from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import Dashboard from "./Dashboard";
import { ThemeProvider } from "./components/theme-provider";
const container = document.getElementById("root") as HTMLDivElement;
const root = createRoot(container);

import Welcome from "./Welcome";
import ProviderInfoPage from "./provider/ProviderInfoPage";
import { Toaster } from "@/components/ui/sonner";

const router = createBrowserRouter(
  [
    {
      element: <Dashboard />,
      children: [
        {
          path: "/",
          index: true,
          element: <Welcome />,
        },
        {
          // Deliberately no provider listing — this route exists so
          // stats.golem.network can deep-link a single provider's dashboard.
          path: "/provider/info/:providerId",
          element: <ProviderInfoPage />,
        },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
);

root.render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="system" storageKey="ui-theme">
      <RouterProvider router={router} />
      <Toaster />
    </ThemeProvider>
  </React.StrictMode>,
);
