import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { MapListPage } from "./pages/MapListPage";
import { TrashPage } from "./pages/TrashPage";
import { EditorPage } from "./pages/EditorPage";
import "@xyflow/react/dist/style.css";
import "./styles.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/" element={<MapListPage />} />
        <Route path="/trash" element={<TrashPage />} />
        <Route path="/maps/:mapId" element={<EditorPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
