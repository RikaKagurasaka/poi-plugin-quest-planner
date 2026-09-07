'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('module')

const {
  booleanQueryMatches,
  buildIndexes,
  completionIsCurrent,
  evaluateFeasibility,
  findConcurrentQuestRecommendations,
  findConcurrentQuestRecommendationsByProgress,
  graphForQuestIds,
  goalRows,
  inferQuestStatuses,
  mergeQuestListPage,
} = require('./logic')
const { evaluateExpression, evaluateQuestRequirements } = require('./domain')
const { buildRequirementSections, evaluateFleetComposition, prerequisiteProgress } = require('./requirements-view')
const { applyOverrides, buildCatalogs, coverage, ignoreLimitedPrerequisites, validateData } = require('./scripts/schema-v4')
const questData = require('./data/quests.json')
const { parseRewards } = require('./scripts/build-data')

assert.deepStrictEqual(parseRewards('奖励:开发资材×2高速修复材×1').items, [
  { name: '开发资材', count: 2, kind: 'item', choiceGroup: null },
  { name: '高速修复材', count: 1, kind: 'item', choiceGroup: null },
])
const choiceReward = parseRewards('奖励:以下奖励二选一：「F6F-3」×1 「F4U-1D」×1')
assert.deepStrictEqual(choiceReward.choices, [
  { id: 1, choose: 1, optionCount: 2, text: '「F6F-3」×1 「F4U-1D」×1', options: ['F6F-3', 'F4U-1D'] },
])
assert.ok(choiceReward.items.every((item) => item.choiceGroup === 1))
assert.deepStrictEqual(parseRewards('奖励:「白雪」').items, [
  { name: '白雪', count: 1, kind: 'other', choiceGroup: null },
])
assert.deepStrictEqual(parseRewards('奖励:「12.7cm连装炮C型改二」★max').items, [
  { name: '12.7cm连装炮C型改二', count: 1, kind: 'equipment', choiceGroup: null, improvement: 10 },
])
assert.deepStrictEqual(parseRewards('奖励:装备保有位+8').items, [
  { name: '装备保有位', count: 8, kind: 'other', choiceGroup: null },
])
assert.strictEqual(questData.schemaVersion, 4)
assert.strictEqual(questData.catalogVersion, 2)
assert.strictEqual(questData.quests.length, 644)
assert.deepStrictEqual(validateData(questData), [])
assert.ok(questData.quests.every((quest) => quest.requirements.conditions && quest.requirements.objectives && quest.requirements.costs && quest.rewards.entries))
assert.ok(questData.quests.every((quest) => quest.rewards.unresolved.length === 0))
assert.ok(questData.quests.every((quest) => quest.rewards.entries.every((entry) => entry.kind !== 'other')))
assert.strictEqual(questData.quests.find((quest) => quest.id === 102).rewards.entries.find((entry) => entry.useItemId === 2).quantity, 1)
assert.strictEqual(questData.quests.find((quest) => quest.id === 226).rewards.entries.find((entry) => entry.resource === 'fuel').quantity, 300)
assert.strictEqual(questData.quests.find((quest) => quest.id === 997).tracking.poiGoal['battle_boss_win_rank_s@1-3'].required, 2)
const structuredFactoryQuest = questData.quests.find((quest) => quest.id === 620)
assert.strictEqual(structuredFactoryQuest.requirements.costs.find((cost) => cost.resource === 'ammo').quantity, 2800)
assert.strictEqual(structuredFactoryQuest.requirements.costs.find((cost) => cost.resource === 'bauxite').quantity, 9000)
assert.ok(structuredFactoryQuest.requirements.costs.some((cost) => cost.selector?.masterIds?.includes(52) && cost.operation === 'discard'))
assert.strictEqual(questData.quests.find((quest) => quest.id === 119).requirements.unresolved.length, 0)
assert.deepStrictEqual(questData.quests.find((quest) => quest.id === 119).requirements.conditions.predicate.groups.at(-1).selector.speed, { min: 10 })
assert.strictEqual(questData.quests.find((quest) => quest.id === 214).requirements.objectives.length, 4)
assert.strictEqual(questData.quests.find((quest) => quest.id === 214).requirements.unresolved.length, 0)
assert.strictEqual(questData.quests.find((quest) => quest.id === 317).requirements.completion.logic, 'sequence')
assert.strictEqual(questData.quests.find((quest) => quest.id === 317).requirements.completion.stages.length, 2)
assert.strictEqual(questData.quests.find((quest) => quest.id === 318).requirements.completion.logic, 'sequence')
;[672, 693, 694, 695].forEach((id) => assert.strictEqual(questData.quests.find((quest) => quest.id === id).requirements.unresolved.length, 0))
const typedFactoryQuest = questData.quests.find((quest) => quest.id === 1151)
assert.strictEqual(typedFactoryQuest.tracking.poiGoal['destory_item@水侦类-1'].required, 14)
assert.deepStrictEqual(typedFactoryQuest.tracking.poiGoal['destory_item@水侦类-1'].slotitemType2, [10])
assert.strictEqual(coverage(questData).invalidEntityReferences, 0)
assert.strictEqual(coverage(questData).missingPrerequisites, 0)
assert.ok(coverage(questData).ignoredLimitedPrerequisites > 0)
assert.strictEqual(coverage(questData).rewardChoiceConflicts, 0)
assert.strictEqual(coverage(questData).unresolvedRewards, 0)
assert.ok(questData.quests.every((quest) => (quest.dependencies.ignored || []).every((ignored) =>
  !quest.dependencies.questIds.includes(ignored.questId))))
assert.ok(questData.quests.every((quest) => quest.requirements.unresolved.every((entry) => entry.raw && entry.reason)))
assert.ok(questData.quests.every((quest) => quest.rewards.choices.every((choice) =>
  choice.valid || quest.rewards.unresolved.some((entry) => entry.choiceId === choice.id))))
const usShipGroup = questData.catalogs.shipGroups.find((group) => group.id === 'country.us')
assert.ok(usShipGroup.memberMasterIds.length > 0)
assert.ok(!usShipGroup.memberMasterIds.includes(957))
assert.ok(!usShipGroup.memberMasterIds.includes(1007))
assert.strictEqual(questData.quests.find((quest) => quest.id === 919).requirements.unresolved.length, 0)
assert.deepStrictEqual(
  questData.quests.find((quest) => quest.id === 919).requirements.conditions.predicate.groups[0].selector.groupIds,
  ['country.us'],
)
assert.deepStrictEqual(
  questData.quests.find((quest) => quest.id === 1032).requirements.conditions.predicate.groups.map((group) => group.selector.level),
  [{ min: 88 }, { min: 88 }, { min: 88 }],
)
assert.deepStrictEqual(
  questData.quests.find((quest) => quest.id === 1048).requirements.costs.map((cost) => [cost.resource, cost.quantity]),
  [['ammo', 2200], ['bauxite', 1800]],
)
assert.strictEqual(questData.quests.find((quest) => quest.id === 933).requirements.unresolved.length, 1)

const firstQuest = questData.quests[0]
const invalidReferenceData = {
  ...questData,
  quests: [{
    ...firstQuest,
    requirements: {
      ...firstQuest.requirements,
      costs: [{
        id: 'invalid-reference', kind: 'equipment', selector: { masterIds: [999999] }, quantity: 1,
        operation: 'own', timing: 'operation', confidence: 'exact', sourceRefs: [{ source: 'kcQuests', field: 'test' }],
      }],
    },
  }, ...questData.quests.slice(1)],
}
assert.ok(validateData(invalidReferenceData).some((error) => error.includes('invalid cost equipment 999999')))
const invalidOperatorData = {
  ...questData,
  quests: [{
    ...firstQuest,
    requirements: { ...firstQuest.requirements, conditions: { ...firstQuest.requirements.conditions, op: 'xor' } },
  }, ...questData.quests.slice(1)],
}
assert.ok(validateData(invalidOperatorData).some((error) => error.includes('invalid condition operator')))
const invalidShipGroupData = {
  ...questData,
  quests: [{
    ...firstQuest,
    requirements: {
      ...firstQuest.requirements,
      conditions: {
        op: 'predicate',
        predicate: { kind: 'fleet', positions: [], groups: [{ selector: { groupIds: ['country.missing'] }, min: 1 }], forbidden: [], size: {}, distinct: true },
        confidence: 'exact', sourceRefs: [{ source: 'kcQuests', field: 'test' }],
      },
    },
  }, ...questData.quests.slice(1)],
}
assert.ok(validateData(invalidShipGroupData).some((error) => error.includes('invalid ship group country.missing')))
const invalidObjectiveData = {
  ...questData,
  quests: [{
    ...firstQuest,
    requirements: {
      ...firstQuest.requirements,
      completion: { ...firstQuest.requirements.completion, objectiveIds: ['missing-objective'] },
    },
  }, ...questData.quests.slice(1)],
}
assert.ok(validateData(invalidObjectiveData).some((error) => error.includes('invalid objective reference')))
const cycleShip = { ...questData.catalogs.ships[0], predecessorId: questData.catalogs.ships[0].masterId }
const remodelCycleData = {
  ...questData,
  catalogs: { ...questData.catalogs, ships: [cycleShip, ...questData.catalogs.ships.slice(1)] },
}
assert.ok(validateData(remodelCycleData).some((error) => error.includes('remodel chain contains a cycle')))
assert.deepStrictEqual(applyOverrides([{ id: 1, nested: { value: 1, list: [1, 2] } }], {
  quests: [{ id: 1, nested: { value: 2, list: [3] } }],
}), [{ id: 1, nested: { value: 2, list: [3] } }])
assert.deepStrictEqual(ignoreLimitedPrerequisites([
  { id: 1, code: '2409B1', name: '限时', sources: ['kcQuests'], prerequisites: [], unresolvedPrerequisites: [], dependencies: { questIds: [], unresolved: [] } },
  { id: 2, code: 'B1', name: '常设', sources: ['kcQuests'], prerequisites: [1], unresolvedPrerequisites: ['2508B1'], dependencies: {
    questIds: [1],
    unresolved: [{ kind: 'dependency', code: '2508B1', raw: '2508B1', reason: 'prerequisite-code-not-in-local-catalog', confidence: 'unresolved', sourceRefs: [{ source: 'kcQuests', field: 'prerequisites[0]' }] }],
  } },
])[1].dependencies.ignored.map((entry) => entry.code), ['2409B1', '2508B1'])
const patchedObjective = applyOverrides([{
  id: 1,
  requirements: {
    conditions: { op: 'all', children: [], confidence: 'exact', sourceRefs: [{ source: 'test', field: 'condition' }] },
    objectives: [{ id: 'objective-1', constraints: { op: 'all', children: [] } }],
  },
}], {
  quests: [{ id: 1, requirements: { objectiveOverrides: { 'objective-1': { constraints: '$conditions' } } } }],
})[0]
assert.strictEqual(patchedObjective.requirements.objectives[0].constraints, patchedObjective.requirements.conditions)
assert.strictEqual(patchedObjective.requirements.objectiveOverrides, undefined)
const patchedRewards = applyOverrides([{
  id: 2,
  rewards: {
    entries: [{ id: 'removed', quantity: 1 }, { id: 'existing', quantity: 1 }],
    choices: [{ id: 'choice-1', valid: false, entryIds: [] }],
    unresolved: [{ reason: 'old' }],
  },
}], {
  quests: [{
    id: 2,
    rewardOverrides: {
      removeEntryIds: ['removed'],
      entryOverrides: { existing: { quantity: 2 } },
      additionalEntries: [{ id: 'added', quantity: 1 }],
      choiceOverrides: { 'choice-1': { valid: true, entryIds: ['existing', 'added'] } },
      additionalChoices: [{ id: 'choice-2', valid: true, entryIds: ['added'] }],
      unresolved: [],
    },
  }],
})[0]
assert.deepStrictEqual(patchedRewards.rewards.entries.map((entry) => [entry.id, entry.quantity]), [['existing', 2], ['added', 1]])
assert.deepStrictEqual(patchedRewards.rewards.choices[0].entryIds, ['existing', 'added'])
assert.deepStrictEqual(patchedRewards.rewards.choices[1].entryIds, ['added'])
assert.deepStrictEqual(patchedRewards.rewards.unresolved, [])
assert.strictEqual(patchedRewards.rewardOverrides, undefined)

const quests = [
  { id: 1, code: 'A1', name: '一', repeat: 'single', prerequisites: [], unresolvedPrerequisites: [] },
  { id: 2, code: 'A2', name: '二', repeat: 'single', prerequisites: [1], unresolvedPrerequisites: [] },
  { id: 3, code: 'B1', name: '三', repeat: 'single', prerequisites: [2], unresolvedPrerequisites: [] },
]
const indexes = buildIndexes(quests)
assert.deepStrictEqual(indexes.children.get(1), [2])
assert.deepStrictEqual(graphForQuestIds([1, 3], indexes), { nodeIds: [1, 3], edges: [] })

const plannerState = {
  observed: { 3: { apiState: 1 } },
  completed: {},
  manualCompleted: {},
  todo: {},
  snapshot: { complete: true, questIds: [3] },
}
let inference = inferQuestStatuses(quests, plannerState)
assert.deepStrictEqual(Array.from(inference.completedIds).sort(), [1, 2])
assert.strictEqual(inference.statuses.get(1).status, 'inferred-completed')
assert.strictEqual(inference.statuses.get(2).status, 'inferred-completed')
assert.strictEqual(inference.statuses.get(3).status, 'available')

inference = inferQuestStatuses(quests, {
  observed: {}, completed: {}, manualCompleted: {}, todo: {},
  snapshot: { complete: true, questIds: [] },
})
assert.deepStrictEqual(Array.from(inference.completedIds).sort(), [1, 2, 3])
assert.ok(Array.from(inference.statuses.values()).every((entry) => entry.status === 'inferred-completed'))

const completeEmptySnapshot = inferQuestStatuses(questData.quests, {
  observed: {}, completed: {}, manualCompleted: {}, todo: {},
  snapshot: { complete: true, questIds: [] },
})
assert.strictEqual(
  Array.from(completeEmptySnapshot.statuses.values()).filter((entry) => entry.status === 'unknown').length,
  0,
)
assert.ok(
  Array.from(completeEmptySnapshot.statuses.values()).some((entry) => entry.status === 'inferred-completed'),
)

inference = inferQuestStatuses(quests, {
  observed: { 1: { apiState: 1 } }, completed: {}, manualCompleted: {}, todo: {},
  snapshot: { complete: true, questIds: [1] },
})
assert.strictEqual(inference.statuses.get(1).status, 'available')
assert.strictEqual(inference.statuses.get(2).status, 'locked')
assert.strictEqual(inference.statuses.get(3).status, 'locked')

const incompleteQuest = { id: 4, code: 'B2', name: '四', repeat: 'single', prerequisites: [], unresolvedPrerequisites: ['A0'] }
inference = inferQuestStatuses([...quests, incompleteQuest], {
  observed: {}, completed: {}, manualCompleted: {}, todo: {},
  snapshot: { complete: true, questIds: [] },
})
assert.strictEqual(inference.statuses.get(4).status, 'incomplete-data')

inference = inferQuestStatuses(quests, {
  observed: {}, completed: {}, manualCompleted: { 3: { at: Date.now(), source: 'manual' } }, todo: {}, snapshot: null,
})
assert.deepStrictEqual(Array.from(inference.completedIds).sort(), [1, 2, 3])
assert.strictEqual(inference.statuses.get(1).status, 'inferred-completed')
assert.strictEqual(inference.statuses.get(3).status, 'completed')

inference = inferQuestStatuses(quests, {
  observed: { 2: { apiState: 1 } }, completed: {}, manualCompleted: {}, todo: {}, snapshot: null,
})
assert.strictEqual(inference.statuses.get(2).status, 'unknown')

const periodicQuests = [
  { id: 10, code: 'P', repeat: 'daily', prerequisites: [], unresolvedPrerequisites: [] },
  { id: 11, code: 'A', repeat: 'daily', prerequisites: [10], unresolvedPrerequisites: [] },
  { id: 12, code: 'B', repeat: 'weekly', prerequisites: [11], unresolvedPrerequisites: [] },
]
const periodicNow = Date.parse('2026-09-06T10:00:00Z')
inference = inferQuestStatuses(periodicQuests, {
  observed: { 10: { apiState: 1 }, 12: { apiState: 1 } }, completed: {}, manualCompleted: {}, todo: {},
  snapshot: { complete: true, completedAt: periodicNow, questIds: [10, 12] },
}, new Set(), periodicNow)
assert.strictEqual(inference.statuses.get(11).status, 'locked')
assert.strictEqual(inference.statuses.get(12).status, 'available')

inference = inferQuestStatuses(periodicQuests, {
  observed: { 10: { apiState: 1 } }, completed: {}, manualCompleted: {}, todo: {},
  snapshot: { complete: true, completedAt: periodicNow, questIds: [10] },
}, new Set(), periodicNow)
assert.strictEqual(inference.statuses.get(12).status, 'unknown')

const weeklyReset = Date.parse('2026-09-07T00:00:00Z')
inference = inferQuestStatuses(periodicQuests, {
  observed: { 10: { apiState: 1 } }, completed: {}, manualCompleted: {}, todo: {},
  snapshot: { complete: true, completedAt: weeklyReset, questIds: [10] },
}, new Set(), weeklyReset)
assert.strictEqual(inference.statuses.get(12).status, 'locked')

const afterDailyReset = Date.parse('2026-09-08T00:00:00Z')
inference = inferQuestStatuses(periodicQuests, {
  observed: { 10: { apiState: 1 } }, completed: {}, manualCompleted: {}, todo: {},
  snapshot: { complete: true, completedAt: afterDailyReset, questIds: [10] },
}, new Set(), afterDailyReset)
assert.strictEqual(inference.statuses.get(12).status, 'unknown')

inference = inferQuestStatuses(periodicQuests, {
  observed: { 10: { apiState: 1 } },
  completed: { 11: { at: Date.parse('2026-09-07T02:00:00Z'), source: 'game' } },
  manualCompleted: {}, todo: {},
  snapshot: { complete: true, completedAt: afterDailyReset, questIds: [10] },
}, new Set(), afterDailyReset)
assert.strictEqual(inference.statuses.get(12).status, 'inferred-completed')

inference = inferQuestStatuses(periodicQuests, {
  observed: {
    10: { apiState: 1 },
    12: { apiState: 1, seenAt: Date.parse('2026-09-05T10:00:00Z') },
  },
  completed: {}, manualCompleted: {}, todo: {}, snapshot: { complete: true, completedAt: periodicNow, questIds: [10] },
}, new Set(), periodicNow)
assert.strictEqual(inference.statuses.get(12).status, 'inferred-completed')

inference = inferQuestStatuses(periodicQuests, {
  observed: {
    10: { apiState: 1 },
    12: { apiState: 1, seenAt: periodicNow },
  },
  completed: {}, manualCompleted: {}, todo: {},
  snapshot: { complete: true, completedAt: periodicNow - 1000, questIds: [10] },
}, new Set(), periodicNow)
assert.strictEqual(inference.statuses.get(12).status, 'available')

const longParentQuests = [
  { id: 20, code: 'W', repeat: 'weekly', prerequisites: [], unresolvedPrerequisites: [] },
  { id: 21, code: 'D', repeat: 'daily', prerequisites: [20], unresolvedPrerequisites: [] },
]
inference = inferQuestStatuses(longParentQuests, {
  observed: { 20: { apiState: 1 } }, completed: {}, manualCompleted: {}, todo: {},
  snapshot: { complete: true, completedAt: periodicNow, questIds: [20] },
}, new Set(), periodicNow)
assert.strictEqual(inference.statuses.get(21).status, 'locked')

let pageResult = mergeQuestListPage(null, {
  postBody: { api_tab_id: '0', api_page_no: '1' },
  body: { api_count: 2, api_page_count: 2, api_disp_page: 1, api_list: [{ api_no: 1 }] },
  time: 1000,
})
assert.strictEqual(pageResult.snapshot, null)
pageResult = mergeQuestListPage(pageResult.scan, {
  postBody: { api_tab_id: '0', api_page_no: '2' },
  body: { api_count: 2, api_page_count: 2, api_disp_page: 2, api_list: [{ api_no: 2 }] },
  time: 1100,
})
assert.deepStrictEqual(pageResult.snapshot.questIds, [1, 2])
assert.strictEqual(completionIsCurrent({ at: Date.parse('2026-09-06T01:00:00Z') }, 'daily', Date.parse('2026-09-06T10:00:00Z')), true)
assert.strictEqual(completionIsCurrent({ at: Date.parse('2026-09-05T01:00:00Z') }, 'daily', Date.parse('2026-09-06T10:00:00Z')), false)

const rootState = {
  info: {
    ships: { 10: { api_ship_id: 100 } },
    equips: { 20: { api_slotitem_id: 200 } },
    maps: { 21: { api_cleared: 1 } },
  },
  const: {
    $ships: { 100: { api_name: '霞改二', api_stype: 2, api_ctype: 18 } },
    $equips: { 200: { api_type: [0, 0, 1] } },
  },
}
assert.strictEqual(evaluateFeasibility({ battle: { flagship: ['霞改二'], required: 1 } }, rootState).status, 'ready')
assert.strictEqual(evaluateFeasibility({ battle: { flagship: ['大潮改二'], required: 1 } }, rootState).status, 'blocked')
assert.strictEqual(goalRows({ battle: { description: '胜利', required: 2 } }, { battle: { count: 1, required: 2 } })[0].count, 1)

const domainCatalogs = {
  ships: [
    { masterId: 100, familyId: 10, remodelStage: 0 },
    { masterId: 101, familyId: 10, remodelStage: 1 },
    { masterId: 102, familyId: 10, remodelStage: 2 },
    { masterId: 200, familyId: 20, remodelStage: 0 },
    { masterId: 201, familyId: 21, remodelStage: 0 },
    { masterId: 300, familyId: 30, remodelStage: 0 },
  ],
  shipGroups: [{ id: 'country.test', memberMasterIds: [100, 102] }],
  equipment: [{ masterId: 400 }, { masterId: 401 }],
}
const domainState = {
  info: {
    ships: {
      1: { api_id: 1, api_ship_id: 100, api_slot: [500, -1] },
      2: { api_id: 2, api_ship_id: 102, api_slot: [501, -1] },
      3: { api_id: 3, api_ship_id: 200, api_slot: [-1] },
      4: { api_id: 4, api_ship_id: 201, api_slot: [-1] },
      5: { api_id: 5, api_ship_id: 300, api_slot: [-1] },
    },
    equips: {
      500: { api_id: 500, api_slotitem_id: 400, api_level: 5, api_alv: 7, api_locked: 1 },
      501: { api_id: 501, api_slotitem_id: 400, api_level: 10, api_alv: 6, api_locked: 0 },
      502: { api_id: 502, api_slotitem_id: 401, api_level: 0, api_alv: 0, api_locked: 0 },
      503: { api_id: 503, api_slotitem_id: 401, api_level: 0, api_alv: 0, api_locked: 0 },
    },
    fleets: [{ api_id: 1, api_ship: [1, 2, 3, 4, 5, -1] }],
    airbase: [{ api_area_id: 6, api_rid: 1, api_plane_info: [{ api_squadron_id: 1, api_slotid: 503 }] }],
    resources: [1000, 2000, 3000, 4000, 5, 6, 7, 8],
    basic: { api_fcoin: 3 },
    useitems: { 44: { api_id: 44, api_count: 3 } },
    maps: { 11: { api_id: 11, api_cleared: 1 } },
  },
  const: {
    $ships: {
      100: { api_id: 100, api_stype: 2, api_ctype: 1 },
      102: { api_id: 102, api_stype: 2, api_ctype: 1 },
      200: { api_id: 200, api_stype: 3, api_ctype: 2 },
      201: { api_id: 201, api_stype: 3, api_ctype: 2 },
      300: { api_id: 300, api_stype: 7, api_ctype: 3 },
    },
    $equips: { 400: { api_id: 400, api_type: [0, 0, 6] }, 401: { api_id: 401, api_type: [0, 0, 12] } },
  },
}
const condition = (predicate) => ({ op: 'predicate', predicate, confidence: 'exact' })
const all = (...children) => ({ op: 'all', children, confidence: 'exact' })
const requirements = (conditions, costs = []) => ({ conditions, objectives: [], completion: { logic: 'all', objectiveIds: [] }, costs, unresolved: [] })

const groupedRequirementQuest = {
  category: 'sortie',
  requirements: {
    conditions: condition({
      kind: 'fleet',
      positions: [{ role: 'flagship', selector: { masterIds: [102] } }],
      groups: [{ selector: { typeIds: [3] }, min: 2 }],
      forbidden: [], size: { max: 6 }, distinct: true,
    }),
    objectives: [{ id: 'objective-1', event: 'battle_boss_win_rank_s', label: '1-1', count: { required: 2 }, target: { mapIds: [11] } }],
    completion: { logic: 'all', objectiveIds: ['objective-1'] },
    costs: [{
      id: 'cost-1', kind: 'equipment', selector: { masterIds: [400] }, quantity: 1, operation: 'equip', timing: 'operation',
      state: { improvement: { exact: 5 }, proficiency: { min: 7 }, locked: true },
      placement: { role: 'secretary', slotIndex: 0, mustBeCurrentlyEquipped: true, shipSelector: { masterIds: [100] } },
      confidence: 'exact',
    }],
    unresolved: [],
  },
}
const groupedRequirementSections = buildRequirementSections({
  quest: groupedRequirementQuest,
  rootState: domainState,
  catalogs: domainCatalogs,
  goal: { 'battle_boss_win_rank_s@1-1': { description: '1-1', required: 2, maparea: [11] } },
  record: { 'battle_boss_win_rank_s@1-1': { count: 1, required: 2 } },
  questStatus: 'active',
})
assert.deepStrictEqual(groupedRequirementSections.map((section) => section.label), ['前提 A', '前提 B', '前提 C', '完成进度'])
assert.ok(groupedRequirementSections.find((section) => section.id === 'a').rows.every((row) => row.text.startsWith('拥有 ')))
assert.ok(groupedRequirementSections.find((section) => section.id === 'b').rows.some((row) => row.text.includes('形态')))
assert.ok(groupedRequirementSections.find((section) => section.id === 'b').rows.some((row) => row.text.includes('改修 ★+5')))
assert.ok(groupedRequirementSections.find((section) => section.id === 'c').rows.some((row) => row.text.startsWith('编成 ')))
assert.ok(groupedRequirementSections.find((section) => section.id === 'c').rows.some((row) => row.text.includes('秘书舰') && row.text.includes('第 1 格')))
assert.deepStrictEqual(groupedRequirementSections.find((section) => section.id === 'progress').rows[0], {
  key: 'progress-objective-1', text: '1-1 Boss S 胜', status: 'blocked', actual: 1, required: 2,
})
assert.ok(!groupedRequirementSections.flatMap((section) => section.rows).some((row) => row.text.startsWith('解锁 ')))
const openFleetSections = buildRequirementSections({
  quest: {
    category: 'composition',
    requirements: requirements(condition({ kind: 'fleet', positions: [], groups: [], forbidden: [], size: { min: 1, max: 99 }, distinct: true })),
  },
  rootState: domainState,
  catalogs: domainCatalogs,
})
assert.strictEqual(openFleetSections.find((section) => section.id === 'c').rows[0].text, '编成 舰队 至少 1 艘')
assert.deepStrictEqual(prerequisiteProgress({
  quest: { requirements: requirements(condition({ kind: 'use-item', useItemId: 44, quantity: 2 })) },
  rootState: domainState,
  catalogs: domainCatalogs,
}), { hasPrerequisites: true, fulfilledGroups: 3 })
assert.deepStrictEqual(prerequisiteProgress({
  quest: { requirements: requirements(condition({
    kind: 'equipment', selector: { masterIds: [400] }, quantity: 1,
    state: { improvement: { min: 5 } }, operation: 'own',
  })) },
  rootState: domainState,
  catalogs: domainCatalogs,
}), { hasPrerequisites: true, fulfilledGroups: 3 })
assert.deepStrictEqual(prerequisiteProgress({
  quest: { requirements: requirements(condition({
    kind: 'equipment', selector: { masterIds: [400] }, quantity: 1,
    state: { improvement: { exact: 7 } }, operation: 'own',
  })) },
  rootState: domainState,
  catalogs: domainCatalogs,
}), { hasPrerequisites: true, fulfilledGroups: 1 })
assert.deepStrictEqual(prerequisiteProgress({
  quest: { requirements: requirements(condition({
    kind: 'equipment', selector: { masterIds: [400] }, quantity: 1,
    state: { improvement: { min: 5 } }, operation: 'equip',
    placement: { role: 'secretary', slotIndex: 0, mustBeCurrentlyEquipped: true, shipSelector: { masterIds: [200] } },
  })) },
  rootState: domainState,
  catalogs: domainCatalogs,
}), { hasPrerequisites: true, fulfilledGroups: 2 })
assert.deepStrictEqual(prerequisiteProgress({
  quest: { requirements: requirements(condition({
    kind: 'equipment', selector: { masterIds: [400] }, quantity: 1,
    state: { locked: true }, operation: 'equip',
    placement: { role: 'secretary', slotIndex: 0, mustBeCurrentlyEquipped: true, shipSelector: { masterIds: [100] } },
  })) },
  rootState: domainState,
  catalogs: domainCatalogs,
}), { hasPrerequisites: true, fulfilledGroups: 3 })
assert.deepStrictEqual(prerequisiteProgress({
  quest: { requirements: requirements({ op: 'all', children: [], confidence: 'exact' }) },
  rootState: domainState,
  catalogs: domainCatalogs,
}), { hasPrerequisites: false, fulfilledGroups: 0 })
const mapOnlyQuest = {
  requirements: {
    ...requirements({ op: 'all', children: [], confidence: 'exact' }),
    objectives: [{ id: 'map-objective', event: 'battle_boss_win_rank_s', count: { required: 1 }, target: { mapIds: [11] } }],
    completion: { logic: 'all', objectiveIds: ['map-objective'] },
  },
}
assert.deepStrictEqual(prerequisiteProgress({ quest: mapOnlyQuest, rootState: domainState, catalogs: domainCatalogs }), { hasPrerequisites: true, fulfilledGroups: 3 })
assert.deepStrictEqual(prerequisiteProgress({
  quest: mapOnlyQuest,
  rootState: { ...domainState, info: { ...domainState.info, maps: {} } },
  catalogs: domainCatalogs,
}), { hasPrerequisites: true, fulfilledGroups: 0 })
const lockedMapSections = buildRequirementSections({
  quest: groupedRequirementQuest,
  rootState: { ...domainState, info: { ...domainState.info, maps: {} } },
  catalogs: domainCatalogs, goal: null, record: null, questStatus: 'active',
})
assert.ok(lockedMapSections.find((section) => section.id === 'a').rows.some((row) => row.text === '解锁 1-1'))
assert.strictEqual(evaluateFleetComposition({
  kind: 'fleet', positions: [{ role: 'flagship', selector: { masterIds: [100] } }],
  groups: [{ selector: { typeIds: [3] }, min: 2 }], forbidden: [], size: { max: 6 }, distinct: true,
}, 'exact', domainState, domainCatalogs).status, 'ready')
assert.strictEqual(evaluateFleetComposition({
  kind: 'fleet', positions: [{ role: 'flagship', selector: { masterIds: [102] } }],
  groups: [{ selector: { typeIds: [3] }, min: 2 }], forbidden: [], size: { max: 6 }, distinct: true,
}, 'exact', domainState, domainCatalogs).status, 'blocked')
const compositionSections = buildRequirementSections({
  quest: { ...groupedRequirementQuest, category: 'composition' }, rootState: domainState, catalogs: domainCatalogs,
  goal: { formation: { description: '编成', required: 1 } }, record: {}, questStatus: 'active',
})
assert.ok(!compositionSections.some((section) => section.id === 'progress'))

const alternativeFleetSections = buildRequirementSections({
  quest: {
    category: 'sortie',
    requirements: {
      conditions: {
        op: 'any', confidence: 'exact', children: [
          condition({ kind: 'fleet', groups: [{ selector: { masterIds: [999] }, min: 1 }], distinct: true }),
          condition({
            kind: 'fleet', positions: [{ role: 'flagship', selector: { masterIds: [100] } }],
            groups: [{ selector: { typeIds: [3] }, min: 2 }], distinct: true,
          }),
        ],
      },
      objectives: [], completion: { logic: 'all', objectiveIds: [] }, costs: [], unresolved: [],
    },
  },
  rootState: domainState, catalogs: domainCatalogs, goal: null, record: null, questStatus: 'active',
})
assert.deepStrictEqual(alternativeFleetSections.map((section) => section.label), ['前提 A', '前提 C'])
assert.ok(alternativeFleetSections[0].rows[0].text.startsWith('任选一套：拥有 '))
assert.strictEqual(alternativeFleetSections[0].rows[0].status, 'ready')
assert.ok(alternativeFleetSections[1].rows[0].text.includes('任选一套：编成 '))
assert.strictEqual(alternativeFleetSections[1].rows[0].status, 'ready')

// Exact ship/remodel, accepted remodels, minimum and pre-remodel selectors.
assert.strictEqual(evaluateQuestRequirements(requirements(condition({
  kind: 'fleet', groups: [{ selector: { masterIds: [102], remodel: { exactMasterIds: [102] } }, min: 1 }], distinct: true,
})), domainState, domainCatalogs).status, 'ready')
assert.strictEqual(evaluateQuestRequirements(requirements(condition({
  kind: 'fleet', groups: [{ selector: { remodel: { allowedMasterIds: [101, 102] } }, min: 1 }], distinct: true,
})), domainState, domainCatalogs).status, 'ready')
assert.strictEqual(evaluateQuestRequirements(requirements(all(
  condition({ kind: 'fleet', groups: [{ selector: { familyIds: [10], remodel: { minimumStage: 2 } }, min: 1 }], distinct: true }),
  condition({ kind: 'fleet', groups: [{ selector: { familyIds: [10], remodel: { beforeStage: 1 } }, min: 1 }], distinct: true }),
)), domainState, domainCatalogs).status, 'ready')

// Type counts, flagship, alternatives and forbidden types.
assert.strictEqual(evaluateQuestRequirements(requirements(condition({
  kind: 'fleet', positions: [{ role: 'flagship', selector: { masterIds: [100] } }],
  groups: [{ selector: { typeIds: [3], classIds: [2] }, min: 2 }], size: { max: 6 }, distinct: true,
})), domainState, domainCatalogs).status, 'ready')
assert.strictEqual(evaluateQuestRequirements(requirements(condition({
  kind: 'fleet', groups: [{ selector: { groupIds: ['country.test'] }, min: 1 }], distinct: true,
})), domainState, domainCatalogs).status, 'ready')
assert.strictEqual(evaluateQuestRequirements(requirements(condition({
  kind: 'fleet', groups: [{ selector: { groupIds: ['country.test'] }, min: 2, distinctBy: 'family' }], distinct: true,
})), domainState, domainCatalogs).status, 'blocked')
const newerMasterThanCatalogState = {
  info: { ships: { 1: { api_id: 1, api_ship_id: 999 } } },
  const: { $ships: { 999: { api_id: 999, api_stype: 2, api_ctype: 99 } } },
}
assert.strictEqual(evaluateQuestRequirements(requirements(condition({
  kind: 'fleet', groups: [{ selector: { groupIds: ['country.test'] }, min: 1 }], distinct: true,
})), newerMasterThanCatalogState, domainCatalogs).status, 'unknown')
assert.strictEqual(evaluateQuestRequirements(requirements({
  op: 'any', confidence: 'exact', children: [
    condition({ kind: 'fleet', groups: [{ selector: { masterIds: [999] }, min: 1 }], distinct: true }),
    condition({ kind: 'fleet', groups: [{ selector: { masterIds: [102] }, min: 1 }], distinct: true }),
  ],
}), domainState, domainCatalogs).status, 'ready')
assert.strictEqual(evaluateQuestRequirements(requirements(condition({
  kind: 'fleet', groups: [{ selector: { typeIds: [7] }, min: 1 }], forbidden: [{ typeIds: [7] }], distinct: true,
})), domainState, domainCatalogs).status, 'blocked')
assert.strictEqual(evaluateQuestRequirements(requirements(condition({
  kind: 'fleet', groups: [{ selector: { typeIds: [3] }, min: 2, max: 1 }], size: { max: 6 }, distinct: true,
})), domainState, domainCatalogs).status, 'blocked')
assert.strictEqual(evaluateQuestRequirements(requirements({
  ...condition({ kind: 'resource', resource: 'fuel', quantity: 9999 }), confidence: 'parsed',
}), domainState, domainCatalogs).status, 'blocked')

const cyclicCatalogs = {
  ships: [
    { masterId: 1, familyId: 1, remodelStage: 0, successorIds: [2] },
    { masterId: 2, familyId: 1, remodelStage: 1, successorIds: [3] },
    { masterId: 3, familyId: 1, remodelStage: 2, successorIds: [4] },
    { masterId: 4, familyId: 1, remodelStage: 3, successorIds: [5] },
    { masterId: 5, familyId: 1, remodelStage: 4, successorIds: [3] },
  ],
}
const cyclicState = (masterId) => ({
  info: { ships: { 1: { api_id: 1, api_ship_id: masterId } } },
  const: { $ships: { [masterId]: { api_id: masterId, api_stype: 2, api_ctype: 1 } } },
})
const shapeRequirement = (masterId) => requirements(condition({
  kind: 'fleet', groups: [{ selector: { masterIds: [masterId] }, min: 1 }], distinct: true,
}))
assert.strictEqual(evaluateQuestRequirements(shapeRequirement(2), cyclicState(5), cyclicCatalogs).status, 'ready')
assert.strictEqual(evaluateQuestRequirements(shapeRequirement(3), cyclicState(4), cyclicCatalogs).status, 'blocked')
assert.strictEqual(evaluateQuestRequirements(shapeRequirement(3), cyclicState(3), cyclicCatalogs).status, 'ready')

// Equipment quantity, improvement, proficiency, lock and secretary first slot.
assert.strictEqual(evaluateQuestRequirements(requirements(condition({
  kind: 'equipment', selector: { masterIds: [400] }, quantity: 2, operation: 'own',
})), domainState, domainCatalogs).status, 'ready')
assert.strictEqual(evaluateQuestRequirements(requirements(condition({
  kind: 'equipment', selector: { masterIds: [400] }, quantity: 1,
  state: { improvement: { exact: 5 }, proficiency: { min: 7 }, locked: true },
})), domainState, domainCatalogs).status, 'ready')
assert.strictEqual(evaluateQuestRequirements(requirements(condition({
  kind: 'equipment', selector: { masterIds: [400] }, quantity: 1,
  placement: { role: 'secretary', slotIndex: 0, mustBeCurrentlyEquipped: true, shipSelector: { masterIds: [100] } },
})), domainState, domainCatalogs).status, 'ready')
assert.strictEqual(evaluateQuestRequirements(requirements(condition({
  kind: 'equipment', selector: { masterIds: [401] }, quantity: 2,
  placement: { location: 'not-airbase' },
})), domainState, domainCatalogs).status, 'blocked')
assert.strictEqual(evaluateQuestRequirements(requirements(condition({
  kind: 'equipment', selector: { masterIds: [401] }, quantity: 1,
  placement: { location: 'not-airbase' },
})), { ...domainState, info: { ...domainState.info, airbase: undefined } }, domainCatalogs).status, 'unknown')

// Multiple discards plus resources and use-item costs.
assert.strictEqual(evaluateQuestRequirements(requirements(all(), [
  { kind: 'equipment', selector: { masterIds: [401] }, quantity: 2, operation: 'discard', timing: 'quest-completion', confidence: 'exact' },
  { kind: 'resource', resource: 'fuel', quantity: 500, operation: 'consume', timing: 'quest-completion', confidence: 'exact' },
  { kind: 'use-item', useItemId: 44, quantity: 2, operation: 'consume', timing: 'quest-completion', confidence: 'exact' },
]), domainState, domainCatalogs).status, 'ready')
assert.strictEqual(evaluateQuestRequirements(requirements(condition({
  kind: 'use-item', useItemId: 3, quantity: 7,
})), domainState, domainCatalogs).status, 'ready')
assert.strictEqual(evaluateQuestRequirements(requirements(condition({
  kind: 'use-item', useItemId: 3, quantity: 8,
})), domainState, domainCatalogs).status, 'blocked')
assert.strictEqual(evaluateQuestRequirements(requirements(condition({
  kind: 'use-item', useItemId: 4, quantity: 8,
})), domainState, domainCatalogs).status, 'ready')
assert.strictEqual(evaluateQuestRequirements(requirements(condition({
  kind: 'use-item', useItemId: 44, quantity: 4,
})), domainState, domainCatalogs).status, 'blocked')

// Boolean atLeast/not and one physical ship cannot satisfy two independent demands.
assert.strictEqual(evaluateExpression({ op: 'atLeast', count: 1, children: [
  condition({ kind: 'resource', resource: 'fuel', quantity: 9999 }),
  { op: 'not', child: condition({ kind: 'resource', resource: 'fuel', quantity: 9999 }), confidence: 'exact' },
], confidence: 'exact' }, { rootState: domainState, indexes: { ships: new Map(), equipment: new Map() } }).status, 'ready')
const oneShipState = {
  info: { ships: { 1: domainState.info.ships[1] } }, const: { $ships: { 100: domainState.const.$ships[100] } },
}
assert.strictEqual(evaluateQuestRequirements(requirements(condition({
  kind: 'fleet', groups: [{ selector: { familyIds: [10] }, min: 2 }], distinct: true,
})), oneShipState, domainCatalogs).status, 'blocked')
const duplicateFamilyState = {
  info: {
    ships: {
      1: { ...domainState.info.ships[1], api_id: 1, api_lv: 50 },
      2: { ...domainState.info.ships[1], api_id: 2, api_lv: 50 },
    },
  },
  const: { $ships: domainState.const.$ships },
}
assert.strictEqual(evaluateQuestRequirements(requirements(condition({
  kind: 'fleet', groups: [{ selector: { familyIds: [10] }, min: 2, distinctBy: 'family' }], distinct: true,
})), duplicateFamilyState, domainCatalogs).status, 'blocked')
const overlappingGroupState = {
  ...domainState,
  info: {
    ...domainState.info,
    ships: {
      ...domainState.info.ships,
      6: { api_id: 6, api_ship_id: 101, api_slot: [-1] },
    },
  },
  const: {
    ...domainState.const,
    $ships: {
      ...domainState.const.$ships,
      101: { api_id: 101, api_stype: 2, api_ctype: 1 },
    },
  },
}
assert.strictEqual(evaluateQuestRequirements(requirements(condition({
  kind: 'fleet',
  groups: [
    { selector: { masterIds: [100] }, min: 1 },
    { selector: { typeIds: [2] }, min: 2, max: 2 },
  ],
  distinct: true,
})), overlappingGroupState, domainCatalogs).status, 'ready')
const onlyDestroyersState = {
  info: {
    ships: {
      1: domainState.info.ships[1],
      2: domainState.info.ships[2],
    },
  },
  const: { $ships: domainState.const.$ships },
}
assert.strictEqual(evaluateQuestRequirements(requirements(condition({
  kind: 'fleet', groups: [{ selector: { typeIds: [2] }, min: 1, max: 1 }], size: { min: 2 }, distinct: true,
})), onlyDestroyersState, domainCatalogs).status, 'blocked')
assert.strictEqual(evaluateQuestRequirements(requirements(condition({
  kind: 'fleet', groups: [{ selector: { masterIds: [100], level: { min: 60 } }, min: 1 }], distinct: true,
})), duplicateFamilyState, domainCatalogs).status, 'blocked')

// Reward choices reference entry IDs and retain equipment improvement.
const improvedRewardQuest = questData.quests.find((quest) => quest.id === 334)
assert.ok(improvedRewardQuest.rewards.choices.every((choice) => choice.entryIds.every((id) => improvedRewardQuest.rewards.entries.some((entry) => entry.id === id))))
assert.strictEqual(improvedRewardQuest.rewards.entries.find((entry) => entry.equipmentId === 17).improvement, 2)
const kcwikiChoiceQuest = questData.quests.find((quest) => quest.id === 158)
assert.deepStrictEqual(kcwikiChoiceQuest.rewards.choices[0].entryIds, ['reward-kcwiki-1', 'reward-kcwiki-2', 'reward-kcwiki-3'])
assert.ok(kcwikiChoiceQuest.rewards.choices[0].valid)
assert.ok(kcwikiChoiceQuest.sources.includes('kcwiki quest data'))
const destroyerTrainingQuest = questData.quests.find((quest) => quest.code === 'C18')
assert.strictEqual(destroyerTrainingQuest.rewards.entries.find((entry) => entry.useItemId === 1).quantity, 3)
assert.ok(!destroyerTrainingQuest.rewards.entries.some((entry) => entry.useItemId === 2))
const firstDevelopmentQuest = questData.quests.find((quest) => quest.code === 'F2')
assert.deepStrictEqual(firstDevelopmentQuest.rewards.entries.filter((entry) => entry.useItemId === 3).map((entry) => entry.quantity), [2])
const firstTorpedoSquadronQuest = questData.quests.find((quest) => quest.code === 'A55')
assert.strictEqual(firstTorpedoSquadronQuest.rewards.entries.find((entry) => entry.label === '家具箱（大）').useItemId, 12)
assert.ok(!firstTorpedoSquadronQuest.rewards.entries.some((entry) => entry.useItemId === 11))
const summerPracticeQuest = questData.quests.find((quest) => quest.id === 326)
assert.strictEqual(summerPracticeQuest.code, 'Cs7')
assert.deepStrictEqual(summerPracticeQuest.rewards.choices.map((choice) => choice.entryIds.length), [2, 3])
assert.ok(summerPracticeQuest.rewards.entries.some((entry) => entry.useItemId === 54 && entry.quantity === 1))
assert.ok(summerPracticeQuest.rewards.entries.some((entry) => entry.useItemId === 3 && entry.quantity === 8))
assert.ok(summerPracticeQuest.rewards.entries.some((entry) => entry.equipmentId === 42 && entry.quantity === 1))
assert.ok(summerPracticeQuest.rewards.entries.some((entry) => entry.equipmentId === 68 && entry.quantity === 1))
const seventeenthDestroyerPracticeQuest = questData.quests.find((quest) => quest.code === 'C27')
assert.ok(seventeenthDestroyerPracticeQuest.rewards.entries.some((entry) => entry.useItemId === 54 && entry.quantity === 1))
const commandFacilityQuest = questData.quests.find((quest) => quest.code === 'B159')
assert.ok(commandFacilityQuest.rewards.entries.some((entry) => entry.useItemId === 63 && entry.quantity === 1))
;['F96', 'F108'].forEach((code) => {
  assert.ok(questData.quests.find((quest) => quest.code === code).rewards.entries.some((entry) => entry.useItemId === 92))
})
;['B105', 'B126'].forEach((code) => {
  assert.deepStrictEqual(questData.quests.find((quest) => quest.code === code).rewards.choices.map((choice) => choice.entryIds.length), [2, 3])
})
questData.quests.forEach((quest) => {
  const choiceCounts = [...quest.rewardText.matchAll(/以下奖励([二三四])选一/g)].map((match) => ({ 二: 2, 三: 3, 四: 4 })[match[1]])
  if (choiceCounts.length === quest.rewards.choices.length) {
    assert.deepStrictEqual(quest.rewards.choices.map((choice) => choice.entryIds.length), choiceCounts, `${quest.code} reward choice order`)
  }
})
const amatsukazeQuest = questData.quests.find((quest) => quest.code === 'B193')
assert.strictEqual(amatsukazeQuest.rewards.entries.find((entry) => entry.equipmentId === 266).improvement, 10)
assert.strictEqual(questData.quests.find((quest) => quest.code === 'B216').rewards.entries.find((entry) => entry.kind === 'capacity').quantity, 4)
assert.strictEqual(questData.quests.find((quest) => quest.code === 'F135').rewards.entries.find((entry) => entry.kind === 'capacity').quantity, 8)
assert.strictEqual(questData.quests.find((quest) => quest.code === 'F141').rewards.entries.find((entry) => entry.kind === 'equipment').equipmentId, 548)
;[898, 929, 931, 940].forEach((id) => {
  assert.ok(questData.quests.find((quest) => quest.id === id).rewards.entries.some((entry) => entry.kind === 'furniture'))
})
const currentThirtyFirstSquadronQuest = questData.quests.find((quest) => quest.id === 382)
assert.deepStrictEqual(currentThirtyFirstSquadronQuest.requirements.conditions.predicate.groups[0].selector.familyIds, [1041, 1044, 642, 994, 992, 993, 16, 35])
assert.strictEqual(currentThirtyFirstSquadronQuest.requirements.unresolved.length, 0)
assert.deepStrictEqual(currentThirtyFirstSquadronQuest.prerequisites, [216])
assert.deepStrictEqual(currentThirtyFirstSquadronQuest.unresolvedPrerequisites, [])
assert.deepStrictEqual(currentThirtyFirstSquadronQuest.dependencies.ignored.map((entry) => entry.code), ['2606Am1'])
assert.strictEqual(currentThirtyFirstSquadronQuest.rewards.entries.find((entry) => entry.quantity === 2900).kind, 'resource')
assert.strictEqual(currentThirtyFirstSquadronQuest.rewards.entries.find((entry) => entry.quantity === 2900).resource, 'fuel')
const currentFrenchFleetQuest = questData.quests.find((quest) => quest.id === 383)
assert.deepStrictEqual(currentFrenchFleetQuest.requirements.conditions.predicate.groups[0].selector.familyIds, [491, 492, 935, 962, 965, 1051, 1053, 1055])
assert.strictEqual(currentFrenchFleetQuest.requirements.unresolved.length, 0)
assert.strictEqual(currentFrenchFleetQuest.rewards.entries.find((entry) => entry.quantity === 970).kind, 'resource')
assert.strictEqual(currentFrenchFleetQuest.rewards.entries.find((entry) => entry.quantity === 970).resource, 'fuel')
const carrierPracticeQuest = questData.quests.find((quest) => quest.id === 343)
assert.deepStrictEqual(carrierPracticeQuest.rewards.choices[0].entryIds, ['reward-wiki-1', 'reward-wiki-2'])
assert.strictEqual(carrierPracticeQuest.rewards.entries.find((entry) => entry.kind === 'furniture').id, 'reward-wiki-fixed-1')
const yahagiPracticeQuest = questData.quests.find((quest) => quest.id === 352)
assert.deepStrictEqual(yahagiPracticeQuest.rewards.choices[0].entryIds, ['reward-wiki-1', 'reward-wiki-2', 'reward-wiki-3'])
assert.strictEqual(yahagiPracticeQuest.rewards.entries.find((entry) => entry.equipmentId === 407).id, 'reward-wiki-fixed-1')
const kuroshioPracticeQuest = questData.quests.find((quest) => quest.code === 'Cy7')
assert.deepStrictEqual(kuroshioPracticeQuest.requirements.conditions.predicate.positions.map((entry) => entry.role), ['flagship', 'second'])
assert.deepStrictEqual(kuroshioPracticeQuest.requirements.conditions.predicate.positions[0].selector.masterIds, [568, 670])
const nineteenthDestroyerPracticeQuest = questData.quests.find((quest) => quest.code === 'Cy8')
assert.deepStrictEqual(nineteenthDestroyerPracticeQuest.requirements.conditions.predicate.groups.map((group) => group.selector.masterIds[0]), [666, 647, 195, 627])
assert.strictEqual(questData.quests.find((quest) => quest.code === 'B109').requirements.conditions.children.length, 1)
assert.strictEqual(questData.quests.find((quest) => quest.code === 'B95').requirements.conditions.children.length, 1)
const fy2Sections = buildRequirementSections({
  quest: questData.quests.find((quest) => quest.code === 'Fy2'), rootState: {}, catalogs: questData.catalogs,
  goal: null, record: null, questStatus: 'active',
})
assert.deepStrictEqual(fy2Sections.find((section) => section.id === 'a').rows.filter((row) => row.text.includes('Swordfish')).map((row) => row.text), [
  '拥有 剑鱼（Swordfish） ×2',
])
const expectedProgress = {
  D39: ['#30 潜水艦派遣作戦 成功', 2],
  Fm2: ['废弃 零式舰战52型', 2],
  F116: ['开发水上打击战使用的改良35.6cm炮', 1],
  F105: ['精锐“一式陆攻”队的编成', 1],
  F141: ['【工厂任务】震电的喷式推进化', 1],
  C17: ['演习胜利', 4],
}
Object.entries(expectedProgress).forEach(([code, [text, required]]) => {
  const quest = questData.quests.find((entry) => entry.code === code)
  const sections = buildRequirementSections({ quest, rootState: {}, catalogs: questData.catalogs, goal: quest.tracking.poiGoal, record: {}, questStatus: 'active' })
  assert.deepStrictEqual(sections.find((section) => section.id === 'progress').rows.map((row) => [row.text, row.required]), [[text, required]])
})
const expectedDiscardProgress = {
  F52: [['废弃 零式艦戦21型', 2], ['废弃 瑞雲', 2]],
  Fq3: [['废弃 大口径主砲', 10]],
  F59: [['废弃 対空機銃', 10]],
  Fq4: [['废弃 艦上戦闘機', 6], ['废弃 対空機銃', 4]],
  Fq7: [['废弃 10cm連装高角砲', 4], ['废弃 94式高射装置', 1]],
  F4: [['废弃 任意装备', 1]],
}
Object.entries(expectedDiscardProgress).forEach(([code, expected]) => {
  const quest = questData.quests.find((entry) => entry.code === code)
  const sections = buildRequirementSections({ quest, rootState: {}, catalogs: questData.catalogs, goal: quest.tracking.poiGoal, record: {}, questStatus: 'active' })
  assert.deepStrictEqual(sections.find((section) => section.id === 'progress').rows.map((row) => [row.text, row.required]), expected)
})
const f52Quest = questData.quests.find((quest) => quest.code === 'F52')
const f52Progress = buildRequirementSections({
  quest: f52Quest, rootState: {}, catalogs: questData.catalogs, goal: f52Quest.tracking.poiGoal,
  record: {
    'destory_item@零式舰战21型-1': { count: 1, required: 2 },
    'destory_item@瑞云-2': { count: 2, required: 2 },
  },
  questStatus: 'active',
}).find((section) => section.id === 'progress').rows
assert.deepStrictEqual(f52Progress.map((row) => [row.actual, row.required]), [[1, 2], [2, 2]])
questData.quests.forEach((quest) => {
  const discardCosts = quest.requirements.costs.filter((cost) => cost.kind === 'equipment' && cost.operation === 'discard')
  discardCosts.forEach((cost) => assert.strictEqual(cost.timing, 'operation', `${quest.code} ${cost.id} discard timing`))
  if (discardCosts.length) {
    assert.strictEqual(quest.requirements.objectives.filter((objective) => objective.event === 'destory_item').length, discardCosts.length, `${quest.code} discard progress count`)
  }
  quest.requirements.objectives.filter((objective) => objective.event === 'destory_item').forEach((objective) => {
    assert.ok(objective.label && objective.label.length <= 48, `${quest.code} ${objective.id} concise discard label`)
    assert.ok(!/<br|[。！※]|^(?:废弃|廃棄)(?:\s|$|[-:：])/.test(objective.label), `${quest.code} ${objective.id} normalized discard label`)
  })
  const sections = buildRequirementSections({
    quest, rootState: {}, catalogs: questData.catalogs, goal: quest.tracking.poiGoal, record: {}, questStatus: 'active',
  })
  sections.forEach((section) => {
    const signatures = section.rows.map((row) => `${row.text}\0${row.status}\0${row.actual ?? ''}\0${row.required ?? ''}`)
    assert.strictEqual(new Set(signatures).size, signatures.length, `${quest.code} ${section.id} duplicate display rows`)
  })
  const progressRows = sections.find((section) => section.id === 'progress')?.rows || []
  progressRows.forEach((row) => {
    assert.ok(row.text.length <= 50 && !/[<>]/.test(row.text), `${quest.code} concise progress text: ${row.text}`)
  })
})
const firstCarrierDivisionQuest = questData.quests.find((quest) => quest.id === 926)
assert.ok(firstCarrierDivisionQuest.rewards.choices.every((choice) => choice.valid && choice.entryIds.length === 3))
assert.strictEqual(firstCarrierDivisionQuest.rewards.entries.find((entry) => entry.equipmentId === 186).improvement, 2)
assert.strictEqual(firstCarrierDivisionQuest.rewards.entries.find((entry) => entry.equipmentId === 343).improvement, 2)
const yamatoFleetQuest = questData.quests.find((quest) => quest.id === 977)
assert.ok(yamatoFleetQuest.rewards.choices.every((choice) => choice.valid && choice.entryIds.length === 3))
assert.strictEqual(yamatoFleetQuest.rewards.entries.find((entry) => entry.equipmentId === 276).improvement, 8)
assert.strictEqual(structuredFactoryQuest.requirements.costs.find((cost) => cost.placement?.slotIndex === 0).state.proficiency.exact, 7)
const guidedBomberQuest = questData.quests.find((quest) => quest.code === 'F107')
assert.strictEqual(guidedBomberQuest.requirements.unresolved.length, 0)
assert.ok(guidedBomberQuest.requirements.costs.filter((cost) => cost.kind === 'equipment')
  .every((cost) => cost.placement.location === 'not-airbase'))
const kumaSortieQuest = questData.quests.find((quest) => quest.code === 'B163')
assert.strictEqual(kumaSortieQuest.requirements.unresolved.length, 0)
assert.deepStrictEqual(kumaSortieQuest.requirements.conditions.predicate.positions[0].selector.masterIds, [652, 657])
assert.strictEqual(kumaSortieQuest.requirements.objectives.find((objective) => objective.label === '1-6').event, 'sally')

// Missing or explicitly stale poi state is unknown, never blocked.
assert.strictEqual(evaluateQuestRequirements(requirements(condition({
  kind: 'equipment', selector: { masterIds: [400] }, quantity: 1,
})), { info: {}, const: {} }, domainCatalogs).status, 'unknown')
assert.strictEqual(evaluateQuestRequirements(requirements(condition({
  kind: 'use-item', useItemId: 44, quantity: 1,
})), { ...domainState, info: { ...domainState.info, dataFreshness: { useitems: 'stale', basic: 'stale' } } }, domainCatalogs).status, 'unknown')

// api_start2 is authoritative for IDs/current Japanese names; alias databases only enrich it.
const masterCatalogs = buildCatalogs({
  wctfDb: path.join(os.tmpdir(), 'quest-planner-missing-wctf'),
  equipment: { entries: [{ id: 400, name: 'Test plane', localizedName: '测试飞机' }] },
  masterData: {
    api_mst_ship: [
      { api_id: 100, api_sortno: 1, api_name: '試験艦', api_yomi: 'しけんかん', api_stype: 2, api_ctype: 10, api_aftershipid: '101' },
      { api_id: 101, api_sortno: 2, api_name: '試験艦改', api_yomi: 'しけんかんかい', api_stype: 2, api_ctype: 10, api_aftershipid: '0' },
      { api_id: 900, api_sortno: 0, api_name: '敵艦', api_stype: 2, api_ctype: 10, api_aftershipid: '0' },
    ],
    api_mst_stype: [{ api_id: 2, api_name: '駆逐艦' }],
    api_mst_slotitem: [{ api_id: 400, api_name: '試験装備', api_type: [0, 0, 8] }],
    api_mst_slotitem_equiptype: [{ api_id: 8, api_name: '艦上攻撃機' }],
    api_mst_useitem: [{ api_id: 44, api_name: '試験道具' }],
    api_mst_mapinfo: [{ api_id: 11, api_maparea_id: 1, api_no: 1, api_name: '鎮守府正面海域' }],
    api_mst_mission: [{ api_id: 100, api_disp_no: 'A1', api_name: '兵站強化任務' }],
  },
})
assert.deepStrictEqual(masterCatalogs.ships.map((ship) => ship.masterId), [100, 101])
assert.strictEqual(masterCatalogs.ships[1].predecessorId, 100)
assert.strictEqual(masterCatalogs.ships[1].remodelStage, 1)
assert.ok(masterCatalogs.ships[0].aliases.includes('試験艦'))
assert.deepStrictEqual(masterCatalogs.equipment[0], {
  masterId: 400, type2Id: 8,
  names: { ja_jp: '試験装備' }, aliases: ['試験装備', 'Test plane', '测试飞机'],
})
assert.deepStrictEqual(masterCatalogs.useItems.map((item) => item.id), [44])
assert.ok(masterCatalogs.missions[0].aliases.includes('A1'))

const cyclicMasterCatalogs = buildCatalogs({
  wctfDb: path.join(os.tmpdir(), 'quest-planner-missing-wctf'),
  masterData: {
    api_mst_ship: [
      { api_id: 1, api_sortno: 1, api_name: '甲', api_stype: 2, api_ctype: 10, api_aftershipid: '2' },
      { api_id: 2, api_sortno: 2, api_name: '乙', api_stype: 2, api_ctype: 10, api_aftershipid: '1' },
    ],
    api_mst_stype: [{ api_id: 2, api_name: '駆逐艦' }], api_mst_slotitem: [],
  },
})
assert.ok(cyclicMasterCatalogs.ships.every((ship) => ship.remodelStageKnown === false && ship.predecessorId === null))

const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'quest-planner-test-'))
const handlers = new Map()
const originalLoad = Module._load
let state = { info: { basic: { api_member_id: 7 }, quests: { activeQuests: {}, questGoals: {}, records: {} } } }
const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  memo: (component) => component,
  useCallback: (callback) => callback,
  useEffect() {},
  useMemo: (factory) => factory(),
  useRef: () => ({ current: null }),
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
}
Module._load = function mockLoad(request, parent, isMain) {
  if (request === 'react') return React
  if (request === '@blueprintjs/core') return {
    Button: 'button', HTMLSelect: 'select', Icon: 'icon', InputGroup: 'input', Menu: 'menu', MenuItem: 'menuitem', Popover: 'popover', Tag: 'span',
  }
  if (request === 'cytoscape') {
    const mock = () => ({ on() {}, fit() {}, destroy() {} })
    mock.use = () => {}
    return mock
  }
  if (request === 'cytoscape-dagre') return () => {}
  if (request === 'views/create-store') {
    return { store: { getState: () => state, subscribe: () => () => {} } }
  }
  return originalLoad.call(this, request, parent, isMain)
}
global.APPDATA_PATH = appData
global.window = {
  addEventListener(type, handler) { handlers.set(type, handler) },
  removeEventListener(type, handler) { if (handlers.get(type) === handler) handlers.delete(type) },
}
const plugin = require('./index')
const sanitizedUi = plugin.__test.sanitizeUiConfig({
  query: 'F52',
  advancedSearch: true,
  advancedQueries: { name: '战队', detail: '', requirements: '旗舰 AND (驱逐舰 OR 海防舰)', rewards: '开发资材' },
  statusFilters: ['active', 'invalid'],
  categoryFilters: [],
  repeatFilters: ['weekly'],
  prerequisiteFilter: '2',
  temporaryCompletedRepeats: ['daily', 'quarterly', 'yearly'],
  todoOnly: true,
  detailedStatuses: true,
  direction: 'TB',
})
assert.deepStrictEqual(sanitizedUi, {
  query: 'F52',
  advancedSearch: true,
  advancedQueries: { name: '战队', detail: '', requirements: '旗舰 AND (驱逐舰 OR 海防舰)', rewards: '开发资材' },
  statusFilters: ['active'],
  categoryFilters: [],
  repeatFilters: ['weekly'],
  prerequisiteFilter: '2',
  temporaryCompletedRepeats: ['daily', 'quarterly'],
  todoOnly: true,
  detailedStatuses: true,
  direction: 'TB',
})
assert.strictEqual(plugin.__test.sanitizeUiConfig({ direction: 'diagonal' }).direction, 'LR')
assert.strictEqual(plugin.__test.coarseStatus('claimable'), 'unlocked')
assert.strictEqual(plugin.__test.coarseStatus('active'), 'unlocked')
assert.strictEqual(plugin.__test.coarseStatus('inferred-completed'), 'completed')
assert.strictEqual(plugin.__test.coarseStatus('incomplete-data'), 'unknown')
assert.strictEqual(plugin.__test.questMatchesSearch(questData.quests[0], '白雪'), true)
assert.strictEqual(booleanQueryMatches('旗舰 AND (驱逐舰 OR 海防舰)', '第一舰队 旗舰 驱逐舰3'), true)
assert.strictEqual(booleanQueryMatches('旗舰 AND NOT 战舰', '第一舰队 旗舰 驱逐舰3'), true)
assert.strictEqual(booleanQueryMatches('旗舰 AND NOT 驱逐舰', '第一舰队 旗舰 驱逐舰3'), false)
assert.strictEqual(plugin.__test.questMatchesSearch(questData.quests.find((quest) => quest.code === 'A1'), {
  name: '编成', detail: '阵容', requirements: '艦隊', rewards: '白雪',
}), true)
assert.strictEqual(plugin.__test.questMatchesSearch(questData.quests.find((quest) => quest.code === 'A1'), { rewards: '不存在的奖励' }), false)
assert.strictEqual(plugin.__test.rewardEntryLabel({ kind: 'ranking-point', label: '战果330' }), '战果')
assert.strictEqual(plugin.__test.rewardQuantityText({ kind: 'ranking-point', quantity: 330 }), '+330')
assert.deepStrictEqual(plugin.__test.exclusiveOrAll(['daily'], ['daily'], ['daily', 'weekly']), ['daily', 'weekly'])
assert.deepStrictEqual(plugin.__test.exclusiveOrAll(['daily', 'weekly'], ['daily'], ['daily', 'weekly']), ['daily'])
assert.strictEqual(plugin.__test.prerequisiteFilterMatches('all', { hasPrerequisites: false, fulfilledGroups: 0 }), true)
assert.strictEqual(plugin.__test.prerequisiteFilterMatches('none', { hasPrerequisites: false, fulfilledGroups: 0 }), true)
assert.strictEqual(plugin.__test.prerequisiteFilterMatches('3', { hasPrerequisites: false, fulfilledGroups: 0 }), false)
assert.strictEqual(plugin.__test.prerequisiteFilterMatches('3', { hasPrerequisites: false, fulfilledGroups: 3 }), false)
assert.strictEqual(plugin.__test.prerequisiteFilterMatches('0', { hasPrerequisites: true, fulfilledGroups: 0 }), true)
assert.strictEqual(plugin.__test.prerequisiteFilterMatches('1', { hasPrerequisites: true, fulfilledGroups: 3 }), true)
assert.strictEqual(plugin.__test.prerequisiteFilterMatches('2', { hasPrerequisites: true, fulfilledGroups: 3 }), true)
assert.strictEqual(plugin.__test.prerequisiteFilterMatches('3', { hasPrerequisites: true, fulfilledGroups: 2 }), false)
assert.strictEqual(plugin.__test.questPhase('claimable'), 'completed')
assert.strictEqual(plugin.__test.questPhase('active'), 'unlocked')
assert.strictEqual(plugin.__test.graphNodeLabel('A1', 'locked'), '⊘ A1')
assert.strictEqual(plugin.__test.graphNodeLabel('A1', 'available'), '▶ A1')
assert.strictEqual(plugin.__test.graphNodeLabel('A1', 'completed'), '✓ A1')
const recommendationFleet = (predicate) => ({ op: 'predicate', predicate, confidence: 'verified' })
const recommendationObjective = ({ event = 'sally', mapIds = [], missionIds = [], constraints } = {}) => ({
  id: 'recommendation-objective', event, count: { required: 1, initial: 0 },
  target: { mapIds, mapNodes: [], missionIds, enemyShipTypeIds: [], executionCounts: [] },
  ...(constraints ? { constraints } : {}),
})
const recommendationQuests = [
  {
    id: 1, code: 'S1', name: '同海域出击', category: 'sortie', repeat: 'single',
    requirements: { conditions: recommendationFleet({ kind: 'fleet', positions: [{ role: 'flagship', selector: { masterIds: [1], typeIds: [2] } }], groups: [], forbidden: [], size: {}, distinct: true }), objectives: [recommendationObjective({ mapIds: [22] })] },
  },
  {
    id: 2, code: 'S2', name: '兼容出击', category: 'sortie', repeat: 'single',
    requirements: { conditions: recommendationFleet({ kind: 'fleet', positions: [{ role: 'flagship', selector: { masterIds: [1], typeIds: [2] } }], groups: [{ selector: { typeIds: [2] }, min: 2, max: 2 }], forbidden: [], size: {}, distinct: true }), objectives: [recommendationObjective({ mapIds: [22] })] },
  },
  {
    id: 3, code: 'S3', name: '旗舰冲突', category: 'sortie', repeat: 'single',
    requirements: { conditions: recommendationFleet({ kind: 'fleet', positions: [{ role: 'flagship', selector: { masterIds: [2] } }], groups: [], forbidden: [], size: {}, distinct: true }), objectives: [recommendationObjective({ mapIds: [22] })] },
  },
  {
    id: 4, code: 'Sd', name: '日常不推荐', category: 'sortie', repeat: 'daily',
    requirements: { conditions: recommendationFleet({ kind: 'fleet', positions: [{ role: 'flagship', selector: { masterIds: [1] } }], groups: [], forbidden: [], size: {}, distinct: true }), objectives: [recommendationObjective({ mapIds: [22] })] },
  },
  {
    id: 5, code: 'S5', name: '无海域', category: 'sortie', repeat: 'single',
    requirements: { conditions: recommendationFleet({ kind: 'fleet', positions: [{ role: 'flagship', selector: { masterIds: [1] } }], groups: [], forbidden: [], size: {}, distinct: true }), objectives: [recommendationObjective()] },
  },
  {
    id: 6, code: 'S6', name: '无编成限制', category: 'sortie', repeat: 'single',
    requirements: { conditions: { op: 'all', children: [] }, objectives: [recommendationObjective({ mapIds: [22] })] },
  },
  {
    id: 7, code: 'S7', name: '舰队容量冲突', category: 'sortie', repeat: 'single',
    requirements: { conditions: recommendationFleet({ kind: 'fleet', positions: [], groups: [{ selector: { typeIds: [3] }, min: 6 }], forbidden: [], size: {}, distinct: true }), objectives: [recommendationObjective({ mapIds: [22] })] },
  },
  {
    id: 15, code: 'S8', name: '僚舰数量冲突', category: 'sortie', repeat: 'single',
    requirements: { conditions: recommendationFleet({ kind: 'fleet', positions: [], groups: [{ selector: { typeIds: [2] }, min: 3, max: 3 }], forbidden: [], size: {}, distinct: true }), objectives: [recommendationObjective({ mapIds: [22] })] },
  },
  {
    id: 8, code: 'D1', name: '相同远征', category: 'expedition', repeat: 'single',
    requirements: { conditions: { op: 'all', children: [] }, objectives: [recommendationObjective({ event: 'mission_success', missionIds: ['30'] })] },
  },
  {
    id: 9, code: 'D2', name: '不同远征', category: 'expedition', repeat: 'single',
    requirements: { conditions: { op: 'all', children: [] }, objectives: [recommendationObjective({ event: 'mission_success', missionIds: ['31'] })] },
  },
  {
    id: 14, code: 'D3', name: '相同远征二', category: 'expedition', repeat: 'single',
    requirements: { conditions: { op: 'all', children: [] }, objectives: [recommendationObjective({ event: 'mission_success', missionIds: ['30'] })] },
  },
  {
    id: 10, code: 'F1', name: '工厂一', category: 'factory', repeat: 'single',
    requirements: { conditions: recommendationFleet({ kind: 'fleet', positions: [{ role: 'flagship', selector: { masterIds: [1] } }], groups: [], forbidden: [], size: {}, distinct: true }), objectives: [recommendationObjective({ event: 'destory_item', constraints: recommendationFleet({ kind: 'equipment', selector: { masterIds: [10] }, quantity: 1 }) })] },
  },
  {
    id: 11, code: 'F2', name: '工厂二', category: 'factory', repeat: 'single',
    requirements: { conditions: recommendationFleet({ kind: 'fleet', positions: [{ role: 'flagship', selector: { masterIds: [1] } }], groups: [], forbidden: [], size: {}, distinct: true }), objectives: [recommendationObjective({ event: 'destory_item', constraints: recommendationFleet({ kind: 'equipment', selector: { type2Ids: [3] }, quantity: 1 }) })] },
  },
  {
    id: 12, code: 'F3', name: '工厂秘书冲突', category: 'factory', repeat: 'single',
    requirements: { conditions: recommendationFleet({ kind: 'fleet', positions: [{ role: 'flagship', selector: { masterIds: [2] } }], groups: [], forbidden: [], size: {}, distinct: true }), objectives: [recommendationObjective({ event: 'destory_item', constraints: recommendationFleet({ kind: 'equipment', selector: { masterIds: [11] }, quantity: 1 }) })] },
  },
  {
    id: 13, code: 'Fw', name: '工厂任意装备', category: 'factory', repeat: 'single',
    requirements: { conditions: { op: 'all', children: [] }, objectives: [recommendationObjective({ event: 'destory_item' })] },
  },
]
const recommendationStatuses = new Map(recommendationQuests.map((quest) => [quest.id, { status: 'active' }]))
const recommendationCatalogs = { ships: [], shipGroups: [] }
recommendationStatuses.set(2, { status: 'locked' })
let sortieRecommendations = findConcurrentQuestRecommendations(recommendationQuests[0], recommendationQuests, recommendationStatuses, recommendationCatalogs)
assert.ok(sortieRecommendations.some((entry) => entry.code === 'S2'))
assert.ok(!sortieRecommendations.some((entry) => ['S3', 'Sd', 'S5', 'S6', 'S7'].includes(entry.code)))
assert.deepStrictEqual(findConcurrentQuestRecommendations(recommendationQuests.find((quest) => quest.code === 'Sd'), recommendationQuests, recommendationStatuses, recommendationCatalogs), [])
assert.ok(!findConcurrentQuestRecommendations(recommendationQuests.find((quest) => quest.code === 'S2'), recommendationQuests, recommendationStatuses, recommendationCatalogs).some((entry) => entry.code === 'S8'))
recommendationStatuses.set(2, { status: 'completed' })
sortieRecommendations = findConcurrentQuestRecommendations(recommendationQuests[0], recommendationQuests, recommendationStatuses, recommendationCatalogs)
assert.ok(!sortieRecommendations.some((entry) => entry.code === 'S2'))
assert.deepStrictEqual(findConcurrentQuestRecommendations(recommendationQuests.find((quest) => quest.code === 'D1'), recommendationQuests, recommendationStatuses, recommendationCatalogs).map((entry) => entry.code), ['D3'])
recommendationStatuses.set(2, { status: 'active' })
assert.deepStrictEqual(findConcurrentQuestRecommendations(recommendationQuests.find((quest) => quest.code === 'F1'), recommendationQuests, recommendationStatuses, recommendationCatalogs).map((entry) => entry.code), ['Fw'])
const exerciseFleet = (min = 2) => recommendationFleet({
  kind: 'fleet',
  positions: [{ role: 'flagship', selector: { masterIds: [1] } }],
  groups: [{ selector: { typeIds: [2] }, min }],
  forbidden: [], size: {}, distinct: true,
})
const exerciseQuests = [
  { id: 20, code: 'C1', name: '相同演习编成', category: 'exercise', repeat: 'single', requirements: { conditions: exerciseFleet(), objectives: [recommendationObjective({ event: 'practice_win' })] } },
  { id: 21, code: 'C2', name: '兼容演习编成', category: 'exercise', repeat: 'single', requirements: { conditions: exerciseFleet(), objectives: [recommendationObjective({ event: 'practice_win' })] } },
  { id: 22, code: 'C3', name: '演习容量冲突', category: 'exercise', repeat: 'single', requirements: { conditions: exerciseFleet(6), objectives: [recommendationObjective({ event: 'practice_win' })] } },
  { id: 23, code: 'C4', name: '无演习编成', category: 'exercise', repeat: 'single', requirements: { conditions: { op: 'all', children: [] }, objectives: [recommendationObjective({ event: 'practice_win' })] } },
]
const exerciseStatuses = new Map(exerciseQuests.map((quest) => [quest.id, { status: 'active' }]))
assert.deepStrictEqual(
  findConcurrentQuestRecommendations(exerciseQuests[0], exerciseQuests, exerciseStatuses, recommendationCatalogs).map((entry) => entry.code),
  ['C2'],
)
const factoryProgress = findConcurrentQuestRecommendationsByProgress(
  recommendationQuests.find((quest) => quest.code === 'F1'), recommendationQuests, recommendationStatuses, recommendationCatalogs,
)
assert.deepStrictEqual(factoryProgress['recommendation-objective'].map((entry) => entry.code), ['Fw'])
const expeditionRecommendationSections = buildRequirementSections({
  quest: questData.quests.find((quest) => quest.code === 'D5'), rootState: {}, catalogs: questData.catalogs,
  goal: null, record: {}, questStatus: 'active', recommendations: [{ id: 2, code: 'D2', name: '远征二', kind: 'expedition', missionIds: [30] }],
})
assert.ok(expeditionRecommendationSections.find((section) => section.id === 'progress').rows.some((row) => row.text === '可同时远征 #30：D2 远征二'))

const temporaryNow = Date.parse('2026-09-07T08:00:00Z')
const temporaryQuests = [
  { id: 1, repeat: 'daily', prerequisites: [], unresolvedPrerequisites: [] },
  { id: 2, repeat: 'single', prerequisites: [1], unresolvedPrerequisites: [] },
]
const temporaryBaseState = {
  observed: { 1: { apiState: 1, seenAt: temporaryNow } },
  completed: {}, manualCompleted: {}, todo: {},
  snapshot: { complete: true, completedAt: temporaryNow, questIds: [1] },
}
const temporaryState = plugin.__test.withTemporaryRepeatCompletions(temporaryQuests, temporaryBaseState, ['daily'], temporaryNow)
assert.deepStrictEqual(temporaryBaseState.manualCompleted, {})
assert.deepStrictEqual(temporaryState.manualCompleted[1], { at: temporaryNow, source: 'temporary-repeat' })
const temporaryInference = plugin.__test.inferWithTemporaryRepeatCompletions(
  temporaryQuests,
  temporaryBaseState,
  new Set(),
  ['daily'],
  temporaryNow,
)
assert.strictEqual(temporaryInference.statuses.get(1).status, 'completed')
assert.strictEqual(temporaryInference.statuses.get(2).status, 'inferred-completed')
plugin.pluginDidLoad()
handlers.get('game.response')({
  detail: {
    path: '/kcsapi/api_get_member/questlist',
    body: { api_list: [{ api_no: 101, api_state: 2, api_progress_flag: 1, api_title: '任务', api_detail: '条件' }] },
    time: 1000,
  },
})
let saved = JSON.parse(fs.readFileSync(path.join(appData, 'quest-planner', '7', 'state.json'), 'utf8'))
assert.strictEqual(saved.observed[101].apiState, 2)
handlers.get('game.response')({
  detail: { path: '/kcsapi/api_req_quest/clearitemget', postBody: { api_quest_id: '101' }, time: 2000 },
})
saved = JSON.parse(fs.readFileSync(path.join(appData, 'quest-planner', '7', 'state.json'), 'utf8'))
assert.strictEqual(saved.completed[101].source, 'game')
assert.doesNotThrow(() => plugin.reactClass())
plugin.pluginWillUnload()
Module._load = originalLoad

console.log('poi-plugin-quest-planner tests passed')
