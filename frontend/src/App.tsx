import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AccountProvider } from './contexts/AccountContext.tsx'
import { Layout } from './components/Layout.tsx'
import { Dashboard } from './pages/Dashboard.tsx'
import { Symbols } from './pages/Symbols.tsx'
import { SymbolDetail } from './pages/SymbolDetail.tsx'
import { History } from './pages/Reports.tsx'
import { ApiKeys } from './pages/ApiKeys.tsx'
import { Config } from './pages/Config.tsx'
import { SymbolConfig } from './pages/SymbolConfig.tsx'
import { Account } from './pages/Account.tsx'
import { Strategies } from './pages/Strategies.tsx'
import { AgentMemory } from './pages/AgentMemory.tsx'
import { AgentRules } from './pages/AgentRules.tsx'
import { Analytics } from './pages/Analytics.tsx'
import { DataExport } from './pages/DataExport.tsx'

export default function App() {
  return (
    <BrowserRouter>
      <AccountProvider>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="symbols" element={<Symbols />} />
            <Route path="symbols/:key" element={<SymbolDetail />} />
            <Route path="symbols/:key/config" element={<SymbolConfig />} />
            <Route path="history" element={<History />} />
            <Route path="keys" element={<ApiKeys />} />
            <Route path="config" element={<Config />} />
            <Route path="account" element={<Account />} />
            <Route path="strategies" element={<Strategies />} />
            <Route path="agent/memory" element={<AgentMemory />} />
            <Route path="agent/rules" element={<AgentRules />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="export" element={<DataExport />} />
          </Route>
        </Routes>
      </AccountProvider>
    </BrowserRouter>
  )
}
