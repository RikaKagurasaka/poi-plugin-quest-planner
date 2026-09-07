'use strict'

const fs = require('fs')
const path = require('path')
const React = require('react')
const { Button, Dialog, HTMLSelect, Icon, InputGroup, Popover, Tag } = require('@blueprintjs/core')
const cytoscape = require('cytoscape')
const dagre = require('cytoscape-dagre')
const { store } = require('views/create-store')
const questData = require('./data/quests.json')
const { buildRequirementSections, prerequisiteProgress } = require('./requirements-view')
const {
  CATEGORY_LABELS,
  booleanQueryMatches,
  buildIndexes,
  completionIsCurrent,
  findConcurrentQuestRecommendations,
  findConcurrentQuestRecommendationsByProgress,
  findConcurrentQuestRecommendationsForObjective,
  graphForQuestIds,
  inferQuestStatuses,
  mergeQuestListPage,
} = require('./logic')

cytoscape.use(dagre)

const h = React.createElement
const STATE_DIRECTORY = 'quest-planner'
const STATUS_LABELS = {
  unlocked: '已解锁',
  locked: '未解锁',
  completed: '已完成',
  unknown: '未知',
  claimable: '可领取',
  active: '进行中',
  'inferred-completed': '推定完成',
  available: '已解锁',
  'incomplete-data': '资料缺失',
}
const STATUS_ICONS = {
  unlocked: 'play',
  locked: 'disable',
  completed: 'tick-circle',
  unknown: 'help',
  claimable: 'tick',
  active: 'play',
  'inferred-completed': 'predictive-analysis',
  available: 'play',
  'incomplete-data': 'warning-sign',
}
const CATEGORY_COLORS = {
  composition: '#3dcc63',
  sortie: '#ed5a5a',
  exercise: '#85d768',
  expedition: '#2ac6aa',
  supply: '#e0c341',
  factory: '#bd876b',
  modernization: '#b586d9',
  other: '#87909c',
}
const REQUIREMENT_STATUS = {
  ready: { icon: 'tick', label: '已满足' },
  blocked: { icon: 'cross', label: '未满足' },
  progressing: { icon: 'arrow-right', label: '进行中' },
  unknown: { icon: 'help', label: '未知' },
}
const QUEST_PHASE = {
  locked: { icon: 'disable', symbol: '⊘', label: '未解锁' },
  unlocked: { icon: 'play', symbol: '▶', label: '已解锁' },
  completed: { icon: 'tick', symbol: '✓', label: '已完成' },
  unknown: { icon: 'help', symbol: '?', label: '未知' },
}
const COARSE_STATUS_FILTER_OPTIONS = [
  ['locked', '未解锁'],
  ['unlocked', '已解锁'],
  ['completed', '已完成'],
  ['unknown', '未知'],
]
const COARSE_STATUS_GROUPS = {
  locked: ['locked'],
  unlocked: ['available', 'active', 'claimable'],
  completed: ['completed', 'inferred-completed'],
  unknown: ['incomplete-data', 'unknown'],
}
const STATUS_FILTER_OPTIONS = [
  ['available', '已解锁'],
  ['active', '进行中'],
  ['claimable', '可领取'],
  ['completed', '已完成'],
  ['inferred-completed', '推定完成'],
  ['locked', '未解锁'],
  ['incomplete-data', '资料缺失'],
  ['unknown', '未知'],
]
const DEFAULT_STATUS_FILTERS = ['available', 'active', 'claimable', 'locked', 'incomplete-data', 'unknown']

function coarseStatus(status) {
  if (['available', 'active', 'claimable'].includes(status)) return 'unlocked'
  if (['completed', 'inferred-completed'].includes(status)) return 'completed'
  if (status === 'locked') return 'locked'
  return 'unknown'
}

function displayedStatus(status, detailed) {
  return detailed ? status : coarseStatus(status)
}

function questPhase(status) {
  if (['completed', 'inferred-completed', 'claimable'].includes(status)) return 'completed'
  if (['unlocked', 'available', 'active'].includes(status)) return 'unlocked'
  if (status === 'locked') return 'locked'
  return 'unknown'
}

function graphNodeLabel(code, status) {
  return `${QUEST_PHASE[questPhase(status)].symbol} ${code}`
}

function prerequisiteFilterMatches(filter, progress) {
  if (filter === 'all') return true
  const hasPrerequisites = progress?.hasPrerequisites === true
  if (filter === 'none') return !hasPrerequisites
  if (!hasPrerequisites) return false
  const fulfilledGroups = Math.max(0, Math.min(3, number(progress.fulfilledGroups)))
  const required = number(filter)
  return required === 0 ? fulfilledGroups === 0 : fulfilledGroups >= required
}

function withTemporaryRepeatCompletions(quests, state, repeats, at = Date.now()) {
  if (!repeats.length) return state
  const selected = new Set(repeats)
  const manualCompleted = { ...(state.manualCompleted || {}) }
  quests.forEach((quest) => {
    if (selected.has(quest.repeat)) manualCompleted[quest.id] = { at, source: 'temporary-repeat' }
  })
  return { ...state, manualCompleted }
}

function inferWithTemporaryRepeatCompletions(quests, state, activeIds, repeats, at = Date.now()) {
  const inferredState = withTemporaryRepeatCompletions(quests, state, repeats, at)
  const result = inferQuestStatuses(quests, inferredState, activeIds, at)
  if (!repeats.length) return result
  const selected = new Set(repeats)
  const statuses = new Map(result.statuses)
  quests.forEach((quest) => {
    if (selected.has(quest.repeat)) statuses.set(quest.id, { status: 'completed', evidence: 'temporary-repeat' })
  })
  return { ...result, statuses }
}

function searchableText(value) {
  const structuredValues = []
  function collect(value, key = '') {
    if (value == null || ['sourceRefs', 'poiGoal'].includes(key)) return
    if (Array.isArray(value)) value.forEach((entry) => collect(entry))
    else if (typeof value === 'object') Object.entries(value).forEach(([childKey, child]) => collect(child, childKey))
    else structuredValues.push(value)
  }
  collect(value)
  return structuredValues.join('\n')
}

function questSearchFields(quest) {
  const observed = plannerState.observed?.[quest.id]
  return {
    name: [quest.code, quest.name, observed?.title].filter(Boolean).join('\n'),
    detail: [quest.detail, quest.note, observed?.detail].filter(Boolean).join('\n'),
    requirements: searchableText({ requirements: quest.requirements, prerequisites: quest.prerequisites, dependencies: quest.dependencies }),
    rewards: [quest.rewardText, searchableText(quest.rewards)].filter(Boolean).join('\n'),
  }
}

function questMatchesSearch(quest, query) {
  if (!query) return true
  const fields = questSearchFields(quest)
  if (typeof query === 'object') {
    return Object.entries(query).every(([field, expression]) =>
      !expression || !Object.prototype.hasOwnProperty.call(fields, field) || booleanQueryMatches(expression, fields[field]))
  }
  const needle = String(query).toLocaleLowerCase()
  return Object.values(fields).some((value) => value.toLocaleLowerCase().includes(needle))
}
const REPEAT_LABELS = {
  single: '单次',
  daily: '每日',
  weekly: '每周',
  monthly: '每月',
  quarterly: '每季',
  yearly: '每年',
  unknown: '未分类',
}
const REWARD_KIND_LABELS = {
  resource: '资源',
  'use-item': '道具',
  equipment: '装备',
  ship: '舰娘',
  furniture: '家具',
  unlock: '开放',
  capacity: '容量',
  'ranking-point': '战果',
  other: '其他',
}
const REWARD_KIND_ICONS = {
  resource: 'database',
  'use-item': 'box',
  equipment: 'build',
  ship: 'people',
  furniture: 'home',
  unlock: 'unlock',
  capacity: 'add',
  'ranking-point': 'trophy',
  other: 'help',
}

function rewardQuantityText(entry) {
  if (entry.kind === 'capacity' || entry.kind === 'ranking-point') return `+${entry.quantity}`
  return `×${entry.quantity}`
}

function rewardEntryLabel(entry) {
  const label = entry.label || entry.raw || REWARD_KIND_LABELS[entry.kind] || '未识别奖励'
  if (entry.kind === 'ranking-point') return label.replace(/\s*\+?\d+\s*$/, '') || '战果'
  return label
}

function rewardEntryText(entry) {
  const label = rewardEntryLabel(entry)
  const improvement = entry.kind === 'equipment' && entry.improvement != null
    ? ` ★${Number(entry.improvement) >= 10 ? 'max' : `+${entry.improvement}`}`
    : ''
  return `${label}${improvement}`
}
const REPEAT_FILTER_OPTIONS = [
  ['single', '单次'],
  ['daily', '每日'],
  ['weekly', '每周'],
  ['monthly', '每月'],
  ['quarterly', '每季'],
  ['yearly', '每年'],
  ['unknown', '未分类'],
]
const TEMPORARY_COMPLETION_OPTIONS = [
  ['daily', '日'],
  ['weekly', '周'],
  ['monthly', '月'],
  ['quarterly', '季'],
]
const ADVANCED_SEARCH_FIELDS = [
  ['name', '任务名'],
  ['detail', '细节'],
  ['requirements', '要求'],
  ['rewards', '奖励'],
]
const DEFAULT_ADVANCED_QUERIES = { name: '', detail: '', requirements: '', rewards: '' }
const CATEGORY_FILTER_OPTIONS = Object.entries(CATEGORY_LABELS)
const DEFAULT_CATEGORY_FILTERS = CATEGORY_FILTER_OPTIONS.map(([value]) => value)
const DEFAULT_REPEAT_FILTERS = REPEAT_FILTER_OPTIONS.map(([value]) => value)
const PREREQUISITE_FILTER_OPTIONS = [
  ['all', '全部'],
  ['none', '无前提'],
  ['0', '未达成'],
  ['1', '达成 A'],
  ['2', '达成 B'],
  ['3', '达成 C'],
]
const FILTER_INFO = {
  prerequisite: '按前提组筛选：无前提单独归类；达成 B 表示 A、B 均已达成，达成 C 表示 A、B、C 均已达成。',
  temporary: '将选中的日、周、月、季任务暂时视为已完成，仅用于推算后续任务状态，不会修改游戏记录。',
}
const DEFAULT_PREREQUISITE_FILTER = 'all'
const DEFAULT_UI_CONFIG = {
  query: '',
  advancedSearch: false,
  advancedQueries: DEFAULT_ADVANCED_QUERIES,
  statusFilters: DEFAULT_STATUS_FILTERS,
  categoryFilters: DEFAULT_CATEGORY_FILTERS,
  repeatFilters: DEFAULT_REPEAT_FILTERS,
  prerequisiteFilter: DEFAULT_PREREQUISITE_FILTER,
  temporaryCompletedRepeats: [],
  todoOnly: false,
  detailedStatuses: false,
  direction: 'LR',
}

function configuredValues(value, options, fallback) {
  if (!Array.isArray(value)) return [...fallback]
  const allowed = new Set(options.map(([option]) => option))
  return Array.from(new Set(value.filter((entry) => allowed.has(entry))))
}

function sanitizeAdvancedQueries(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_ADVANCED_QUERIES }
  return ADVANCED_SEARCH_FIELDS.reduce((result, [field]) => {
    result[field] = typeof value[field] === 'string' ? value[field] : ''
    return result
  }, {})
}

function sanitizeUiConfig(value) {
  const ui = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const prerequisiteValues = new Set(PREREQUISITE_FILTER_OPTIONS.map(([option]) => option))
  return {
    query: typeof ui.query === 'string' ? ui.query : DEFAULT_UI_CONFIG.query,
    advancedSearch: ui.advancedSearch === true,
    advancedQueries: sanitizeAdvancedQueries(ui.advancedQueries),
    statusFilters: configuredValues(ui.statusFilters, STATUS_FILTER_OPTIONS, DEFAULT_UI_CONFIG.statusFilters),
    categoryFilters: configuredValues(ui.categoryFilters, CATEGORY_FILTER_OPTIONS, DEFAULT_UI_CONFIG.categoryFilters),
    repeatFilters: configuredValues(ui.repeatFilters, REPEAT_FILTER_OPTIONS, DEFAULT_UI_CONFIG.repeatFilters),
    prerequisiteFilter: prerequisiteValues.has(ui.prerequisiteFilter) ? ui.prerequisiteFilter : DEFAULT_UI_CONFIG.prerequisiteFilter,
    temporaryCompletedRepeats: configuredValues(ui.temporaryCompletedRepeats, TEMPORARY_COMPLETION_OPTIONS, DEFAULT_UI_CONFIG.temporaryCompletedRepeats),
    todoOnly: ui.todoOnly === true,
    detailedStatuses: ui.detailedStatuses === true,
    direction: ['LR', 'TB'].includes(ui.direction) ? ui.direction : DEFAULT_UI_CONFIG.direction,
  }
}

const indexes = buildIndexes(questData.quests)
const listeners = new Set()
let loadedAdmiralId = null
let unsubscribeStore = null
let pendingUiPersist = null
let plannerState = emptyPlannerState()
let relevantStoreState = null

function emptyPlannerState() {
  return { observed: {}, completed: {}, manualCompleted: {}, todo: {}, hidden: {}, ui: {}, scan: null, snapshot: null }
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function rootState() {
  return store && typeof store.getState === 'function' ? store.getState() : {}
}

function admiralId() {
  const value = rootState()?.info?.basic?.api_member_id
  return value == null ? null : String(value)
}

function stateDirectory(id) {
  const base = typeof APPDATA_PATH !== 'undefined'
    ? APPDATA_PATH
    : path.join(process.env.HOME || process.cwd(), '.poi-dark')
  return path.join(base, STATE_DIRECTORY, id)
}

function stateFile(id) {
  return path.join(stateDirectory(id), 'state.json')
}

function sanitizeRecord(record) {
  return record && typeof record === 'object' && !Array.isArray(record) ? record : {}
}

function sanitizePlannerState(candidate) {
  if (!candidate || typeof candidate !== 'object') return emptyPlannerState()
  return {
    observed: sanitizeRecord(candidate.observed),
    completed: sanitizeRecord(candidate.completed),
    manualCompleted: sanitizeRecord(candidate.manualCompleted),
    todo: sanitizeRecord(candidate.todo),
    hidden: sanitizeRecord(candidate.hidden),
    ui: sanitizeRecord(candidate.ui),
    scan: candidate.scan && typeof candidate.scan === 'object' ? candidate.scan : null,
    snapshot: candidate.snapshot && typeof candidate.snapshot === 'object' ? candidate.snapshot : null,
  }
}

function ensureLoaded() {
  const id = admiralId()
  if (!id) return false
  if (loadedAdmiralId === id) return true
  loadedAdmiralId = id
  try {
    plannerState = sanitizePlannerState(JSON.parse(fs.readFileSync(stateFile(id), 'utf8')))
  } catch (_) {
    plannerState = emptyPlannerState()
  }
  notify()
  return true
}

function persist() {
  if (!loadedAdmiralId) return
  try {
    fs.mkdirSync(stateDirectory(loadedAdmiralId), { recursive: true })
    fs.writeFileSync(stateFile(loadedAdmiralId), JSON.stringify(plannerState, null, 2))
  } catch (error) {
    console.error('[任务规划] 保存状态失败', error)
  }
}

function scheduleUiPersist() {
  if (pendingUiPersist) clearTimeout(pendingUiPersist)
  pendingUiPersist = setTimeout(() => {
    pendingUiPersist = null
    persist()
  }, 180)
}

function notify() {
  listeners.forEach((listener) => listener())
}

function updateQuestList(detail) {
  if (!ensureLoaded()) return
  const list = Array.isArray(detail?.body?.api_list) ? detail.body.api_list : []
  let changed = false
  list.forEach((quest) => {
    if (!quest || typeof quest !== 'object' || number(quest.api_no) <= 0) return
    const id = number(quest.api_no)
    const definition = indexes.byId.get(id)
    const observedAt = number(detail.time) || Date.now()
    if (definition?.repeat !== 'single') {
      if (completionIsCurrent(plannerState.completed[id], definition?.repeat, observedAt)) {
        delete plannerState.completed[id]
      }
      if (completionIsCurrent(plannerState.manualCompleted[id], definition?.repeat, observedAt)) {
        delete plannerState.manualCompleted[id]
      }
    }
    plannerState.observed[id] = {
      apiState: number(quest.api_state),
      progressFlag: number(quest.api_progress_flag),
      title: typeof quest.api_title === 'string' ? quest.api_title : '',
      detail: typeof quest.api_detail === 'string' ? quest.api_detail : '',
      seenAt: observedAt,
    }
    changed = true
  })
  const mergedPage = mergeQuestListPage(plannerState.scan, detail)
  plannerState.scan = mergedPage.scan
  if (mergedPage.snapshot) plannerState.snapshot = mergedPage.snapshot
  if (String(detail?.postBody?.api_tab_id) === '0') changed = true
  if (changed) {
    persist()
    notify()
  }
}

function completeQuest(detail) {
  if (!ensureLoaded()) return
  const id = number(detail?.postBody?.api_quest_id)
  if (id <= 0) return
  plannerState.completed[id] = { at: number(detail.time) || Date.now(), source: 'game' }
  plannerState.scan = null
  plannerState.snapshot = null
  persist()
  notify()
}

function handleGameResponse(event) {
  const detail = event?.detail || {}
  if (detail.path === '/kcsapi/api_get_member/questlist') updateQuestList(detail)
  if (detail.path === '/kcsapi/api_req_quest/clearitemget') completeQuest(detail)
}

function toggleField(field, id) {
  if (!ensureLoaded()) return
  const numericId = number(id)
  plannerState[field] = { ...plannerState[field] }
  if (plannerState[field][numericId]) delete plannerState[field][numericId]
  else plannerState[field][numericId] = true
  persist()
  notify()
}

function toggleCompleted(id) {
  if (!ensureLoaded()) return
  const numericId = number(id)
  plannerState.manualCompleted = { ...plannerState.manualCompleted }
  if (plannerState.manualCompleted[numericId]) delete plannerState.manualCompleted[numericId]
  else plannerState.manualCompleted[numericId] = { at: Date.now(), source: 'manual' }
  persist()
  notify()
}

function start() {
  ensureLoaded()
  window.addEventListener('game.response', handleGameResponse)
  relevantStoreState = selectRelevantStoreState(rootState())
  unsubscribeStore = store.subscribe(() => {
    ensureLoaded()
    const next = selectRelevantStoreState(rootState())
    if (next.every((value, index) => value === relevantStoreState?.[index])) return
    relevantStoreState = next
    notify()
  })
}

function selectRelevantStoreState(state) {
  return [
    state?.info?.basic,
    state?.info?.quests,
    state?.info?.ships,
    state?.info?.fleets,
    state?.info?.equips,
    state?.info?.resources,
    state?.info?.useitems,
    state?.info?.maps,
    state?.info?.airbase,
    state?.info?.dataFreshness,
    state?.const?.$ships,
    state?.const?.$equips,
  ]
}

function stop() {
  window.removeEventListener('game.response', handleGameResponse)
  if (unsubscribeStore) unsubscribeStore()
  unsubscribeStore = null
  relevantStoreState = null
  if (pendingUiPersist) clearTimeout(pendingUiPersist)
  pendingUiPersist = null
  persist()
  listeners.clear()
}

function activeQuestIds(state) {
  return new Set(Object.keys(state?.info?.quests?.activeQuests || {}).map(number))
}

function directHiddenQuestIds(stateOrIds) {
  if (stateOrIds instanceof Set) return new Set(Array.from(stateOrIds).map(number).filter((id) => id > 0))
  return new Set(Object.entries(stateOrIds?.hidden || {})
    .filter(([, value]) => value === true)
    .map(([id]) => number(id))
    .filter((id) => id > 0))
}

function hiddenQuestIds(quests, stateOrIds, statuses) {
  const direct = directHiddenQuestIds(stateOrIds)
  const hidden = new Set(direct)
  const questIndexes = buildIndexes(quests || [])
  const queue = Array.from(direct)
  const visited = new Set()
  while (queue.length) {
    const parentId = queue.shift()
    if (visited.has(parentId)) continue
    visited.add(parentId)
    ;(questIndexes.children.get(parentId) || []).forEach((childId) => {
      const child = number(childId)
      if (visited.has(child)) return
      queue.push(child)
      const childStatus = statuses && typeof statuses.get === 'function'
        ? statuses.get(child)?.status
        : statuses?.[child]?.status
      if (childStatus === 'locked') hidden.add(child)
    })
  }
  return hidden
}

function toggleSelection(values, value) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

function sameSelection(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value))
}

function exclusiveOrAll(current, target, all) {
  return sameSelection(current, target) ? [...all] : [...target]
}

function FilterInfoPopover({ label, info }) {
  const target = h(
    'span',
    { className: 'qp-filter-label-info', title: info },
    label,
    h(Icon, { icon: 'info-sign', size: 11 }),
  )
  if (typeof Popover !== 'function') return target
  return h(
    Popover,
    {
      content: h('div', { className: 'qp-setting-info' }, info),
      interactionKind: 'hover-target',
      placement: 'top-start',
      hoverOpenDelay: 120,
      hoverCloseDelay: 100,
      minimal: true,
      targetTagName: 'span',
      popoverClassName: 'qp-setting-popover',
    },
    target,
  )
}

function FilterBadges({ label, info, options, values, partialValues = [], onToggle, classNameFor, iconFor }) {
  return h(
    'div',
    { className: 'qp-filter-group' },
    info ? h(FilterInfoPopover, { label, info }) : h('span', { className: 'qp-filter-label' }, label),
    ...options.map(([value, text]) => h(Button, {
      key: value,
      small: true,
      minimal: true,
      icon: iconFor?.(value),
      className: `qp-filter-badge${values.includes(value) ? ' is-active' : ''}${partialValues.includes(value) ? ' is-partial' : ''}${classNameFor ? ` ${classNameFor(value)}` : ''}`,
      onClick: () => onToggle(value, false),
      onContextMenu: (event) => {
        event.preventDefault()
        onToggle(value, true)
      },
    }, text)),
  )
}

function effectiveQuest(quest) {
  const observed = plannerState.observed?.[quest.id]
  return {
    ...quest,
    name: observed?.title || quest.name,
    detail: observed?.detail || quest.detail,
  }
}

function Graph({ quests, selectedId, statuses, detailedStatuses, direction, apiRef, onSelect }) {
  const container = React.useRef(null)
  const cyRef = React.useRef(null)
  const selectedNodeRef = React.useRef(null)
  const focusedEdgesRef = React.useRef(null)
  const questIdSignature = quests.map((quest) => quest.id).join(',')
  const graph = React.useMemo(
    () => graphForQuestIds(quests.map((quest) => quest.id), indexes),
    [questIdSignature],
  )
  const statusSignature = React.useMemo(
    () => graph.nodeIds
      .map((id) => `${id}:${displayedStatus(statuses.get(id)?.status || 'unknown', detailedStatuses)}`)
      .join('|'),
    [graph, statuses, detailedStatuses],
  )

  React.useEffect(() => {
    if (!container.current || graph.nodeIds.length === 0) return undefined
    const elements = [
      ...graph.nodeIds.map((id) => {
        const quest = indexes.byId.get(id)
        const status = displayedStatus(statuses.get(id)?.status || 'unknown', detailedStatuses)
        return {
          data: {
            id: String(id),
            label: graphNodeLabel(quest.code, status),
            width: Math.max(40, Math.min(68, quest.code.length * 6.5 + 18)),
            status,
            category: quest.category,
          },
          selected: id === number(selectedId),
        }
      }),
      ...graph.edges.map(([source, target]) => ({
        data: { id: `${source}-${target}`, source: String(source), target: String(target) },
      })),
    ]
    const cy = cytoscape({
      container: container.current,
      elements,
      layout: { name: 'dagre', rankDir: direction, nodeSep: 5, edgeSep: 3, rankSep: 22, padding: 10 },
      minZoom: 0.25,
      maxZoom: 2.5,
      wheelSensitivity: 0.18,
      autoungrabify: true,
      textureOnViewport: true,
      hideEdgesOnViewport: false,
      style: [
        {
          selector: 'node',
          style: {
            width: 'data(width)',
            height: 18,
            padding: 0,
            shape: 'rectangle',
            'background-color': '#87909c',
            'border-width': 1,
            'border-color': '#17191d',
            color: '#ffffff',
            label: 'data(label)',
            'font-size': 11,
            'font-weight': 700,
            'text-outline-color': '#15171b',
            'text-outline-width': 1,
            'text-valign': 'center',
            'text-halign': 'center',
          },
        },
        ...Object.entries(CATEGORY_COLORS).map(([category, color]) => ({
          selector: `node[category = "${category}"]`,
          style: { 'background-color': color },
        })),
        { selector: 'node[status = "unlocked"]', style: { opacity: 0.95 } },
        { selector: 'node[status = "unknown"]', style: { opacity: 1, 'background-blacken': 0.25 } },
        { selector: 'node[status = "available"]', style: { opacity: 0.95 } },
        { selector: 'node[status = "active"]', style: { 'border-width': 3, 'border-color': '#ffb366', opacity: 1 } },
        { selector: 'node[status = "claimable"]', style: { 'border-width': 3, 'border-color': '#ff66a1', opacity: 1 } },
        { selector: 'node[status = "locked"]', style: { opacity: 1, 'border-style': 'dotted', 'background-blacken': 0.38 } },
        { selector: 'node[status = "completed"]', style: { 'border-width': 2, 'border-color': '#8ce3b8', opacity: 0.48, 'background-blacken': 0.32 } },
        { selector: 'node[status = "inferred-completed"]', style: { 'border-width': 2, 'border-style': 'dashed', 'border-color': '#8ce3b8', opacity: 0.48, 'background-blacken': 0.32 } },
        { selector: 'node[status = "incomplete-data"]', style: { 'border-width': 2, 'border-style': 'dashed', 'border-color': '#ff7373', opacity: 1 } },
        {
          selector: 'node:selected',
          style: { 'border-width': 4, 'border-color': '#ffffff', opacity: 1, 'overlay-color': '#ffffff', 'overlay-opacity': 0.1 },
        },
        {
          selector: 'edge',
          style: {
            width: 1.25,
            'line-color': '#929ba8',
            'target-arrow-color': '#929ba8',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            opacity: 0.82,
          },
        },
        { selector: 'edge.is-focus', style: { width: 2.2, opacity: 1, 'line-color': '#d9dee7', 'target-arrow-color': '#d9dee7' } },
      ],
    })
    cyRef.current = cy
    selectedNodeRef.current = selectedId == null ? null : String(selectedId)
    apiRef.current = {
      fit: () => cy.fit(undefined, 12),
      center: () => {
        const node = cy.$(':selected')
        if (node.length) cy.animate({ center: { eles: node }, duration: 160 })
      },
      focus: (id) => {
        const node = cy.$id(String(id))
        if (node.length) cy.center(node)
      },
    }
    cy.on('tap', 'node', (event) => onSelect(number(event.target.id()), false))
    const selectedNode = cy.$id(String(selectedId))
    if (graph.nodeIds.length > 120 && selectedNode.length) {
      cy.center(selectedNode)
      cy.zoom({ level: 0.9, position: selectedNode.position() })
    } else {
      cy.fit(undefined, 12)
    }
    return () => {
      apiRef.current = null
      cyRef.current = null
      selectedNodeRef.current = null
      focusedEdgesRef.current = null
      cy.destroy()
    }
  }, [direction, graph, onSelect])

  React.useEffect(() => {
    const cy = cyRef.current
    if (!cy) return undefined
    const update = () => {
      if (cyRef.current !== cy) return
      cy.batch(() => {
        graph.nodeIds.forEach((id) => {
          const status = displayedStatus(statuses.get(id)?.status || 'unknown', detailedStatuses)
          cy.$id(String(id)).data({
            status,
            label: graphNodeLabel(indexes.byId.get(id).code, status),
          })
        })
      })
    }
    if (typeof window.requestAnimationFrame === 'function') {
      const frame = window.requestAnimationFrame(update)
      return () => window.cancelAnimationFrame(frame)
    }
    const timer = setTimeout(update, 0)
    return () => clearTimeout(timer)
  }, [graph, statusSignature])

  React.useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    const previousId = selectedNodeRef.current
    if (previousId != null && previousId !== String(selectedId)) {
      cy.$id(previousId).unselect()
    }
    focusedEdgesRef.current?.removeClass('is-focus')
    focusedEdgesRef.current = null
    selectedNodeRef.current = selectedId == null ? null : String(selectedId)
    const node = cy.$id(String(selectedId))
    if (node.length) {
      node.select()
      const focusedEdges = node.predecessors('edge').union(node.outgoers('edge'))
      focusedEdges.addClass('is-focus')
      focusedEdgesRef.current = focusedEdges
    }
  }, [graph, selectedId])

  return h('div', { className: 'qp-graph', ref: container })
}

function RelationList({ label, ids, statuses, detailedStatuses, rootState, catalogs, hiddenIds, onSelect }) {
  const visibleIds = (ids || []).filter((id) => !hiddenIds?.has(number(id)))
  if (visibleIds.length === 0) return null
  return h(
    'div',
    { className: 'qp-relation' },
    h('span', { className: 'qp-section-label' }, label),
    h(
      'div',
      { className: 'qp-chip-row' },
      ...visibleIds.map((id) => {
        const quest = indexes.byId.get(number(id))
        const phase = questPhase(statuses?.get(number(id))?.status || 'unknown')
        const button = quest
          ? h(Button, {
              key: id,
              minimal: true,
              small: true,
              icon: QUEST_PHASE[phase].icon,
              title: QUEST_PHASE[phase].label,
              className: `qp-category-button qp-category-${quest.category} qp-relation-phase-${phase}`,
              onClick: () => onSelect(number(id)),
            }, quest.code)
          : null
        return quest && button
          ? h(QuestPopover, {
              key: id,
              quest,
              status: statuses?.get(number(id))?.status || 'unknown',
              statuses,
              detailedStatuses,
              rootState,
              catalogs,
            }, button)
          : button
      }),
    ),
  )
}

function MissingRelationList({ ids }) {
  if (!ids || ids.length === 0) return null
  return h(
    'div',
    { className: 'qp-relation' },
    h('span', { className: 'qp-section-label' }, '前置缺失'),
    h('div', { className: 'qp-chip-row' }, ...ids.map((id) => h(
      Tag,
      { minimal: true, key: id, className: 'qp-relation-phase-unknown' },
      h(Icon, { icon: QUEST_PHASE.unknown.icon, size: 12 }),
      h('span', null, id),
    ))),
  )
}

function IgnoredRelationList({ entries, statuses, detailedStatuses, rootState, catalogs, hiddenIds, onSelect }) {
  const visibleEntries = (entries || []).filter((entry) => !hiddenIds?.has(number(entry.questId)))
  if (visibleEntries.length === 0) return null
  return h(
    'div',
    { className: 'qp-relation' },
    h('span', { className: 'qp-section-label' }, '限时前置'),
    h(
      'div',
      { className: 'qp-chip-row' },
      ...visibleEntries.map((entry, index) => {
        const quest = indexes.byId.get(number(entry.questId))
        const phase = questPhase(statuses?.get(number(entry.questId))?.status || 'unknown')
        const button = entry.questId
          ? h(Button, {
              key: `${entry.code}-${index}`,
              minimal: true,
              small: true,
              icon: QUEST_PHASE[phase].icon,
              title: QUEST_PHASE[phase].label,
              className: `qp-category-button${quest ? ` qp-category-${quest.category}` : ''} qp-relation-phase-${phase}`,
              onClick: () => onSelect(number(entry.questId)),
            }, entry.code)
          : h(Tag, { minimal: true, key: `${entry.code}-${index}`, className: 'qp-relation-phase-unknown' },
              h(Icon, { icon: QUEST_PHASE.unknown.icon, size: 12 }),
              h('span', null, entry.code),
            )
        const questKey = number(entry.questId)
        return quest && button
          ? h(QuestPopover, {
              key: `${entry.code}-${index}`,
              quest,
              status: statuses?.get(questKey)?.status || 'unknown',
              statuses,
              detailedStatuses,
              rootState,
              catalogs,
            }, button)
          : button
      }),
    ),
  )
}

const QuestListItem = React.memo(function QuestListItem({ quest, name, status, detailedStatuses, selected, todo, statuses, rootState, catalogs, onSelect }) {
  const shownStatus = displayedStatus(status, detailedStatuses)
  const button = h(
    'button',
    {
      type: 'button',
      className: `qp-list-item qp-category-${quest.category} qp-status-${shownStatus}${selected ? ' is-selected' : ''}`,
      onClick: () => onSelect(quest.id),
    },
    h('span', { className: 'qp-list-code' }, quest.code),
    h('span', { className: 'qp-list-name' }, name),
    todo ? h('span', { className: 'qp-todo-dot' }) : null,
    h('span', { className: `qp-state-badge qp-state-${shownStatus}`, title: STATUS_LABELS[shownStatus] },
      h('b', null, h(Icon, { icon: STATUS_ICONS[shownStatus], size: 13 })),
    ),
  )
  return h(QuestPopover, {
    quest,
    status,
    statuses,
    detailedStatuses,
    rootState,
    catalogs,
  }, button)
})

function recommendationIcon(kind) {
  if (kind === 'sortie') return 'send-to-graph'
  if (kind === 'exercise') return 'people'
  if (kind === 'expedition') return 'time'
  if (kind === 'factory') return 'build'
  return 'link'
}

function RecommendationBadges({ recommendations, statuses, detailedStatuses, rootState, catalogs, onSelect }) {
  const entries = Array.isArray(recommendations) ? recommendations : []
  if (!entries.length) return null
  return h(
    'div',
    { className: 'qp-recommendation-badges' },
    ...entries.map((recommendation) => {
      const quest = indexes.byId.get(number(recommendation.id))
      const status = statuses?.get(number(recommendation.id))?.status || 'unknown'
      const shownStatus = displayedStatus(status, detailedStatuses)
      const category = quest?.category || recommendation.category || recommendation.kind || 'other'
      const button = h(Button, {
        key: recommendation.id,
        minimal: true,
        small: true,
        icon: STATUS_ICONS[shownStatus] || STATUS_ICONS.unknown,
        className: `qp-recommendation-badge qp-category-${category} qp-status-${shownStatus}`,
        onClick: () => onSelect?.(number(recommendation.id)),
      }, recommendation.code || `#${recommendation.id}`)
      return quest
        ? h(QuestPopover, {
            key: recommendation.id,
            quest,
            status,
            statuses,
            detailedStatuses,
            rootState,
            catalogs,
          }, button)
        : button
    }),
  )
}

function prerequisiteGroupStatus(rows) {
  if (!rows.length) return 'ready'
  if (rows.some((row) => row.status === 'unknown')) return 'unknown'
  return rows.every((row) => row.status === 'ready') ? 'ready' : 'blocked'
}

function RequirementSections({ sections, statuses, detailedStatuses, rootState, catalogs, onSelect }) {
  return h(
    React.Fragment,
    null,
    ...sections.map((section) => h(
      'section',
      { className: `qp-requirement-section qp-requirement-${section.id}`, key: section.id },
      h('div', { className: 'qp-requirement-title' }, section.label),
      ...section.rows.map((row) => {
        if (row.kind === 'recommendation') {
          return h(
            'div',
            { className: `qp-requirement-row qp-requirement-recommendation qp-recommendation-row qp-recommendation-${row.recommendationType || 'quest'}`, key: row.key },
            h('span', { className: 'qp-requirement-state', title: '可同时完成' }, h(Icon, { icon: recommendationIcon(row.recommendationType), size: 12 })),
            h(
              'div',
              { className: 'qp-recommendation-content' },
              h('span', { className: 'qp-requirement-text' }, row.text),
              h(RecommendationBadges, {
                recommendations: row.recommendations,
                statuses,
                detailedStatuses,
                rootState,
                catalogs,
                onSelect,
              }),
            ),
          )
        }
        const visualStatus = section.id === 'progress' && row.status === 'blocked' ? 'progressing' : row.status
        const state = REQUIREMENT_STATUS[visualStatus] || REQUIREMENT_STATUS.unknown
        return h(
          'div',
          { className: `qp-requirement-row qp-requirement-${visualStatus}`, key: row.key },
          h('span', { className: 'qp-requirement-state', title: state.label }, h(Icon, { icon: state.icon, size: 12 })),
          h('span', { className: 'qp-requirement-text' }, row.text),
          row.required == null
            ? null
            : h('span', { className: 'qp-requirement-count' }, `${row.actual == null ? '—' : row.actual}/${row.required}`),
        )
      }),
    )),
  )
}

function RewardDetails({ rewards }) {
  if (!rewards) return null
  const entries = Array.isArray(rewards.entries) ? rewards.entries : []
  const choices = Array.isArray(rewards.choices) ? rewards.choices : []
  const choiceEntryIds = new Set(choices.flatMap((choice) => choice.entryIds || []))
  const fixedEntries = entries.filter((entry) => !choiceEntryIds.has(entry.id))
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const unresolved = Array.isArray(rewards.unresolved) ? rewards.unresolved : []
  if (fixedEntries.length === 0 && choices.length === 0 && unresolved.length === 0) return null
  const renderEntry = (entry, key) => h(
    'div',
    { className: `qp-reward-entry qp-reward-${entry.kind || 'other'}`, key: key || entry.id },
    h(Icon, { className: 'qp-reward-entry-icon', icon: REWARD_KIND_ICONS[entry.kind] || REWARD_KIND_ICONS.other, size: 14 }),
    h('span', { className: 'qp-reward-entry-kind' }, REWARD_KIND_LABELS[entry.kind] || REWARD_KIND_LABELS.other),
    h('span', { className: 'qp-reward-entry-text' }, rewardEntryText(entry)),
    h('span', { className: 'qp-reward-entry-quantity' }, rewardQuantityText(entry)),
  )
  const renderGroup = (title, groupEntries, className, key) => h(
    'section',
    { className: `qp-reward-group ${className || ''}`, key },
    h('div', { className: 'qp-reward-group-title' }, title),
    h('div', { className: 'qp-reward-list' }, ...groupEntries.map((entry) => renderEntry(entry))),
  )
  return h(
    'div',
    { className: 'qp-rewards-structured' },
    fixedEntries.length
      ? renderGroup('确定奖励', fixedEntries, 'qp-reward-fixed', 'fixed')
      : null,
    ...choices.map((choice, index) => renderGroup(
      `选择奖励 ${index + 1}（${choice.choose || 1}项）`,
      (choice.entryIds || []).map((entryId) => byId.get(entryId)).filter(Boolean),
      `qp-reward-choice${choice.valid === false ? ' is-invalid' : ''}`,
      choice.id || index,
    )),
    unresolved.length
      ? renderGroup('未解析奖励', unresolved.map((entry, index) => ({
          id: `unresolved-${index}`,
          kind: 'other',
          label: entry.raw,
          quantity: 1,
        })), 'qp-reward-unresolved', 'unresolved')
      : null,
  )
}

function QuestHoverContent({ quest, status, statuses, detailedStatuses, rootState, catalogs }) {
  if (!quest) return null
  const shownStatus = displayedStatus(status || 'unknown', detailedStatuses)
  const prerequisite = prerequisiteProgress({ quest, rootState, catalogs })
  const goal = rootState?.info?.quests?.questGoals?.[quest.id] || quest.tracking?.poiGoal
  const record = rootState?.info?.quests?.records?.[quest.id]
  const sections = buildRequirementSections({
    quest,
    rootState,
    catalogs,
    goal,
    record,
    questStatus: status || 'unknown',
    recommendationsByProgress: {},
  })
  const progressRows = sections.find((section) => section.id === 'progress')?.rows
    .filter((row) => row.kind !== 'recommendation') || []
  const prerequisiteGroups = ['a', 'b', 'c'].map((id) => {
    const rows = sections.find((section) => section.id === id)?.rows || []
    return { id, rows, status: prerequisiteGroupStatus(rows) }
  })
  return h(
    'div',
    { className: 'qp-quest-hover-card' },
    h(
      'div',
      { className: 'qp-quest-hover-header' },
      h('span', { className: `qp-quest-hover-code qp-category-${quest.category}` }, quest.code),
      h('span', { className: 'qp-quest-hover-name' }, quest.name),
    ),
    h(
      'div',
      { className: 'qp-quest-hover-status' },
      h(Icon, { icon: STATUS_ICONS[shownStatus] || STATUS_ICONS.unknown, size: 13 }),
      h('span', null, STATUS_LABELS[shownStatus] || STATUS_LABELS.unknown),
      h('span', { className: 'qp-quest-hover-repeat' }, REPEAT_LABELS[quest.repeat] || REPEAT_LABELS.unknown),
      h('span', { className: `qp-quest-hover-category qp-category-${quest.category}` }, CATEGORY_LABELS[quest.category] || CATEGORY_LABELS.other),
    ),
    h(
      'div',
      { className: 'qp-quest-hover-prerequisites' },
      h('span', { className: 'qp-quest-hover-label' }, '前提'),
      prerequisite.hasPrerequisites
        ? h(
            'div',
            { className: 'qp-quest-hover-prerequisite-groups' },
            ...prerequisiteGroups.map((group) => {
              const state = REQUIREMENT_STATUS[group.status] || REQUIREMENT_STATUS.unknown
              return h(
                'div',
                { className: `qp-quest-hover-prerequisite-group qp-hover-prerequisite-${group.status}`, key: group.id },
                h(
                  'div',
                  { className: 'qp-quest-hover-prerequisite-heading' },
                  h(Icon, { icon: state.icon, size: 12 }),
                  h('span', null, `${group.id.toUpperCase()} ${state.label}`),
                ),
                group.rows.length
                  ? h(
                      'div',
                      { className: 'qp-quest-hover-prerequisite-rows' },
                      ...group.rows.map((row) => {
                        const rowState = REQUIREMENT_STATUS[row.status] || REQUIREMENT_STATUS.unknown
                        return h(
                          'div',
                          { className: `qp-quest-hover-prerequisite-row qp-requirement-${row.status}`, key: row.key },
                          h(Icon, { icon: rowState.icon, size: 11 }),
                          h('span', null, row.text),
                          row.required == null ? null : h('span', { className: 'qp-quest-hover-count' }, `${row.actual == null ? '—' : row.actual}/${row.required}`),
                        )
                      }),
                    )
                  : null,
              )
            }),
          )
        : h('span', null, '无'),
    ),
    progressRows.length
      ? h(
          'div',
          { className: 'qp-quest-hover-progress' },
          h('div', { className: 'qp-quest-hover-label' }, '完成进度'),
          ...progressRows.map((row) => {
            const visualStatus = row.status === 'blocked' ? 'progressing' : row.status
            const state = REQUIREMENT_STATUS[visualStatus] || REQUIREMENT_STATUS.unknown
            return h(
              'div',
              { className: `qp-quest-hover-progress-row qp-requirement-${visualStatus}`, key: row.key },
              h(Icon, { icon: state.icon, size: 12 }),
              h('span', null, row.text),
              row.required == null ? null : h('span', { className: 'qp-quest-hover-count' }, `${row.actual == null ? '—' : row.actual}/${row.required}`),
            )
          }),
        )
      : null,
    quest.rewards && (quest.rewards.entries?.length || quest.rewards.choices?.length || quest.rewards.unresolved?.length)
      ? h('div', { className: 'qp-quest-hover-rewards' }, h('div', { className: 'qp-quest-hover-label' }, '奖励'), h(RewardDetails, { rewards: quest.rewards }))
      : quest.rewardText
        ? h('div', { className: 'qp-quest-hover-rewards' }, h('div', { className: 'qp-quest-hover-label' }, '奖励'), h('div', { className: 'qp-quest-hover-reward-text' }, quest.rewardText))
        : null,
  )
}

function QuestPopover({ quest, status, statuses, detailedStatuses, rootState, catalogs, children }) {
  if (typeof Popover !== 'function' || !quest) return children
  return h(
    Popover,
    {
      content: h(QuestHoverContent, { quest, status, statuses, detailedStatuses, rootState, catalogs }),
      interactionKind: 'hover-target',
      placement: 'auto-start',
      hoverOpenDelay: 140,
      hoverCloseDelay: 100,
      minimal: true,
      lazy: true,
      targetTagName: 'div',
      popoverClassName: 'qp-quest-popover',
    },
    children,
  )
}

function HiddenQuestDialog({ isOpen, hiddenIds, onToggle, onClose }) {
  const [query, setQuery] = React.useState('')
  if (typeof Dialog !== 'function') return null
  const needle = String(query || '').trim().toLocaleLowerCase()
  const quests = questData.quests.filter((quest) => {
    if (!needle) return true
    return `${quest.code} ${quest.name}`.toLocaleLowerCase().includes(needle)
  })
  return h(
    Dialog,
    {
      isOpen,
      onClose,
      title: '隐藏任务',
      canEscapeKeyClose: true,
      canOutsideClickClose: true,
      className: 'qp-hidden-dialog',
    },
    h(
      'div',
      { className: 'qp-hidden-dialog-body' },
      h(InputGroup, {
        leftIcon: 'search',
        placeholder: '搜索任务',
        value: query,
        onChange: (event) => setQuery(event.target.value),
      }),
      h(
        'div',
        { className: 'qp-hidden-list' },
        ...quests.map((quest) => h(
          'label',
          { className: `qp-hidden-item qp-category-${quest.category}`, key: quest.id },
          h('input', {
            type: 'checkbox',
            checked: hiddenIds.has(quest.id),
            onChange: () => onToggle(quest.id),
          }),
          h('span', { className: 'qp-hidden-code' }, quest.code),
          h('span', { className: 'qp-hidden-name' }, quest.name),
        )),
      ),
    ),
  )
}

function Detail({ quest, status, statuses, detailedStatuses, requirementSections, rootState, catalogs, hiddenIds, onSelect }) {
  if (!quest) return h('section', { className: 'qp-detail' })
  const todo = Boolean(plannerState.todo?.[quest.id])
  const manualCompleted = Boolean(plannerState.manualCompleted?.[quest.id])
  const children = (indexes.children.get(number(quest.id)) || []).filter((id) => !hiddenIds?.has(number(id)))
  const shownStatus = displayedStatus(status, detailedStatuses)
  return h(
    'section',
    { className: `qp-detail qp-category-${quest.category}` },
    h(
      'header',
      { className: 'qp-detail-header' },
      h('div', null, h('span', { className: 'qp-code' }, quest.code), h('h2', null, quest.name)),
      h(
        'div',
        { className: 'qp-actions' },
        h(Button, {
          small: true,
          icon: 'star',
          className: `qp-mark-button qp-mark-todo${todo ? ' is-active' : ''}`,
          onClick: () => toggleField('todo', quest.id),
        }, '待做'),
        h(Button, {
          small: true,
          icon: 'tick',
          className: `qp-mark-button qp-mark-completed${manualCompleted ? ' is-active' : ''}`,
          onClick: () => toggleCompleted(quest.id),
        }, manualCompleted ? '已确认' : '确认完成'),
      ),
    ),
    h(
      'div',
      { className: 'qp-tags' },
      h(Tag, { minimal: true, className: `qp-status-tag qp-status-${shownStatus}` },
        h(Icon, { icon: STATUS_ICONS[shownStatus], size: 12 }),
        h('span', null, STATUS_LABELS[shownStatus]),
      ),
      h(Tag, { minimal: true, className: `qp-category-tag qp-category-${quest.category}` }, CATEGORY_LABELS[quest.category] || CATEGORY_LABELS.other),
      h(Tag, { minimal: true }, REPEAT_LABELS[quest.repeat] || REPEAT_LABELS.unknown),
    ),
    h(
      'div',
      { className: 'qp-detail-content' },
      h(
        'div',
        { className: 'qp-detail-copy' },
        quest.detail ? h('p', { className: 'qp-description' }, quest.detail) : null,
        quest.note ? h('p', { className: 'qp-note' }, quest.note) : null,
        h(RewardDetails, { rewards: quest.rewards }),
        !quest.rewards?.entries?.length && !quest.rewards?.choices?.length && quest.rewardText
          ? h('p', { className: 'qp-rewards' }, quest.rewardText)
          : null,
      ),
      h(
        'div',
        { className: 'qp-detail-meta' },
        h(RequirementSections, { sections: requirementSections, statuses, detailedStatuses, rootState, catalogs, onSelect }),
        h(RelationList, { label: '前置', ids: quest.prerequisites, statuses, detailedStatuses, rootState, catalogs, hiddenIds, onSelect }),
        h(MissingRelationList, { ids: quest.unresolvedPrerequisites }),
        h(IgnoredRelationList, { entries: quest.dependencies?.ignored, statuses, detailedStatuses, rootState, catalogs, hiddenIds, onSelect }),
        h(RelationList, { label: '后续', ids: children, statuses, detailedStatuses, rootState, catalogs, hiddenIds, onSelect }),
      ),
    ),
  )
}

function QuestPlanner() {
  const savedUi = sanitizeUiConfig(plannerState.ui)
  const [revision, setRevision] = React.useState(0)
  const [query, setQuery] = React.useState(savedUi.query)
  const [advancedSearch, setAdvancedSearch] = React.useState(savedUi.advancedSearch)
  const [advancedQueries, setAdvancedQueries] = React.useState(() => ({ ...savedUi.advancedQueries }))
  const [statusFilters, setStatusFilters] = React.useState(() => [...savedUi.statusFilters])
  const [categoryFilters, setCategoryFilters] = React.useState(() => [...savedUi.categoryFilters])
  const [repeatFilters, setRepeatFilters] = React.useState(() => [...savedUi.repeatFilters])
  const [prerequisiteFilter, setPrerequisiteFilter] = React.useState(savedUi.prerequisiteFilter)
  const [temporaryCompletedRepeats, setTemporaryCompletedRepeats] = React.useState(() => [...savedUi.temporaryCompletedRepeats])
  const [todoOnly, setTodoOnly] = React.useState(savedUi.todoOnly)
  const [detailedStatuses, setDetailedStatuses] = React.useState(savedUi.detailedStatuses)
  const [direction, setDirection] = React.useState(savedUi.direction)
  const [selectedId, setSelectedId] = React.useState(null)
  const [hiddenModalOpen, setHiddenModalOpen] = React.useState(false)
  const graphApi = React.useRef(null)
  const temporaryCompletedSignature = temporaryCompletedRepeats.slice().sort().join(',')
  const advancedQueriesSignature = JSON.stringify(advancedQueries)
  const hiddenSignature = Object.keys(plannerState.hidden || {})
    .filter((id) => plannerState.hidden[id] === true)
    .sort((left, right) => number(left) - number(right))
    .join(',')

  React.useEffect(() => {
    const update = () => setRevision((value) => value + 1)
    listeners.add(update)
    ensureLoaded()
    return () => listeners.delete(update)
  }, [])

  React.useEffect(() => {
    if (!ensureLoaded()) return
    plannerState.ui = {
      ...(plannerState.ui || {}),
      query,
      advancedSearch,
      advancedQueries,
      statusFilters,
      categoryFilters,
      repeatFilters,
      prerequisiteFilter,
      temporaryCompletedRepeats,
      todoOnly,
      detailedStatuses,
      direction,
    }
    scheduleUiPersist()
  }, [
    query,
    advancedSearch,
    advancedQueriesSignature,
    statusFilters,
    categoryFilters,
    repeatFilters,
    prerequisiteFilter,
    temporaryCompletedSignature,
    todoOnly,
    detailedStatuses,
    direction,
  ])

  const state = rootState()
  const activeIds = activeQuestIds(state)
  const inference = React.useMemo(
    () => inferWithTemporaryRepeatCompletions(
      questData.quests,
      plannerState,
      activeIds,
      temporaryCompletedRepeats,
    ),
    [revision, state?.info?.quests?.activeQuests, temporaryCompletedSignature],
  )
  const statuses = inference.statuses
  const directHiddenIds = React.useMemo(
    () => directHiddenQuestIds(plannerState),
    [revision, hiddenSignature],
  )
  const hiddenIds = React.useMemo(
    () => hiddenQuestIds(questData.quests, directHiddenIds, statuses),
    [directHiddenIds, statuses, hiddenSignature],
  )
  React.useEffect(() => {
    if (selectedId != null && hiddenIds.has(number(selectedId))) setSelectedId(null)
  }, [selectedId, hiddenIds])
  const prerequisiteProgressById = React.useMemo(
    () => new Map(questData.quests.map((quest) => [
      quest.id,
      prerequisiteProgress({ quest, rootState: state, catalogs: questData.catalogs }),
    ])),
    [
      state?.info?.ships,
      state?.info?.fleets,
      state?.info?.equips,
      state?.info?.basic,
      state?.info?.resources,
      state?.info?.useitems,
      state?.info?.maps,
      state?.info?.airbase,
      state?.info?.dataFreshness,
      state?.const?.$ships,
      state?.const?.$equips,
    ],
  )
  const searchQuery = advancedSearch ? advancedQueries : query.trim().toLocaleLowerCase()
  const quests = React.useMemo(
    () => questData.quests
      .filter((quest) => !hiddenIds.has(quest.id))
      .filter((quest) => categoryFilters.includes(quest.category))
      .filter((quest) => repeatFilters.includes(quest.repeat))
      .filter((quest) => statusFilters.includes(statuses.get(quest.id)?.status || 'unknown'))
      .filter((quest) => prerequisiteFilterMatches(
        prerequisiteFilter,
        prerequisiteProgressById.get(quest.id) || { hasPrerequisites: false, fulfilledGroups: 0 },
      ))
      .filter((quest) => !todoOnly || plannerState.todo?.[quest.id])
      .filter((quest) => questMatchesSearch(quest, searchQuery)),
    [hiddenIds, categoryFilters, repeatFilters, statusFilters, prerequisiteFilter, prerequisiteProgressById, statuses, todoOnly, searchQuery, advancedSearch, advancedQueriesSignature],
  )
  const selectedBase = quests.find((quest) => quest.id === number(selectedId))
    || (selectedId == null || hiddenIds.has(number(selectedId))
      ? null
      : questData.quests.find((quest) => quest.id === number(selectedId)))
    || quests[0]
    || null
  const selected = selectedBase ? effectiveQuest(selectedBase) : null
  const questGoal = selected
    ? state?.info?.quests?.questGoals?.[selected.id] || selected.tracking?.poiGoal
    : null
  const record = selected ? state?.info?.quests?.records?.[selected.id] : null
  const concurrentRecommendationsByProgress = React.useMemo(
    () => {
      if (!selected) return {}
      const recommendations = findConcurrentQuestRecommendationsByProgress(selected, questData.quests, statuses, questData.catalogs)
      return Object.fromEntries(Object.entries(recommendations).map(([key, entries]) => [
        key,
        entries.filter((entry) => !hiddenIds.has(number(entry.id))),
      ]))
    },
    [selected?.id, statuses, questData.catalogs, hiddenIds],
  )
  const requirementSections = selected
    ? buildRequirementSections({
        quest: selected,
        rootState: state,
        catalogs: questData.catalogs,
        goal: questGoal,
        record,
        questStatus: statuses.get(selected.id)?.status || 'unknown',
        recommendationsByProgress: concurrentRecommendationsByProgress,
      })
    : []
  const graphQuests = selected && !hiddenIds.has(selected.id) && !quests.some((quest) => quest.id === selected.id)
    ? [selected, ...quests]
    : quests
  const selectQuest = React.useCallback((id, locate = true) => {
    setSelectedId(id)
    if (locate) graphApi.current?.focus(id)
  }, [])
  const coarseStatusValues = Object.entries(COARSE_STATUS_GROUPS)
    .filter(([, fineStatuses]) => fineStatuses.every((status) => statusFilters.includes(status)))
    .map(([status]) => status)
  const partialCoarseStatusValues = Object.entries(COARSE_STATUS_GROUPS)
    .filter(([, fineStatuses]) => {
      const selectedCount = fineStatuses.filter((status) => statusFilters.includes(status)).length
      return selectedCount > 0 && selectedCount < fineStatuses.length
    })
    .map(([status]) => status)
  const toggleStatusFilter = (value, exclusive) => {
    const targetStatuses = detailedStatuses ? [value] : COARSE_STATUS_GROUPS[value]
    setStatusFilters((current) => {
      if (exclusive) return exclusiveOrAll(current, targetStatuses, STATUS_FILTER_OPTIONS.map(([status]) => status))
      const allSelected = targetStatuses.every((status) => current.includes(status))
      if (allSelected) return current.filter((status) => !targetStatuses.includes(status))
      return Array.from(new Set([...current, ...targetStatuses]))
    })
  }
  const filtersChanged = query || advancedSearch || Object.values(advancedQueries).some(Boolean) || todoOnly
    || !sameSelection(statusFilters, DEFAULT_STATUS_FILTERS)
    || !sameSelection(categoryFilters, DEFAULT_CATEGORY_FILTERS)
    || !sameSelection(repeatFilters, DEFAULT_REPEAT_FILTERS)
    || prerequisiteFilter !== DEFAULT_PREREQUISITE_FILTER

  return h(
    'div',
    { className: 'quest-planner bp6-dark' },
    h('link', { rel: 'stylesheet', href: path.join(__dirname, 'assets', 'quest-planner.css') }),
    h('div', { className: 'qp-titlebar' }, '任务规划'),
    h(
      'div',
      { className: 'qp-toolbar' },
      h('div', { className: 'qp-toolbar-main' },
        advancedSearch
          ? null
          : h(InputGroup, {
            leftIcon: 'search',
            placeholder: '搜索',
            value: query,
            onChange: (event) => setQuery(event.target.value),
          }),
        h(Button, { small: true, icon: 'star', className: `qp-filter-button${todoOnly ? ' is-active' : ''}`, onClick: () => setTodoOnly((value) => !value) }, '待做'),
        h(Button, {
          small: true,
          icon: hiddenModalOpen ? 'eye-open' : 'eye-off',
          title: '管理隐藏任务',
          className: `qp-filter-button${hiddenModalOpen || directHiddenIds.size ? ' is-active' : ''}`,
          onClick: () => setHiddenModalOpen(true),
        }, '隐藏'),
        h('span', { className: 'qp-count' }, quests.length),
        h('span', { className: 'qp-toolbar-spacer' }),
        h(Button, {
          small: true,
          icon: 'search-template',
          className: `qp-filter-button${advancedSearch ? ' is-active' : ''}`,
          onClick: () => setAdvancedSearch((value) => !value),
        }, '高级'),
        h(Button, {
          small: true,
          icon: 'properties',
          className: `qp-filter-button${detailedStatuses ? ' is-active' : ''}`,
          onClick: () => setDetailedStatuses((value) => !value),
        }, '细分'),
        h(HTMLSelect, {
          minimal: true,
          value: direction,
          options: [{ value: 'LR', label: '横向图' }, { value: 'TB', label: '纵向图' }],
          onChange: (event) => setDirection(event.target.value),
        }),
        h(Button, { minimal: true, icon: 'zoom-to-fit', title: '适合窗口', onClick: () => graphApi.current?.fit() }),
        h(Button, { minimal: true, icon: 'locate', title: '定位任务', onClick: () => graphApi.current?.center() }),
        filtersChanged
          ? h(Button, { minimal: true, icon: 'filter-remove', title: '重置筛选', onClick: () => { setQuery(''); setAdvancedSearch(false); setAdvancedQueries({ ...DEFAULT_ADVANCED_QUERIES }); setStatusFilters([...DEFAULT_STATUS_FILTERS]); setCategoryFilters([...DEFAULT_CATEGORY_FILTERS]); setRepeatFilters([...DEFAULT_REPEAT_FILTERS]); setPrerequisiteFilter(DEFAULT_PREREQUISITE_FILTER); setTodoOnly(false) } })
          : null,
      ),
      advancedSearch
        ? h('div', { className: 'qp-advanced-search' }, ...ADVANCED_SEARCH_FIELDS.map(([field, label]) => h(InputGroup, {
          key: field,
          leftIcon: 'search',
          placeholder: label,
          title: 'AND / OR / NOT / ()',
          value: advancedQueries[field],
          onChange: (event) => setAdvancedQueries((current) => ({ ...current, [field]: event.target.value })),
        })))
        : null,
      h('div', { className: 'qp-toolbar-filters' },
        h(FilterBadges, {
          label: '类型',
          options: CATEGORY_FILTER_OPTIONS,
          values: categoryFilters,
          onToggle: (value, exclusive) => setCategoryFilters((current) => exclusive
            ? exclusiveOrAll(current, [value], DEFAULT_CATEGORY_FILTERS)
            : toggleSelection(current, value)),
          classNameFor: (value) => `qp-category-${value}`,
        }),
        h(FilterBadges, {
          label: '完成度',
          options: detailedStatuses ? STATUS_FILTER_OPTIONS : COARSE_STATUS_FILTER_OPTIONS,
          values: detailedStatuses ? statusFilters : coarseStatusValues,
          partialValues: detailedStatuses ? [] : partialCoarseStatusValues,
          onToggle: toggleStatusFilter,
          iconFor: (value) => STATUS_ICONS[value],
          classNameFor: (value) => `qp-state-${value}`,
        }),
        h(FilterBadges, {
          label: '周期',
          options: REPEAT_FILTER_OPTIONS,
          values: repeatFilters,
          onToggle: (value, exclusive) => setRepeatFilters((current) => exclusive
            ? exclusiveOrAll(current, [value], DEFAULT_REPEAT_FILTERS)
            : toggleSelection(current, value)),
        }),
        h(FilterBadges, {
          label: '前提',
          info: FILTER_INFO.prerequisite,
          options: PREREQUISITE_FILTER_OPTIONS,
          values: [prerequisiteFilter],
          onToggle: (value) => setPrerequisiteFilter(value),
          classNameFor: (value) => `qp-prerequisite-${value}`,
        }),
      ),
      h('div', { className: 'qp-toolbar-temporary' },
        h(FilterBadges, {
          label: '暂定完成',
          info: FILTER_INFO.temporary,
          options: TEMPORARY_COMPLETION_OPTIONS,
          values: temporaryCompletedRepeats,
          onToggle: (value, exclusive) => setTemporaryCompletedRepeats((current) => exclusive
            ? exclusiveOrAll(current, [value], TEMPORARY_COMPLETION_OPTIONS.map(([repeat]) => repeat))
            : toggleSelection(current, value)),
          classNameFor: (value) => `qp-temporary-${value}`,
        }),
      ),
    ),
    h(HiddenQuestDialog, {
      isOpen: hiddenModalOpen,
      hiddenIds: directHiddenIds,
      onToggle: (id) => toggleField('hidden', id),
      onClose: () => setHiddenModalOpen(false),
    }),
    h(
      'div',
      { className: 'qp-workspace' },
      h(
        'div',
        { className: 'qp-graph-row' },
        h(
          'aside',
          { className: 'qp-list' },
          ...quests.map((quest) => h(QuestListItem, {
            key: quest.id,
            quest,
            name: plannerState.observed?.[quest.id]?.title || quest.name,
            status: statuses.get(quest.id)?.status || 'unknown',
            detailedStatuses,
            selected: selected?.id === quest.id,
            todo: Boolean(plannerState.todo?.[quest.id]),
            statuses,
            rootState: state,
            catalogs: questData.catalogs,
            onSelect: selectQuest,
          })),
        ),
        h(Graph, { quests: graphQuests, selectedId: selected?.id, statuses, detailedStatuses, direction, apiRef: graphApi, onSelect: selectQuest }),
      ),
      h(Detail, {
        quest: selected,
        status: selected ? statuses.get(selected.id)?.status || 'unknown' : 'unknown',
        statuses,
        detailedStatuses,
        requirementSections,
        rootState: state,
        catalogs: questData.catalogs,
        hiddenIds,
        onSelect: selectQuest,
      }),
    ),
  )
}

exports.reactClass = QuestPlanner
exports.windowMode = true
exports.switchPluginPath = ['/kcsapi/api_get_member/questlist']
exports.pluginDidLoad = start
exports.pluginWillUnload = stop
exports.__test = {
  coarseStatus,
  completeQuest,
  displayedStatus,
  effectiveQuest,
  exclusiveOrAll,
  findConcurrentQuestRecommendations,
  findConcurrentQuestRecommendationsByProgress,
  findConcurrentQuestRecommendationsForObjective,
  graphNodeLabel,
  inferWithTemporaryRepeatCompletions,
  prerequisiteFilterMatches,
  questPhase,
  questMatchesSearch,
  rewardEntryLabel,
  rewardEntryText,
  rewardQuantityText,
  sanitizePlannerState,
  sanitizeUiConfig,
  toggleField,
  updateQuestList,
  withTemporaryRepeatCompletions,
}
