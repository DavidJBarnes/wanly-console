import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { ThemeProvider, CssBaseline } from "@mui/material";
import theme from "./theme";
import MainLayout from "./layouts/MainLayout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import JobQueue from "./pages/JobQueue";
import JobDetail from "./pages/JobDetail";
import Workers from "./pages/Workers";
import WorkerDetail from "./pages/WorkerDetail";
import Videos from "./pages/Videos";
import SmashcutBuilder from "./pages/SmashcutBuilder";
import ImageRepo from "./pages/ImageRepo";
import SettingsPage from "./pages/SettingsPage";
import HologramPlayer from "./pages/HologramPlayer";
import Wildcards from "./pages/Wildcards";
import LoraRecipes from "./pages/LoraRecipes";

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          {/* Full-screen WebXR player — outside MainLayout (no nav chrome) */}
          <Route path="/holo/:id" element={<HologramPlayer />} />
          <Route element={<MainLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/jobs" element={<JobQueue />} />
            <Route path="/jobs/:id" element={<JobDetail />} />
            <Route path="/workers" element={<Workers />} />
            <Route path="/workers/:id" element={<WorkerDetail />} />
            <Route path="/videos" element={<Videos />} />
            <Route path="/smashcut" element={<SmashcutBuilder />} />
            <Route path="/wildcards" element={<Wildcards />} />
            <Route path="/lora-recipes" element={<LoraRecipes />} />
            <Route path="/images" element={<ImageRepo />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
