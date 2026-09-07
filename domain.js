'use strict'

const EXPRESSION_OPERATORS = new Set(['all', 'any', 'atLeast', 'not', 'predicate'])
const RESULT_STATUSES = new Set(['ready', 'blocked', 'unknown'])
const remodelAcceptanceCache = new WeakMap()
const catalogIndexesCache = new WeakMap()

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function result(status, check) {
  return {
    status,
    checks: check ? [{ status, actual: check.actual ?? null, required: check.required ?? null, ...check }] : [],
  }
}

function stale(rootState, key) {
  return rootState?.info?.dataFreshness?.[key] === 'stale' || rootState?.meta?.freshness?.[key] === 'stale'
}

function combineAll(results) {
  const checks = results.flatMap((entry) => entry.checks)
  if (results.some((entry) => entry.status === 'blocked')) return { status: 'blocked', checks }
  if (results.some((entry) => entry.status === 'unknown')) return { status: 'unknown', checks }
  return { status: 'ready', checks }
}

function combineAny(results) {
  const checks = results.flatMap((entry) => entry.checks)
  if (results.some((entry) => entry.status === 'ready')) return { status: 'ready', checks }
  if (results.some((entry) => entry.status === 'unknown')) return { status: 'unknown', checks }
  return { status: 'blocked', checks }
}

function remodelAcceptance(ships) {
  if (remodelAcceptanceCache.has(ships)) return remodelAcceptanceCache.get(ships)
  const byId = new Map(ships.map((entry) => [number(entry.masterId), entry]))
  const accepted = new Map()
  const reaches = (start, target) => {
    const pending = [...(byId.get(start)?.successorIds || [])].map(number)
    const visited = new Set()
    while (pending.length) {
      const id = pending.pop()
      if (id === target) return true
      if (visited.has(id)) continue
      visited.add(id)
      pending.push(...(byId.get(id)?.successorIds || []).map(number))
    }
    return false
  }
  ships.forEach((entry) => {
    const masterId = number(entry.masterId)
    if (reaches(masterId, masterId)) {
      accepted.set(masterId, new Set([masterId]))
      return
    }
    const descendants = new Set([masterId])
    const pending = [...(entry.successorIds || [])].map(number)
    while (pending.length) {
      const id = pending.pop()
      if (descendants.has(id)) continue
      descendants.add(id)
      pending.push(...(byId.get(id)?.successorIds || []).map(number))
    }
    accepted.set(masterId, descendants)
  })
  remodelAcceptanceCache.set(ships, accepted)
  return accepted
}

function catalogIndexes(catalogs = {}) {
  if (catalogs && typeof catalogs === 'object' && catalogIndexesCache.has(catalogs)) return catalogIndexesCache.get(catalogs)
  const ships = catalogs.ships || []
  const indexes = {
    ships: new Map(ships.map((entry) => [number(entry.masterId), entry])),
    remodelAccepted: remodelAcceptance(ships),
    shipGroups: new Map((catalogs.shipGroups || []).map((entry) => [String(entry.id), new Set((entry.memberMasterIds || []).map(number))])),
    equipment: new Map((catalogs.equipment || []).map((entry) => [number(entry.masterId), entry])),
  }
  if (catalogs && typeof catalogs === 'object') catalogIndexesCache.set(catalogs, indexes)
  return indexes
}

function selectorMatchesShip(selector = {}, ship, master, indexes) {
  if (!ship || !master) return false
  const masterId = number(ship.api_ship_id ?? master.api_id)
  const catalog = indexes.ships.get(masterId)
  if (selector.masterIds?.length && !selector.masterIds.map(number).some((requiredId) =>
    (indexes.remodelAccepted?.get(requiredId) || new Set([requiredId])).has(masterId))) return false
  if (selector.groupIds?.length && !selector.groupIds.some((id) => indexes.shipGroups.get(String(id))?.has(masterId))) return false
  if (selector.familyIds?.length && !selector.familyIds.map(number).includes(number(catalog?.familyId))) return false
  if (selector.typeIds?.length && !selector.typeIds.map(number).includes(number(master.api_stype))) return false
  if (selector.classIds?.length && !selector.classIds.map(number).includes(number(master.api_ctype))) return false
  if (selector.level?.min != null && number(ship.api_lv) < number(selector.level.min)) return false
  if (selector.level?.max != null && number(ship.api_lv) > number(selector.level.max)) return false
  const speed = number(master.api_soku ?? catalog?.speed)
  if (selector.speed?.min != null && speed < number(selector.speed.min)) return false
  if (selector.speed?.exact != null && speed !== number(selector.speed.exact)) return false
  const remodel = selector.remodel
  if (remodel?.exactMasterIds?.length && !remodel.exactMasterIds.map(number).includes(masterId)) return false
  if (remodel?.allowedMasterIds?.length && !remodel.allowedMasterIds.map(number).includes(masterId)) return false
  if (remodel?.minimumStage != null && (!catalog || number(catalog.remodelStage) < number(remodel.minimumStage))) return false
  if (remodel?.beforeStage != null && (!catalog || number(catalog.remodelStage) >= number(remodel.beforeStage))) return false
  return true
}

function selectorNeedsShipCatalog(selector = {}) {
  return Boolean(selector.familyIds?.length || selector.groupIds?.length || selector.remodel)
}

function assignDistinct(demands, ships, matches) {
  const ordered = demands
    .map((demand) => ({ demand, candidates: ships.map((ship, index) => matches(demand, ship, index) ? index : -1).filter((index) => index >= 0) }))
    .sort((left, right) => left.candidates.length - right.candidates.length)
  const used = new Set()
  function visit(index) {
    if (index >= ordered.length) return true
    for (const candidate of ordered[index].candidates) {
      if (used.has(candidate)) continue
      used.add(candidate)
      if (visit(index + 1)) return true
      used.delete(candidate)
    }
    return false
  }
  return visit(0)
}

function canAssembleFleet(demands, ships, groups, minimumSize, maximumSize, matches, identity) {
  const ordered = demands
    .map((demand) => ({ demand, candidates: ships.map((ship, index) => matches(demand, ship, index) ? index : -1).filter((index) => index >= 0) }))
    .sort((left, right) => left.candidates.length - right.candidates.length)
  const used = new Set()
  const usedIdentities = new Map()
  const assignedDemands = new Map()
  const respectsMaximums = () => groups.every((group) => group.max == null ||
    Array.from(used).filter((shipIndex) => {
      const assigned = assignedDemands.get(shipIndex)
      return (assigned == null || assigned === group) && matches(group, ships[shipIndex], shipIndex)
    }).length <= number(group.max))
  function fill(start) {
    if (used.size >= minimumSize) return true
    for (let index = start; index < ships.length; index += 1) {
      if (used.has(index)) continue
      used.add(index)
      if (respectsMaximums() && fill(index + 1)) return true
      used.delete(index)
    }
    return false
  }
  function visit(index) {
    if (index >= ordered.length) return fill(0)
    const demand = ordered[index].demand
    for (const candidate of ordered[index].candidates) {
      if (used.has(candidate)) continue
      const identityValue = demand.distinctBy ? identity(demand.distinctBy, ships[candidate]) : null
      const identities = demand.distinctBy ? usedIdentities.get(demand) || new Set() : null
      if (identities?.has(identityValue)) continue
      used.add(candidate)
      assignedDemands.set(candidate, demand)
      if (identities) { identities.add(identityValue); usedIdentities.set(demand, identities) }
      if (respectsMaximums() && visit(index + 1)) return true
      used.delete(candidate)
      assignedDemands.delete(candidate)
      if (identities) identities.delete(identityValue)
    }
    return false
  }
  if (maximumSize != null && minimumSize > maximumSize) return false
  if (groups.some((group) => group.max != null && number(group.min) > number(group.max))) return false
  return visit(0)
}

function evaluateFleet(predicate, context) {
  const shipsState = context.rootState?.info?.ships
  const masterShips = context.rootState?.const?.$ships
  if (!shipsState || Object.keys(shipsState).length === 0 || !masterShips || Object.keys(masterShips).length === 0 || stale(context.rootState, 'ships')) {
    return result('unknown', { kind: 'fleet', label: predicate.label || '编成', reason: 'ship-data-unavailable' })
  }
  const rawShips = Object.values(shipsState)
  const allSelectors = [
    ...(predicate.positions || []).map((entry) => entry.selector),
    ...(predicate.groups || []).map((entry) => entry.selector),
    ...(predicate.forbidden || []),
  ]
  const needsCatalog = allSelectors.some(selectorNeedsShipCatalog) || (predicate.groups || []).some((group) => group.distinctBy === 'family')
  const needsKnownStage = allSelectors.some((selector) => selector?.remodel?.minimumStage != null || selector?.remodel?.beforeStage != null)
  const incomplete = rawShips.some((ship) => {
    const catalog = context.indexes.ships.get(number(ship?.api_ship_id))
    return !masterShips[ship?.api_ship_id] || (needsCatalog && !catalog) || (needsKnownStage && catalog?.remodelStageKnown === false)
  })
  const allShips = rawShips.map((ship) => ({ ship, master: masterShips[ship?.api_ship_id] })).filter((entry) => entry.master)
  const forbidden = predicate.forbidden || []
  const ships = allShips.filter((entry) => !forbidden.some((selector) => selectorMatchesShip(selector, entry.ship, entry.master, context.indexes)))
  const minSize = number(predicate.size?.min)
  const maxSize = predicate.size?.max == null ? null : number(predicate.size.max)
  if (ships.length < minSize) {
    return result(incomplete ? 'unknown' : 'blocked', { kind: 'fleet', label: predicate.label || '编成', actual: ships.length, required: minSize, reason: incomplete ? 'ship-data-incomplete' : 'fleet-size' })
  }

  const positions = predicate.positions || []
  const demands = positions.map((position) => ({ selector: position.selector, role: position.role }))
  const groups = predicate.groups || []
  groups.forEach((group) => {
    for (let index = 0; index < number(group.min); index += 1) demands.push(group)
  })
  const requiredSize = Math.max(minSize, demands.length)
  const possible = predicate.distinct === false
    ? demands.every((demand) => ships.some((entry) => selectorMatchesShip(demand.selector, entry.ship, entry.master, context.indexes)))
    : canAssembleFleet(
        demands, ships, groups, requiredSize, maxSize,
        (demand, entry) => selectorMatchesShip(demand.selector, entry.ship, entry.master, context.indexes),
        (distinctBy, entry) => distinctBy === 'family'
          ? number(context.indexes.ships.get(number(entry.ship.api_ship_id))?.familyId) || number(entry.ship.api_ship_id)
          : number(entry.ship.api_ship_id),
      )
  if (!possible) {
    return result(incomplete ? 'unknown' : 'blocked', { kind: 'fleet', label: predicate.label || '编成', actual: ships.length, required: demands.length, reason: incomplete ? 'ship-data-incomplete' : 'distinct-assignment' })
  }
  if (maxSize != null && requiredSize > maxSize) {
    return result('blocked', { kind: 'fleet', label: predicate.label || '编成', required: maxSize, reason: 'fleet-size-conflict' })
  }
  return result('ready', { kind: 'fleet', label: predicate.label || '编成', actual: ships.length, required: requiredSize })
}

function equipmentMatches(predicate, equip, master) {
  if (!equip || !master) return false
  const selector = predicate.selector || {}
  if (selector.masterIds?.length && !selector.masterIds.map(number).includes(number(equip.api_slotitem_id))) return false
  if (selector.type2Ids?.length && !selector.type2Ids.map(number).includes(number(master.api_type?.[2]))) return false
  const state = predicate.state || {}
  if (state.improvement?.min != null && number(equip.api_level) < number(state.improvement.min)) return false
  if (state.improvement?.exact != null && number(equip.api_level) !== number(state.improvement.exact)) return false
  if (state.proficiency?.min != null && number(equip.api_alv) < number(state.proficiency.min)) return false
  if (state.proficiency?.exact != null && number(equip.api_alv) !== number(state.proficiency.exact)) return false
  if (state.locked != null && Boolean(equip.api_locked) !== Boolean(state.locked)) return false
  return true
}

function evaluateEquipment(predicate, context) {
  const equips = context.rootState?.info?.equips
  const masterEquips = context.rootState?.const?.$equips
  if (!equips || !masterEquips || Object.keys(masterEquips).length === 0 || stale(context.rootState, 'equips')) {
    return result('unknown', { kind: 'equipment', label: predicate.label || '装备', reason: 'equipment-data-unavailable' })
  }
  const allEquips = Object.values(equips)
  const incomplete = allEquips.some((equip) => !masterEquips[equip?.api_slotitem_id])
  let matches = allEquips.filter((equip) => equipmentMatches(predicate, equip, masterEquips[equip?.api_slotitem_id]))
  const required = number(predicate.quantity) || 1
  if (predicate.placement?.location === 'not-airbase') {
    const airbase = context.rootState?.info?.airbase
    if (!Array.isArray(airbase) || stale(context.rootState, 'airbase')) {
      return result('unknown', { kind: 'equipment', label: predicate.label || '装备', reason: 'airbase-data-unavailable' })
    }
    const deployedIds = new Set(airbase.flatMap((base) => (base?.api_plane_info || [])
      .map((plane) => number(plane?.api_slotid)).filter((id) => id > 0)))
    matches = matches.filter((equip) => !deployedIds.has(number(equip.api_id)))
  }
  if (predicate.placement?.shipSelector) {
    const ships = context.rootState?.info?.ships
    const masterShips = context.rootState?.const?.$ships
    if (!ships || !masterShips) {
      return result('unknown', { kind: 'equipment', label: predicate.label || '装备', reason: 'ship-data-unavailable' })
    }
    const shipDataIncomplete = Object.values(ships).some((ship) => !masterShips[ship?.api_ship_id] ||
      (selectorNeedsShipCatalog(predicate.placement.shipSelector) && !context.indexes.ships.has(number(ship?.api_ship_id))))
    const hasShip = Object.values(ships).some((ship) => selectorMatchesShip(predicate.placement.shipSelector, ship, masterShips[ship?.api_ship_id], context.indexes))
    if (!hasShip) return result(shipDataIncomplete ? 'unknown' : 'blocked', {
      kind: 'equipment', label: predicate.label || '装备', reason: shipDataIncomplete ? 'ship-data-incomplete' : 'placement-ship-missing',
    })
  }
  if (predicate.placement?.mustBeCurrentlyEquipped) {
    const ships = context.rootState?.info?.ships
    if (!ships) return result('unknown', { kind: 'equipment', label: predicate.label || '装备', reason: 'ship-data-unavailable' })
    const matchingIds = new Set(matches.map((equip) => number(equip.api_id)))
    const slotIndex = predicate.placement.slotIndex
    const fleets = context.rootState?.info?.fleets
    const secretaryId = Array.isArray(fleets) ? number(fleets[0]?.api_ship?.[0]) : 0
    if (predicate.placement.role === 'secretary' && !secretaryId) {
      return result('unknown', { kind: 'equipment', label: predicate.label || '装备', reason: 'fleet-data-unavailable' })
    }
    const equippedCount = Object.values(ships).reduce((count, ship) => {
      if (predicate.placement.role === 'secretary' && number(ship.api_id) !== secretaryId) return count
      if (predicate.placement.shipSelector) {
        const masterShips = context.rootState?.const?.$ships
        if (!masterShips || !selectorMatchesShip(predicate.placement.shipSelector, ship, masterShips[ship?.api_ship_id], context.indexes)) return count
      }
      const slots = [...(ship.api_slot || []), ship.api_slot_ex]
      const selected = slotIndex == null ? slots : [slots[number(slotIndex)]]
      return count + selected.filter((id) => matchingIds.has(number(id))).length
    }, 0)
    return result(equippedCount >= required ? 'ready' : incomplete ? 'unknown' : 'blocked', {
      kind: 'equipment', label: predicate.label || '装备', actual: equippedCount, required,
      reason: incomplete ? 'equipment-master-data-incomplete' : 'equipped-count',
    })
  }
  const status = matches.length >= required ? 'ready' : incomplete ? 'unknown' : 'blocked'
  return result(status, {
    kind: 'equipment', label: predicate.label || '装备', actual: matches.length, required, reason: incomplete ? 'equipment-master-data-incomplete' : 'inventory-count',
  })
}

function evaluateResource(predicate, context) {
  const resources = context.rootState?.info?.resources
  const indexes = { fuel: 0, ammo: 1, steel: 2, bauxite: 3 }
  if (!Array.isArray(resources) || resources.length < 4 || indexes[predicate.resource] == null || stale(context.rootState, 'resources')) {
    return result('unknown', { kind: 'resource', label: predicate.label || predicate.resource, reason: 'resource-data-unavailable' })
  }
  const actual = number(resources[indexes[predicate.resource]])
  const required = number(predicate.quantity)
  return result(actual >= required ? 'ready' : 'blocked', { kind: 'resource', label: predicate.label || predicate.resource, actual, required })
}

function evaluateUseItem(predicate, context) {
  const materialIndex = { 1: 5, 2: 4, 3: 6, 4: 7 }[number(predicate.useItemId)]
  if (materialIndex != null) {
    const resources = context.rootState?.info?.resources
    if (!Array.isArray(resources) || resources.length <= materialIndex || stale(context.rootState, 'resources')) {
      return result('unknown', { kind: 'use-item', label: predicate.label || '道具', reason: 'resource-data-unavailable' })
    }
    const actual = number(resources[materialIndex])
    const required = number(predicate.quantity)
    return result(actual >= required ? 'ready' : 'blocked', { kind: 'use-item', label: predicate.label || '道具', actual, required })
  }
  if (number(predicate.useItemId) === 44) {
    const value = context.rootState?.info?.basic?.api_fcoin
    if (Number.isFinite(Number(value)) && !stale(context.rootState, 'basic')) {
      const actual = number(value)
      const required = number(predicate.quantity)
      return result(actual >= required ? 'ready' : 'blocked', { kind: 'use-item', label: predicate.label || '家具币', actual, required })
    }
  }
  const useitems = context.rootState?.info?.useitems
  if (!useitems || stale(context.rootState, 'useitems') || !Object.prototype.hasOwnProperty.call(useitems, predicate.useItemId)) {
    return result('unknown', { kind: 'use-item', label: predicate.label || '道具', reason: 'useitem-data-unavailable' })
  }
  const actual = number(useitems[predicate.useItemId]?.api_count)
  const required = number(predicate.quantity)
  return result(actual >= required ? 'ready' : 'blocked', { kind: 'use-item', label: predicate.label || '道具', actual, required })
}

function evaluateMap(predicate, context) {
  const maps = context.rootState?.info?.maps
  if (!maps || Object.keys(maps).length === 0 || stale(context.rootState, 'maps')) {
    return result('unknown', { kind: 'map', label: predicate.label || '海图', reason: 'map-data-unavailable' })
  }
  const mapIds = predicate.mapIds || []
  const actual = mapIds.filter((id) => maps[number(id)] != null).length
  const required = predicate.match === 'any' ? 1 : mapIds.length
  return result(actual >= required ? 'ready' : 'blocked', { kind: 'map', label: predicate.label || '海图', actual, required, reason: 'map-unlocked' })
}

function evaluatePredicate(predicate, context) {
  if (!predicate || typeof predicate !== 'object') return result('unknown', { kind: 'invalid', reason: 'predicate-missing' })
  if (predicate.kind === 'fleet') return evaluateFleet(predicate, context)
  if (predicate.kind === 'equipment') return evaluateEquipment(predicate, context)
  if (predicate.kind === 'resource') return evaluateResource(predicate, context)
  if (predicate.kind === 'use-item') return evaluateUseItem(predicate, context)
  if (predicate.kind === 'map') return evaluateMap(predicate, context)
  return result('unknown', { kind: predicate.kind || 'invalid', label: predicate.label, reason: 'unsupported-predicate' })
}

function evaluateExpression(expression, context) {
  if (!expression || typeof expression !== 'object' || !EXPRESSION_OPERATORS.has(expression.op)) {
    return result('unknown', { kind: 'expression', reason: 'invalid-expression' })
  }
  if (expression.op === 'predicate') {
    const evaluated = evaluatePredicate(expression.predicate, context)
    if (expression.confidence === 'unresolved') {
      return { status: 'unknown', checks: evaluated.checks.map((check) => ({ ...check, status: 'unknown', reason: 'unverified-rule' })) }
    }
    return evaluated
  }
  if (expression.op === 'not') {
    const child = evaluateExpression(expression.child, context)
    return { status: child.status === 'ready' ? 'blocked' : child.status === 'blocked' ? 'ready' : 'unknown', checks: child.checks }
  }
  const children = (expression.children || []).map((child) => evaluateExpression(child, context))
  if (expression.op === 'all') return children.length ? combineAll(children) : { status: 'ready', checks: [] }
  if (expression.op === 'any') return children.length ? combineAny(children) : result('unknown', { kind: 'expression', reason: 'empty-any' })
  const required = number(expression.count)
  const ready = children.filter((entry) => entry.status === 'ready').length
  const possible = ready + children.filter((entry) => entry.status === 'unknown').length
  const checks = children.flatMap((entry) => entry.checks)
  if (ready >= required) return { status: 'ready', checks }
  if (possible < required) return { status: 'blocked', checks }
  return { status: 'unknown', checks }
}

function costExpression(cost) {
  if (cost.kind === 'resource') return { op: 'predicate', predicate: { kind: 'resource', resource: cost.resource, quantity: cost.quantity, label: cost.label } }
  if (cost.kind === 'use-item') return { op: 'predicate', predicate: { kind: 'use-item', useItemId: cost.useItemId, quantity: cost.quantity, label: cost.label } }
  if (cost.kind === 'equipment') {
    return {
      op: 'predicate',
      predicate: { kind: 'equipment', selector: cost.selector, quantity: cost.quantity, state: cost.state, placement: cost.placement, label: cost.label },
    }
  }
  if (cost.kind === 'ship') {
    return { op: 'predicate', predicate: { kind: 'fleet', groups: [{ selector: cost.selector, min: cost.quantity }], distinct: true, label: cost.label } }
  }
  return { op: 'predicate', confidence: 'unresolved', predicate: { kind: cost.kind, label: cost.label } }
}

function evaluateQuestRequirements(requirements, rootState, catalogs = {}) {
  if (!requirements || typeof requirements !== 'object') return result('unknown', { kind: 'requirements', reason: 'requirements-missing' })
  const context = { rootState, catalogs, indexes: catalogIndexes(catalogs) }
  const evaluations = [evaluateExpression(requirements.conditions || { op: 'all', children: [] }, context)]
  ;(requirements.objectives || []).forEach((objective) => {
    if (objective.constraints) evaluations.push(evaluateExpression(objective.constraints, context))
    const mapIds = objective.target?.mapIds || []
    if (mapIds.length) evaluations.push(evaluatePredicate({ kind: 'map', mapIds, match: objective.target?.mapMatch, label: objective.label }, context))
  })
  ;(requirements.costs || []).forEach((cost) => {
    const expression = costExpression(cost)
    expression.confidence = cost.confidence
    evaluations.push(evaluateExpression(expression, context))
  })
  if ((requirements.unresolved || []).length) {
    evaluations.push(result('unknown', { kind: 'unresolved', label: '资料未确认', reason: 'unresolved-requirement' }))
  }
  return combineAll(evaluations)
}

module.exports = {
  EXPRESSION_OPERATORS,
  RESULT_STATUSES,
  assignDistinct,
  catalogIndexes,
  evaluateExpression,
  evaluateQuestRequirements,
  selectorMatchesShip,
}
