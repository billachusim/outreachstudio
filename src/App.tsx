import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Offerings from "./pages/Offerings";
import Campaigns from "./pages/Campaigns";
import Jobs from "./pages/Jobs";
import Leads from "./pages/Leads";
import Templates from "./pages/Templates";
import Inbox from "./pages/Inbox";
import Chat from "./pages/Chat";
import Memory from "./pages/Memory";
import Channels from "./pages/Channels";
import Intel from "./pages/Intel";
import IntelSources from "./pages/IntelSources";
import Social from "./pages/Social";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/offerings" element={<Offerings />} />
              <Route path="/campaigns" element={<Campaigns />} />
              <Route path="/jobs" element={<Jobs />} />
              <Route path="/leads" element={<Leads />} />
              <Route path="/templates" element={<Templates />} />
              <Route path="/inbox" element={<Inbox />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/memory" element={<Memory />} />
              <Route path="/channels" element={<Channels />} />
              <Route path="/intel" element={<Intel />} />
              <Route path="/intel" element={<Intel />} />
              <Route path="/intel/sources" element={<IntelSources />} />
              <Route path="/social" element={<Social />} />
            </Route>
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
