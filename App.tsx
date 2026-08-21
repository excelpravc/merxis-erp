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
import Products from "./Products";
import Stock from "./Stock";
import Suppliers from "./Suppliers";
import Customers from "./Customers";

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
            <Route path="produtos" element={<Products />} />
            <Route path="estoque" element={<Stock />} />
            <Route path="fornecedores" element={<Suppliers />} />
            <Route path="clientes" element={<Customers />} />
            <Route path="configuracoes" element={<SettingsPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
