import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout.tsx'
import { Dashboard } from './pages/Dashboard.tsx'
import { Agents } from './pages/Agents.tsx'
import { AgentCreate } from './pages/AgentCreate.tsx'
import { AgentDetail } from './pages/AgentDetail.tsx'
import { Positions } from './pages/Positions.tsx'
import { ApiKeys } from './pages/ApiKeys.tsx'
import { Reports } from './pages/Reports.tsx'
import { Account } from './pages/Account.tsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="agents" element={<Agents />} />
          <Route path="agents/new" element={<AgentCreate />} />
          <Route path="agents/:market/:symbol/:accountId?" element={<AgentDetail />} />
          <Route path="positions" element={<Positions />} />
          <Route path="keys" element={<ApiKeys />} />
          <Route path="reports" element={<Reports />} />
          <Route path="account" element={<Account />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
