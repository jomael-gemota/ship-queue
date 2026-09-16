import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { flashHHGroupRow } from '../components/hh/hhUi'
import {
  hhGroupMatchesQuery,
  hhItemMatchesQuery,
  hhOrderMatchesQuery,
  listHHGroups,
  rerunHHGroupScSync,
  rerunHHOrderScSync,
  updateHHGroupNotes,
  updateHHOrderNotes,
} from '../lib/hhSportswear'
import type { HHCartStatus, HHChildOrder, HHDetailsStatus, HHLineItem, HHOrderGroup } from '../lib/hhSportswear'
import { hhBreadcrumbPage, hhDirection } from '../lib/hhNav'
import type { HHPage } from '../lib/hhNav'

const POLL_INTERVAL_MS = 5000
const OPTIMISTIC_LOCAL_MS = 15_000

function mergePolledGroups(current: HHOrderGroup[], incoming: HHOrderGroup[]): HHOrderGroup[] {
  const incomingIds = new Set(incoming.map((group) => group.id))
  const now = Date.now()
  const optimistic = current.filter((group) => {
    if (incomingIds.has(group.id)) return false
    const created = Date.parse(group.createdAt)
    return Number.isFinite(created) && now - created < OPTIMISTIC_LOCAL_MS
  })
  if (optimistic.length === 0) return incoming
  return [...optimistic, ...incoming].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || 0,
  )
}

interface HHLevelFilters {
  detailsStatus: HHDetailsStatus | ''
  cartStatus: HHCartStatus | ''
  search: string
  page: number
}

const EMPTY_FILTERS: HHLevelFilters = { detailsStatus: '', cartStatus: '', search: '', page: 1 }

export type HHLoadState = 'loading' | 'ready' | 'error'

interface HHListContextValue {
  level: HHPage
  loadState: HHLoadState
  loadError: string | null
  reload: () => void
  refreshSilent: () => void
  groups: HHOrderGroup[]
  setGroups: Dispatch<SetStateAction<HHOrderGroup[]>>
  rerunDetails: (groupId: string, orderId?: string) => Promise<void>
  resyncBusyId: string | null
  updateNotes: (groupId: string, notes: string) => Promise<void>
  updateOrderNotes: (groupId: string, orderId: string, notes: string) => Promise<void>
  selectedDetailsStatus: HHDetailsStatus | ''
  selectedCartStatus: HHCartStatus | ''
  searchInput: string
  page: number
  pageSize: number
  filtered: HHOrderGroup[]
  paginated: HHOrderGroup[]
  filteredOrders: HHChildOrder[]
  filteredItems: HHLineItem[]
  total: number
  listTotal: number
  pageCount: number
  safePage: number
  startItem: number
  endItem: number
  handleDetailsStatusChange: (value: HHDetailsStatus | '') => void
  handleCartStatusChange: (value: HHCartStatus | '') => void
  handleSearchChange: (value: string) => void
  handleClearFilters: () => void
  hasActiveFilters: boolean
  handlePageSizeChange: (value: number) => void
  setPage: Dispatch<SetStateAction<number>>
  getGroup: (id: string) => HHOrderGroup | undefined
  getOrder: (groupId: string, orderId: string) => { group: HHOrderGroup; order: HHChildOrder } | undefined
}

const HHListContext = createContext<HHListContextValue | null>(null)

export function HHListProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { groupId = '', orderId = '' } = useParams<{ groupId: string; orderId: string }>()
  const level = hhBreadcrumbPage(location.pathname)
  const pathnameRef = useRef(location.pathname)

  const [groups, setGroups] = useState<HHOrderGroup[]>([])
  const [loadState, setLoadState] = useState<HHLoadState>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [resyncBusyId, setResyncBusyId] = useState<string | null>(null)
  const [filtersByLevel, setFiltersByLevel] = useState<Record<HHPage, HHLevelFilters>>({
    list: { ...EMPTY_FILTERS },
    orders: { ...EMPTY_FILTERS },
    items: { ...EMPTY_FILTERS },
  })
  const [pageSize, setPageSize] = useState(10)
  const fetchGenRef = useRef(0)
  const knownIdsRef = useRef<Set<string> | null>(null)

  const refreshGroups = useCallback((mode: 'initial' | 'silent') => {
    const gen = ++fetchGenRef.current
    if (mode === 'initial') {
      setLoadState('loading')
      setLoadError(null)
    }

    listHHGroups()
      .then((res) => {
        if (gen !== fetchGenRef.current) return
        const incoming = res.data
        const known = knownIdsRef.current
        setGroups((current) => mergePolledGroups(current, incoming))
        if (known) {
          const newestRemote = incoming.find((group) => !known.has(group.id))
          if (newestRemote) flashHHGroupRow(newestRemote.id)
        }
        const nextKnown = new Set(incoming.map((group) => group.id))
        if (known) {
          for (const id of known) nextKnown.add(id)
        }
        knownIdsRef.current = nextKnown
        setLoadState('ready')
        setLoadError(null)
      })
      .catch((error: unknown) => {
        if (gen !== fetchGenRef.current) return
        if (mode === 'silent' && knownIdsRef.current) return
        setLoadError(error instanceof Error ? error.message : 'Failed to load HH Sportswear groups')
        setLoadState('error')
      })
  }, [])

  useEffect(() => {
    refreshGroups('initial')
    return () => {
      fetchGenRef.current += 1
    }
  }, [reloadToken, refreshGroups])

  useEffect(() => {
    if (loadState !== 'ready') return
    for (const group of groups) {
      knownIdsRef.current?.add(group.id)
    }
  }, [groups, loadState])

  useEffect(() => {
    let timer: number | null = null

    const stop = () => {
      if (timer != null) {
        window.clearInterval(timer)
        timer = null
      }
    }

    const start = () => {
      stop()
      timer = window.setInterval(() => {
        if (document.hidden) return
        refreshGroups('silent')
      }, POLL_INTERVAL_MS)
    }

    const onVisible = () => {
      if (document.hidden) {
        stop()
        return
      }
      refreshGroups('silent')
      start()
    }

    start()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [refreshGroups])

  useLayoutEffect(() => {
    const from = pathnameRef.current
    const to = location.pathname
    if (from === to) return
    const direction = hhDirection(from, to)
    pathnameRef.current = to
    if (direction === 'back') return
    const nextLevel = hhBreadcrumbPage(to)
    setFiltersByLevel((current) => ({ ...current, [nextLevel]: { ...EMPTY_FILTERS } }))
  }, [location.pathname])

  const currentFilters = filtersByLevel[level]
  const selectedDetailsStatus = currentFilters.detailsStatus
  const selectedCartStatus = currentFilters.cartStatus
  const searchInput = currentFilters.search

  const updateCurrentFilters = (patch: Partial<HHLevelFilters>) => {
    setFiltersByLevel((current) => ({
      ...current,
      [level]: { ...current[level], ...patch },
    }))
  }

  const getGroup = (id: string) => groups.find((group) => group.id === id)
  const getOrder = (targetGroupId: string, targetOrderId: string) => {
    const group = groups.find((item) => item.id === targetGroupId)
    if (!group) return undefined
    const order = group.children.find((child) => child.id === targetOrderId || child.orderId === targetOrderId)
    if (!order) return undefined
    return { group, order }
  }

  const filtered = useMemo(() => {
    return groups.filter((group) => {
      if (filtersByLevel.list.detailsStatus && group.detailsStatus !== filtersByLevel.list.detailsStatus) return false
      if (filtersByLevel.list.cartStatus && group.cartStatus !== filtersByLevel.list.cartStatus) return false
      return hhGroupMatchesQuery(group, filtersByLevel.list.search)
    })
  }, [groups, filtersByLevel.list])

  const activeGroup = getGroup(groupId)
  const activeOrder = getOrder(groupId, orderId)?.order

  const filteredOrders = useMemo(() => {
    if (!activeGroup) return []
    return activeGroup.children.filter((order) => {
      if (filtersByLevel.orders.detailsStatus && order.detailsStatus !== filtersByLevel.orders.detailsStatus) return false
      if (filtersByLevel.orders.cartStatus && order.cartStatus !== filtersByLevel.orders.cartStatus) return false
      return hhOrderMatchesQuery(order, filtersByLevel.orders.search)
    })
  }, [activeGroup, filtersByLevel.orders])

  const filteredItems = useMemo(() => {
    if (!activeOrder) return []
    return activeOrder.items.filter((item) => hhItemMatchesQuery(item, filtersByLevel.items.search))
  }, [activeOrder, filtersByLevel.items.search])

  const listTotal = filtered.length
  const total =
    level === 'list' ? listTotal : level === 'orders' ? filteredOrders.length : filteredItems.length
  const pageCount = Math.max(1, Math.ceil(listTotal / pageSize) || 1)
  const safePage = Math.min(filtersByLevel.list.page, pageCount)
  const startItem = listTotal === 0 ? 0 : (safePage - 1) * pageSize + 1
  const endItem = Math.min(safePage * pageSize, listTotal)
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  const value: HHListContextValue = {
    level,
    loadState,
    loadError,
    reload: () => setReloadToken((current) => current + 1),
    refreshSilent: () => refreshGroups('silent'),
    groups,
    setGroups,
    rerunDetails: async (groupId, orderId) => {
      const busyId = orderId ?? groupId
      setResyncBusyId(busyId)
      try {
        const res = orderId
          ? await rerunHHOrderScSync(groupId, orderId)
          : await rerunHHGroupScSync(groupId)
        setGroups((current) => current.map((group) => (group.id === res.data.id ? res.data : group)))
      } catch (error) {
        console.error(error)
      } finally {
        setResyncBusyId((current) => (current === busyId ? null : current))
      }
    },
    resyncBusyId,
    updateNotes: async (groupId, notes) => {
      const res = await updateHHGroupNotes(groupId, notes)
      setGroups((current) => current.map((group) => (group.id === res.data.id ? res.data : group)))
    },
    updateOrderNotes: async (groupId, orderId, notes) => {
      const res = await updateHHOrderNotes(groupId, orderId, notes)
      setGroups((current) => current.map((group) => (group.id === res.data.id ? res.data : group)))
    },
    selectedDetailsStatus,
    selectedCartStatus,
    searchInput,
    page: safePage,
    pageSize,
    filtered,
    paginated,
    filteredOrders,
    filteredItems,
    total,
    listTotal,
    pageCount,
    safePage,
    startItem,
    endItem,
    handleDetailsStatusChange: (value) => {
      updateCurrentFilters({ detailsStatus: value, page: 1 })
    },
    handleCartStatusChange: (value) => {
      updateCurrentFilters({ cartStatus: value, page: 1 })
    },
    handleSearchChange: (value) => {
      updateCurrentFilters({ search: value, page: 1 })
    },
    handleClearFilters: () => {
      updateCurrentFilters({ detailsStatus: '', cartStatus: '', search: '', page: 1 })
    },
    hasActiveFilters: Boolean(selectedDetailsStatus || selectedCartStatus || searchInput.trim()),
    handlePageSizeChange: (value) => {
      setPageSize(value)
      setFiltersByLevel((current) => ({
        ...current,
        list: { ...current.list, page: 1 },
      }))
    },
    setPage: (action) => {
      setFiltersByLevel((current) => {
        const next = typeof action === 'function' ? action(safePage) : action
        return { ...current, list: { ...current.list, page: next } }
      })
    },
    getGroup,
    getOrder,
  }

  return <HHListContext.Provider value={value}>{children}</HHListContext.Provider>
}

export function useHHList() {
  const context = useContext(HHListContext)
  if (!context) throw new Error('useHHList must be used within HHListProvider')
  return context
}
