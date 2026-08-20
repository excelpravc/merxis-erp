import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./AuthProvider";
import { ProtectedRoute } from "./ProtectedRoute";
import Layout from "./Layout";
import Login from "./Login";
import Dashboard from "./Dashboard";
import Companies from "./Companies";
import Users from "./Users";
import Roles from "./Roles";
import SettingsPage from "./SettingsPage";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="empresas" element={<Companies />} />
            <Route path="usuarios" element={<Users />} />
            <Route path="perfis" element={<Roles />} />
            <Route path="configuracoes" element={<SettingsPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
