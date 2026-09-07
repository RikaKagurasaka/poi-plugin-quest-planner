'use strict'

const { assignDistinct, catalogIndexes, evaluateQuestRequirements, selectorMatchesShip } = require('./domain')
const { EVENT_LABELS, goalRows } = require('./logic')

const SECTION_ORDER = ['a', 'b', 'c', 'progress']
const SECTION_LABELS = { a: '前提 A', b: '前提 B', c: '前提 C', progress: '完成进度' }
const ROLE_LABELS = { flagship: '旗舰', second: '二号舰', escort: '僚舰' }
const RESOURCE_LABELS = { fuel: '燃料', ammo: '弹药', steel: '钢材', bauxite: '铝土' }
const SHIP_TYPE_LABELS = {
  1: '海防舰', 2: '驱逐舰', 3: '轻巡洋舰', 4: '重雷装巡洋舰', 5: '重巡洋舰', 6: '航空巡洋舰',
  7: '轻空母', 8: '战舰', 9: '战舰', 10: '航空战舰', 11: '正规空母', 12: '超弩级战舰',
  13: '潜水舰', 14: '潜水空母', 15: '补给舰', 16: '水上机母舰', 17: '扬陆舰', 18: '装甲空母',
  19: '工作舰', 20: '潜水母舰', 21: '练习巡洋舰', 22: '补给舰',
}
const catalogLookupCache = new WeakMap()

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function clean(value) {
  return String(value || '').replace(/<br\s*\/?\s*>/gi, ' ').replace(/\s+/g, ' ').trim()
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)))
}

function nameOf(entry, fallback) {
  return entry?.names?.zh_cn || entry?.names?.ja_jp || entry?.names?.en_us || entry?.aliases?.[0] || fallback
}

function exactShipName(entry, fallback) {
  return entry?.names?.ja_jp || entry?.names?.zh_cn || entry?.names?.en_us || entry?.aliases?.[0] || fallback
}

function catalogLookup(catalogs = {}) {
  if (catalogs && typeof catalogs === 'object' && catalogLookupCache.has(catalogs)) return catalogLookupCache.get(catalogs)
  const ships = catalogs.ships || []
  const remodelAccepted = catalogIndexes(catalogs).remodelAccepted
  const byMaster = new Map(ships.map((entry) => [number(entry.masterId), entry]))
  const familyName = new Map()
  ships.slice().sort((left, right) => number(left.remodelStage) - number(right.remodelStage) || number(left.masterId) - number(right.masterId)).forEach((entry) => {
    if (!familyName.has(number(entry.familyId))) familyName.set(number(entry.familyId), nameOf(entry, `舰娘 #${entry.familyId}`))
  })
  const lookup = {
    byMaster,
    remodelAccepted,
    familyName,
    shipGroups: new Map((catalogs.shipGroups || []).map((entry) => [String(entry.id), entry])),
    shipTypes: new Map((catalogs.shipTypes || []).map((entry) => [number(entry.id), entry])),
    shipClasses: new Map((catalogs.shipClasses || []).map((entry) => [number(entry.id), entry])),
    equipment: new Map((catalogs.equipment || []).map((entry) => [number(entry.masterId), entry])),
    equipmentTypes: new Map((catalogs.equipmentTypes || []).map((entry) => [number(entry.id), entry])),
    useItems: new Map((catalogs.useItems || []).map((entry) => [number(entry.id), entry])),
    maps: new Map((catalogs.maps || []).map((entry) => [number(entry.id), entry])),
    missions: new Map((catalogs.missions || []).map((entry) => [String(entry.id), entry])),
  }
  if (catalogs && typeof catalogs === 'object') catalogLookupCache.set(catalogs, lookup)
  return lookup
}

function slash(values) {
  return unique(values).join('/')
}

function shipSelectorText(selector = {}, lookup) {
  const parts = []
  if (selector.masterIds?.length) parts.push(slash(selector.masterIds.map((id) => nameOf(lookup.byMaster.get(number(id)), `舰娘 #${id}`))))
  if (selector.groupIds?.length) parts.push(slash(selector.groupIds.map((id) => {
    const group = lookup.shipGroups.get(String(id))
    return group?.aliases?.[0] || nameOf(group, String(id))
  })))
  if (selector.familyIds?.length) parts.push(slash(selector.familyIds.map((id) => lookup.familyName.get(number(id)) || `舰娘族 #${id}`)))
  if (selector.typeIds?.length) parts.push(slash(selector.typeIds.map((id) => SHIP_TYPE_LABELS[number(id)] || nameOf(lookup.shipTypes.get(number(id)), `舰种 #${id}`))))
  if (selector.classIds?.length) parts.push(slash(selector.classIds.map((id) => nameOf(lookup.shipClasses.get(number(id)), `舰级 #${id}`))))
  return parts.join(' · ') || '舰娘'
}

function equipmentSelectorText(selector = {}, lookup) {
  const parts = []
  if (selector.masterIds?.length) parts.push(slash(selector.masterIds.map((id) => nameOf(lookup.equipment.get(number(id)), `装备 #${id}`))))
  if (selector.type2Ids?.length) parts.push(slash(selector.type2Ids.map((id) => nameOf(lookup.equipmentTypes.get(number(id)), `装备类型 #${id}`))))
  return parts.join(' · ') || '装备'
}

function mapText(id, lookup) {
  const entry = lookup.maps.get(number(id))
  return entry?.code || `${Math.floor(number(id) / 10)}-${number(id) % 10}`
}

function missionText(id, lookup) {
  const numericId = number(id)
  const entry = lookup.missions.get(String(id))
  return entry ? `#${numericId} ${nameOf(entry, `远征 #${numericId}`)}` : `远征 #${numericId}`
}

function countText(min, max) {
  const minimum = number(min)
  if (max != null && number(max) === minimum) return `×${minimum}`
  if (max != null && minimum === 0) return `至多 ${number(max)} 艘`
  if (max != null) return `${minimum}–${number(max)} 艘`
  return minimum > 1 ? `至少 ${minimum} 艘` : '×1'
}

function fleetSizeText(min, max) {
  const minimum = number(min)
  if (max != null && number(max) >= 99 && minimum > 0) return `至少 ${minimum} 艘`
  return countText(min, max)
}

function availabilitySelector(selector = {}, lookup) {
  const resolvedFamilies = (selector.masterIds || []).map((id) => lookup.byMaster.get(number(id))?.familyId).filter((id) => id != null)
  return {
    ...(resolvedFamilies.length === (selector.masterIds || []).length && resolvedFamilies.length
      ? { familyIds: unique([...(selector.familyIds || []).map(number), ...resolvedFamilies.map(number)]) }
      : { masterIds: selector.masterIds || [], familyIds: selector.familyIds || [] }),
    groupIds: selector.groupIds || [],
    typeIds: selector.typeIds || [],
    classIds: selector.classIds || [],
    ...(selector.speed ? { speed: selector.speed } : {}),
  }
}

function hasShipIdentity(selector = {}) {
  return ['masterIds', 'groupIds', 'familyIds', 'typeIds', 'classIds'].some((key) => selector[key]?.length)
}

function selectorModifiers(selector = {}, lookup) {
  const fragments = []
  if (selector.level?.min != null) fragments.push(`Lv.${number(selector.level.min)}以上`)
  // Master/poi data commonly uses 999 as an open upper bound. It is not a
  // player-facing condition and should not make otherwise useful text noisy.
  if (selector.level?.max != null && number(selector.level.max) < 999) fragments.push(`Lv.${number(selector.level.max)}以下`)
  const explicitlyAllowedIds = selector.remodel?.exactMasterIds || selector.remodel?.allowedMasterIds || []
  const requiredMasterIds = explicitlyAllowedIds.length
    ? explicitlyAllowedIds
    : (selector.masterIds || []).filter((id) => {
        const ship = lookup.byMaster.get(number(id))
        return number(ship?.remodelStage) > 0 || ship?.predecessorId != null
      })
  if (requiredMasterIds.length) fragments.push(`形态 ${slash(requiredMasterIds.map((id) => {
    const name = exactShipName(lookup.byMaster.get(number(id)), `舰娘 #${id}`)
    return !explicitlyAllowedIds.length && lookup.remodelAccepted?.get(number(id))?.size > 1 ? `${name}以后` : name
  }))}`)
  if (selector.remodel?.minimumStage != null) fragments.push(`改造阶段 ${number(selector.remodel.minimumStage)} 以上`)
  if (selector.remodel?.beforeStage != null) fragments.push(`改造阶段 ${number(selector.remodel.beforeStage)} 之前`)
  return fragments
}

function equipmentModifiers(state = {}) {
  const fragments = []
  if (state.improvement?.exact != null) fragments.push(number(state.improvement.exact) === 10 ? '改修 ★MAX' : `改修 ★+${number(state.improvement.exact)}`)
  if (state.improvement?.min != null) fragments.push(number(state.improvement.min) === 10 ? '改修 ★MAX' : `改修 ★+${number(state.improvement.min)}以上`)
  if (state.proficiency?.exact != null) fragments.push(number(state.proficiency.exact) === 7 ? '熟练度 MAX' : `熟练度 ${number(state.proficiency.exact)}`)
  if (state.proficiency?.min != null) fragments.push(number(state.proficiency.min) === 7 ? '熟练度 MAX' : `熟练度 ${number(state.proficiency.min)}以上`)
  return fragments
}

function emptyRequirements(conditions, costs = []) {
  return { conditions, objectives: [], completion: { logic: 'all', objectiveIds: [] }, costs, unresolved: [] }
}

function evaluatePredicate(predicate, confidence, rootState, catalogs) {
  return evaluateQuestRequirements(emptyRequirements({ op: 'predicate', predicate, confidence: confidence || 'exact' }), rootState, catalogs)
}

function expressionPredicateText(predicate = {}, lookup) {
  if (predicate.kind === 'fleet') return predicate.label || fleetText(predicate, lookup, false)
  if (predicate.kind === 'equipment') return `${equipmentSelectorText(predicate.selector, lookup)} ×${number(predicate.quantity) || 1}`
  if (predicate.kind === 'resource') return `${predicate.label || RESOURCE_LABELS[predicate.resource] || predicate.resource} ×${number(predicate.quantity)}`
  if (predicate.kind === 'use-item') return `${predicate.label || nameOf(lookup.useItems.get(number(predicate.useItemId)), `道具 #${predicate.useItemId}`)} ×${number(predicate.quantity)}`
  if (predicate.kind === 'map') return `解锁 ${slash((predicate.mapIds || []).map((id) => mapText(id, lookup)))}`
  return predicate.label || '未确认条件'
}

function expressionText(expression, lookup) {
  if (!expression) return '未确认条件'
  if (expression.op === 'predicate') return expressionPredicateText(expression.predicate, lookup)
  if (expression.op === 'not') return `不得满足：${expressionText(expression.child, lookup)}`
  const children = (expression.children || []).map((child) => expressionText(child, lookup))
  if (expression.op === 'any') return `任选一项：${children.join('；')}`
  if (expression.op === 'atLeast') return `以下至少 ${number(expression.count)} 项：${children.join('；')}`
  return children.join('；')
}

function expressionStatus(expression, evaluateLeaf) {
  if (expression.op === 'predicate') return evaluateLeaf(expression)
  if (expression.op === 'not') {
    const status = expressionStatus(expression.child, evaluateLeaf)
    return status === 'ready' ? 'blocked' : status === 'blocked' ? 'ready' : 'unknown'
  }
  const statuses = (expression.children || []).map((child) => expressionStatus(child, evaluateLeaf))
  if (expression.op === 'all') return statuses.includes('blocked') ? 'blocked' : statuses.includes('unknown') ? 'unknown' : 'ready'
  if (expression.op === 'any') return statuses.includes('ready') ? 'ready' : statuses.includes('unknown') ? 'unknown' : 'blocked'
  const required = number(expression.count)
  const ready = statuses.filter((status) => status === 'ready').length
  const possible = ready + statuses.filter((status) => status === 'unknown').length
  return ready >= required ? 'ready' : possible < required ? 'blocked' : 'unknown'
}

function compoundPrefix(expression) {
  if (expression.op === 'any') return '任选一套'
  if (expression.op === 'atLeast') return `至少 ${number(expression.count)} 套`
  return ''
}

function directFleetBranches(expression) {
  if (!['any', 'atLeast'].includes(expression.op)) return null
  const children = expression.children || []
  if (!children.length || children.some((child) => child.op !== 'predicate' || child.predicate?.kind !== 'fleet')) return null
  return children
}

function collectFleetAlternatives(expression, sections, rootState, catalogs, lookup, key) {
  const branches = directFleetBranches(expression)
  if (!branches) return false
  const prefix = compoundPrefix(expression)
  const availabilityPredicates = branches.map((child) => ({
    ...child,
    predicate: {
      kind: 'fleet', positions: [], forbidden: [], size: {}, distinct: child.predicate.distinct !== false,
      groups: fleetDemands(child.predicate, (selector) => availabilitySelector(selector, lookup))
        .filter((entry) => hasShipIdentity(entry.selector))
        .map((entry) => ({ selector: entry.selector, min: number(entry.min) || 1, ...(entry.max == null ? {} : { max: entry.max }), ...(entry.distinctBy ? { distinctBy: entry.distinctBy } : {}) })),
    },
  }))
  if (availabilityPredicates.every((child) => child.predicate.groups.length)) {
    const projected = { ...expression, children: availabilityPredicates }
    pushRow(sections, 'a', {
      key: `${key}-own`,
      text: `${prefix}：${availabilityPredicates.map((child) => `拥有 ${fleetText(child.predicate, lookup, false)}`).join('；')}`,
      status: evaluateQuestRequirements(emptyRequirements(projected), rootState, catalogs).status,
    })
  }
  const modifierBranches = branches.map((child) => fleetDemands(child.predicate)
    .map((demand) => ({ demand, modifiers: selectorModifiers(demand.selector, lookup) }))
    .filter((entry) => entry.modifiers.length))
  if (modifierBranches.some((entries) => entries.length)) {
    pushRow(sections, 'b', {
      key: `${key}-modifier`,
      text: `${prefix}：${modifierBranches.filter((entries) => entries.length).map((entries) => entries.map(({ demand, modifiers }) =>
        `${shipSelectorText(availabilitySelector(demand.selector, lookup), lookup)} ${modifiers.join('、')} ${countText(demand.min, demand.max)}`).join('、')).join('；')}`,
      status: expressionStatus(expression, (child) => evaluatePredicate(child.predicate, child.confidence, rootState, catalogs).status),
    })
  }
  const arrangementPredicates = branches.map((child) => ({
    ...child,
    predicate: {
      ...child.predicate,
      positions: (child.predicate.positions || []).map((entry) => ({ ...entry, selector: availabilitySelector(entry.selector, lookup) })),
      groups: (child.predicate.groups || []).map((entry) => ({ ...entry, selector: availabilitySelector(entry.selector, lookup) })),
    },
  }))
  pushRow(sections, 'c', {
    key: `${key}-fleet`,
    text: `${prefix}：${arrangementPredicates.map((child) => `编成 ${fleetText(child.predicate, lookup)}`).join('；')}`,
    status: expressionStatus({ ...expression, children: arrangementPredicates }, (child) =>
      evaluateFleetComposition(child.predicate, child.confidence, rootState, catalogs).status),
  })
  return true
}

function expressionSection(expression) {
  const predicates = []
  function collect(node) {
    if (!node) return
    if (node.op === 'predicate') predicates.push(node.predicate)
    if (node.op === 'not') collect(node.child)
    ;(node.children || []).forEach(collect)
  }
  collect(expression)
  if (predicates.some((predicate) => predicate.kind === 'resource' || predicate.kind === 'use-item' || predicate.kind === 'equipment' || (predicate.kind === 'fleet' && [ ...(predicate.positions || []), ...(predicate.groups || []) ].some((entry) => hasShipIdentity(entry.selector))))) return 'a'
  if (predicates.some((predicate) => predicate.kind === 'fleet' && [ ...(predicate.positions || []), ...(predicate.groups || []) ].some((entry) => selectorModifiers(entry.selector, { byMaster: new Map() }).length))) return 'b'
  return 'c'
}

function fleetDemands(predicate = {}, selectorMapper = (selector) => selector) {
  return [
    ...(predicate.positions || []).map((position) => ({ selector: selectorMapper(position.selector), role: position.role, min: 1 })),
    ...(predicate.groups || []).map((group) => ({ ...group, selector: selectorMapper(group.selector) })),
  ]
}

function fleetText(predicate, lookup, includeRoles = true) {
  const fragments = []
  ;(predicate.positions || []).forEach((position) => fragments.push(`${includeRoles ? `${ROLE_LABELS[position.role] || position.role} ` : ''}${shipSelectorText(position.selector, lookup)}`))
  ;(predicate.groups || []).forEach((group) => fragments.push(`${shipSelectorText(group.selector, lookup)} ${countText(group.min, group.max)}`))
  if (predicate.size?.min != null || predicate.size?.max != null) fragments.push(`舰队 ${fleetSizeText(predicate.size?.min, predicate.size?.max)}`)
  ;(predicate.forbidden || []).forEach((selector) => fragments.push(`不含 ${shipSelectorText(selector, lookup)}`))
  return fragments.join('、') || '指定舰队'
}

function indexesForSelectors(catalogs = {}) {
  return catalogIndexes(catalogs)
}

function selectorNeedsCatalog(selector = {}) {
  return Boolean(selector.familyIds?.length || selector.groupIds?.length || selector.remodel)
}

function evaluateFleetComposition(predicate, confidence, rootState, catalogs) {
  const fleetsState = rootState?.info?.fleets
  const shipsState = rootState?.info?.ships
  const masterShips = rootState?.const?.$ships
  if (!fleetsState || !shipsState || !masterShips || rootState?.info?.dataFreshness?.ships === 'stale') return { status: 'unknown' }
  const indexes = indexesForSelectors(catalogs)
  const allFleets = Array.isArray(fleetsState) ? fleetsState : Object.values(fleetsState)
  const fleets = predicate.fleetId == null
    ? allFleets
    : allFleets.filter((fleet, index) => number(fleet?.api_id) === number(predicate.fleetId) || index + 1 === number(predicate.fleetId))
  if (!fleets.length) return { status: 'unknown' }
  const selectors = [
    ...(predicate.positions || []).map((entry) => entry.selector),
    ...(predicate.groups || []).map((entry) => entry.selector),
    ...(predicate.forbidden || []),
  ]
  const deckResults = fleets.map((fleet) => {
    const instanceIds = (fleet?.api_ship || []).map(number).filter((id) => id > 0)
    const entries = instanceIds.map((id) => shipsState[id]).map((ship) => ({ ship, master: masterShips[ship?.api_ship_id] }))
    if (entries.some((entry) => !entry.ship || !entry.master)) return 'unknown'
    if (selectors.some(selectorNeedsCatalog) && entries.some((entry) => !indexes.ships.has(number(entry.ship.api_ship_id)))) return 'unknown'
    const minSize = predicate.size?.min == null ? 0 : number(predicate.size.min)
    const maxSize = predicate.size?.max == null ? null : number(predicate.size.max)
    if (entries.length < minSize || (maxSize != null && entries.length > maxSize)) return 'blocked'
    if ((predicate.forbidden || []).some((selector) => entries.some((entry) => selectorMatchesShip(selector, entry.ship, entry.master, indexes)))) return 'blocked'
    if ((predicate.groups || []).some((group) => group.max != null && entries.filter((entry) => selectorMatchesShip(group.selector, entry.ship, entry.master, indexes)).length > number(group.max))) return 'blocked'
    const demands = []
    ;(predicate.positions || []).forEach((position) => demands.push({ selector: position.selector, role: position.role }))
    ;(predicate.groups || []).forEach((group) => {
      for (let index = 0; index < number(group.min); index += 1) demands.push(group)
    })
    const matches = (demand, entry, index) => {
      if (demand.role === 'flagship' && index !== 0) return false
      if (demand.role === 'second' && index !== 1) return false
      if (demand.role === 'escort' && index === 0) return false
      return selectorMatchesShip(demand.selector, entry.ship, entry.master, indexes)
    }
    const assigned = predicate.distinct === false
      ? demands.every((demand) => entries.some((entry, index) => matches(demand, entry, index)))
      : assignDistinct(demands, entries, matches)
    if (!assigned) return 'blocked'
    if (predicate.allowOnlyListed) {
      const allowed = [ ...(predicate.positions || []), ...(predicate.groups || []) ].map((entry) => entry.selector)
      if (entries.some((entry) => !allowed.some((selector) => selectorMatchesShip(selector, entry.ship, entry.master, indexes)))) return 'blocked'
    }
    return 'ready'
  })
  let status = deckResults.includes('ready') ? 'ready' : deckResults.includes('unknown') ? 'unknown' : 'blocked'
  if (confidence === 'unresolved') status = 'unknown'
  return { status }
}

function pushRow(sections, section, row) {
  if (!row.text) return
  const key = row.key || `${section}-${sections[section].length}`
  sections[section].push({ ...row, key })
}

function collectFleet(predicate, confidence, sections, rootState, catalogs, lookup, key) {
  const availableDemands = fleetDemands(predicate, (selector) => availabilitySelector(selector, lookup)).filter((entry) => hasShipIdentity(entry.selector))
  if (availableDemands.length) {
    const availabilityPredicate = {
      kind: 'fleet', positions: [], groups: availableDemands.map((entry) => ({ selector: entry.selector, min: number(entry.min) || 1, ...(entry.max == null ? {} : { max: entry.max }), ...(entry.distinctBy ? { distinctBy: entry.distinctBy } : {}) })),
      forbidden: [], size: {}, distinct: predicate.distinct !== false,
    }
    pushRow(sections, 'a', {
      key: `${key}-own`, text: `拥有 ${availableDemands.map((entry) => `${shipSelectorText(entry.selector, lookup)} ${countText(entry.min, entry.max)}`).join('、')}`,
      status: evaluatePredicate(availabilityPredicate, confidence, rootState, catalogs).status,
    })
  }
  fleetDemands(predicate).forEach((demand, index) => {
    const modifiers = selectorModifiers(demand.selector, lookup)
    if (!modifiers.length) return
    const modifierPredicate = { kind: 'fleet', positions: [], groups: [{ selector: demand.selector, min: number(demand.min) || 1, ...(demand.distinctBy ? { distinctBy: demand.distinctBy } : {}) }], forbidden: [], size: {}, distinct: true }
    pushRow(sections, 'b', {
      key: `${key}-modifier-${index}`, text: `${shipSelectorText(availabilitySelector(demand.selector, lookup), lookup)} ${modifiers.join('、')} ${countText(demand.min, demand.max)}`,
      status: evaluatePredicate(modifierPredicate, confidence, rootState, catalogs).status,
    })
  })
  const arrangementPredicate = {
    ...predicate,
    positions: (predicate.positions || []).map((entry) => ({ ...entry, selector: availabilitySelector(entry.selector, lookup) })),
    groups: (predicate.groups || []).map((entry) => ({ ...entry, selector: availabilitySelector(entry.selector, lookup) })),
  }
  pushRow(sections, 'c', {
    key: `${key}-fleet`, text: `编成 ${fleetText(arrangementPredicate, lookup)}`,
    status: evaluateFleetComposition(arrangementPredicate, confidence, rootState, catalogs).status,
  })
}

function collectEquipment(predicate, confidence, sections, rootState, catalogs, lookup, key) {
  const quantity = number(predicate.quantity) || 1
  const name = equipmentSelectorText(predicate.selector, lookup)
  const base = { kind: 'equipment', selector: predicate.selector, quantity, operation: predicate.operation || 'own' }
  pushRow(sections, 'a', {
    key: `${key}-own`, text: `拥有 ${name} ×${quantity}`,
    status: evaluatePredicate(base, confidence, rootState, catalogs).status,
    availabilityKey: `equipment:${JSON.stringify(predicate.selector || {})}`,
    availabilityQuantity: quantity,
    availabilitySource: key.startsWith('cost-') ? 'cost' : 'condition',
  })
  const modifiers = equipmentModifiers(predicate.state)
  if (modifiers.length) {
    pushRow(sections, 'b', {
      key: `${key}-modifier`, text: `${name} ${modifiers.join('、')} ×${quantity}`,
      status: evaluatePredicate({ ...base, state: { improvement: predicate.state?.improvement, proficiency: predicate.state?.proficiency } }, confidence, rootState, catalogs).status,
    })
  }
  const placement = predicate.placement
  const arrangement = []
  if (predicate.state?.locked != null) arrangement.push(predicate.state.locked ? '已锁定' : '未锁定')
  if (placement?.location === 'not-airbase') arrangement.push('未配置于基地航空队')
  if (placement?.mustBeCurrentlyEquipped || predicate.operation === 'equip') {
    let location = placement?.role === 'secretary' ? '秘书舰' : placement?.role === 'flagship' ? '旗舰' : '指定舰娘'
    if (placement?.shipSelector) location += `（${shipSelectorText(placement.shipSelector, lookup)}）`
    if (placement?.slotIndex != null) location += `第 ${number(placement.slotIndex) + 1} 格`
    arrangement.push(`装备于${location}`)
  }
  if (arrangement.length) {
    pushRow(sections, 'c', {
      key: `${key}-placement`, text: `${name} ${arrangement.join('、')} ×${quantity}`,
      status: evaluatePredicate({ ...base, state: predicate.state?.locked == null ? {} : { locked: predicate.state.locked }, placement }, confidence, rootState, catalogs).status,
    })
  }
}

function collectPredicate(predicate, confidence, sections, rootState, catalogs, lookup, key) {
  if (predicate.kind === 'fleet') return collectFleet(predicate, confidence, sections, rootState, catalogs, lookup, key)
  if (predicate.kind === 'equipment') return collectEquipment(predicate, confidence, sections, rootState, catalogs, lookup, key)
  if (predicate.kind === 'resource') {
    return pushRow(sections, 'a', {
      key, text: `拥有 ${predicate.label || RESOURCE_LABELS[predicate.resource] || predicate.resource} ×${number(predicate.quantity)}`,
      status: evaluatePredicate(predicate, confidence, rootState, catalogs).status,
      availabilityKey: `resource:${predicate.resource}`, availabilityQuantity: number(predicate.quantity),
      availabilitySource: key.startsWith('cost-') ? 'cost' : 'condition',
    })
  }
  if (predicate.kind === 'use-item') {
    const name = predicate.label || nameOf(lookup.useItems.get(number(predicate.useItemId)), `道具 #${predicate.useItemId}`)
    return pushRow(sections, 'a', {
      key, text: `拥有 ${name} ×${number(predicate.quantity)}`, status: evaluatePredicate(predicate, confidence, rootState, catalogs).status,
      availabilityKey: `use-item:${number(predicate.useItemId)}`, availabilityQuantity: number(predicate.quantity),
      availabilitySource: key.startsWith('cost-') ? 'cost' : 'condition',
    })
  }
  if (predicate.kind === 'map') {
    const status = evaluatePredicate(predicate, confidence, rootState, catalogs).status
    return pushRow(sections, 'a', {
      key,
      text: `解锁 ${slash((predicate.mapIds || []).map((id) => mapText(id, lookup)))}`,
      status,
      hidden: status === 'ready',
    })
  }
  return pushRow(sections, 'a', { key, text: predicate.label || '未确认条件', status: 'unknown' })
}

function collectExpression(expression, sections, rootState, catalogs, lookup, key = 'condition') {
  if (!expression) return
  if (expression.op === 'all') {
    ;(expression.children || []).forEach((child, index) => collectExpression(child, sections, rootState, catalogs, lookup, `${key}-${index}`))
    return
  }
  if (expression.op === 'predicate') return collectPredicate(expression.predicate, expression.confidence, sections, rootState, catalogs, lookup, key)
  if (collectFleetAlternatives(expression, sections, rootState, catalogs, lookup, key)) return
  const evaluation = evaluateQuestRequirements(emptyRequirements(expression), rootState, catalogs)
  pushRow(sections, expressionSection(expression), { key, text: expressionText(expression, lookup), status: evaluation.status })
}

function costPredicate(cost) {
  if (cost.kind === 'equipment') return { kind: 'equipment', selector: cost.selector, quantity: cost.quantity, state: cost.state, placement: cost.placement, operation: cost.operation, label: cost.label }
  if (cost.kind === 'ship') return { kind: 'fleet', positions: [], groups: [{ selector: cost.selector, min: cost.quantity }], forbidden: [], size: {}, distinct: true, label: cost.label }
  if (cost.kind === 'resource') return { kind: 'resource', resource: cost.resource, quantity: cost.quantity, label: cost.label }
  if (cost.kind === 'use-item') return { kind: 'use-item', useItemId: cost.useItemId, quantity: cost.quantity, label: cost.label }
  return { kind: cost.kind, label: cost.label }
}

function collectCost(cost, sections, rootState, catalogs, lookup, key) {
  if (cost.kind !== 'ship') return collectPredicate(costPredicate(cost), cost.confidence, sections, rootState, catalogs, lookup, key)
  const predicate = costPredicate(cost)
  const selector = availabilitySelector(cost.selector, lookup)
  const available = { ...predicate, groups: [{ selector, min: cost.quantity }] }
  pushRow(sections, 'a', {
    key: `${key}-own`, text: `拥有 ${shipSelectorText(selector, lookup)} ×${number(cost.quantity) || 1}`,
    status: evaluatePredicate(available, cost.confidence, rootState, catalogs).status,
  })
  const modifiers = selectorModifiers(cost.selector, lookup)
  if (modifiers.length) pushRow(sections, 'b', {
    key: `${key}-modifier`, text: `${shipSelectorText(selector, lookup)} ${modifiers.join('、')} ×${number(cost.quantity) || 1}`,
    status: evaluatePredicate(predicate, cost.confidence, rootState, catalogs).status,
  })
}

function goalRowText(row, lookup) {
  const event = row.key.split('@')[0]
  const eventLabel = EVENT_LABELS[event] || event
  const condition = row.condition || {}
  if (condition.maparea?.length) return `${slash(condition.maparea.map((id) => mapText(id, lookup)))} ${eventLabel}`
  if (condition.mapcell?.length) return `${slash(condition.mapcell.map((cell) => String(cell)))} ${eventLabel}`
  if (condition.mission?.length) return `${slash(condition.mission.map((id) => missionText(id, lookup)))} 成功`
  if (condition.slotitemId?.length) return `${eventLabel} ${slash(condition.slotitemId.map((id) => nameOf(lookup.equipment.get(number(id)), `装备 #${id}`)))}`
  if (condition.slotitemType2?.length) return `${eventLabel} ${slash(condition.slotitemType2.map((id) => nameOf(lookup.equipmentTypes.get(number(id)), `装备类型 #${id}`)))}`
  return clean(condition.description) || eventLabel
}

function objectiveText(objective, lookup) {
  const eventLabel = EVENT_LABELS[objective.event] || objective.event || '完成任务'
  if (objective.target?.mapIds?.length) return `${slash(objective.target.mapIds.map((id) => mapText(id, lookup)))} ${eventLabel}`
  if (objective.target?.missionIds?.length) return `${slash(objective.target.missionIds.map((id) => missionText(id, lookup)))} 成功`
  const label = clean(objective.label)
  return label && label.length <= 72 ? label : eventLabel
}

function objectiveEquipmentSelector(expression) {
  if (!expression || typeof expression !== 'object') return null
  if (expression.op === 'predicate' && expression.predicate?.kind === 'equipment') return expression.predicate.selector || null
  if (expression.op === 'not') return objectiveEquipmentSelector(expression.child)
  for (const child of expression.children || []) {
    const selector = objectiveEquipmentSelector(child)
    if (selector) return selector
  }
  return null
}

function progressObjectiveText(quest, objective, lookup) {
  if (objective.target?.mapIds?.length || objective.target?.missionIds?.length) return objectiveText(objective, lookup)
  if (quest.category === 'exercise' && String(objective.event || '').startsWith('practice')) return EVENT_LABELS[objective.event] || '演习'
  if (objective.event === 'destory_item') {
    const rawLabel = clean(objective.label).replace(/^(?:废弃|廃棄)\s*(?:[-:：]\s*)?/, '')
    const selector = objectiveEquipmentSelector(objective.constraints)
    const label = !rawLabel || rawLabel.length > 48 || /[。！※]|任務|準備|用意/.test(rawLabel)
      ? selector ? equipmentSelectorText(selector, lookup) : '任意装备'
      : rawLabel
    return `废弃 ${label}`
  }
  if (quest.category === 'factory' && ['factory_operation', 'remodel_item', 'create_item'].includes(objective.event)) return quest.name
  return objectiveText(objective, lookup)
}

function goalMatchScore(objective, row) {
  const event = row.key.split('@')[0]
  let score = objective.completion?.eventKey === row.key ? 100 : objective.event === event ? 10 : 0
  const condition = row.condition || {}
  if (objective.target?.mapIds?.some((id) => condition.maparea?.map(number).includes(number(id)))) score += 50
  if (objective.target?.missionIds?.some((id) => condition.mission?.map(String).includes(String(id)))) score += 50
  const equipmentSelector = objectiveEquipmentSelector(objective.constraints)
  if (equipmentSelector?.masterIds?.some((id) => condition.slotitemId?.map(number).includes(number(id)))) score += 50
  if (equipmentSelector?.type2Ids?.some((id) => condition.slotitemType2?.map(number).includes(number(id)))) score += 50
  if (score > 0 && number(objective.count?.required) === number(condition.required)) score += 5
  return score
}

function matchGoalRows(objectives, rows) {
  if (objectives.length === 1 && rows.length === 1) return [rows[0]]
  const matches = Array(objectives.length).fill(null)
  const usedObjectives = new Set()
  const usedRows = new Set()
  const pairs = []
  objectives.forEach((objective, objectiveIndex) => rows.forEach((row, rowIndex) => {
    const score = goalMatchScore(objective, row)
    if (score > 0) pairs.push({ objectiveIndex, rowIndex, score })
  }))
  pairs.sort((left, right) => right.score - left.score || left.objectiveIndex - right.objectiveIndex || left.rowIndex - right.rowIndex)
  pairs.forEach(({ objectiveIndex, rowIndex }) => {
    if (usedObjectives.has(objectiveIndex) || usedRows.has(rowIndex)) return
    usedObjectives.add(objectiveIndex)
    usedRows.add(rowIndex)
    matches[objectiveIndex] = rows[rowIndex]
  })
  return matches
}

function concurrentRecommendationText(recommendation) {
  const labels = { sortie: '可同时出击', exercise: '可同时演习', expedition: '可同时远征', factory: '可同时工厂' }
  const code = recommendation.code || `#${recommendation.id}`
  const qualifier = recommendation.kind === 'expedition' && recommendation.missionIds?.length
    ? ` #${recommendation.missionIds.join('/')}`
    : ''
  return `${labels[recommendation.kind] || '可同时完成'}${qualifier}：${code}${recommendation.name ? ` ${recommendation.name}` : ''}`
}

function addConcurrentRecommendations(sections, recommendations, anchorKey = 'progress') {
  const entries = Array.isArray(recommendations) ? recommendations : []
  if (!entries.length) return
  const kinds = unique(entries.map((entry) => entry.kind || 'quest'))
  const recommendationType = kinds.length === 1 ? kinds[0] : 'mixed'
  pushRow(sections, 'progress', {
    key: `${anchorKey}-concurrent`,
    kind: 'recommendation',
    recommendationType,
    recommendations: entries,
    text: entries.length === 1 ? concurrentRecommendationText(entries[0]) : `可同时完成 ×${entries.length}`,
    status: 'ready',
  })
}

function recommendationsForProgress(recommendationsByProgress, key) {
  if (!recommendationsByProgress) return undefined
  if (typeof recommendationsByProgress.get === 'function') return recommendationsByProgress.get(key)
  return recommendationsByProgress[key]
}

function addProgress(quest, sections, lookup, goal, record, questStatus, recommendations, recommendationsByProgress) {
  if (quest.category === 'composition') return
  const complete = ['completed', 'inferred-completed', 'claimable'].includes(questStatus)
  const trackedRows = goalRows(goal, record)
  const objectives = (quest.requirements?.objectives || []).filter((objective) => objective.event !== 'formation')
  if (objectives.length) {
    const matchedRows = matchGoalRows(objectives, trackedRows)
    objectives.forEach((objective, index) => {
      const row = matchedRows[index]
      const required = number(objective.count?.required) || 1
      const actual = complete ? required : row ? Math.min(row.count, required) : null
      pushRow(sections, 'progress', {
        key: `progress-${objective.id}`, text: progressObjectiveText(quest, objective, lookup),
        status: actual == null ? 'unknown' : actual >= required ? 'ready' : 'blocked', actual, required,
      })
      const objectiveKey = String(objective.id ?? `objective-${index}`)
      const objectiveRecommendations = recommendationsForProgress(recommendationsByProgress, objectiveKey)
      if (objectiveRecommendations) {
        addConcurrentRecommendations(sections, objectiveRecommendations, `progress-${objective.id}`)
      }
    })
    if (!recommendationsByProgress) addConcurrentRecommendations(sections, recommendations)
    return
  }
  if (trackedRows.length) {
    trackedRows.forEach((row) => {
      const actual = complete ? row.required : row.count
      pushRow(sections, 'progress', {
        key: `progress-${row.key}`, text: goalRowText(row, lookup),
        status: actual >= row.required ? 'ready' : 'blocked', actual, required: row.required,
      })
      const rowRecommendations = recommendationsForProgress(recommendationsByProgress, row.key)
      if (rowRecommendations) {
        addConcurrentRecommendations(sections, rowRecommendations, `progress-${row.key}`)
      }
    })
    if (!recommendationsByProgress) addConcurrentRecommendations(sections, recommendations)
    return
  }
  addConcurrentRecommendations(sections, recommendations)
}

function normalizeRows(rows) {
  const coveredCostKeys = new Set()
  const availability = new Map()
  rows.forEach((row) => {
    if (!row.availabilityKey) return
    const group = availability.get(row.availabilityKey) || { conditions: [], costs: [] }
    group[row.availabilitySource === 'cost' ? 'costs' : 'conditions'].push(row)
    availability.set(row.availabilityKey, group)
  })
  availability.forEach(({ conditions, costs }) => {
    const conditionQuantity = Math.max(0, ...conditions.map((row) => number(row.availabilityQuantity)))
    const costQuantity = costs.reduce((sum, row) => sum + number(row.availabilityQuantity), 0)
    if (conditionQuantity >= costQuantity) costs.forEach((row) => coveredCostKeys.add(row.key))
  })
  const seen = new Set()
  return rows.filter((row) => !row.hidden).filter((row) => {
    if (coveredCostKeys.has(row.key)) return false
    const signature = row.kind === 'recommendation'
      ? `${row.kind}\0${row.key}`
      : `${row.text}\0${row.status}\0${row.actual ?? ''}\0${row.required ?? ''}`
    if (seen.has(signature)) return false
    seen.add(signature)
    return true
  }).map((row) => {
    const normalized = { ...row }
    delete normalized.availabilityKey
    delete normalized.availabilityQuantity
    delete normalized.availabilitySource
    delete normalized.hidden
    return normalized
  })
}

function collectPrerequisiteSections({ quest, rootState, catalogs }) {
  const sections = { a: [], b: [], c: [], progress: [] }
  const lookup = catalogLookup(catalogs)
  collectExpression(quest.requirements?.conditions, sections, rootState, catalogs, lookup)
  ;(quest.requirements?.costs || []).forEach((cost, index) => collectCost(cost, sections, rootState, catalogs, lookup, `cost-${cost.id || index}`))
  const mapIds = unique((quest.requirements?.objectives || []).flatMap((objective) => objective.target?.mapIds || []).map(number))
  mapIds.forEach((mapId) => collectPredicate({ kind: 'map', mapIds: [mapId], match: 'all' }, 'exact', sections, rootState, catalogs, lookup, `map-${mapId}`))
  ;(quest.requirements?.unresolved || []).forEach((entry, index) => pushRow(sections, 'a', {
    key: `unresolved-${index}`, text: clean(entry.raw) || '未确认条件', status: 'unknown',
  }))
  return { lookup, sections }
}

function prerequisiteProgress({ quest, rootState, catalogs }) {
  const { sections } = collectPrerequisiteSections({ quest, rootState, catalogs })
  const hasPrerequisites = ['a', 'b', 'c'].some((id) => sections[id].length)
  let fulfilledGroups = 0
  for (const id of ['a', 'b', 'c']) {
    if (!sections[id].every((row) => row.status === 'ready')) break
    fulfilledGroups += 1
  }
  return { hasPrerequisites, fulfilledGroups: hasPrerequisites ? fulfilledGroups : 0 }
}

function buildRequirementSections({ quest, rootState, catalogs, goal, record, questStatus, recommendations, recommendationsByProgress }) {
  const { lookup, sections } = collectPrerequisiteSections({ quest, rootState, catalogs })
  addProgress(quest, sections, lookup, goal, record, questStatus, recommendations, recommendationsByProgress)
  return SECTION_ORDER.map((id) => ({ id, label: SECTION_LABELS[id], rows: normalizeRows(sections[id]) })).filter((section) => section.rows.length)
}

module.exports = {
  SECTION_LABELS,
  buildRequirementSections,
  evaluateFleetComposition,
  missionText,
  prerequisiteProgress,
}
