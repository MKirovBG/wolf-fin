import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { getAccounts, getSelectedAccount as apiGetSelected, setSelectedAccount as apiSetSelected } from '../api/client.ts'
import type { AccountEntry, Mt5AccountEntry, BinanceAccountEntry, SelectedAccount } from '../types/index.ts'

interface AccountContextValue {
  selectedAccount: SelectedAccount | null
  accounts: AccountEntry[]
  accountsLoading: boolean
  setSelectedAccount: (account: SelectedAccount | null) => Promise<void>
  refreshAccounts: () => Promise<void>
}

const AccountContext = createContext<AccountContextValue>({
  selectedAccount: null,
  accounts: [],
  accountsLoading: true,
  setSelectedAccount: async () => {},
  refreshAccounts: async () => {},
})

export function buildAccountLabel(entry: AccountEntry): string {
  if (entry.exchange === 'mt5') {
    const mt5 = entry as Mt5AccountEntry
    const login = mt5.summary?.login ?? entry.id.replace('mt5-', '')
    const server = mt5.summary?.server ? ` @ ${mt5.summary.server}` : ''
    return `MT5 · #${login}${server}`
  }
  const bin = entry as BinanceAccountEntry
  return `Binance · ${bin.mode}`
}

export function entryToSelectedAccount(entry: AccountEntry): SelectedAccount {
  if (entry.exchange === 'mt5') {
    const mt5 = entry as Mt5AccountEntry
    const login = mt5.summary?.login ?? parseInt(entry.id.replace('mt5-', ''), 10)
    return {
      market: 'mt5',
      accountId: String(login),
      label: buildAccountLabel(entry),
    }
  }
  return {
    market: 'crypto',
    accountId: 'binance',
    label: buildAccountLabel(entry),
  }
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [selectedAccount, setSelectedAccountState] = useState<SelectedAccount | null>(null)
  const [accounts, setAccounts] = useState<AccountEntry[]>([])
  const [accountsLoading, setAccountsLoading] = useState(true)

  const refreshAccounts = useCallback(async () => {
    try {
      const data = await getAccounts()
      setAccounts(data)
    } catch { /* bridge may be offline */ }
  }, [])

  // Load persisted selection + account list on mount
  useEffect(() => {
    Promise.all([
      apiGetSelected().catch(() => null),
      getAccounts().catch(() => [] as AccountEntry[]),
    ]).then(([sel, accts]) => {
      setSelectedAccountState(sel)
      setAccounts(accts)
    }).finally(() => setAccountsLoading(false))
  }, [])

  const setSelectedAccount = useCallback(async (account: SelectedAccount | null) => {
    await apiSetSelected(account)
    setSelectedAccountState(account)
  }, [])

  return (
    <AccountContext.Provider value={{ selectedAccount, accounts, accountsLoading, setSelectedAccount, refreshAccounts }}>
      {children}
    </AccountContext.Provider>
  )
}

export function useAccount() {
  return useContext(AccountContext)
}
