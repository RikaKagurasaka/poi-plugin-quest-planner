'use strict'

const fs = require('fs')
const path = require('path')
const childProcess = require('child_process')
const crypto = require('crypto')
const { buildCatalogs, coverage: coverageV4, migrateData, validateData } = require('./schema-v4')

const META_GOAL_KEYS = new Set(['type', 'fuzzy', 'resetInterval'])
const CHOICE_COUNTS = { 二: 2, 三: 3, 四: 4 }
const CHINESE_NUMBERS = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
const RESOURCE_NAMES = {
  fuel: ['燃料'], ammo: ['弹药', '彈藥'], steel: ['钢材', '鋼材'], bauxite: ['铝土', '鋁土', '铝', '鋁', 'ボーキサイト'],
}
const KNOWN_REWARD_ITEMS = [
  '高速修复材', '高速建造材', '开发资材', '改修资材', '勋章', '甲种勋章', '间宫', '伊良湖',
  '家具箱（小）', '家具箱（中）', '家具箱（大）', '家具箱(小)', '家具箱(中)', '家具箱(大)',
  '特制家具职人', '特注家具职人', '熟练搭乘员', '熟练见张员', '战斗详报', '新型火炮兵装资材',
  '新型航空兵装资材', '新型炮熕兵装资材', '新型喷进装备开发资材', '新型噴進装備開発資材',
  '新型航空器设计图', '新型兵装资材', '司令部要员', '补强增设',
  '洋上补给', '战斗粮食', '礼物箱', '应急修理要员', '应急修理女神', '设营队', '海外舰最新技术',
  '装备运用枠', '装备保有位', '家具币', '战果', '燃料', '弹药', '钢材', '铝土',
]
const EQUIPMENT_TYPE_NAMES = [
  ['小口径主炮', [1]], ['中口径主炮', [2]], ['大口径主炮', [3]], ['副炮', [4]], ['鱼雷', [5]],
  ['舰上战斗机', [6]], ['舰战类', [6]], ['舰上爆击机', [7]], ['舰爆类', [7]], ['舰上攻击机', [8]],
  ['舰攻类', [8]], ['舰上侦察机', [9]], ['水上侦察机', [10]], ['水侦类', [10]], ['水上爆击机', [11]],
  ['电探', [12, 13]], ['声呐', [14]], ['爆雷', [15]], ['对空机铳', [21]],
]

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function readCson(file) {
  return require('cson-parser').parse(fs.readFileSync(file, 'utf8'))
}

function readQuestDirectory(directory) {
  if (!directory || !fs.existsSync(directory)) return []
  return fs.readdirSync(directory).filter((file) => /^\d+\.json$/.test(file)).sort((left, right) => Number(left.slice(0, -5)) - Number(right.slice(0, -5)))
    .map((file) => readJson(path.join(directory, file)))
}

function sha256(file) {
  return fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null
}

function clean(value) {
  return String(value || '')
    .replace(/\b(?:gray|grey|orange|red|green|blue)\|/gi, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function category(code) {
  const match = String(code || '').match(/[ABCDEFG]/)
  return { A: 'composition', B: 'sortie', C: 'exercise', D: 'expedition', E: 'supply', F: 'factory', G: 'modernization' }[match?.[0]] || 'other'
}

function rewardKind(name) {
  if (/开启|开放/.test(name)) return 'unlock'
  if (/燃料|弹药|钢材|铝土|家具币|战果/.test(name)) return 'resource'
  if (/资材|修复材|建造材|勋章|家具箱|职人|伊良湖|间宫|粮食|补强增设|洋上补给|礼物箱|设营队|要员|女神|技术|详报|搭乘员/.test(name)) return 'item'
  if (/炮|砲|雷|机|機|电探|電探|战|戦|艇|弹|弾|航空|甲板|发动机|搭乘员|探信仪|听音机|机铳|艦戦|艦攻|艦爆/.test(name)) return 'equipment'
  return 'other'
}

function normalizedName(value) {
  return clean(value).replace(/[「」『』【】“”\s]/g, '').replace(/（/g, '(').replace(/）/g, ')').toLocaleLowerCase()
}

function equipmentIndex(equipmentFile) {
  if (!equipmentFile || !fs.existsSync(equipmentFile)) return { entries: [], byName: new Map() }
  const entries = readJson(equipmentFile).map((entry) => ({
    id: Number(entry.id), name: clean(entry.name), localizedName: clean(entry.chinese_name),
    type: Array.isArray(entry.type) ? entry.type.map(Number) : [],
  }))
  const byName = new Map()
  entries.forEach((entry) => {
    ;[entry.name, entry.localizedName].filter(Boolean).forEach((name) => byName.set(normalizedName(name), entry))
  })
  return { entries, byName }
}

function matchEquipment(name, equipment) {
  const entry = equipment?.byName?.get(normalizedName(name))
  return entry ? { equipmentId: entry.id, equipmentType: entry.type } : {}
}

function choiceMarkers(text) {
  const markers = []
  const pattern = /以下奖励([二三四])选一[:：]?|从下列奖励中选择[:：]?/g
  let match
  while ((match = pattern.exec(text))) {
    markers.push({ start: match.index, end: pattern.lastIndex, choose: 1, optionCount: CHOICE_COUNTS[match[1]] || null })
  }
  return markers
}

function choiceGroupAt(index, markers) {
  const markerIndex = markers.findIndex((marker, position) =>
    marker.end <= index && (!markers[position + 1] || index < markers[position + 1].start),
  )
  return markerIndex >= 0 ? markerIndex + 1 : null
}

function improvementValue(value) {
  if (!value) return null
  return /^max$/i.test(value) ? 10 : Number(value) || null
}

function addRewardCandidate(candidates, candidate) {
  const rawName = clean(candidate.name).replace(/[「」『』【】“”]/g, '')
  const improvement = candidate.improvement ?? improvementValue(rawName.match(/★\+?(max|\d+)/i)?.[1])
  const name = rawName.replace(/★\+?(?:max|\d+)/ig, '')
  if (!name || /^(奖励|以下奖励|以上二者选择其一)$/.test(name)) return
  candidates.push({ ...candidate, name, improvement })
}

function parseRewards(value, equipment = { entries: [], byName: new Map() }) {
  const text = clean(value).replace(/^奖励[:：]?\s*/, '').replace(/^➣\s*/, '')
  const markers = choiceMarkers(text)
  const candidates = []
  const countedPattern = /(?:「([^」]+)」|『([^』]+)』|【([^】]+)】|“([^”]+)”|([^\s「」『』【】“”：:，,；;]+?))\s*(?:★\+?(max|\d+))?\s*[×xX]\s*(\d+)/gi
  let match
  while ((match = countedPattern.exec(text))) {
    addRewardCandidate(candidates, {
      name: match[1] || match[2] || match[3] || match[4] || match[5], improvement: improvementValue(match[6]),
      count: Number(match[7]),
      start: match.index, end: countedPattern.lastIndex, priority: 4,
    })
  }

  const quotedPattern = /[「『【“]([^」』】”]+)[」』】”](?:\s*★\+?(max|\d+))?/gi
  while ((match = quotedPattern.exec(text))) {
    addRewardCandidate(candidates, {
      name: match[1], improvement: improvementValue(match[2]), count: 1,
      start: match.index, end: quotedPattern.lastIndex, priority: 3,
    })
  }

  const namedEntities = [...KNOWN_REWARD_ITEMS, ...(equipment.entries || []).flatMap((entry) => [entry.localizedName, entry.name])]
    .filter(Boolean).sort((left, right) => right.length - left.length)
  namedEntities.forEach((name) => {
    let start = text.indexOf(name)
    while (start >= 0) {
      const suffix = text.slice(start + name.length).match(/^\s*(?:(?:★\+?(max|\d+)(?:\s*[×xX]\s*(\d+))?)|(?:[×xX]\s*(\d+))|(?:\+\s*(\d+)(?:\s*装[备備]分)?))/i)
      addRewardCandidate(candidates, {
        name, improvement: improvementValue(suffix?.[1]), count: Number(suffix?.[2] || suffix?.[3] || suffix?.[4]) || 1, start,
        end: start + name.length + (suffix?.[0].length || 0),
        priority: equipment.byName.has(normalizedName(name)) ? 2 : 1,
      })
      start = text.indexOf(name, start + name.length)
    }
  })

  const unlockPattern = /(?:「[^」]+」|『[^』]+』|[^\s，。；])+?(?:开启|开放)/g
  while ((match = unlockPattern.exec(text))) {
    addRewardCandidate(candidates, { name: match[0], count: 1, start: match.index, end: unlockPattern.lastIndex, priority: 3 })
  }

  const selected = []
  candidates
    .sort((left, right) => left.start - right.start || right.priority - left.priority || right.end - left.end)
    .forEach((candidate) => {
      if (!selected.some((item) => candidate.start < item.end && item.start < candidate.end)) selected.push(candidate)
    })
  const recognizedCount = selected.length
  if (selected.length === 0 && markers.length === 0 && text) {
    addRewardCandidate(selected, { name: text, count: 1, start: 0, end: text.length, priority: 0 })
  }

  const items = []
  selected.sort((left, right) => left.start - right.start).forEach((item) => {
    const equipmentMatch = matchEquipment(item.name, equipment)
    const parsed = {
      name: item.name, count: item.count, kind: equipmentMatch.equipmentId ? 'equipment' : rewardKind(item.name),
      choiceGroup: choiceGroupAt(item.start, markers),
      ...(item.improvement ? { improvement: item.improvement } : {}), ...equipmentMatch,
      _start: item.start, _end: item.end,
    }
    const previous = items[items.length - 1]
    const adjacentAlias = previous && previous.choiceGroup === parsed.choiceGroup && item.start === previous._end && /[「『【“]/.test(text[item.start])
    if (adjacentAlias) {
      previous.count = parsed.count
      if (parsed.improvement) previous.improvement = parsed.improvement
      if (!previous.equipmentId && parsed.equipmentId) {
        previous.equipmentId = parsed.equipmentId
        previous.equipmentType = parsed.equipmentType
      }
      previous._end = parsed._end
    } else {
      items.push(parsed)
    }
  })
  const trailingGroups = []
  const trailingChoicePattern = /以上二者选择其一/g
  while ((match = trailingChoicePattern.exec(text))) {
    const chosen = items.filter((item) => item._start < match.index).slice(-2)
    if (chosen.length !== 2) continue
    const group = markers.length + trailingGroups.length + 1
    chosen.forEach((item) => { item.choiceGroup = group })
    trailingGroups.push({ id: group, choose: 1, optionCount: 2, text: chosen.map((item) => `${item.name}×${item.count}`).join(' '), options: chosen.map((item) => item.name) })
  }
  const choices = markers.map((marker, index) => {
    const id = index + 1
    return {
      id, choose: marker.choose, optionCount: marker.optionCount,
      text: clean(text.slice(marker.end, markers[index + 1]?.start ?? text.length).replace(/以上二者选择其一/g, '')),
      options: items.filter((item) => item.choiceGroup === id).map((item) => item.name),
    }
  }).concat(trailingGroups)
  return {
    schemaVersion: 1, raw: text, confidence: text && recognizedCount ? 'partial' : 'unparsed',
    items: items.map(({ _start, _end, ...item }) => item), choices,
  }
}

function mapCode(mapId) {
  const value = Number(mapId)
  return `${Math.floor(value / 10)}-${value % 10}`
}

function normalizeGoal(goal) {
  if (!goal || typeof goal !== 'object') return []
  return Object.entries(goal)
    .filter(([key, value]) => !META_GOAL_KEYS.has(key) && value && typeof value === 'object' && !Array.isArray(value))
    .map(([key, condition]) => ({
      key, event: key.split('@')[0], description: clean(condition.description),
      required: Number(condition.required) || 1, initial: Number(condition.init) || 0,
      maps: (condition.maparea || []).map((id) => ({ id: Number(id), code: mapCode(id), nodes: (condition.mapcell || []).map(Number) })),
      missions: (condition.mission || []).map((name) => ({ name: clean(name) })),
      fleet: {
        flagshipShips: condition.flagship || [], flagshipTypes: condition.flagshiptype || [], flagshipClasses: condition.flagshipclass || [],
        secondShips: condition.secondship || [], secondShipClasses: condition.secondshipclass || [], memberShips: condition.escortship || [],
        memberTypes: condition.escortshiptype || [], memberClasses: condition.escortshipclass || [], forbiddenTypes: condition.banshiptype || [],
        maxShips: condition.fleetlimit || null,
      },
      equipment: { ids: condition.slotitemId || [], types: condition.slotitemType2 || [] },
      enemyShipTypes: condition.shipType || [],
      materialShips: { types: condition.materialShipType || [], minimumPerAttempt: Number(condition.materialShipMinCount) || null },
      times: condition.times || [],
    }))
}

function numeric(value) {
  if (/^\d+$/.test(value)) return Number(value)
  if (value === '十') return 10
  if (value.startsWith('十')) return 10 + (CHINESE_NUMBERS[value[1]] || 0)
  if (value.endsWith('十')) return (CHINESE_NUMBERS[value[0]] || 0) * 10
  if (value.includes('十')) return (CHINESE_NUMBERS[value[0]] || 0) * 10 + (CHINESE_NUMBERS[value[2]] || 0)
  return CHINESE_NUMBERS[value] || null
}

function actionCount(text, categoryName) {
  const patterns = {
    sortie: [/(?:各|分别)[^。；]*?(\d+|[一两二三四五六七八九十]+)次/i, /(?:S|A|B|胜利|获胜|击破)[^。；]*?(\d+|[一两二三四五六七八九十]+)次/i, /(?:出击|胜利|击破)[^。；]*?(\d+|[一两二三四五六七八九十]+)次/i],
    exercise: [/(\d+|[一两二三四五六七八九十]+)次[^。；]*(?:S|A|胜)/i, /(?:演习|胜利)[^。；]*?(\d+|[一两二三四五六七八九十]+)次/i],
    expedition: [/(?:远征|成功|完成)[^。；]*?(\d+|[一两二三四五六七八九十]+)次/i, /(\d+|[一两二三四五六七八九十]+)次[^。；]*(?:成功|完成)/i],
    supply: [/(?:补给|修复|维修|入渠)[^。；]*?(\d+|[一两二三四五六七八九十]+)次/i],
    factory: [/(?:建造|开发|解体|废弃|改修|更新)[^。；]*?(\d+|[一两二三四五六七八九十]+)(?:次|个|艘)/i],
    modernization: [/(?:近代化改修|改修)[^。；]*?(?:成功)?[^。；]*?(\d+|[一两二三四五六七八九十]+)次/i],
  }
  for (const pattern of patterns[categoryName] || []) {
    const match = text.match(pattern)
    if (match) return numeric(match[1]) || 1
  }
  return 1
}

function eventFor(categoryName, text) {
  if (categoryName === 'composition') return 'formation'
  if (categoryName === 'expedition') return 'mission_success'
  if (categoryName === 'exercise') {
    if (/S(?:或SS)?胜|S勝/i.test(text)) return 'practice_win_s'
    if (/A胜|A勝/i.test(text)) return 'practice_win_a'
    return /胜|勝/.test(text) ? 'practice_win' : 'practice'
  }
  if (categoryName === 'supply') return /入渠|修复|维修/.test(text) ? 'repair' : 'supply'
  if (categoryName === 'modernization') return 'remodel_ship'
  if (categoryName === 'factory') {
    if (/废弃|廃棄/.test(text)) return 'destory_item'
    if (/解体/.test(text)) return 'destroy_ship'
    if (/建造/.test(text)) return 'create_ship'
    if (/开发/.test(text)) return 'create_item'
    if (/改修|更新|转换|転換/.test(text)) return 'remodel_item'
    return 'factory'
  }
  if (categoryName === 'sortie') {
    if (/S(?:或SS)?胜|S勝/i.test(text)) return 'battle_boss_win_rank_s'
    if (/A胜|A勝|A胜以上/i.test(text)) return 'battle_boss_win_rank_a'
    if (/B胜|B勝|击破BOSS|击败BOSS|Boss|BOSS/i.test(text)) return 'battle_boss_win'
    if (/胜利|获胜|击破|撃破/.test(text)) return 'battle_win'
    return 'sally'
  }
  return 'unknown'
}

function extractMaps(text) {
  const maps = []
  const pattern = /(^|[^\d])([1-7])[-－](\d)(?:[-－](\d)|[（(]P([12])[）)]|P([12]))?/g
  let match
  while ((match = pattern.exec(text))) {
    const code = `${match[2]}-${match[3]}`
    const phase = Number(match[4] || match[5] || match[6]) || null
    const key = `${code}:${phase || 0}`
    if (!maps.some((entry) => entry.key === key)) maps.push({ key, id: Number(`${match[2]}${match[3]}`), code, phase, nodes: [] })
  }
  return maps.map(({ key, ...entry }) => entry)
}

function extractMissionIds(text) {
  const ids = []
  const chunks = text.match(/(?:远征|遠征)[^。；\n]*/g) || []
  chunks.forEach((chunk) => {
    let matches = []
    if (/\//.test(chunk)) {
      const list = chunk.match(/(?:远征|遠征)\s*((?:[A-E]\d|\d{1,2})(?:\s*\/\s*(?:[A-E]\d|\d{1,2}))+)/)?.[1]
      matches = list?.match(/(?:[A-E]\d|\d{1,2})/g) || []
    } else {
      const named = chunk.match(/(?:远征|遠征)\s*([A-E]\d|\d{1,2})(?=\s*[「『“])/)
      const lettered = chunk.match(/(?:远征|遠征)\s*([A-E]\d)\b/)
      matches = [named?.[1] || lettered?.[1]].filter(Boolean)
    }
    matches.forEach((id) => { if (!ids.includes(id)) ids.push(id) })
  })
  return ids
}

function extractRequirementResources(text) {
  const resources = { fuel: 0, ammo: 0, steel: 0, bauxite: 0 }
  Object.entries(RESOURCE_NAMES).forEach(([key, names]) => {
    for (const name of names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const patterns = [
        new RegExp(`(?:准备|消耗|需要|预备)[^。；，,]{0,12}?(\\d+)\\s*${escaped}`, 'i'),
        new RegExp(`${escaped}\\s*[×xX]?\\s*(\\d+)`, 'i'),
      ]
      const match = patterns.map((pattern) => text.match(pattern)).find(Boolean)
      if (match) { resources[key] = Number(match[1]); break }
    }
  })
  return resources
}

function extractRequirementItems(text, equipment = { entries: [], byName: new Map() }) {
  const entities = [...KNOWN_REWARD_ITEMS, ...(equipment.entries || []).flatMap((entry) => [entry.localizedName, entry.name])]
    .filter((name) => name && !Object.values(RESOURCE_NAMES).flat().includes(name))
    .sort((left, right) => right.length - left.length)
  const matches = []
  entities.forEach((name) => {
    let start = text.indexOf(name)
    while (start >= 0) {
      const end = start + name.length
      if (!matches.some((entry) => start < entry.end && entry.start < end)) {
        const before = text.slice(Math.max(0, start - 24), start)
        const after = text.slice(end, end + 16)
        const prefixCount = before.match(/(\d+)\s*(?:个|艘|只|枚)?\s*[「『【“]?$/)?.[1]
        const suffixCount = after.match(/^[」』】”]?\s*[×xX]?\s*(\d+)/)?.[1]
        const clauseStart = Math.max(text.lastIndexOf('。', start), text.lastIndexOf('；', start), text.lastIndexOf(';', start)) + 1
        const operationText = text.slice(clauseStart, start)
        const operations = [
          ['discard', Math.max(operationText.lastIndexOf('废弃'), operationText.lastIndexOf('廃棄'))],
          ['equip', Math.max(operationText.lastIndexOf('装备'), operationText.lastIndexOf('装備'), operationText.lastIndexOf('第一格'))],
          ['consume', Math.max(operationText.lastIndexOf('准备'), operationText.lastIndexOf('消耗'), operationText.lastIndexOf('需要'), operationText.lastIndexOf('预备'))],
        ].sort((left, right) => right[1] - left[1])
        const operation = operations[0][1] >= 0 ? operations[0][0] : 'required'
        const equipmentMatch = matchEquipment(name, equipment)
        matches.push({
          name, count: Number(prefixCount || suffixCount) || 1, operation,
          kind: equipmentMatch.equipmentId ? 'equipment' : rewardKind(name), ...equipmentMatch, start, end,
        })
      }
      start = text.indexOf(name, start + name.length)
    }
  })
  const unique = new Map()
  matches.sort((left, right) => left.start - right.start).forEach(({ start, end, ...entry }) => {
    const identity = entry.equipmentId || normalizedName(entry.name)
    const key = `${identity}:${entry.count}:${entry.operation}`
    if (!unique.has(key)) unique.set(key, entry)
  })
  return Array.from(unique.values())
}

function extractFleet(text) {
  const typeNames = [
    '航空巡洋舰', '水上机母舰', '航空战舰', '正规空母', '装甲空母', '轻巡洋舰', '重巡洋舰',
    '潜水空母', '潜水艇', '驱逐舰', '海防舰', '轻空母', '轻巡', '雷巡', '练巡', '重巡', '航巡', '战舰',
  ]
  const types = []
  typeNames.forEach((name) => {
    let start = text.indexOf(name)
    while (start >= 0) {
      if (!types.some((entry) => start < entry.end && entry.start < start + name.length)) {
        const before = text.slice(Math.max(0, start - 8), start)
        const after = text.slice(start + name.length, start + name.length + 8)
        const count = Number(before.match(/(\d+)\s*(?:艘|只)?\s*$/)?.[1] || after.match(/^\s*(?:[×xX]\s*)?(\d+)/)?.[1]) || 1
        types.push({ name, count, start, end: start + name.length })
      }
      start = text.indexOf(name, start + name.length)
    }
  })
  return {
    types: types.sort((left, right) => left.start - right.start).map(({ start, end, ...entry }) => entry),
    flagshipRequired: /旗舰/.test(text),
  }
}

function extractEquipmentTypes(text) {
  const types = []
  EQUIPMENT_TYPE_NAMES.forEach(([name, typeIds]) => {
    let start = text.indexOf(name)
    while (start >= 0) {
      if (!types.some((entry) => start < entry.end && entry.start < start + name.length)) {
        const before = text.slice(Math.max(0, start - 12), start)
        const after = text.slice(start + name.length, start + name.length + 12)
        const count = Number(before.match(/(\d+)\s*(?:个|枚)?\s*$/)?.[1] || after.match(/^[」』】”]?\s*(?:装备)?\s*[×xX]?\s*(\d+)/)?.[1]) || 1
        types.push({ name, typeIds, count, start, end: start + name.length })
      }
      start = text.indexOf(name, start + name.length)
    }
  })
  const unique = new Map()
  types.sort((left, right) => left.start - right.start).forEach(({ start, end, ...entry }) => {
    const key = `${entry.typeIds.join(',')}:${entry.count}`
    if (!unique.has(key)) unique.set(key, entry)
  })
  return Array.from(unique.values())
}

function classifyClause(text) {
  if (/奖励|BUG|争议|待验证|注意|建议|前置/.test(text)) return 'note'
  if (/出击|BOSS|Boss|胜|海域/.test(text)) return 'sortie'
  if (/远征|遠征/.test(text)) return 'expedition'
  if (/演习|演習/.test(text)) return 'exercise'
  if (/废弃|廃棄|装备|装備|开发|建造|解体|改修|更新/.test(text)) return 'equipment'
  if (/准备|消耗|燃料|弹药|钢材|铝土/.test(text)) return 'resource'
  if (/旗舰|僚舰|舰队|编成|艘|只|舰娘/.test(text)) return 'fleet'
  return 'condition'
}

function requirementText(quest) {
  const parts = [clean(quest.desc), clean(quest.memo2)].filter(Boolean)
  return parts.filter((part, index) => parts.indexOf(part) === index).join('；')
}

function parseTextRequirements(quest, categoryName, equipment = { entries: [], byName: new Map() }) {
  const raw = requirementText(quest)
  if (!raw) return { schemaVersion: 1, source: 'kcquests-text', confidence: 'unparsed', raw: '', goal: {}, objectives: [], clauses: [], costs: { resources: {}, items: [] }, unparsed: [] }
  const event = eventFor(categoryName, raw)
  const required = actionCount(raw, categoryName)
  const maps = extractMaps(raw)
  const missionIds = extractMissionIds(raw)
  const costItems = extractRequirementItems(raw, equipment)
  const equipmentTypes = extractEquipmentTypes(raw)
  const goal = {}
  let objectives = (maps.length > 1 ? maps : [maps[0] || null]).map((map) => {
    const key = map ? `${event}@${map.code}${map.phase ? `-${map.phase}` : ''}` : event
    const condition = { description: map ? `${map.code}${map.phase ? `-${map.phase}` : ''}` : raw.slice(0, 80), required, init: 0 }
    if (map) condition.maparea = [map.id]
    if (missionIds.length) condition.mission = missionIds
    goal[key] = condition
    return {
      key, event, description: condition.description, required, initial: 0, maps: map ? [map] : [],
      missions: missionIds.map((id) => ({ id })), fleet: extractFleet(raw),
      equipment: { ids: [], types: equipmentTypes }, materialShips: {}, times: [],
    }
  })
  if (event === 'destory_item') {
    const discards = [
      ...costItems.filter((item) => item.operation === 'discard' && item.equipmentId).map((item) => ({ name: item.name, count: item.count, ids: [item.equipmentId], types: [] })),
      ...equipmentTypes
        .filter((item) => !costItems.some((cost) => cost.operation === 'discard' && cost.name.includes(item.name)))
        .map((item) => ({ name: item.name, count: item.count, ids: [], types: item.typeIds })),
    ]
    if (discards.length) {
      Object.keys(goal).forEach((key) => delete goal[key])
      objectives = discards.map((item, index) => {
        const key = `destory_item@${item.name}-${index + 1}`
        const condition = { description: `废弃 ${item.name}`, required: item.count, init: 0 }
        if (item.ids.length) condition.slotitemId = item.ids
        if (item.types.length) condition.slotitemType2 = item.types
        goal[key] = condition
        return {
          key, event, description: condition.description, required: item.count, initial: 0, maps: [], missions: [],
          fleet: extractFleet(raw), equipment: { ids: item.ids, types: item.types.map((typeId) => ({ name: item.name, typeIds: [typeId], count: item.count })) },
          materialShips: {}, times: [],
        }
      })
    }
  }
  const clauses = raw.split(/[。；;\n]+/).map(clean).filter(Boolean).map((text) => ({ kind: classifyClause(text), text }))
  const hasSignal = event !== 'unknown' && (categoryName !== 'composition' || /编成|舰队|旗舰|艘/.test(raw))
  return {
    schemaVersion: 1, source: 'kcquests-text', confidence: hasSignal ? 'partial' : 'unparsed', raw,
    goal: hasSignal ? goal : {}, objectives: hasSignal ? objectives : [], clauses,
    costs: { resources: extractRequirementResources(raw), items: costItems },
    unparsed: hasSignal ? clauses.filter((clause) => ['condition', 'note'].includes(clause.kind)).map((clause) => clause.text) : [raw],
  }
}

function structureRequirements(id, quest, categoryName, poiGoals, equipment = { entries: [], byName: new Map() }) {
  const raw = requirementText(quest)
  const exact = poiGoals?.[id]
  if (!exact) return parseTextRequirements(quest, categoryName, equipment)
  return {
    schemaVersion: 1, source: 'poi-goal', confidence: 'exact', raw, goal: exact, objectives: normalizeGoal(exact),
    clauses: raw.split(/[。；;\n]+/).map(clean).filter(Boolean).map((text) => ({ kind: classifyClause(text), text })),
    costs: { resources: extractRequirementResources(raw), items: extractRequirementItems(raw, equipment) }, unparsed: [],
  }
}

function structureReward(raw, kcanotifyQuest, equipment) {
  const parsed = parseRewards(raw || kcanotifyQuest?.rewards, equipment)
  const base = kcanotifyQuest?.resources?.[0] || []
  const consumables = kcanotifyQuest?.resources?.[1] || []
  return {
    ...parsed,
    confidence: { items: parsed.confidence, resources: kcanotifyQuest?.resources ? 'exact' : 'unparsed' },
    resources: { fuel: Number(base[0]) || 0, ammo: Number(base[1]) || 0, steel: Number(base[2]) || 0, bauxite: Number(base[3]) || 0 },
    consumables: {
      instantRepair: Number(consumables[0]) || 0, instantConstruction: Number(consumables[1]) || 0,
      developmentMaterial: Number(consumables[2]) || 0, improvementMaterial: Number(consumables[3]) || 0,
    },
  }
}

function revisionFor(file) {
  let directory = path.dirname(path.resolve(file))
  while (directory !== path.dirname(directory)) {
    if (fs.existsSync(path.join(directory, '.git'))) {
      try {
        return childProcess.execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
      } catch (_) { return null }
    }
    directory = path.dirname(directory)
  }
  return null
}

function repeatIndex(categoryFile) {
  if (!categoryFile || !fs.existsSync(categoryFile)) return new Map()
  const source = readJson(categoryFile)
  const index = new Map()
  ;[['dailyQuest', 'daily'], ['weeklyQuest', 'weekly'], ['monthlyQuest', 'monthly'], ['quarterlyQuest', 'quarterly'], ['yearlyQuest', 'yearly'], ['singleQuest', 'single']]
    .forEach(([key, repeat]) => { ;(source[key] || []).forEach((id) => index.set(Number(id), repeat)) })
  return index
}

function build(baseFile, latestFile, categoryFile, options = {}) {
  const base = readJson(baseFile)
  const latest = latestFile && fs.existsSync(latestFile) ? readJson(latestFile) : {}
  const merged = { ...base, ...latest }
  const codeToId = new Map(Object.entries(merged).map(([id, quest]) => [quest.code, Number(id)]))
  const repeats = repeatIndex(categoryFile)
  const poiGoals = options.poiGoals || {}
  const kcanotify = options.kcanotify || {}
  const equipment = options.equipment || { entries: [], byName: new Map() }
  const unresolved = new Set()
  const quests = Object.entries(merged).map(([id, quest]) => {
    const prerequisiteCodes = Array.isArray(quest.pre) ? quest.pre.map(String) : []
    const prerequisites = prerequisiteCodes.map((code) => {
      const parentId = codeToId.get(code)
      if (!parentId) unresolved.add(code)
      return parentId
    }).filter(Boolean)
    const categoryName = category(quest.code)
    return {
      id: Number(id), code: clean(quest.code), category: categoryName, repeat: repeats.get(Number(id)) || 'unknown',
      name: clean(quest.name), detail: clean(quest.desc), note: clean(quest.memo2), rewards: clean(quest.memo),
      requirements: structureRequirements(id, quest, categoryName, poiGoals, equipment), reward: structureReward(quest.memo, kcanotify[id], equipment),
      prerequisites, unresolvedPrerequisites: prerequisiteCodes.filter((code) => !codeToId.has(code)),
    }
  }).sort((left, right) => left.id - right.id)
  return { quests, unresolved: Array.from(unresolved).sort() }
}

function coverage(quests) {
  const requirementConfidence = {}
  const objectivesByEvent = {}
  let rewardItems = 0
  let rewardChoices = 0
  let matchedEquipment = 0
  let exactRewardResources = 0
  let unparsedRewardItems = 0
  let requirementsWithCosts = 0
  let requirementsWithMaps = 0
  let requirementsWithMissions = 0
  quests.forEach((quest) => {
    const confidence = quest.requirements.confidence
    requirementConfidence[confidence] = (requirementConfidence[confidence] || 0) + 1
    quest.requirements.objectives.forEach((objective) => { objectivesByEvent[objective.event] = (objectivesByEvent[objective.event] || 0) + 1 })
    rewardItems += quest.reward.items.length
    rewardChoices += quest.reward.choices.length
    matchedEquipment += quest.reward.items.filter((item) => item.equipmentId).length
    if (quest.reward.confidence.resources === 'exact') exactRewardResources += 1
    if (quest.reward.confidence.items === 'unparsed') unparsedRewardItems += 1
    if (quest.requirements.costs.items.length || Object.values(quest.requirements.costs.resources).some(Boolean)) requirementsWithCosts += 1
    if (quest.requirements.objectives.some((objective) => objective.maps.length)) requirementsWithMaps += 1
    if (quest.requirements.objectives.some((objective) => objective.missions.length)) requirementsWithMissions += 1
  })
  return {
    quests: quests.length, requirementConfidence, objectivesByEvent, requirementsWithCosts,
    requirementsWithMaps, requirementsWithMissions, rewardItems, rewardChoices, matchedEquipment,
    exactRewardResources, unparsedRewardItems,
  }
}

if (require.main === module) {
  const referenceRoot = '/Users/rika/Library/Application Support/poi/plugins/node_modules/poi-plugin-quest-info-2/build'
  const source = path.resolve(argument('--kcquests') || (fs.existsSync('/private/tmp/kcQuests/quests-scn.json')
    ? '/private/tmp/kcQuests/quests-scn.json' : path.join(referenceRoot, 'kcQuestsData', 'quests-scn.json')))
  const latest = path.resolve(argument('--latest') || path.join(path.dirname(source), 'quests-scn-new.json'))
  const categoryFile = path.resolve(argument('--categories') || path.join(referenceRoot, 'questCategory.json'))
  const poiGoalFile = path.resolve(argument('--poi-goals') || path.join(__dirname, '..', '..', '..', 'assets', 'data', 'quest_goal.cson'))
  const kcanotifyFile = path.resolve(argument('--kcanotify') || path.join(referenceRoot, 'kcanotifyGamedata', 'quests-scn.json'))
  const equipmentFile = path.resolve(argument('--equipment') || path.join(path.dirname(source), 'equip.json'))
  const wctfDb = path.resolve(argument('--wctf-db') || '/Users/rika/Library/Application Support/poi/wctf-db/node_modules/whocallsthefleet-database/db')
  const masterDataFile = path.resolve(argument('--master-data') || '/private/tmp/kcwiki-start2.json')
  const kcwikiQuestDirectory = path.resolve(argument('--kcwiki-quests') || '/private/tmp/kcwiki-quest-data/data')
  const overridesFile = path.resolve(argument('--overrides') || path.join(__dirname, '..', 'data', 'overrides', 'quests.json'))
  const output = path.resolve(argument('--output') || path.join(__dirname, '..', 'data', 'quests.json'))
  const equipment = equipmentIndex(equipmentFile)
  const result = build(source, latest, categoryFile, {
    poiGoals: fs.existsSync(poiGoalFile) ? readCson(poiGoalFile) : {},
    kcanotify: kcanotifyFile && fs.existsSync(kcanotifyFile) ? readJson(kcanotifyFile) : {},
    equipment,
  })
  const legacyData = {
    schemaVersion: 3, generatedAt: new Date().toISOString(),
    sources: [
      { name: 'kcQuests', url: 'https://github.com/kcwikizh/kcQuests', revision: revisionFor(source), role: 'quest-text-and-requirement-fallback' },
      { name: 'Kcanotify game data', url: 'https://github.com/antest1/kcanotify-gamedata', role: 'base-rewards' },
      { name: 'kcwiki quest data', url: 'https://github.com/kcwikizh/kcwiki-quest-data', revision: revisionFor(kcwikiQuestDirectory), role: 'structured-requirements-and-rewards' },
      { name: 'kcwiki start2 snapshot', url: 'https://www.kcwiki.org/start2', revision: sha256(masterDataFile), role: 'game-master-data' },
      { name: 'WhoCallsTheFleet database', url: 'https://github.com/kcwikizh/WhoCallsTheFleet-DB', revision: revisionFor(wctfDb), role: 'entity-aliases' },
      { name: '艦隊これくしょん -艦これ- 攻略 Wiki', url: 'https://wikiwiki.jp/kancolle/任務', role: 'verification' },
      { name: 'tsunkit', url: 'https://tsunkit.net/quests/', role: 'verification' },
      { name: 'poi', url: 'https://github.com/poooi/poi', role: 'structured-progress-goals' },
    ], quests: result.quests,
  }
  const data = migrateData(legacyData, {
    catalogs: buildCatalogs({
      wctfDb, equipment,
      masterData: fs.existsSync(masterDataFile) ? readJson(masterDataFile) : null,
    }),
    kcwikiQuests: readQuestDirectory(kcwikiQuestDirectory),
    overrides: fs.existsSync(overridesFile) ? readJson(overridesFile) : { schemaVersion: 1, quests: [] },
  })
  const errors = validateData(data)
  if (errors.length) {
    console.error(errors.join('\n'))
    process.exitCode = 1
    return
  }
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, `${JSON.stringify(data, null, 2)}\n`)
  console.log(`wrote ${result.quests.length} quests to ${output}`)
  console.log(JSON.stringify(coverageV4(data, errors), null, 2))
}

module.exports = {
  build, category, clean, coverage, equipmentIndex, normalizeGoal, parseRewards, parseTextRequirements,
  readQuestDirectory, repeatIndex, rewardKind, structureReward, structureRequirements,
}
