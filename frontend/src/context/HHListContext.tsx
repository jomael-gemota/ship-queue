import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import {
  HH_SAMPLE_GROUPS,
  hhGroupMatchesQuery,
  hhItemMatchesQuery,
  hhOrderMatchesQuery,
} from '../lib/hhSportswear'
import type { HHChildOrder, HHLineItem, HHOrderGroup, HHOrderStatus } from '../lib/hhSportswear'
import { hhBreadcrumbPage, hhDirection } from '../lib/hhNav'
import type { HHPage } from '../lib/hhNav'

interface HHLevelFilters {
  status: HHOrderStatus | ''
  search: string
  page: number
}

const EMPTY_FILTERS: HHLevelFilters = { status: '', search: '', page: 1 }

interface HHListContextValue {
  level: HHPage
  groups: HHOrderGroup[]
  setGroups: Dispatch<SetStateAction<HHOrderGroup[]>>
  selectedStatus: HHOrderStatus | ''
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
  handleStatusChange: (value: HHOrderStatus | '') => void
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

  const [groups, setGroups] = useState<HHOrderGroup[]>(HH_SAMPLE_GROUPS)
  const [filtersByLevel, setFiltersByLevel] = useState<Record<HHPage, HHLevelFilters>>({
    list: { ...EMPTY_FILTERS },
    orders: { ...EMPTY_FILTERS },
    items: { ...EMPTY_FILTERS },
  })
  const [pageSize, setPageSize] = useState(10)

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
  const selectedStatus = currentFilters.status
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
      if (filtersByLevel.list.status && group.status !== filtersByLevel.list.status) return false
      return hhGroupMatchesQuery(group, filtersByLevel.list.search)
    })
  }, [groups, filtersByLevel.list])

  const activeGroup = getGroup(groupId)
  const activeOrder = getOrder(groupId, orderId)?.order

  const filteredOrders = useMemo(() => {
    if (!activeGroup) return []
    return activeGroup.children.filter((order) => {
      if (filtersByLevel.orders.status && order.status !== filtersByLevel.orders.status) return false
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
    groups,
    setGroups,
    selectedStatus,
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
    handleStatusChange: (value) => {
      updateCurrentFilters({ status: value, page: 1 })
    },
    handleSearchChange: (value) => {
      updateCurrentFilters({ search: value, page: 1 })
    },
    handleClearFilters: () => {
      updateCurrentFilters({ status: '', search: '', page: 1 })
    },
    hasActiveFilters: Boolean(selectedStatus || searchInput.trim()),
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
