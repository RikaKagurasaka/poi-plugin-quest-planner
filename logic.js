'use strict'

const CATEGORY_LABELS = {
  composition: '编成',
  sortie: '出击',
  exercise: '演习',
  expedition: '远征',
  supply: '补给',
  factory: '工厂',
  modernization: '改装',
  other: '其他',
}

const EVENT_LABELS = {
  formation: '编成',
  factory: '工厂',
  practice: '演习',
  practice_win: '演习胜利',
  practice_win_a: '演习 A 胜',
  practice_win_s: '演习 S 胜',
  mission_success: '远征成功',
  repair: '入渠',
  supply: '补给',
  create_item: '开发',
  create_ship: '建造',
  destroy_ship: '解体',
  destory_item: '废弃',
  remodel_item: '装备改修',
  remodel_ship: '近代化改修',
  sally: '出击',
  reach_mapcell: '到达节点',
  battle: '战斗',
  battle_win: '战斗胜利',
  battle_rank_s: 'S 胜',
  battle_boss: 'Boss 战',
  battle_boss_win: 'Boss 胜利',
  battle_boss_win_s: 'Boss S 胜',
  battle_boss_win_rank_a: 'Boss A 胜',
  battle_boss_win_rank_s: 'Boss S 胜',
  sinking: '击沉',
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function booleanQueryTokens(query) {
  const rawTokens = String(query || '').match(/"[^"\n]*"|'[^'\n]*'|\(|\)|\S+/g) || []
  return rawTokens.map((raw) => {
    const quoted = (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
    const value = quoted ? raw.slice(1, -1) : raw
    if (quoted) return { type: 'term', value }
    if (value === '(') return { type: 'open' }
    if (value === ')') return { type: 'close' }
    const operator = value.toLocaleUpperCase()
    if (['AND', '且', '并且', '&&'].includes(operator)) return { type: 'and' }
    if (['OR', '或', '||'].includes(operator)) return { type: 'or' }
    if (['NOT', '非', '!'].includes(operator)) return { type: 'not' }
    return { type: 'term', value }
  })
}

function booleanQueryMatches(query, haystack) {
  const tokens = booleanQueryTokens(query)
  if (tokens.length === 0) return true
  const text = String(haystack || '').toLocaleLowerCase()
  let cursor = 0
  const peek = () => tokens[cursor]
  const startsPrimary = (token) => token && ['term', 'open', 'not'].includes(token.type)
  const parsePrimary = () => {
    const token = peek()
    if (!token) return false
    if (token.type === 'open') {
      cursor += 1
      const value = parseOr()
      if (peek()?.type === 'close') cursor += 1
      return value
    }
    if (token.type !== 'term') return false
    cursor += 1
    return text.includes(String(token.value).toLocaleLowerCase())
  }
  const parseUnary = () => {
    if (peek()?.type === 'not') {
      cursor += 1
      return !parseUnary()
    }
    return parsePrimary()
  }
  const parseAnd = () => {
    let value = parseUnary()
    while (peek()?.type === 'and' || startsPrimary(peek())) {
      if (peek()?.type === 'and') cursor += 1
      value = parseUnary() && value
    }
    return value
  }
  const parseOr = () => {
    let value = parseAnd()
    while (peek()?.type === 'or') {
      cursor += 1
      value = parseAnd() || value
    }
    return value
  }
  const result = parseOr()
  while (cursor < tokens.length) cursor += 1
  return result
}

function buildIndexes(quests) {
  const byId = new Map()
  const children = new Map()
  quests.forEach((quest) => {
    byId.set(number(quest.id), quest)
    children.set(number(quest.id), [])
  })
  quests.forEach((quest) => {
    ;(quest.prerequisites || []).forEach((parentId) => {
      if (!children.has(number(parentId))) children.set(number(parentId), [])
      children.get(number(parentId)).push(number(quest.id))
    })
  })
  return { byId, children }
}

function directCompletedQuestIds(quests, plannerState, now = Date.now()) {
  const indexes = buildIndexes(quests)
  const completed = new Set()
  Object.entries(plannerState.manualCompleted || {}).forEach(([id, value]) => {
    const quest = indexes.byId.get(number(id))
    if (value === true || completionIsCurrent(value, quest?.repeat, now)) completed.add(number(id))
  })
  Object.entries(plannerState.completed || {}).forEach(([id, value]) => {
    const quest = indexes.byId.get(number(id))
    if (value && completionIsCurrent(value, quest?.repeat, now)) completed.add(number(id))
  })
  return completed
}

function repeatRank(repeat) {
  return {
    daily: 1,
    weekly: 2,
    monthly: 3,
    quarterly: 4,
    yearly: 5,
    single: Number.POSITIVE_INFINITY,
  }[repeat] ?? null
}

function addCompletedAncestors(seedIds, indexes, completed) {
  const pending = Array.from(seedIds).map((id) => ({
    id,
    horizon: repeatRank(indexes.byId.get(number(id))?.repeat),
  }))
  const visited = new Set()
  while (pending.length > 0) {
    const { id, horizon } = pending.pop()
    const visitKey = `${id}:${horizon}`
    if (visited.has(visitKey)) continue
    visited.add(visitKey)
    const quest = indexes.byId.get(number(id))
    if (!quest) continue
    ;(quest.prerequisites || []).forEach((parentValue) => {
      const parentId = number(parentValue)
      const parent = indexes.byId.get(parentId)
      const parentRank = repeatRank(parent?.repeat)
      if (parent?.repeat === 'single' || (horizon != null && parentRank != null && parentRank >= horizon)) {
        completed.add(parentId)
      }
      pending.push({ id: parentId, horizon })
    })
  }
}

function dependencyRequiresCurrentCompletion(parent, child, at = Date.now()) {
  const parentRank = repeatRank(parent?.repeat)
  const childRank = repeatRank(child?.repeat)
  if (parent?.repeat === 'single') return true
  if (child?.repeat === 'single') return false
  if (parentRank == null || childRank == null) return false
  if (childRank <= parentRank) return true
  const parentStart = cycleStart(at, parent?.repeat)
  const childStart = cycleStart(at, child?.repeat)
  return parentStart != null && childStart != null && parentStart <= childStart
}

function cycleKey(timestamp, repeat) {
  const shifted = new Date(number(timestamp) + 4 * 60 * 60 * 1000)
  const day = shifted.toISOString().slice(0, 10)
  if (repeat === 'daily') return day
  if (repeat === 'weekly') {
    const monday = new Date(`${day}T00:00:00.000Z`)
    const offset = (monday.getUTCDay() + 6) % 7
    monday.setUTCDate(monday.getUTCDate() - offset)
    return monday.toISOString().slice(0, 10)
  }
  if (repeat === 'monthly') return day.slice(0, 7)
  if (repeat === 'quarterly') {
    const month = shifted.getUTCMonth()
    return `${shifted.getUTCFullYear()}-Q${Math.floor(month / 3) + 1}`
  }
  return null
}

function cycleStart(timestamp, repeat) {
  const key = cycleKey(timestamp, repeat)
  if (!key) return null
  if (repeat === 'daily' || repeat === 'weekly') {
    return Date.parse(`${key}T00:00:00.000Z`) - 4 * 60 * 60 * 1000
  }
  if (repeat === 'monthly') {
    return Date.parse(`${key}-01T00:00:00.000Z`) - 4 * 60 * 60 * 1000
  }
  if (repeat === 'quarterly') {
    const match = /^(\d{4})-Q([1-4])$/.exec(key)
    if (!match) return null
    const month = (number(match[2]) - 1) * 3 + 1
    return Date.parse(`${match[1]}-${String(month).padStart(2, '0')}-01T00:00:00.000Z`) - 4 * 60 * 60 * 1000
  }
  return null
}

function latestCompletionAt(plannerState, id) {
  return Math.max(
    number(plannerState.completed?.[id]?.at),
    number(plannerState.manualCompleted?.[id]?.at),
  )
}

function prerequisiteSatisfiedForChild(parent, child, parentStatus, plannerState, at) {
  if (['completed', 'inferred-completed'].includes(parentStatus)) return true
  const completedAt = latestCompletionAt(plannerState, parent?.id)
  if (completedAt <= 0 || completedAt > at) return false
  if (child?.repeat === 'single') return true
  const childStart = cycleStart(at, child?.repeat)
  return childStart != null && completedAt >= childStart
}

function completionIsCurrent(completion, repeat, now = Date.now()) {
  if (!completion || typeof completion !== 'object') return false
  if (!repeat || repeat === 'single' || repeat === 'unknown' || repeat === 'yearly') return true
  return cycleKey(completion.at, repeat) === cycleKey(now, repeat)
}

function inferQuestStatuses(quests, plannerState, activeQuestIds = new Set(), now = Date.now()) {
  const indexes = buildIndexes(quests)
  const snapshotIds = new Set((plannerState.snapshot?.questIds || []).map(number))
  const hasSnapshot = plannerState.snapshot?.complete === true
  const snapshotTime = number(plannerState.snapshot?.completedAt)
  if (hasSnapshot) {
    Object.entries(plannerState.observed || {}).forEach(([id, observed]) => {
      if (number(observed?.seenAt) > snapshotTime) snapshotIds.add(number(id))
    })
  }
  const directCompleted = directCompletedQuestIds(quests, plannerState, now)
  const completed = new Set(directCompleted)

  // Completing any quest proves all of its prerequisites complete.
  addCompletedAncestors(directCompleted, indexes, completed)
  // A currently visible quest proves every known prerequisite in its ancestry complete.
  addCompletedAncestors(snapshotIds, indexes, completed)
  // Historical sightings remain valid evidence for permanent prerequisite tasks.
  const observedSingle = Object.keys(plannerState.observed || {})
    .map(number)
    .filter((id) => indexes.byId.get(id)?.repeat === 'single')
  addCompletedAncestors(observedSingle, indexes, completed)

  // A permanent quest seen before but absent from a complete current snapshot was completed.
  if (hasSnapshot) {
    Object.keys(plannerState.observed || {}).map(number).forEach((id) => {
      const quest = indexes.byId.get(id)
      const observed = plannerState.observed?.[id]
      if (
        !snapshotIds.has(id)
        && number(observed?.seenAt) <= snapshotTime
        && completionIsCurrent({ at: observed?.seenAt }, quest?.repeat, now)
      ) completed.add(id)
    })
    addCompletedAncestors(completed, indexes, completed)
  }

  const statuses = new Map()
  quests.forEach((quest) => {
    const id = number(quest.id)
    const visible = snapshotIds.has(id)
    const observed = plannerState.observed?.[id]
    if (visible) {
      if (number(observed?.apiState) === 3) statuses.set(id, { status: 'claimable', evidence: 'game' })
      else if (activeQuestIds.has(id) || number(observed?.apiState) === 2) statuses.set(id, { status: 'active', evidence: 'game' })
      else statuses.set(id, { status: 'available', evidence: 'game' })
    } else if (completed.has(id)) {
      statuses.set(id, {
        status: directCompleted.has(id) ? 'completed' : 'inferred-completed',
        evidence: directCompleted.has(id) ? 'confirmed' : 'dependency',
      })
    }
  })

  if (!hasSnapshot) {
    quests.forEach((quest) => {
      if (statuses.has(quest.id)) return
      if ((quest.unresolvedPrerequisites || []).length > 0) {
        statuses.set(quest.id, { status: 'incomplete-data', evidence: 'missing-dependency' })
      } else {
        statuses.set(quest.id, {
          status: 'unknown',
          evidence: plannerState.observed?.[quest.id] ? 'history-only' : 'no-snapshot',
        })
      }
    })
    return { statuses, completedIds: completed, snapshotComplete: false }
  }

  let changed = true
  while (changed) {
    changed = false
    quests.forEach((quest) => {
      if (statuses.has(quest.id)) return
      if ((quest.unresolvedPrerequisites || []).length > 0) {
        statuses.set(quest.id, { status: 'incomplete-data', evidence: 'missing-dependency' })
        changed = true
        return
      }
      const parents = (quest.prerequisites || []).map((id) => {
        const parentQuest = indexes.byId.get(number(id))
        const status = statuses.get(number(id))?.status
        return {
          quest: parentQuest,
          status,
          satisfied: prerequisiteSatisfiedForChild(parentQuest, quest, status, plannerState, snapshotTime || now),
        }
      })
      if (parents.some((parent) =>
        ['available', 'active', 'claimable', 'locked'].includes(parent.status)
        && !parent.satisfied
        && dependencyRequiresCurrentCompletion(parent.quest, quest, snapshotTime || now),
      )) {
        statuses.set(quest.id, { status: 'locked', evidence: 'unfinished-prerequisite' })
        changed = true
        return
      }
      if (parents.some((parent) => parent.status === 'incomplete-data')) {
        statuses.set(quest.id, { status: 'incomplete-data', evidence: 'missing-dependency' })
        changed = true
        return
      }
      const prerequisitesResolved = parents.every((parent) => parent.satisfied)
      if ((quest.prerequisites || []).length === 0 || prerequisitesResolved) {
        statuses.set(quest.id, { status: 'inferred-completed', evidence: 'absent-while-unlocked' })
        completed.add(number(quest.id))
        changed = true
      }
    })
  }

  quests.forEach((quest) => {
    if (!statuses.has(quest.id)) statuses.set(quest.id, { status: 'unknown', evidence: 'insufficient-evidence' })
  })
  return { statuses, completedIds: completed, snapshotComplete: true }
}

function mergeQuestListPage(scan, detail) {
  if (String(detail?.postBody?.api_tab_id) !== '0') return { scan, snapshot: null }
  const body = detail?.body || {}
  const page = number(body.api_disp_page) || number(detail?.postBody?.api_page_no) || 1
  const pageCount = Math.max(1, number(body.api_page_count) || 1)
  const expectedCount = Math.max(0, number(body.api_count))
  const timestamp = number(detail?.time) || Date.now()
  const stale = !scan || timestamp - number(scan.startedAt) > 5 * 60 * 1000
  const incompatible = scan && (scan.pageCount !== pageCount || scan.expectedCount !== expectedCount)
  const restart = page === 1 && scan?.pages?.[1]
  const next = stale || incompatible || restart
    ? { startedAt: timestamp, pageCount, expectedCount, pages: {} }
    : { ...scan, pages: { ...(scan?.pages || {}) } }
  next.pages[page] = (Array.isArray(body.api_list) ? body.api_list : [])
    .filter((quest) => quest && typeof quest === 'object' && number(quest.api_no) > 0)
    .map((quest) => number(quest.api_no))
  const questIds = Array.from(new Set(Object.values(next.pages).flat().map(number)))
  const pagesComplete = Array.from({ length: pageCount }, (_, index) => index + 1)
    .every((pageNumber) => Object.prototype.hasOwnProperty.call(next.pages, pageNumber))
  const complete = pagesComplete && questIds.length >= expectedCount
  return {
    scan: next,
    snapshot: complete
      ? { complete: true, completedAt: timestamp, expectedCount, questIds: questIds.sort((a, b) => a - b) }
      : null,
  }
}

function graphForQuestIds(ids, indexes) {
  const nodeIds = Array.from(new Set(ids.map(number))).filter((id) => indexes.byId.has(id))
  const included = new Set(nodeIds)
  const edges = []
  nodeIds.forEach((id) => {
    const quest = indexes.byId.get(id)
    ;(quest?.prerequisites || []).forEach((parentId) => {
      if (included.has(number(parentId))) edges.push([number(parentId), id])
    })
  })
  return { nodeIds, edges }
}

const CONCURRENT_EXCLUDED_REPEATS = new Set(['daily', 'weekly'])
const CONCURRENT_COMPLETED_STATUSES = new Set(['completed', 'inferred-completed', 'claimable'])
const SHIP_SELECTOR_DIMENSIONS = [
  ['masterIds', 'masterId'],
  ['groupIds', 'groupId'],
  ['familyIds', 'familyId'],
  ['typeIds', 'typeId'],
  ['classIds', 'classId'],
]

function uniqueNumbers(values) {
  return Array.from(new Set((values || []).map(number).filter((value) => value > 0)))
}

function collectPredicates(expression, result = []) {
  if (!expression || typeof expression !== 'object') return result
  if (expression.op === 'predicate' && expression.predicate) result.push(expression.predicate)
  if (expression.child) collectPredicates(expression.child, result)
  ;(expression.children || []).forEach((child) => collectPredicates(child, result))
  return result
}

function hasFleetRestriction(predicate = {}) {
  return Boolean(
    predicate.positions?.length
    || predicate.groups?.length
    || predicate.forbidden?.length
    || predicate.size?.min != null
    || predicate.size?.max != null
    || predicate.allowOnlyListed,
  )
}

function cartesianAlternatives(left, right) {
  const result = []
  left.forEach((leftBranch) => right.forEach((rightBranch) => result.push([...leftBranch, ...rightBranch])))
  return result
}

function combinations(length, count) {
  if (count <= 0) return [[]]
  if (count > length) return []
  const result = []
  function visit(start, selected) {
    if (selected.length === count) {
      result.push([...selected])
      return
    }
    for (let index = start; index <= length - (count - selected.length); index += 1) {
      selected.push(index)
      visit(index + 1, selected)
      selected.pop()
    }
  }
  visit(0, [])
  return result
}

function dedupeFleetAlternatives(alternatives) {
  const seen = new Set()
  return alternatives.filter((alternative) => {
    const key = JSON.stringify(alternative)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Project a boolean requirement expression to the fleet predicates which must
 * hold for one possible branch. Non-fleet predicates are intentionally
 * ignored; recommendation is only a proven compatibility hint, not a full
 * quest solver.
 */
function fleetAlternatives(expression) {
  if (!expression || typeof expression !== 'object') return [[]]
  if (expression.op === 'predicate') {
    return expression.predicate?.kind === 'fleet' && hasFleetRestriction(expression.predicate)
      ? [[expression.predicate]]
      : [[]]
  }
  if (expression.op === 'not') return [[]]
  const children = expression.children || []
  if (expression.op === 'all') {
    return dedupeFleetAlternatives(children.reduce(
      (branches, child) => cartesianAlternatives(branches, fleetAlternatives(child)),
      [[]],
    ))
  }
  if (expression.op === 'any') {
    return dedupeFleetAlternatives(children.flatMap((child) => fleetAlternatives(child)))
  }
  if (expression.op === 'atLeast') {
    const required = Math.max(0, number(expression.count))
    if (required === 0) return [[]]
    const result = []
    combinations(children.length, required).forEach((indexes) => {
      indexes.reduce(
        (branches, index) => cartesianAlternatives(branches, fleetAlternatives(children[index])),
        [[]],
      ).forEach((branch) => result.push(branch))
    })
    return dedupeFleetAlternatives(result)
  }
  return [[]]
}

function requirementFleetAlternatives(quest) {
  const conditions = fleetAlternatives(quest.requirements?.conditions)
  if (conditions.some((branch) => branch.length > 0)) return conditions.filter((branch) => branch.length > 0)
  const constraints = (quest.requirements?.objectives || []).map((objective) => objective.constraints).filter(Boolean)
  if (!constraints.length) return []
  // Objective constraints describe the fleet for that objective's map. For a
  // multi-map quest, one shared sortie only needs one objective branch, so do
  // not concatenate every objective's fleet demand into one impossible fleet.
  return dedupeFleetAlternatives(constraints.flatMap((constraint) => fleetAlternatives(constraint)))
    .filter((branch) => branch.length > 0)
}

function fleetAlternativesForObjective(quest, objective, fallback = []) {
  if (!objective) return fallback
  const global = fleetAlternatives(quest.requirements?.conditions).filter((branch) => branch.length > 0)
  const local = fleetAlternatives(objective.constraints).filter((branch) => branch.length > 0)
  if (global.length && local.length) {
    const merged = cartesianAlternatives(global, local).map((branch) => {
      const seen = new Set()
      return branch.filter((predicate) => {
        const signature = JSON.stringify(predicate)
        if (seen.has(signature)) return false
        seen.add(signature)
        return true
      })
    })
    return dedupeFleetAlternatives(merged)
  }
  if (local.length) return local
  if (global.length) return global
  return fallback
}

function fleetAlternativesForMap(quest, mapId, fallback = []) {
  const objectives = (quest.requirements?.objectives || []).filter((objective) => objectiveMapIds(objective).includes(number(mapId)))
  const variants = objectives.flatMap((objective) => fleetAlternativesForObjective(quest, objective, []))
  return variants.length ? dedupeFleetAlternatives(variants) : fallback
}

function fleetAlternativesForQuest(quest, fallback = []) {
  const objectives = quest?.requirements?.objectives || []
  const variants = objectives.flatMap((objective) => fleetAlternativesForObjective(quest, objective, []))
  return variants.length ? dedupeFleetAlternatives(variants) : fallback
}

function questMapIds(quest) {
  const objectiveMapIds = (quest.requirements?.objectives || []).flatMap((objective) => objective.target?.mapIds || [])
  const conditionMapIds = collectPredicates(quest.requirements?.conditions)
    .filter((predicate) => predicate.kind === 'map')
    .flatMap((predicate) => predicate.mapIds || [])
  return uniqueNumbers([...objectiveMapIds, ...conditionMapIds])
}

function questMissionIds(quest) {
  return uniqueNumbers((quest.requirements?.objectives || []).flatMap((objective) => objective.target?.missionIds || []))
}

function buildShipSelectorContext(catalogs = {}) {
  const ships = Array.isArray(catalogs.ships) ? catalogs.ships : []
  const byId = new Map(ships.map((ship) => [number(ship.masterId), ship]))
  const allIds = ships.map((ship) => number(ship.masterId)).filter((id) => id > 0)
  const groups = new Map((catalogs.shipGroups || []).map((group) => [String(group.id), new Set((group.memberMasterIds || []).map(number))]))
  const acceptedCache = new Map()
  const selectorCache = new WeakMap()

  function acceptedIds(masterId) {
    const id = number(masterId)
    if (acceptedCache.has(id)) return acceptedCache.get(id)
    if (!byId.has(id)) return null
    const result = new Set([id])
    const pending = [id]
    while (pending.length) {
      const current = pending.pop()
      ;(byId.get(current)?.successorIds || []).map(number).forEach((successor) => {
        if (result.has(successor)) return
        result.add(successor)
        pending.push(successor)
      })
    }
    acceptedCache.set(id, result)
    return result
  }

  function intersect(left, right) {
    return new Set(Array.from(left).filter((id) => right.has(id)))
  }

  function selectorSet(selector = {}) {
    if (!selector || typeof selector !== 'object') return null
    if (selectorCache.has(selector)) return selectorCache.get(selector)
    const hasIdentity = SHIP_SELECTOR_DIMENSIONS.some(([key]) => selector[key]?.length)
    if (!hasIdentity || allIds.length === 0) {
      selectorCache.set(selector, null)
      return null
    }
    let result = new Set(allIds)
    if (selector.masterIds?.length) {
      const allowed = new Set()
      for (const id of selector.masterIds) {
        const accepted = acceptedIds(id)
        if (!accepted) {
          selectorCache.set(selector, null)
          return null
        }
        accepted.forEach((value) => allowed.add(value))
      }
      result = intersect(result, allowed)
    }
    if (selector.groupIds?.length) {
      const allowed = new Set()
      for (const id of selector.groupIds) {
        const members = groups.get(String(id))
        if (!members) {
          selectorCache.set(selector, null)
          return null
        }
        members.forEach((value) => allowed.add(value))
      }
      result = intersect(result, allowed)
    }
    for (const [key, field] of [['familyIds', 'familyId'], ['typeIds', 'typeId'], ['classIds', 'classId']]) {
      if (!selector[key]?.length) continue
      const allowed = new Set(selector[key].map(number))
      result = new Set(Array.from(result).filter((id) => allowed.has(number(byId.get(id)?.[field]))))
    }
    if (selector.remodel?.exactMasterIds?.length || selector.remodel?.allowedMasterIds?.length) {
      const allowed = new Set((selector.remodel.exactMasterIds || selector.remodel.allowedMasterIds).map(number))
      result = new Set(Array.from(result).filter((id) => allowed.has(id)))
    }
    if (selector.remodel?.minimumStage != null) {
      result = new Set(Array.from(result).filter((id) => number(byId.get(id)?.remodelStage) >= number(selector.remodel.minimumStage)))
    }
    if (selector.remodel?.beforeStage != null) {
      result = new Set(Array.from(result).filter((id) => number(byId.get(id)?.remodelStage) < number(selector.remodel.beforeStage)))
    }
    selectorCache.set(selector, result)
    return result
  }

  return { selectorSet }
}

function selectorsDisjoint(left, right, selectorContext) {
  const rangeDisjoint = (leftRange = {}, rightRange = {}) => {
    const leftMinimum = leftRange.exact != null ? number(leftRange.exact) : leftRange.min == null ? Number.NEGATIVE_INFINITY : number(leftRange.min)
    const leftMaximum = leftRange.exact != null ? number(leftRange.exact) : leftRange.max == null ? Number.POSITIVE_INFINITY : number(leftRange.max)
    const rightMinimum = rightRange.exact != null ? number(rightRange.exact) : rightRange.min == null ? Number.NEGATIVE_INFINITY : number(rightRange.min)
    const rightMaximum = rightRange.exact != null ? number(rightRange.exact) : rightRange.max == null ? Number.POSITIVE_INFINITY : number(rightRange.max)
    return Math.max(leftMinimum, rightMinimum) > Math.min(leftMaximum, rightMaximum)
  }
  if (left?.level && right?.level && rangeDisjoint(left.level, right.level)) return true
  if (left?.speed && right?.speed && rangeDisjoint(left.speed, right.speed)) return true
  if (left?.remodel && right?.remodel && rangeDisjoint(
    { min: left.remodel.minimumStage, max: left.remodel.beforeStage == null ? null : number(left.remodel.beforeStage) - 1 },
    { min: right.remodel.minimumStage, max: right.remodel.beforeStage == null ? null : number(right.remodel.beforeStage) - 1 },
  )) return true
  const leftSet = selectorContext.selectorSet(left)
  const rightSet = selectorContext.selectorSet(right)
  if (leftSet && rightSet) return !Array.from(leftSet).some((id) => rightSet.has(id))
  for (const [key] of SHIP_SELECTOR_DIMENSIONS) {
    if (left?.[key]?.length && right?.[key]?.length) {
      const rightValues = new Set(right[key].map(String))
      if (left[key].every((value) => !rightValues.has(String(value)))) return true
    }
  }
  return false
}

function selectorSingleton(selector, selectorContext) {
  const set = selectorContext.selectorSet(selector)
  if (set?.size === 1) return Array.from(set)[0]
  const identityKeys = ['familyIds', 'groupIds', 'typeIds', 'classIds']
  if (!set && selector?.masterIds?.length === 1 && !identityKeys.some((key) => selector[key]?.length)) {
    return number(selector.masterIds[0])
  }
  return null
}

function selectorSubset(required, forbidden, selectorContext) {
  const requiredSet = selectorContext.selectorSet(required)
  const forbiddenSet = selectorContext.selectorSet(forbidden)
  if (requiredSet && forbiddenSet) return Array.from(requiredSet).every((id) => forbiddenSet.has(id))
  return required?.masterIds?.length > 0
    && forbidden?.masterIds?.length > 0
    && required.masterIds.every((id) => forbidden.masterIds.map(number).includes(number(id)))
}

function selectorsEquivalent(left, right, selectorContext) {
  const leftSet = selectorContext.selectorSet(left)
  const rightSet = selectorContext.selectorSet(right)
  if (leftSet && rightSet) {
    return leftSet.size === rightSet.size && Array.from(leftSet).every((id) => rightSet.has(id))
  }
  return SHIP_SELECTOR_DIMENSIONS.every(([key]) => JSON.stringify(left?.[key] || []) === JSON.stringify(right?.[key] || []))
}

function fleetDemandsForRecommendation(predicates) {
  const positions = []
  const groups = []
  const forbidden = []
  const sizeMins = []
  const sizeMaxes = []
  predicates.forEach((predicate) => {
    ;(predicate.positions || []).forEach((position) => positions.push({ selector: position.selector || {}, role: position.role }))
    ;(predicate.groups || []).forEach((group) => groups.push({
      selector: group.selector || {},
      min: Math.max(1, number(group.min) || 1),
      ...(group.max == null ? {} : { max: Math.max(0, number(group.max)) }),
    }))
    ;(predicate.forbidden || []).forEach((selector) => forbidden.push(selector || {}))
    if (predicate.size?.min != null) sizeMins.push(number(predicate.size.min))
    if (predicate.size?.max != null) sizeMaxes.push(number(predicate.size.max))
  })
  return { positions, groups, forbidden, sizeMins, sizeMaxes }
}

function maximumDisjointGroupMinimum(groups, selectorContext) {
  if (groups.length === 0) return 0
  let best = 0
  function visit(index, chosen, total) {
    if (total > best) best = total
    for (let next = index; next < groups.length; next += 1) {
      if (chosen.every((group) => selectorsDisjoint(group.selector, groups[next].selector, selectorContext))) {
        chosen.push(groups[next])
        visit(next + 1, chosen, total + groups[next].min)
        chosen.pop()
      }
    }
  }
  visit(0, [], 0)
  return best
}

function fleetPredicateVariantsCompatible(leftPredicates, rightPredicates, selectorContext) {
  const left = fleetDemandsForRecommendation(leftPredicates)
  const right = fleetDemandsForRecommendation(rightPredicates)
  const leftPositions = left.positions.filter((entry) => ['flagship', 'second'].includes(entry.role))
  const rightPositions = right.positions.filter((entry) => ['flagship', 'second'].includes(entry.role))
  for (const leftPosition of leftPositions) {
    for (const rightPosition of rightPositions) {
      if (leftPosition.role === rightPosition.role && selectorsDisjoint(leftPosition.selector, rightPosition.selector, selectorContext)) return false
      if (leftPosition.role !== rightPosition.role
        && selectorSingleton(leftPosition.selector, selectorContext) != null
        && selectorSingleton(leftPosition.selector, selectorContext) === selectorSingleton(rightPosition.selector, selectorContext)) return false
    }
  }
  const leftRequired = [...left.positions, ...left.groups]
  const rightRequired = [...right.positions, ...right.groups]
  if (left.forbidden.some((forbidden) => rightRequired.some((required) => selectorSubset(required.selector, forbidden, selectorContext)))) return false
  if (right.forbidden.some((forbidden) => leftRequired.some((required) => selectorSubset(required.selector, forbidden, selectorContext)))) return false

  for (const leftGroup of left.groups) {
    for (const rightGroup of right.groups) {
      if (selectorsDisjoint(leftGroup.selector, rightGroup.selector, selectorContext)) continue
      if (selectorsEquivalent(leftGroup.selector, rightGroup.selector, selectorContext)) {
        const lower = Math.max(leftGroup.min, rightGroup.min)
        const upper = Math.min(leftGroup.max == null ? 6 : leftGroup.max, rightGroup.max == null ? 6 : rightGroup.max)
        if (lower > upper) return false
        continue
      }
      if (leftGroup.max != null && selectorSubset(rightGroup.selector, leftGroup.selector, selectorContext) && rightGroup.min > leftGroup.max) return false
      if (rightGroup.max != null && selectorSubset(leftGroup.selector, rightGroup.selector, selectorContext) && leftGroup.min > rightGroup.max) return false
    }
  }

  const allGroups = [...left.groups, ...right.groups]
  const leftGroupLower = maximumDisjointGroupMinimum(left.groups, selectorContext)
  const rightGroupLower = maximumDisjointGroupMinimum(right.groups, selectorContext)
  const combinedGroupLower = maximumDisjointGroupMinimum(allGroups, selectorContext)
  const leftRequiredSlots = Math.max(
    Math.max(0, ...left.sizeMins, 0),
    left.positions.length + left.groups.reduce((sum, group) => sum + group.min, 0),
    leftGroupLower,
  )
  const rightRequiredSlots = Math.max(
    Math.max(0, ...right.sizeMins, 0),
    right.positions.length + right.groups.reduce((sum, group) => sum + group.min, 0),
    rightGroupLower,
  )
  const fixedRoles = new Set([...leftPositions, ...rightPositions].map((position) => position.role)).size
  const positionGroupBonus = Math.max(
    left.positions.length && right.groups.length
      ? left.positions.filter((position) => right.groups.every((group) => selectorsDisjoint(position.selector, group.selector, selectorContext))).length
      : 0,
    right.positions.length && left.groups.length
      ? right.positions.filter((position) => left.groups.every((group) => selectorsDisjoint(position.selector, group.selector, selectorContext))).length
      : 0,
  )
  const requiredSlots = Math.max(leftRequiredSlots, rightRequiredSlots, fixedRoles)
    + Math.max(0, combinedGroupLower - Math.max(leftGroupLower, rightGroupLower))
    + positionGroupBonus
  const maximumSlots = Math.min(6, ...[...left.sizeMaxes, ...right.sizeMaxes].map((value) => Math.max(0, value)))
  return requiredSlots <= maximumSlots
}

function factoryDiscardRequirements(quest) {
  const costs = (quest.requirements?.costs || [])
    .filter((cost) => cost.kind === 'equipment' && cost.operation === 'discard')
    .map((cost) => ({ selector: cost.selector || {}, quantity: number(cost.quantity) || 1, label: cost.label }))
  const objectives = (quest.requirements?.objectives || []).filter((objective) => objective.event === 'destory_item')
  if (!objectives.length) return costs
  const result = [...costs]
  objectives.forEach((objective) => {
    const predicates = collectPredicates(objective.constraints).filter((predicate) => predicate.kind === 'equipment')
    const quantity = number(objective.count?.required) || 1
    if (predicates.length) predicates.forEach((predicate) => result.push({ selector: predicate.selector || {}, quantity: number(predicate.quantity) || quantity, label: objective.label }))
    else if (!costs.length) result.push({ selector: {}, quantity, label: objective.label || '任意装备' })
  })
  const seen = new Set()
  return result.filter((entry) => {
    const key = `${JSON.stringify(entry.selector)}:${entry.quantity}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function factoryDiscardRequirementsForObjective(quest, objective) {
  if (!objective || typeof objective !== 'object') return factoryDiscardRequirements(quest)
  const predicates = collectPredicates(objective.constraints)
    .filter((predicate) => predicate.kind === 'equipment')
  const quantity = number(objective.count?.required) || 1
  if (predicates.length) {
    return predicates.map((predicate) => ({
      selector: predicate.selector || {},
      quantity: number(predicate.quantity) || quantity,
      label: objective.label,
    }))
  }
  if (objective.event === 'destory_item') {
    const costs = (quest.requirements?.costs || [])
      .filter((cost) => cost.kind === 'equipment' && cost.operation === 'discard')
    if (costs.length === 1) {
      return costs.map((cost) => ({ selector: cost.selector || {}, quantity: number(cost.quantity) || quantity, label: cost.label }))
    }
    return [{ selector: {}, quantity, label: objective.label || '任意装备' }]
  }
  return []
}

function factoryVariants(quest) {
  const alternatives = requirementFleetAlternatives(quest)
  const placementSelectors = (quest.requirements?.costs || [])
    .filter((cost) => cost.kind === 'equipment' && cost.placement?.role === 'secretary' && cost.placement.shipSelector)
    .map((cost) => cost.placement.shipSelector)
  const branches = alternatives.length ? alternatives : [[]]
  return branches.map((predicates) => ({
    secretaries: [
      ...predicates.flatMap((predicate) => (predicate.positions || [])
        .filter((position) => position.role === 'flagship' || position.role === 'secretary')
        .map((position) => position.selector || {})),
      ...placementSelectors,
    ],
  }))
}

function buildEquipmentSelectorContext(catalogs = {}) {
  const equipment = Array.isArray(catalogs.equipment) ? catalogs.equipment : []
  const byMaster = new Map(equipment.map((entry) => [number(entry.masterId), entry]))
  const cache = new WeakMap()
  function selectorSet(selector = {}) {
    if (!selector || typeof selector !== 'object') return null
    if (cache.has(selector)) return cache.get(selector)
    const masterIds = uniqueNumbers(selector.masterIds)
    const type2Ids = uniqueNumbers(selector.type2Ids)
    if (!masterIds.length && !type2Ids.length) {
      cache.set(selector, null)
      return null
    }
    const knownMasterIds = masterIds.filter((id) => byMaster.has(id))
    // An exact ID which is absent from the local catalog cannot be proved to
    // overlap a type selector. Keep the recommendation conservative.
    if (masterIds.length && knownMasterIds.length !== masterIds.length) {
      cache.set(selector, undefined)
      return undefined
    }
    const result = new Set(knownMasterIds)
    if (type2Ids.length) {
      for (const [masterId, entry] of byMaster) {
        if (type2Ids.includes(number(entry.type2Id))) result.add(masterId)
      }
    }
    if (masterIds.length && type2Ids.length) {
      for (const masterId of Array.from(result)) {
        if (!masterIds.includes(masterId) || !type2Ids.includes(number(byMaster.get(masterId)?.type2Id))) result.delete(masterId)
      }
    }
    cache.set(selector, result)
    return result
  }
  return { selectorSet }
}

function equipmentSelectorsCompatible(left, right, selectorContext) {
  const leftMasterIds = uniqueNumbers(left?.masterIds)
  const rightMasterIds = uniqueNumbers(right?.masterIds)
  const leftType2Ids = uniqueNumbers(left?.type2Ids)
  const rightType2Ids = uniqueNumbers(right?.type2Ids)
  if (!leftType2Ids.length && !rightType2Ids.length && leftMasterIds.some((id) => rightMasterIds.includes(id))) return true
  if (!leftMasterIds.length && !rightMasterIds.length && leftType2Ids.some((id) => rightType2Ids.includes(id))) return true
  if (JSON.stringify(left || {}) === JSON.stringify(right || {}) && (leftMasterIds.length || leftType2Ids.length)) return true
  const leftSet = selectorContext.selectorSet(left)
  const rightSet = selectorContext.selectorSet(right)
  // An empty selector is the normalized representation of “any equipment”.
  if (leftSet === null || rightSet === null) return true
  if (!leftSet || !rightSet) return false
  return Array.from(leftSet).some((id) => rightSet.has(id))
}

function factoryDiscardCompatible(left, right, equipmentContext) {
  return left.some((leftEntry) => right.some((rightEntry) => equipmentSelectorsCompatible(
    leftEntry.selector || {}, rightEntry.selector || {}, equipmentContext,
  )))
}

function statusValue(statuses, id) {
  if (statuses && typeof statuses.get === 'function') return statuses.get(id)?.status
  return statuses?.[id]?.status
}

function recommendationRepeatRank(repeat) {
  if (repeat === 'quarterly') return 0
  if (repeat === 'yearly') return 1
  return 2
}

function recommendationAvailabilityRank(status) {
  if (['available', 'active', 'unlocked'].includes(status)) return 0
  if (status === 'locked') return 1
  return 2
}

function compareRecommendations(left, right, candidates, statuses) {
  const leftQuest = candidates.get(number(left.id))
  const rightQuest = candidates.get(number(right.id))
  const repeatOrder = recommendationRepeatRank(leftQuest?.repeat) - recommendationRepeatRank(rightQuest?.repeat)
  if (repeatOrder !== 0) return repeatOrder
  const statusOrder = recommendationAvailabilityRank(statusValue(statuses, number(left.id)))
    - recommendationAvailabilityRank(statusValue(statuses, number(right.id)))
  return statusOrder || number(left.id) - number(right.id)
}

function recommendationDescriptor(quest) {
  if (!quest || CONCURRENT_EXCLUDED_REPEATS.has(quest.repeat)) return null
  if (quest.category === 'sortie') {
    const mapIds = questMapIds(quest)
    const variants = requirementFleetAlternatives(quest).filter((branch) => branch.length > 0)
    if (!mapIds.length || !variants.length) return null
    return { kind: 'sortie', mapIds, variants }
  }
  if (quest.category === 'expedition') {
    const missionIds = questMissionIds(quest)
    return missionIds.length ? { kind: 'expedition', missionIds } : null
  }
  if (quest.category === 'exercise') {
    const variants = requirementFleetAlternatives(quest).filter((branch) => branch.length > 0)
    return variants.length ? { kind: 'exercise', variants } : null
  }
  if (quest.category === 'factory') {
    const discards = factoryDiscardRequirements(quest)
    return discards.length ? { kind: 'factory', discards, variants: factoryVariants(quest) } : null
  }
  return null
}

function objectiveMapIds(objective) {
  return uniqueNumbers([
    ...(objective?.target?.mapIds || []),
    ...collectPredicates(objective?.constraints)
      .filter((predicate) => predicate.kind === 'map')
      .flatMap((predicate) => predicate.mapIds || []),
  ])
}

function objectiveMissionIds(objective) {
  return uniqueNumbers(objective?.target?.missionIds || [])
}

function recommendationEntry(candidate, kind, extra = {}) {
  return {
    id: number(candidate.id),
    code: candidate.code,
    name: candidate.name,
    kind,
    ...extra,
  }
}

function recommendationSearchContext(quests, catalogs = {}) {
  return {
    selectorContext: buildShipSelectorContext(catalogs),
    equipmentContext: buildEquipmentSelectorContext(catalogs),
    descriptors: new Map((quests || []).map((candidate) => [number(candidate.id), recommendationDescriptor(candidate)])),
  }
}

function findConcurrentQuestRecommendationsForObjectiveWithContext(quest, objective, quests, statuses, context) {
  if (!quest || CONCURRENT_EXCLUDED_REPEATS.has(quest.repeat)) return []
  const currentStatus = statusValue(statuses, number(quest.id))
  if (CONCURRENT_COMPLETED_STATUSES.has(currentStatus)) return []
  const { selectorContext, equipmentContext, descriptors } = context
  const candidates = new Map((quests || []).map((candidate) => [number(candidate.id), candidate]))
  const current = recommendationDescriptor(quest)
  if (!current) return []
  const objectiveMaps = objective ? objectiveMapIds(objective) : []
  const objectiveMissions = objective ? objectiveMissionIds(objective) : []
  const objectiveDiscards = objective ? factoryDiscardRequirementsForObjective(quest, objective) : []
  const currentMapIds = objectiveMaps.length ? objectiveMaps : current.mapIds || []
  const currentMissionIds = objectiveMissions.length ? objectiveMissions : current.missionIds || []
  const currentDiscards = objectiveDiscards.length ? objectiveDiscards : current.discards || []
  const currentVariants = objective && ['sortie', 'exercise'].includes(current.kind)
    ? fleetAlternativesForObjective(quest, objective, current.variants)
    : current.variants
  return (quests || [])
    .filter((candidate) => number(candidate.id) !== number(quest.id))
    .filter((candidate) => !CONCURRENT_EXCLUDED_REPEATS.has(candidate.repeat))
    .filter((candidate) => !CONCURRENT_COMPLETED_STATUSES.has(statusValue(statuses, number(candidate.id))))
    .map((candidate) => {
      const descriptor = descriptors.get(number(candidate.id))
      if (!descriptor || descriptor.kind !== current.kind) return null
      if (current.kind === 'sortie') {
        const sharedMapIds = currentMapIds.filter((id) => descriptor.mapIds.includes(id))
        const compatible = sharedMapIds.some((mapId) => {
          const candidateVariants = fleetAlternativesForMap(candidate, mapId, descriptor.variants)
          return currentVariants.some((left) => candidateVariants.some((right) => fleetPredicateVariantsCompatible(left, right, selectorContext)))
        })
        return compatible ? recommendationEntry(candidate, current.kind, { mapIds: sharedMapIds }) : null
      }
      if (current.kind === 'exercise') {
        const candidateVariants = fleetAlternativesForQuest(candidate, descriptor.variants)
        const compatible = currentVariants.some((left) => candidateVariants.some((right) => fleetPredicateVariantsCompatible(left, right, selectorContext)))
        return compatible ? recommendationEntry(candidate, current.kind) : null
      }
      if (current.kind === 'expedition') {
        const sharedMissionIds = currentMissionIds.filter((id) => descriptor.missionIds.includes(id))
        return sharedMissionIds.length ? recommendationEntry(candidate, current.kind, { missionIds: sharedMissionIds }) : null
      }
      const secretaryCompatible = current.variants.some((left) => descriptor.variants.some((right) =>
        left.secretaries.every((leftSelector) => right.secretaries.every((rightSelector) => !selectorsDisjoint(leftSelector, rightSelector, selectorContext)))))
      return secretaryCompatible && factoryDiscardCompatible(currentDiscards, descriptor.discards, equipmentContext)
        ? recommendationEntry(candidate, current.kind)
        : null
    })
    .filter(Boolean)
    .sort((left, right) => compareRecommendations(left, right, candidates, statuses))
}

function findConcurrentQuestRecommendationsForObjective(quest, objective, quests, statuses, catalogs = {}) {
  return findConcurrentQuestRecommendationsForObjectiveWithContext(
    quest,
    objective,
    quests,
    statuses,
    recommendationSearchContext(quests, catalogs),
  )
}

function findConcurrentQuestRecommendations(quest, quests, statuses, catalogs = {}) {
  if (!quest || CONCURRENT_EXCLUDED_REPEATS.has(quest.repeat)) return []
  const objectives = (quest.requirements?.objectives || []).filter((objective) => objective && objective.event !== 'formation')
  const context = recommendationSearchContext(quests, catalogs)
  const batches = objectives.length
    ? objectives.map((objective) => findConcurrentQuestRecommendationsForObjectiveWithContext(quest, objective, quests, statuses, context))
    : [findConcurrentQuestRecommendationsForObjectiveWithContext(quest, null, quests, statuses, context)]
  const seen = new Set()
  return batches.flat().filter((entry) => {
    if (seen.has(entry.id)) return false
    seen.add(entry.id)
    return true
  })
}

function findConcurrentQuestRecommendationsByProgress(quest, quests, statuses, catalogs = {}) {
  if (!quest) return {}
  const objectives = (quest.requirements?.objectives || []).filter((objective) => objective && objective.event !== 'formation')
  const context = recommendationSearchContext(quests, catalogs)
  const result = {}
  objectives.forEach((objective, index) => {
    const key = String(objective.id ?? `objective-${index}`)
    result[key] = findConcurrentQuestRecommendationsForObjectiveWithContext(quest, objective, quests, statuses, context)
  })
  return result
}

function countShipsBy(ships, masterShips, predicate) {
  return Object.values(ships || {}).filter((ship) => {
    const master = masterShips?.[ship?.api_ship_id]
    return master && predicate(master, ship)
  }).length
}

function evaluateFeasibility(goal, rootState) {
  if (!goal || typeof goal !== 'object') return { status: 'unknown', checks: [] }
  const ships = rootState?.info?.ships || {}
  const masterShips = rootState?.const?.$ships || {}
  const equips = rootState?.info?.equips || {}
  const maps = rootState?.info?.maps || {}
  const checks = []

  const addShipNames = (names, required, label) => {
    if (!Array.isArray(names) || names.length === 0) return
    if (Object.keys(masterShips).length === 0) {
      checks.push({ label, status: 'unknown' })
      return
    }
    const count = countShipsBy(ships, masterShips, (master) => names.includes(master.api_name))
    checks.push({ label, status: count >= required ? 'ready' : 'blocked', count, required })
  }
  const addShipTypes = (types, required, label, field) => {
    if (!Array.isArray(types) || types.length === 0) return
    if (Object.keys(masterShips).length === 0) {
      checks.push({ label, status: 'unknown' })
      return
    }
    const count = countShipsBy(ships, masterShips, (master) => types.includes(number(master[field])))
    checks.push({ label, status: count >= required ? 'ready' : 'blocked', count, required })
  }

  Object.entries(goal).forEach(([event, condition]) => {
    if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return
    addShipNames(condition.flagship, 1, '旗舰')
    addShipNames(condition.secondship, 1, '二号舰')
    addShipTypes(condition.flagshiptype, 1, '旗舰舰种', 'api_stype')
    addShipTypes(condition.flagshipclass, 1, '旗舰舰级', 'api_ctype')
    addShipTypes(condition.secondshipclass, 1, '二号舰舰级', 'api_ctype')
    ;(condition.escortship || []).forEach(([names, required]) => addShipNames(names, number(required), '舰娘'))
    ;(condition.escortshiptype || []).forEach(([types, required]) => addShipTypes(types, number(required), '舰种', 'api_stype'))
    ;(condition.escortshipclass || []).forEach(([classes, required]) => addShipTypes(classes, number(required), '舰级', 'api_ctype'))

    if (Array.isArray(condition.slotitemId) && condition.slotitemId.length > 0) {
      const count = Object.values(equips).filter((equip) => condition.slotitemId.includes(number(equip?.api_slotitem_id))).length
      const required = number(condition.required) || 1
      checks.push({ label: '装备', status: count >= required ? 'ready' : 'blocked', count, required })
    }
    if (Array.isArray(condition.slotitemType2) && condition.slotitemType2.length > 0) {
      const masterEquips = rootState?.const?.$equips || {}
      const count = Object.values(equips).filter((equip) => {
        const master = masterEquips[equip?.api_slotitem_id]
        return condition.slotitemType2.includes(number(master?.api_type?.[2]))
      }).length
      const required = number(condition.required) || 1
      checks.push({ label: '装备类别', status: count >= required ? 'ready' : 'blocked', count, required })
    }
    if (Array.isArray(condition.maparea) && condition.maparea.length > 0) {
      if (Object.keys(maps).length === 0) {
        checks.push({ label: '海图', status: 'unknown' })
      } else {
        const ready = condition.maparea.some((mapId) => maps[number(mapId)] != null)
        checks.push({ label: '海图', status: ready ? 'ready' : 'blocked' })
      }
    }
    if (event === 'mission_success' && Array.isArray(condition.mission)) {
      checks.push({ label: '远征', status: 'unknown' })
    }
  })

  if (checks.some((check) => check.status === 'blocked')) return { status: 'blocked', checks }
  if (checks.some((check) => check.status === 'unknown')) return { status: 'unknown', checks }
  return checks.length > 0 ? { status: 'ready', checks } : { status: 'unknown', checks }
}

function goalRows(goal, record) {
  if (!goal || typeof goal !== 'object') return []
  return Object.entries(goal)
    .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
    .map(([key, condition]) => {
      const progress = record?.[key]
      return {
        key,
        label: condition.description || EVENT_LABELS[key.split('@')[0]] || key,
        count: number(progress?.count),
        required: number(progress?.required) || number(condition.required),
        condition,
      }
    })
}

module.exports = {
  CATEGORY_LABELS,
  EVENT_LABELS,
  booleanQueryMatches,
  buildIndexes,
  completionIsCurrent,
  directCompletedQuestIds,
  evaluateFeasibility,
  findConcurrentQuestRecommendations,
  findConcurrentQuestRecommendationsByProgress,
  findConcurrentQuestRecommendationsForObjective,
  graphForQuestIds,
  goalRows,
  inferQuestStatuses,
  mergeQuestListPage,
  repeatRank,
}
