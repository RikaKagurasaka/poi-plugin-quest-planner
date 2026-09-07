'use strict'

const fs = require('fs')
const path = require('path')

const CONFIDENCE = new Set(['exact', 'verified', 'parsed', 'unresolved'])
const EXPRESSION_OPERATORS = new Set(['all', 'any', 'atLeast', 'not', 'predicate'])
const RESOURCE_KEYS = ['fuel', 'ammo', 'steel', 'bauxite']
const COST_OPERATIONS = new Set(['own', 'equip', 'prepare', 'discard', 'consume', 'convert'])
const COST_TIMINGS = new Set(['operation', 'per-execution', 'quest-completion'])
const COST_KINDS = new Set(['resource', 'use-item', 'equipment', 'ship', 'other'])
const PREDICATE_KINDS = new Set(['fleet', 'equipment', 'resource', 'use-item', 'map'])
const REWARD_KINDS = new Set([
  'resource', 'use-item', 'equipment', 'ship', 'furniture', 'unlock', 'capacity', 'ranking-point', 'other',
])
const HANDLED_POI_CONDITION_FIELDS = new Set([
  'description', 'required', 'init', 'maparea', 'mapcell', 'mission', 'flagship', 'flagshiptype', 'flagshipclass',
  'secondship', 'secondshipclass', 'escortship', 'escortshiptype', 'escortshipclass', 'banshiptype', 'fleetlimit',
  'slotitemId', 'slotitemType2', 'materialShipType', 'materialShipMinCount', 'shipType', 'times',
])
const DEFAULT_WCTF_DB = '/Users/rika/Library/Application Support/poi/wctf-db/node_modules/whocallsthefleet-database/db'
const RESOURCE_LABELS = { fuel: '燃料', ammo: '弹药', steel: '钢材', bauxite: '铝土' }
const RESOURCE_ALIASES = {
  fuel: ['燃料'], ammo: ['弾薬', '弹药'], steel: ['鋼材', '钢材'], bauxite: ['ボーキサイト', 'ボーキ', '鋁土', '铝土'],
}
const CONSUMABLE_IDS = { instantRepair: 1, instantConstruction: 2, developmentMaterial: 3, improvementMaterial: 4 }
const CONSUMABLE_LABELS = {
  instantRepair: '高速修復材', instantConstruction: '高速建造材',
  developmentMaterial: '開発資材', improvementMaterial: '改修資材',
}
const SHIP_TYPE_ALIASES = {
  驱逐舰: [2], 駆逐: [2], 海防舰: [1], 海防艦: [1], 轻巡洋舰: [3], 轻巡: [3], 軽巡: [3], 雷巡: [4],
  重巡洋舰: [5], 重巡: [5], 重巡洋艦: [5], 航巡: [6], 航空巡洋舰: [6], 航空巡洋艦: [6],
  轻空母: [7], 軽空母: [7], 軽母: [7], 战舰: [8, 9, 10], 戦艦: [8, 9, 10], 低速戦艦: [8, 9],
  航空战舰: [10], 航空戦艦: [10], 航戦: [10], 正规空母: [11], 正規空母: [11], 空母: [7, 11, 18],
  超弩级战舰: [8, 9, 10], 潜水艇: [13], 潜水艦: [13, 14], 潜水空母: [14], 水上机母舰: [16],
  水上機母艦: [16], 水母: [16], 揚陸艦: [17], 装甲空母: [18], 装母: [18],
  潜水母艦: [20], 练巡: [21], 練巡: [21], 補給艦: [22],
}
const EQUIPMENT_TYPE_ALIASES = {
  電探: [12, 13], 水上電探: [12, 13], ソナー: [14], 水中聴音機: [14], 爆雷: [15],
}
const EQUIPMENT_ALIASES = {
  44: ['九四式暴雷投射机'],
  247: ['15.2cm三连装主炮'],
  367: ['Swordfish(水上机型)'],
  412: ['水雷战队 熟练见张员'],
  454: ['Ki-102乙改+I号一型乙 诱导弹'],
  486: ['零式舰战64型(制空战斗机机型)'],
  502: ['35.6cm连装炮改三(炫光迷彩规格)'],
  505: ['25mm对空机铳增备'],
  529: ['12.7cm连装炮C型改三H'],
  530: ['35.6cm连装炮改三丙'],
  532: ['通信装置&要员'],
  533: ['10cm连装高角炮改+高射装置改'],
  534: ['13.8cm连装炮'],
  540: ['零式水上侦察机11型甲改二'],
  545: ['天山一二型甲改二(村田队/电探装备)'],
  547: ['震电改二(舰战型改二)'],
  548: ['震电改三(试制 喷式震电)'],
  553: ['10cm连装高角炮改'],
  569: ['三式爆雷投射机改'],
  573: ['试制 23号电探改三'],
  575: ['25mm連裝機銃(熟練機銃員分隊)'],
}
const USE_ITEM_ALIASES = {
  1: ['高速修复材'], 2: ['高速建造材'], 3: ['开发资材'], 4: ['改修资材'],
  10: ['家具箱（小）', '家具箱(小)'], 11: ['家具箱（中）', '家具箱(中)'], 12: ['家具箱（大）', '家具箱(大)'],
  44: ['家具币'], 50: ['应急修理要员'], 51: ['应急修理女神'], 52: ['特制家具职人', '特注家具职人'],
  54: ['间宫', '給糧艦「間宮」'], 57: ['勋章'], 59: ['伊良湖', '給糧艦「伊良湖」'], 60: ['礼物箱'],
  63: ['司令部要员'], 64: ['补强增设', '補強增設'], 65: ['试制甲板用弹射器'], 66: ['战斗粮食'],
  67: ['洋上补给'], 70: ['熟练搭乘员'], 73: ['设营队'], 74: ['新型航空器设计图'],
  75: ['新型火炮兵装资材'], 77: ['新型航空兵装资材'], 78: ['战斗详报', '戰鬥詳報'],
  91: ['紧急修理资材'], 92: ['新型喷进装备开发资材'], 94: ['新型兵装资材'], 100: ['海外舰最新技术'],
  104: ['工厂资源'],
}
const SHIP_GROUP_SPECS = [
  {
    id: 'country.us', label: 'アメリカ艦', aliases: ['美国舰', '米艦', 'USS'],
    familyNames: [
      'Nevada', 'Colorado', 'Maryland', 'Washington', 'South Dakota', 'Indiana', 'Massachusetts', 'Iowa',
      'Lexington', 'Saratoga', 'Ranger', 'Hornet', 'Intrepid', 'Wasp', 'Independence', 'Langley', 'Gambier Bay',
      'Northampton', 'Houston', 'Minneapolis', 'Tuscaloosa', 'Brooklyn', 'Phoenix', 'Honolulu', 'Helena', 'Atlanta',
      'Reno', 'Fletcher', 'Johnston', 'Heywood L.E.', 'Richard P.Leary', 'Samuel B.Roberts', 'Salmon', 'Drum',
      'Wahoo', 'Dace', 'Scamp',
    ],
    excludeNames: ['General Belgrano', 'Leonardo da Vinci'],
  },
  {
    id: 'country.uk', label: 'イギリス艦', aliases: ['英国舰', '英艦'],
    familyNames: ['Warspite', 'Valiant', 'Nelson', 'Rodney', 'Glorious', 'Ark Royal', 'Victorious', 'Sheffield', 'Jervis', 'Janus', 'Javelin'],
  },
  { id: 'country.au', label: 'オーストラリア艦', aliases: ['澳大利亚舰', '豪艦'], familyNames: ['Perth'] },
  { id: 'country.nl', label: 'オランダ艦', aliases: ['荷兰舰', '蘭艦'], familyNames: ['De Ruyter'] },
]

function clean(value) {
  return String(value || '').replace(/[ \t]+/g, ' ').trim()
}

function normalizedName(value) {
  return clean(value).replace(/[「」『』【】“”'‘’\s]/g, '').replace(/（/g, '(').replace(/）/g, ')').toLocaleLowerCase()
}

function readNedb(file) {
  if (!file || !fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).filter((entry) => !entry.$$deleted)
}

function namesAndAliases(name, extra = []) {
  const names = {}
  Object.entries(name || {}).forEach(([locale, value]) => {
    if (typeof value === 'string' && clean(value)) names[locale] = clean(value)
  })
  const aliases = Array.from(new Set([...Object.values(names), ...extra].map(clean).filter(Boolean)))
  return { names, aliases }
}

function mergeNamedCatalog(entries) {
  const merged = new Map()
  entries.forEach((entry) => {
    const existing = merged.get(entry.id)
    if (!existing) { merged.set(entry.id, entry); return }
    existing.names = { ...existing.names, ...Object.fromEntries(Object.entries(entry.names || {}).filter(([, value]) => value)) }
    existing.aliases = Array.from(new Set([...(existing.aliases || []), ...(entry.aliases || [])]))
    if (existing.shipTypeId == null && entry.shipTypeId != null) existing.shipTypeId = entry.shipTypeId
  })
  return Array.from(merged.values()).sort((a, b) => a.id - b.id)
}

function buildShipGroups(ships) {
  const byName = new Map(ships.map((ship) => [ship.names?.ja_jp, ship]).filter(([name]) => name))
  return SHIP_GROUP_SPECS.map((spec) => {
    const missingNames = spec.familyNames.filter((name) => !byName.has(name))
    const familyIds = new Set(spec.familyNames.map((name) => byName.get(name)?.familyId).filter(Number.isFinite))
    const excludedIds = new Set((spec.excludeNames || []).map((name) => byName.get(name)?.masterId).filter(Number.isFinite))
    return {
      id: spec.id,
      memberMasterIds: ships.filter((ship) => familyIds.has(ship.familyId) && !excludedIds.has(ship.masterId)).map((ship) => ship.masterId),
      names: { ja_jp: spec.label }, aliases: spec.aliases,
      ...(missingNames.length ? { unresolvedNames: missingNames } : {}),
      confidence: missingNames.length ? 'unresolved' : 'verified',
      sourceRefs: [{
        source: '艦隊これくしょん -艦これ- 攻略 Wiki',
        field: `艦娘名一覧（艦種別）#Flag_${{ us: 'America', uk: 'Britain', au: 'Australia', nl: 'Netherlands' }[spec.id.split('.')[1]]}`,
      }],
    }
  })
}

function buildCatalogs(options = {}) {
  const db = path.resolve(options.wctfDb || DEFAULT_WCTF_DB)
  const suffixes = new Map(readNedb(path.join(db, 'ship_namesuffix.nedb')).map((entry) => [Number(entry.id), entry]))
  const rawShips = readNedb(path.join(db, 'ships.nedb'))
  const rawTypes = readNedb(path.join(db, 'ship_types.nedb'))
  const rawClasses = readNedb(path.join(db, 'ship_classes.nedb'))
  const rawItems = readNedb(path.join(db, 'items.nedb'))
  const rawUseItems = readNedb(path.join(db, 'consumables.nedb'))
  const master = options.masterData?.api_data || options.masterData?.body?.api_data || options.masterData
  if (master?.api_mst_ship && master?.api_mst_slotitem) {
    const wctfShips = new Map(rawShips.map((entry) => [Number(entry.id), entry]))
    const wctfTypesByGameId = new Map()
    rawTypes.filter((entry) => entry.id_ingame != null).forEach((entry) => {
      const values = wctfTypesByGameId.get(Number(entry.id_ingame)) || []
      values.push(entry)
      wctfTypesByGameId.set(Number(entry.id_ingame), values)
    })
    const wctfClassesByGameId = new Map()
    rawClasses.filter((entry) => entry.id_ingame != null).forEach((entry) => {
      const values = wctfClassesByGameId.get(Number(entry.id_ingame)) || []
      values.push(entry)
      wctfClassesByGameId.set(Number(entry.id_ingame), values)
    })
    const playerShips = master.api_mst_ship.filter((ship) => Number(ship.api_sortno) > 0)
    const playerIds = new Set(playerShips.map((ship) => Number(ship.api_id)))
    const incoming = new Map()
    const outgoing = new Map()
    const neighbors = new Map(Array.from(playerIds, (id) => [id, new Set()]))
    playerShips.forEach((ship) => {
      const id = Number(ship.api_id)
      const next = Number(ship.api_aftershipid)
      if (!(next > 0 && next !== id && playerIds.has(next))) return
      const parents = incoming.get(next) || []
      if (!parents.includes(id)) parents.push(id)
      incoming.set(next, parents)
      const successors = outgoing.get(id) || []
      if (!successors.includes(next)) successors.push(next)
      outgoing.set(id, successors)
      neighbors.get(id).add(next)
      neighbors.get(next).add(id)
    })
    const familyById = new Map()
    const stageById = new Map()
    const predecessorById = new Map()
    const visited = new Set()
    Array.from(playerIds).sort((a, b) => a - b).forEach((start) => {
      if (visited.has(start)) return
      const component = []
      const pending = [start]
      while (pending.length) {
        const id = pending.pop()
        if (visited.has(id)) continue
        visited.add(id)
        component.push(id)
        neighbors.get(id).forEach((neighbor) => pending.push(neighbor))
      }
      const componentIds = new Set(component)
      const roots = component.filter((id) => !(incoming.get(id) || []).some((parent) => componentIds.has(parent)))
      const seeds = roots
      const familyId = roots.length ? Math.min(...roots) : Math.min(...component)
      const queue = seeds.map((id) => [id, 0])
      seeds.forEach((id) => stageById.set(id, 0))
      while (queue.length) {
        const [id, stage] = queue.shift()
        ;(outgoing.get(id) || []).forEach((next) => {
          if (!componentIds.has(next) || (stageById.has(next) && stageById.get(next) <= stage + 1)) return
          stageById.set(next, stage + 1)
          queue.push([next, stage + 1])
        })
      }
      component.forEach((id) => familyById.set(id, familyId))
      component.forEach((id) => {
        if (!stageById.has(id) || stageById.get(id) === 0) return
        const parent = (incoming.get(id) || []).filter((candidate) => stageById.get(candidate) === stageById.get(id) - 1)
          .sort((left, right) => left - right)[0]
        if (parent != null) predecessorById.set(id, parent)
      })
    })
    const ships = playerShips.map((ship) => {
      const wctf = wctfShips.get(Number(ship.api_id))
      const identity = namesAndAliases({ ...(wctf?.name || {}), ja_jp: ship.api_name }, [ship.api_yomi])
      const id = Number(ship.api_id)
      return {
        masterId: id, familyId: familyById.get(id) || id, typeId: Number(ship.api_stype), classId: Number(ship.api_ctype),
        speed: Number(ship.api_soku),
        remodelStage: stageById.get(id) || 0, remodelStageKnown: stageById.has(id),
        predecessorId: predecessorById.get(id) || null,
        successorIds: outgoing.get(id) || [], ...identity,
      }
    }).sort((a, b) => a.masterId - b.masterId)
    const shipTypes = mergeNamedCatalog((master.api_mst_stype || []).map((entry) => {
      const wctf = wctfTypesByGameId.get(Number(entry.api_id)) || []
      return {
        id: Number(entry.api_id),
        ...namesAndAliases({ ...Object.assign({}, ...wctf.map((item) => item.name || {})), ja_jp: entry.api_name },
          wctf.flatMap((item) => [item.code, item.code_game])),
      }
    }))
    Object.entries(SHIP_TYPE_ALIASES).forEach(([alias, ids]) => ids.forEach((id) => {
      const entry = shipTypes.find((type) => type.id === id)
      if (entry && !entry.aliases.includes(alias)) entry.aliases.push(alias)
    }))
    const classIds = Array.from(new Set(playerShips.map((ship) => Number(ship.api_ctype)))).sort((a, b) => a - b)
    const shipClasses = classIds.map((id) => {
      const wctf = wctfClassesByGameId.get(id) || []
      const entry = {
        id, shipTypeId: null,
        ...namesAndAliases(Object.assign({}, ...wctf.map((item) => item.name || {}))),
      }
      Object.values(entry.names).forEach((name) => {
        const alias = clean(name).replace(/^改/, '')
        if (alias && !entry.aliases.includes(alias)) entry.aliases.push(alias)
      })
      return entry
    })
    const upstreamEquipment = options.equipment?.entries || []
    const upstreamById = new Map(upstreamEquipment.map((entry) => [Number(entry.id), entry]))
    const wctfItems = new Map(rawItems.map((entry) => [Number(entry.id), entry]))
    const equipment = master.api_mst_slotitem.filter((entry) => clean(entry.api_name)).map((entry) => {
      const id = Number(entry.api_id)
      const wctf = wctfItems.get(id)
      const upstream = upstreamById.get(id)
      return {
        masterId: id, type2Id: Number(entry.api_type?.[2]),
        ...namesAndAliases({ ...(wctf?.name || {}), ja_jp: entry.api_name }, [upstream?.name, upstream?.localizedName, ...(EQUIPMENT_ALIASES[id] || [])]),
      }
    }).sort((a, b) => a.masterId - b.masterId)
    const equipmentTypes = (master.api_mst_slotitem_equiptype || []).map((entry) => ({
      id: Number(entry.api_id), ...namesAndAliases({ ja_jp: entry.api_name }),
    })).sort((a, b) => a.id - b.id)
    Object.entries(EQUIPMENT_TYPE_ALIASES).forEach(([alias, ids]) => ids.forEach((id) => {
      const entry = equipmentTypes.find((type) => type.id === id)
      if (entry && !entry.aliases.includes(alias)) entry.aliases.push(alias)
    }))
    const useItems = (master.api_mst_useitem || []).map((entry) => {
      const wctf = rawUseItems.find((item) => Number(item.id) === Number(entry.api_id))
      return {
        id: Number(entry.api_id),
        ...namesAndAliases({ ...(wctf?.name || {}), ja_jp: entry.api_name }, USE_ITEM_ALIASES[Number(entry.api_id)] || []),
      }
    }).sort((a, b) => a.id - b.id)
    const maps = (master.api_mst_mapinfo || []).map((entry) => ({
      id: Number(entry.api_id), code: `${Number(entry.api_maparea_id)}-${Number(entry.api_no)}`,
      ...namesAndAliases({ ja_jp: entry.api_name }),
    })).sort((a, b) => a.id - b.id)
    const missions = (master.api_mst_mission || []).map((entry) => ({
      id: String(entry.api_id), ...namesAndAliases({ ja_jp: entry.api_name }, [entry.api_disp_no]),
    })).sort((a, b) => Number(a.id) - Number(b.id))
    return { ships, shipGroups: buildShipGroups(ships), shipTypes, shipClasses, equipment, equipmentTypes, useItems, maps, missions }
  }
  const previous = new Map()
  const typeGameIds = new Map(rawTypes.map((entry) => [Number(entry.id), Number(entry.id_ingame ?? entry.id)]))
  const classGameIds = new Map(rawClasses.map((entry) => [Number(entry.id), Number(entry.id_ingame ?? entry.id)]))
  rawShips.forEach((ship) => {
    if (ship.remodel?.next) previous.set(Number(ship.remodel.next), Number(ship.id))
  })
  const byShipId = new Map(rawShips.map((ship) => [Number(ship.id), ship]))
  function remodelStage(ship) {
    let current = Number(ship.id)
    let stage = 0
    const visited = new Set()
    while (previous.has(current) && !visited.has(current)) {
      visited.add(current)
      current = previous.get(current)
      stage += 1
    }
    return stage
  }
  function shipNames(ship) {
    const suffix = suffixes.get(Number(ship.name?.suffix))
    const names = {}
    ;['ja_jp', 'zh_cn', 'en_us'].forEach((locale) => {
      const base = clean(ship.name?.[locale])
      const tail = clean(suffix?.[locale])
      if (base) names[locale] = `${base}${tail}`
    })
    const baseAliases = Object.values(ship.name || {}).filter((value) => typeof value === 'string')
    return namesAndAliases(names, [...baseAliases, ship.name?.ja_kana, ship.name?.ja_romaji])
  }
  const ships = rawShips.map((ship) => {
    const identity = shipNames(ship)
    return {
      masterId: Number(ship.id), familyId: Number(ship.series || ship.id),
      typeId: typeGameIds.get(Number(ship.type)) ?? Number(ship.type), classId: classGameIds.get(Number(ship.class)) ?? Number(ship.class),
      remodelStage: remodelStage(ship), predecessorId: previous.get(Number(ship.id)) || null,
      successorIds: ship.remodel?.next ? [Number(ship.remodel.next)] : [], ...identity,
    }
  }).sort((a, b) => a.masterId - b.masterId)
  const shipTypes = mergeNamedCatalog(rawTypes.filter((entry) => entry.id_ingame != null).map((entry) => ({
    id: Number(entry.id_ingame), ...namesAndAliases(entry.name, [entry.code, entry.code_game]),
  })))
  Object.entries(SHIP_TYPE_ALIASES).forEach(([alias, ids]) => {
    ids.forEach((id) => {
      const entry = shipTypes.find((type) => type.id === id)
      if (entry && !entry.aliases.includes(alias)) entry.aliases.push(alias)
    })
  })
  const shipClasses = mergeNamedCatalog(rawClasses.filter((entry) => entry.id_ingame != null).map((entry) => ({
    id: Number(entry.id_ingame), shipTypeId: typeGameIds.get(Number(entry.ship_type_id)) ?? null, ...namesAndAliases(entry.name),
  })))
  const upstreamEquipment = options.equipment?.entries || []
  const upstreamById = new Map(upstreamEquipment.map((entry) => [Number(entry.id), entry]))
  const itemIds = new Set([...rawItems.map((entry) => Number(entry.id)), ...upstreamEquipment.map((entry) => Number(entry.id))])
  const equipment = Array.from(itemIds).sort((a, b) => a - b).map((id) => {
    const wctf = rawItems.find((entry) => Number(entry.id) === id)
    const upstream = upstreamById.get(id)
    const type = upstream?.type || wctf?.type_ingame || []
    return {
      masterId: id, type2Id: Number(type[2] ?? wctf?.type) || null,
      ...namesAndAliases(wctf?.name, [upstream?.name, upstream?.localizedName, ...(EQUIPMENT_ALIASES[id] || [])]),
    }
  })
  const equipmentTypes = Array.from(new Set(equipment.map((entry) => entry.type2Id).filter(Number.isFinite))).sort((a, b) => a - b)
    .map((id) => ({ id, names: {}, aliases: [] }))
  const useItems = rawUseItems.map((entry) => ({ id: Number(entry.id), ...namesAndAliases(entry.name) })).sort((a, b) => a.id - b.id)
  const maps = []
  for (let area = 1; area <= 7; area += 1) for (let map = 1; map <= 9; map += 1) maps.push({ id: area * 10 + map, code: `${area}-${map}` })
  return { ships, shipGroups: buildShipGroups(ships), shipTypes, shipClasses, equipment, equipmentTypes, useItems, maps, missions: [] }
}

function addIndex(map, name, value) {
  const key = normalizedName(name)
  if (!key) return
  const values = map.get(key) || []
  if (!values.includes(value)) values.push(value)
  map.set(key, values)
}

function catalogResolvers(catalogs) {
  const shipExact = new Map()
  const shipFamily = new Map()
  catalogs.ships.forEach((ship) => {
    if (ship.names?.ja_jp) addIndex(shipExact, ship.names.ja_jp, ship.masterId)
    ;(ship.aliases || []).forEach((alias) => addIndex(shipFamily, alias, ship.familyId))
  })
  const type = new Map()
  catalogs.shipTypes.forEach((entry) => [...Object.values(entry.names || {}), ...(entry.aliases || [])].forEach((name) => addIndex(type, name, entry.id)))
  const klass = new Map()
  catalogs.shipClasses.forEach((entry) => [...Object.values(entry.names || {}), ...(entry.aliases || [])].forEach((name) => addIndex(klass, name, entry.id)))
  const equipment = new Map()
  catalogs.equipment.forEach((entry) => [...Object.values(entry.names || {}), ...(entry.aliases || [])].forEach((name) => addIndex(equipment, name, entry.masterId)))
  const equipmentType = new Map()
  catalogs.equipmentTypes.forEach((entry) => [...Object.values(entry.names || {}), ...(entry.aliases || [])].forEach((name) => addIndex(equipmentType, name, entry.id)))
  const useItem = new Map()
  catalogs.useItems.forEach((entry) => [...Object.values(entry.names || {}), ...(entry.aliases || [])].forEach((name) => addIndex(useItem, name, entry.id)))
  const mission = new Map()
  catalogs.missions.forEach((entry) => {
    addIndex(mission, entry.id, String(entry.id))
    ;[...Object.values(entry.names || {}), ...(entry.aliases || [])].forEach((name) => addIndex(mission, name, String(entry.id)))
  })
  const map = new Map()
  catalogs.maps.forEach((entry) => {
    addIndex(map, entry.id, Number(entry.id))
    addIndex(map, entry.code, Number(entry.id))
    ;[...Object.values(entry.names || {}), ...(entry.aliases || [])].forEach((name) => addIndex(map, name, Number(entry.id)))
  })
  return { shipExact, shipFamily, type, klass, equipment, equipmentType, useItem, mission, map }
}

function sourceRef(source, field, raw) {
  return [{ source, field, ...(raw ? { raw: clean(raw) } : {}) }]
}

function meta(source, field, confidence, raw) {
  return { confidence, sourceRefs: sourceRef(source, field, raw) }
}

function expression(op, children, metadata) {
  return { op, children, ...metadata }
}

function predicate(value, metadata) {
  return { op: 'predicate', predicate: value, ...metadata }
}

function selectorFromNames(names, resolvers, unresolved, source, field) {
  const selector = { masterIds: [], familyIds: [] }
  ;(names || []).map(clean).filter(Boolean).forEach((name) => {
    const exact = resolvers.shipExact.get(normalizedName(name)) || []
    const families = resolvers.shipFamily.get(normalizedName(name)) || []
    if (exact.length === 1 && /(?:改|甲|乙|丙|丁|航|drei|due|zwei|andra|два|Mk\.|II)/i.test(name)) selector.masterIds.push(exact[0])
    else if (families.length) selector.familyIds.push(...families)
    else if (exact.length) selector.masterIds.push(...exact)
    else unresolved.push({ kind: 'entity', raw: name, reason: 'ship-alias-not-resolved', ...meta(source, field, 'unresolved', name) })
  })
  selector.masterIds = Array.from(new Set(selector.masterIds))
  selector.familyIds = Array.from(new Set(selector.familyIds))
  return selector
}

function typeSelector(values, field, resolvers, unresolved, source, sourceField) {
  const ids = []
  ;(values || []).forEach((value) => {
    if (Number.isFinite(Number(value))) ids.push(Number(value))
    else {
      const matched = resolvers[field].get(normalizedName(value)) || []
      if (matched.length) ids.push(...matched)
      else unresolved.push({ kind: 'entity', raw: clean(value), reason: `${field}-alias-not-resolved`, ...meta(source, sourceField, 'unresolved', value) })
    }
  })
  return Array.from(new Set(ids))
}

function hasSelector(selector) {
  return Object.values(selector || {}).some((value) => Array.isArray(value) && value.length)
}

function fleetPredicate(fleet, resolvers, unresolved, source, field, confidence) {
  if (!fleet || typeof fleet !== 'object') return null
  const positions = []
  const groups = []
  const forbidden = []
  const flagshipShip = selectorFromNames(fleet.flagshipShips, resolvers, unresolved, source, `${field}.flagshipShips`)
  const flagshipTypes = typeSelector(fleet.flagshipTypes, 'type', resolvers, unresolved, source, `${field}.flagshipTypes`)
  const flagshipClasses = typeSelector(fleet.flagshipClasses, 'klass', resolvers, unresolved, source, `${field}.flagshipClasses`)
  const flagshipSelector = { ...flagshipShip, typeIds: flagshipTypes, classIds: flagshipClasses }
  if (hasSelector(flagshipSelector) || fleet.flagshipRequired) positions.push({ role: 'flagship', selector: flagshipSelector })
  const secondShip = selectorFromNames(fleet.secondShips, resolvers, unresolved, source, `${field}.secondShips`)
  const secondClasses = typeSelector(fleet.secondShipClasses, 'klass', resolvers, unresolved, source, `${field}.secondShipClasses`)
  const secondSelector = { ...secondShip, classIds: secondClasses }
  if (hasSelector(secondSelector)) positions.push({ role: 'second', selector: secondSelector })
  ;(fleet.memberShips || []).forEach((entry, index) => {
    const names = Array.isArray(entry?.[0]) ? entry[0] : []
    const selector = selectorFromNames(names, resolvers, unresolved, source, `${field}.memberShips[${index}]`)
    if (hasSelector(selector)) groups.push({ selector, min: Number(entry?.[1]) || 1 })
  })
  ;(fleet.memberTypes || []).forEach((entry, index) => {
    const typeIds = typeSelector(entry?.[0], 'type', resolvers, unresolved, source, `${field}.memberTypes[${index}]`)
    if (typeIds.length) groups.push({ selector: { typeIds }, min: Number(entry?.[1]) || 1 })
  })
  ;(fleet.memberClasses || []).forEach((entry, index) => {
    const classIds = typeSelector(entry?.[0], 'klass', resolvers, unresolved, source, `${field}.memberClasses[${index}]`)
    if (classIds.length) groups.push({ selector: { classIds }, min: Number(entry?.[1]) || 1 })
  })
  ;(fleet.types || []).forEach((entry, index) => {
    const typeIds = typeSelector([entry.name], 'type', resolvers, unresolved, source, `${field}.types[${index}]`)
    if (typeIds.length) groups.push({ selector: { typeIds }, min: Number(entry.count) || 1 })
  })
  const forbiddenTypes = typeSelector(fleet.forbiddenTypes, 'type', resolvers, unresolved, source, `${field}.forbiddenTypes`)
  if (forbiddenTypes.length) forbidden.push({ typeIds: forbiddenTypes })
  const size = {}
  if (fleet.maxShips != null) size.max = Number(fleet.maxShips)
  if (!positions.length && !groups.length && !forbidden.length && !Object.keys(size).length) return null
  return predicate({ kind: 'fleet', positions, groups, forbidden, size, distinct: true }, meta(source, field, confidence))
}

function equipmentPredicate(equipment, required, source, field, confidence) {
  const ids = (equipment?.ids || []).map(Number).filter(Number.isFinite)
  const typeIds = (equipment?.types || []).flatMap((entry) => Array.isArray(entry?.typeIds) ? entry.typeIds : [entry]).map(Number).filter(Number.isFinite)
  if (!ids.length && !typeIds.length) return null
  return predicate({ kind: 'equipment', selector: { masterIds: ids, type2Ids: typeIds }, quantity: Number(required) || 1, operation: 'own' }, meta(source, field, confidence))
}

function migrateObjective(legacy, quest, index, resolvers, unresolved) {
  const exact = quest.requirements.confidence === 'exact'
  const confidence = exact ? 'verified' : 'parsed'
  const source = exact ? 'poi' : 'kcQuests'
  const constraints = []
  const fleet = fleetPredicate(legacy.fleet, resolvers, unresolved, source, `requirements.objectives[${index}].fleet`, confidence)
  if (fleet) constraints.push(fleet)
  const equip = equipmentPredicate(legacy.equipment, legacy.required, source, `requirements.objectives[${index}].equipment`, confidence)
  if (equip) constraints.push(equip)
  const mapIds = (legacy.maps || []).map((map) => Number(map.id)).filter(Number.isFinite)
  const missions = []
  ;(legacy.missions || []).forEach((mission, missionIndex) => {
    const raw = clean(mission.id || mission.name)
    const matched = resolvers.mission.get(normalizedName(raw)) || []
    if (matched.length === 1) missions.push(matched[0])
    else if (raw) unresolved.push({
      kind: 'entity', raw, reason: 'mission-alias-not-resolved',
      ...meta(source, `requirements.objectives[${index}].missions[${missionIndex}]`, 'unresolved', raw),
    })
  })
  const objectiveId = `objective-${index + 1}`
  const automatic = exact && !quest.requirements.goal?.fuzzy
  const event = clean(legacy.event || 'unknown')
  const label = event === 'destory_item'
    ? clean(legacy.description).replace(/^(?:废弃|廃棄)\s*(?:[-:：]\s*)?/, '') || '任意装备'
    : clean(legacy.description)
  return {
    id: objectiveId, event, label,
    count: { required: Number(legacy.required) || 1, initial: Number(legacy.initial) || 0 },
    target: {
      mapIds, mapNodes: (legacy.maps || []).flatMap((map) => map.nodes || []), missionIds: missions,
      enemyShipTypeIds: (legacy.enemyShipTypes || []).map(Number), executionCounts: (legacy.times || []).map(Number),
    },
    constraints: expression('all', constraints, meta(source, `requirements.objectives[${index}]`, confidence)),
    completion: {
      logic: 'count', eventKey: clean(legacy.key), automatic,
      ...(automatic ? {} : { reason: exact ? 'poi-goal-uses-fuzzy-counter' : 'text-parser-has-no-verified-game-event-mapping' }),
      ...meta(source, `requirements.objectives[${index}].completion`, confidence),
    },
    ...meta(source, `requirements.objectives[${index}]`, confidence),
  }
}

function costFromLegacy(item, index, resolvers) {
  const operation = { required: 'own', equip: 'equip', discard: 'discard', consume: 'consume' }[item.operation] || 'prepare'
  const base = {
    id: `cost-item-${index + 1}`, operation, timing: 'operation',
    quantity: Number(item.count) || 1, label: clean(item.name), ...meta('kcQuests', `requirements.costs.items[${index}]`, 'parsed', item.name),
  }
  if (item.equipmentId) return { ...base, kind: 'equipment', selector: { masterIds: [Number(item.equipmentId)], type2Ids: [] }, state: {} }
  const useItemIds = resolvers.useItem.get(normalizedName(item.name)) || []
  if (useItemIds.length === 1) return { ...base, kind: 'use-item', useItemId: useItemIds[0] }
  return { ...base, kind: 'other', raw: clean(item.name), reason: 'cost-entity-not-resolved', confidence: 'unresolved' }
}

function migrateCosts(quest, resolvers) {
  const costs = []
  Object.entries(quest.requirements.costs?.resources || {}).forEach(([resource, quantity]) => {
    if (!Number(quantity)) return
    costs.push({
      id: `cost-resource-${resource}`, kind: 'resource', resource, quantity: Number(quantity), operation: 'consume',
      timing: 'quest-completion', label: RESOURCE_LABELS[resource], ...meta('kcQuests', `requirements.costs.resources.${resource}`, 'parsed'),
    })
  })
  ;(quest.requirements.costs?.items || []).forEach((item, index) => costs.push(costFromLegacy(item, index, resolvers)))
  ;(quest.requirements.objectives || []).forEach((objective, index) => {
    const typeIds = (objective.materialShips?.types || []).map(Number).filter(Number.isFinite)
    if (!typeIds.length) return
    costs.push({
      id: `cost-material-ship-${index + 1}`, kind: 'ship', selector: { typeIds },
      quantity: Number(objective.materialShips.minimumPerAttempt) || 1, operation: 'consume', timing: 'per-execution',
      label: '近代化改修素材舰', ...meta('poi', `requirements.objectives[${index}].materialShips`, 'verified'),
    })
  })
  return costs
}

function rewardEntry(item, id, resolvers) {
  const base = { id, quantity: Number(item.count) || 1, label: clean(item.name), ...meta('kcQuests', 'reward.items', 'parsed', item.name) }
  const normalized = normalizedName(item.name)
  const resource = RESOURCE_KEYS.find((key) => RESOURCE_ALIASES[key].some((name) => {
    const alias = normalizedName(name)
    return normalized === alias || normalized === `${alias}${alias}`
  }))
  if (resource) return { ...base, kind: 'resource', resource, label: RESOURCE_LABELS[resource] }
  if (item.equipmentId) return { ...base, kind: 'equipment', equipmentId: Number(item.equipmentId), improvement: item.improvement == null ? null : Number(item.improvement) }
  const equipmentIds = resolvers.equipment.get(normalizedName(item.name)) || []
  if (equipmentIds.length === 1) return { ...base, kind: 'equipment', equipmentId: equipmentIds[0], improvement: item.improvement == null ? null : Number(item.improvement) }
  const useItemIds = resolvers.useItem.get(normalizedName(item.name)) || []
  if (useItemIds.length === 1) return { ...base, kind: 'use-item', useItemId: useItemIds[0] }
  const shipIds = resolvers.shipExact.get(normalizedName(item.name)) || []
  if (shipIds.length === 1) return { ...base, kind: 'ship', shipId: shipIds[0] }
  if (/家具/.test(item.name)) return { ...base, kind: 'furniture' }
  if (/战果|戦果/.test(item.name)) return { ...base, kind: 'ranking-point' }
  if (/保有|装备运用枠|装備運用枠|扩张|拡張/.test(item.name)) return { ...base, kind: 'capacity' }
  if (/开启|开放/.test(item.name)) return { ...base, kind: 'unlock' }
  return { ...base, kind: 'other', raw: clean(item.name), confidence: 'unresolved', reason: 'reward-entity-not-resolved' }
}

function migrateRewards(quest, resolvers) {
  const entries = []
  const legacyChoiceGroups = new Map()
  RESOURCE_KEYS.forEach((resource) => {
    const quantity = Number(quest.reward.resources?.[resource]) || 0
    if (quantity) entries.push({
      id: `reward-resource-${resource}`, kind: 'resource', resource, quantity, label: RESOURCE_LABELS[resource],
      ...meta('Kcanotify game data', `resources.${resource}`, 'exact'),
    })
  })
  Object.entries(CONSUMABLE_IDS).forEach(([key, useItemId]) => {
    const quantity = Number(quest.reward.consumables?.[key]) || 0
    if (quantity) entries.push({
      id: `reward-useitem-${useItemId}`, kind: 'use-item', useItemId, quantity, label: CONSUMABLE_LABELS[key],
      ...meta('Kcanotify game data', `consumables.${key}`, 'exact'),
    })
  })
  ;(quest.reward.items || []).forEach((item, index) => {
    const entry = rewardEntry(item, `reward-item-${index + 1}`, resolvers)
    const fixedConsumable = entry.kind === 'use-item' && item.choiceGroup == null && entries.find((candidate) =>
      candidate.id === `reward-useitem-${entry.useItemId}` && candidate.quantity === entry.quantity)
    if (!fixedConsumable) {
      entries.push(entry)
      legacyChoiceGroups.set(entry.id, item.choiceGroup)
    }
  })
  const unresolved = []
  const choices = (quest.reward.choices || []).map((choice, index) => {
    const entryIds = entries.filter((entry) => legacyChoiceGroups.get(entry.id) === choice.id).map((entry) => entry.id)
    const explicitOptionCount = choice.optionCount == null ? null : Number(choice.optionCount)
    const valid = explicitOptionCount == null ? entryIds.length >= (Number(choice.choose) || 1) : entryIds.length === explicitOptionCount
    if (!valid) unresolved.push({
      kind: 'reward-choice', raw: clean(choice.text), reason: 'choice-option-count-conflict', choiceId: `choice-${index + 1}`,
      expected: explicitOptionCount, actual: entryIds.length, ...meta('kcQuests', `reward.choices[${index}]`, 'unresolved', choice.text),
    })
    return {
      id: `choice-${index + 1}`, choose: Number(choice.choose) || 1, entryIds, valid,
      ...meta('kcQuests', `reward.choices[${index}]`, valid ? 'parsed' : 'unresolved', choice.text),
    }
  })
  return { entries, choices, unresolved }
}

function kcwikiMeta(questId, field, confidence = 'parsed', raw) {
  return meta('kcwiki quest data', `data/${questId}.json#${field}`, confidence, raw)
}

function conditionSemanticValue(value) {
  if (Array.isArray(value)) return value.map(conditionSemanticValue)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value).sort().reduce((result, key) => {
    if (!['confidence', 'sourceRefs', 'label'].includes(key)) result[key] = conditionSemanticValue(value[key])
    return result
  }, {})
}

function dedupeConditionExpression(value) {
  if (!value || typeof value !== 'object') return value
  if (value.op === 'not') return { ...value, child: dedupeConditionExpression(value.child) }
  if (!Array.isArray(value.children)) return value
  const seen = new Set()
  const children = value.children.map(dedupeConditionExpression).filter((child) => {
    const key = JSON.stringify(conditionSemanticValue(child))
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { ...value, children }
}

function uniqueNumbers(values) {
  return Array.from(new Set(values.map(Number).filter(Number.isFinite)))
}

function kcwikiShipSelector(value, resolvers, unresolved, questId, field) {
  const values = (Array.isArray(value) ? value : [value]).map(clean).filter(Boolean)
  const selector = { masterIds: [], familyIds: [], typeIds: [], classIds: [] }
  values.forEach((name) => {
    if (name === '艦' || name === '他の艦') return
    if (name === '高速艦') {
      selector.speed = { min: 10 }
      return
    }
    const typeIds = resolvers.type.get(normalizedName(name)) || []
    if (typeIds.length) { selector.typeIds.push(...typeIds); return }
    const exact = resolvers.shipExact.get(normalizedName(name)) || []
    const families = resolvers.shipFamily.get(normalizedName(name)) || []
    if (exact.length === 1 && /(?:改|甲|乙|丙|丁|航|drei|due|zwei|andra|два|Mk\.|II)/i.test(name)) selector.masterIds.push(exact[0])
    else if (families.length) selector.familyIds.push(...families)
    else if (exact.length) selector.masterIds.push(...exact)
    else unresolved.push({
      kind: 'entity', raw: name, reason: 'ship-or-type-alias-not-resolved',
      ...kcwikiMeta(questId, field, 'unresolved', name),
    })
  })
  ;['masterIds', 'familyIds', 'typeIds', 'classIds'].forEach((key) => { selector[key] = uniqueNumbers(selector[key]) })
  return selector
}

function kcwikiFleetPredicate(requirement, resolvers, unresolved, questId, field) {
  const positions = []
  const groups = []
  ;(requirement.groups || []).forEach((group, index) => {
    const groupField = `${field}.groups[${index}]`
    const selector = kcwikiShipSelector(group.ship, resolvers, unresolved, questId, `${groupField}.ship`)
    const classValues = Array.isArray(group.shipclass) ? group.shipclass : [group.shipclass]
    classValues.map(clean).filter(Boolean).forEach((name) => {
      const ids = resolvers.klass.get(normalizedName(name)) || []
      if (ids.length) selector.classIds.push(...ids)
      else unresolved.push({
        kind: 'entity', raw: name, reason: 'class-alias-not-resolved',
        ...kcwikiMeta(questId, `${groupField}.shipclass`, 'unresolved', name),
      })
    })
    selector.classIds = uniqueNumbers(selector.classIds)
    if (Array.isArray(group.lv)) selector.level = { min: Number(group.lv[0]) || 0, max: Number(group.lv[1]) || null }
    const amount = Array.isArray(group.amount) ? group.amount : [group.amount == null ? 1 : group.amount, group.amount]
    let min = Number(group.select ?? amount[0]) || 0
    const max = Number(amount[1]) || null
    if (group.flagship || Number(group.place) === 2) {
      positions.push({ role: group.flagship ? 'flagship' : 'second', selector })
      min = Math.max(0, min - 1)
    }
    if (min > 0) groups.push({
      selector, min, ...(max == null ? {} : { max: Math.max(0, max - (group.flagship || Number(group.place) === 2 ? 1 : 0)) }),
      ...(group.select ? { distinctBy: 'family' } : {}),
    })
  })
  const forbidden = []
  if (requirement.disallowed && requirement.disallowed !== '他の艦') {
    const selector = kcwikiShipSelector(requirement.disallowed, resolvers, unresolved, questId, `${field}.disallowed`)
    if (hasSelector(selector)) forbidden.push(selector)
  }
  return predicate({
    kind: 'fleet', positions, groups, forbidden, size: {}, distinct: true,
    ...(requirement.fleetid == null ? {} : { fleetId: Number(requirement.fleetid) }),
    ...(requirement.disallowed === '他の艦' ? { allowOnlyListed: true } : {}),
  }, kcwikiMeta(questId, field))
}

function kcwikiEquipmentSelector(name, resolvers) {
  const equipmentIds = resolvers.equipment.get(normalizedName(name)) || []
  if (equipmentIds.length) return { masterIds: uniqueNumbers(equipmentIds), type2Ids: [] }
  const typeIds = resolvers.equipmentType.get(normalizedName(name)) || []
  return { masterIds: [], type2Ids: uniqueNumbers(typeIds) }
}

function kcwikiMapTargets(value, resolvers, unresolved, questId, field) {
  const rawValues = Array.isArray(value) ? value : value == null ? [] : [value]
  const groups = []
  rawValues.forEach((rawValue, index) => {
    const valueText = clean(rawValue)
    const range = valueText.match(/^(\d)-(\d)\s*[~〜～]\s*(\d)-(\d)$/)
    const codes = []
    let phase = null
    if (range && range[1] === range[3]) {
      for (let map = Number(range[2]); map <= Number(range[4]); map += 1) codes.push(`${range[1]}-${map}`)
    } else {
      const phased = valueText.match(/^(\d)-(\d)(?:-(?:P)?(\d))$/i)
      if (phased) { codes.push(`${phased[1]}-${phased[2]}`); phase = Number(phased[3]) }
      else codes.push(valueText)
    }
    const ids = codes.flatMap((code) => resolvers.map.get(normalizedName(code)) || [])
    if (ids.length === codes.length) groups.push({ ids: uniqueNumbers(ids), match: range ? 'any' : 'all', ...(phase ? { phase } : {}) })
    else unresolved.push({
      kind: 'entity', raw: valueText, reason: 'map-alias-not-resolved',
      ...kcwikiMeta(questId, `${field}[${index}]`, 'unresolved', valueText),
    })
  })
  return groups
}

function kcwikiCost(item, operation, timing, resolvers, unresolved, questId, field, extra = {}) {
  const name = clean(item?.name)
  const quantity = Number(item?.amount) || 1
  const equipmentSelector = kcwikiEquipmentSelector(name, resolvers)
  const base = { id: '', quantity, operation, timing, label: name, ...kcwikiMeta(questId, field, 'parsed', name), ...extra }
  if (equipmentSelector.masterIds.length || equipmentSelector.type2Ids.length) return { ...base, kind: 'equipment', selector: equipmentSelector, state: extra.state || {} }
  const useItemIds = resolvers.useItem.get(normalizedName(name)) || []
  if (useItemIds.length === 1) return {
    ...base,
    kind: 'use-item',
    useItemId: useItemIds[0],
    operation: operation === 'discard' ? 'consume' : operation,
  }
  unresolved.push({
    kind: 'cost', raw: name, reason: operation === 'discard' && useItemIds.length ? 'kcwiki-scrap-is-not-equipment' : 'cost-entity-not-resolved',
    ...kcwikiMeta(questId, field, 'unresolved', name),
  })
  return { ...base, kind: 'other', raw: name, reason: 'cost-entity-not-resolved', confidence: 'unresolved' }
}

function kcwikiRewardEntry(item, id, resolvers, questId, unresolved, field) {
  const rawName = clean(item?.name)
  const improvementMatch = rawName.match(/★(?:\+)?(\d+|max)/i)
  const name = clean(rawName.replace(/★(?:\+)?(?:\d+|max)/ig, ''))
  const rankingMatch = name.match(/^戦果\s*(\d+)$/)
  const base = {
    id, quantity: Number(item?.amount) || Number(rankingMatch?.[1]) || 1, label: name,
    ...kcwikiMeta(questId, field, 'parsed', rawName),
  }
  const equipmentIds = resolvers.equipment.get(normalizedName(name)) || []
  if (equipmentIds.length === 1) return {
    ...base, kind: 'equipment', equipmentId: equipmentIds[0], improvement: improvementMatch ? (improvementMatch[1].toLowerCase() === 'max' ? 10 : Number(improvementMatch[1])) : null,
  }
  const useItemNames = [name, name.replace(/^給糧艦[「『](.+)[」』]$/, '$1')]
  const useItemIds = uniqueNumbers(useItemNames.flatMap((candidate) => resolvers.useItem.get(normalizedName(candidate)) || []))
  if (useItemIds.length === 1) return { ...base, kind: 'use-item', useItemId: useItemIds[0] }
  const shipIds = resolvers.shipExact.get(normalizedName(name)) || []
  if (shipIds.length === 1) return { ...base, kind: 'ship', shipId: shipIds[0] }
  if (item?.category === '家具' || /掛け軸|挂轴|床|布団|座布団/.test(name)) return { ...base, kind: 'furniture' }
  if (rankingMatch) return { ...base, kind: 'ranking-point' }
  if (/開放/.test(name)) return { ...base, kind: 'unlock' }
  if (/保有枠|運用枠/.test(name)) return { ...base, kind: 'capacity' }
  const entry = { ...base, kind: 'other', raw: rawName, reason: 'reward-entity-not-resolved', confidence: 'unresolved' }
  unresolved.push({
    kind: 'reward', raw: rawName, reason: entry.reason,
    ...kcwikiMeta(questId, field, 'unresolved', rawName),
  })
  return entry
}

function kcwikiRewards(upstream, existing, resolvers) {
  const entries = existing.entries.filter((entry) =>
    entry.kind === 'resource' || (entry.kind === 'use-item' && entry.id.startsWith('reward-useitem-')))
  const choices = []
  const unresolved = []
  let entryCounter = 0
  let choiceCounter = 0
  ;(upstream.reward_other || []).forEach((reward, rewardIndex) => {
    const options = Array.isArray(reward.choices) ? reward.choices : [reward]
    const entryIds = options.map((item, optionIndex) => {
      entryCounter += 1
      const id = `reward-kcwiki-${entryCounter}`
      const entry = kcwikiRewardEntry(item, id, resolvers, upstream.game_id, unresolved,
        `reward_other[${rewardIndex}]${reward.choices ? `.choices[${optionIndex}]` : ''}`)
      const duplicateExactFixed = !reward.choices && entries.some((candidate) =>
        candidate.confidence === 'exact' && candidate.kind === entry.kind &&
        candidate.useItemId === entry.useItemId)
      if (duplicateExactFixed) return null
      entries.push(entry)
      return id
    }).filter(Boolean)
    if (reward.choices) {
      choiceCounter += 1
      choices.push({ id: `choice-${choiceCounter}`, choose: 1, entryIds, valid: entryIds.length > 0, ...kcwikiMeta(upstream.game_id, `reward_other[${rewardIndex}].choices`) })
    }
  })
  return { entries, choices, unresolved }
}

function convertKcwikiRequirement(upstream, resolvers) {
  const questId = Number(upstream.game_id)
  const unresolved = []
  const objectives = []
  const costs = []
  const sequenceStages = []
  let objectiveCounter = 0
  let costCounter = 0
  function addObjective(event, count, target, constraints, field, label) {
    objectiveCounter += 1
    objectives.push({
      id: `objective-kcwiki-${objectiveCounter}`, event, label: clean(label || event), count: { required: Number(count) || 1, initial: 0 },
      target, constraints: constraints || expression('all', [], kcwikiMeta(questId, `${field}.constraints`)),
      completion: {
        logic: 'count', eventKey: '', automatic: false, reason: 'kcwiki-requirement-has-no-verified-poi-event-mapping',
        ...kcwikiMeta(questId, `${field}.completion`),
      },
      ...kcwikiMeta(questId, field),
    })
  }
  function addDiscardObjective(cost, field) {
    if (cost?.kind !== 'equipment' || cost.operation !== 'discard') return
    addObjective(
      'destory_item', cost.quantity,
      { mapIds: [], mapNodes: [], missionIds: [], enemyShipTypeIds: [], executionCounts: [] },
      predicate({
        kind: 'equipment', selector: cost.selector, quantity: cost.quantity, operation: 'own',
      }, kcwikiMeta(questId, `${field}.constraints`, cost.confidence, cost.sourceRefs?.[0]?.raw)),
      field, cost.label,
    )
  }
  function addCost(cost) { costCounter += 1; cost.id = `cost-kcwiki-${costCounter}`; costs.push(cost) }
  function addResources(resources, field) {
    ;(resources || []).forEach((quantity, index) => {
      if (!Number(quantity)) return
      addCost({
        id: '', kind: 'resource', resource: RESOURCE_KEYS[index], quantity: Number(quantity), operation: 'consume',
        timing: 'quest-completion', label: RESOURCE_LABELS[RESOURCE_KEYS[index]], ...kcwikiMeta(questId, `${field}[${index}]`),
      })
    })
  }
  function addItems(items, operation, field, extra) {
    const added = []
    ;(items || []).forEach((item, index) => {
      const cost = kcwikiCost(
        item, operation, operation === 'discard' ? 'operation' : 'quest-completion',
        resolvers, unresolved, questId, `${field}[${index}]`, extra,
      )
      addCost(cost)
      added.push(cost)
    })
    return added
  }
  function convert(requirement, field) {
    if (!requirement || typeof requirement !== 'object') return expression('all', [], kcwikiMeta(questId, field))
    if (['and', 'then', 'or'].includes(requirement.category)) {
      const beforeObjectives = objectives.length
      const children = (requirement.list || []).map((child, index) => {
        const stageStart = objectives.length
        const converted = convert(child, `${field}.list[${index}]`)
        if (requirement.category === 'then' && field === 'requirements') {
          sequenceStages.push(objectives.slice(stageStart).map((objective) => objective.id))
        }
        return converted
      })
      if (requirement.category === 'or') {
        const alternateObjectives = objectives.splice(beforeObjectives)
        const firstChildCount = alternateObjectives.length / Math.max(children.length, 1)
        if (Number.isInteger(firstChildCount) && firstChildCount > 0) {
          alternateObjectives.slice(0, firstChildCount).forEach((objective) => {
            objective.constraints = expression('any', children, kcwikiMeta(questId, `${field}.alternatives`))
            objectives.push(objective)
          })
        } else unresolved.push({
          kind: 'completion', raw: JSON.stringify(requirement), reason: 'alternative-objectives-not-equivalent',
          ...kcwikiMeta(questId, field, 'unresolved', JSON.stringify(requirement)),
        })
      }
      return expression(requirement.category === 'or' ? 'any' : 'all', children, kcwikiMeta(questId, field))
    }
    if (requirement.category === 'a-gou') {
      ;[
        ['sally', 36, '出击'],
        ['battle_rank_s', 6, 'S 胜'],
        ['battle_boss', 24, 'Boss 到达'],
        ['battle_boss_win', 12, 'Boss 胜利'],
      ].forEach(([event, count, label]) => addObjective(
        event, count,
        { mapIds: [], mapNodes: [], missionIds: [], enemyShipTypeIds: [], executionCounts: [] },
        expression('all', [], kcwikiMeta(questId, `${field}.constraints`)), field, label,
      ))
      return expression('all', [], kcwikiMeta(questId, field))
    }
    const fleet = requirement.groups?.length ? kcwikiFleetPredicate(requirement, resolvers, unresolved, questId, `${field}.fleet`) : null
    const fleetConstraint = fleet || expression('all', [], kcwikiMeta(questId, `${field}.constraints`))
    if (requirement.category === 'fleet') {
      addObjective('formation', 1, {}, fleetConstraint, field, upstream.detail)
      return fleetConstraint
    }
    if (requirement.category === 'sortie') {
      const mapGroups = kcwikiMapTargets(requirement.map, resolvers, unresolved, questId, `${field}.map`)
      const targets = mapGroups.length ? mapGroups : [{ ids: [], match: 'all' }]
      targets.forEach((mapGroup) => addObjective(
        requirement.boss ? `battle_boss_win_rank_${clean(requirement.result || 'B').toLowerCase()}` : 'battle_win',
        requirement.times, { mapIds: mapGroup.ids, mapMatch: mapGroup.match, mapPhase: mapGroup.phase || null, mapNodes: [], missionIds: [], enemyShipTypeIds: [], executionCounts: [], boss: Boolean(requirement.boss), result: requirement.result || null },
        fleetConstraint, field, upstream.detail,
      ))
      return fleetConstraint
    }
    if (requirement.category === 'excercise') {
      addObjective(requirement.victory ? 'practice_win' : 'practice', requirement.times, {
        mapIds: [], mapNodes: [], missionIds: [], enemyShipTypeIds: [], executionCounts: [], daily: Boolean(requirement.daily),
      }, fleetConstraint, field, upstream.detail)
      return fleetConstraint
    }
    if (requirement.category === 'expedition') {
      ;(requirement.objects || []).forEach((object, index) => {
        const rawIds = Array.isArray(object.id) ? object.id : object.id == null ? [] : [object.id]
        const missionIds = rawIds.flatMap((id) => resolvers.mission.get(normalizedName(id)) || [])
        if (missionIds.length !== rawIds.length) unresolved.push({
          kind: 'entity', raw: JSON.stringify(rawIds), reason: 'mission-alias-not-resolved',
          ...kcwikiMeta(questId, `${field}.objects[${index}].id`, 'unresolved', JSON.stringify(rawIds)),
        })
        addObjective('mission_success', object.times, {
          mapIds: [], mapNodes: [], missionIds: Array.from(new Set(missionIds)), enemyShipTypeIds: [], executionCounts: [],
        }, fleetConstraint, `${field}.objects[${index}]`, upstream.detail)
      })
      addResources(requirement.resources, `${field}.resources`)
      return fleetConstraint
    }
    if (requirement.category === 'simple') {
      const events = {
        equipment: 'create_item', ship: 'create_ship', scrapequipment: 'destory_item', scrapship: 'destroy_ship',
        modernization: 'remodel_ship', improvement: 'remodel_item', resupply: 'supply', repair: 'repair', battle: 'battle_win',
      }
      const event = events[requirement.subcategory] || 'unknown'
      addObjective(event, requirement.times, {
        mapIds: [], mapNodes: [], missionIds: [], enemyShipTypeIds: [], executionCounts: [], batch: Boolean(requirement.batch),
      }, fleetConstraint, field, event === 'destory_item' ? '任意装备' : upstream.detail)
      return fleetConstraint
    }
    if (requirement.category === 'sink') {
      addObjective('battle_sink', requirement.amount, {
        mapIds: [], mapNodes: [], missionIds: [], enemyShipTypeIds: [], executionCounts: [], enemy: clean(requirement.ship),
      }, fleetConstraint, field, upstream.detail)
      return fleetConstraint
    }
    if (requirement.category === 'scrapequipment') {
      const discardCosts = addItems(requirement.list, 'discard', `${field}.list`)
      discardCosts.forEach((cost, index) => addDiscardObjective(cost, `${field}.list[${index}]`))
      return fleetConstraint
    }
    if (['equipexchange', 'modelconversion'].includes(requirement.category)) {
      addItems(requirement.equipments, 'prepare', `${field}.equipments`)
      const discardCosts = addItems(requirement.scraps, 'discard', `${field}.scraps`)
      addItems(requirement.consumptions, 'consume', `${field}.consumptions`)
      addResources(requirement.resources, `${field}.resources`)
      const secretarySelector = requirement.secretary ? kcwikiShipSelector(requirement.secretary, resolvers, unresolved, questId, `${field}.secretary`) : null
      const looseEquipment = Array.isArray(requirement.equipment) ? requirement.equipment : requirement.equipment ? [requirement.equipment] : []
      const equipmentCounts = new Map()
      looseEquipment.forEach((name) => equipmentCounts.set(name, (equipmentCounts.get(name) || 0) + 1))
      equipmentCounts.forEach((quantity, name) => addCost(kcwikiCost(
        { name, amount: quantity }, 'equip', 'operation', resolvers, unresolved, questId, `${field}.equipment`, {
          state: {
            ...(requirement.fullyskilled ? { proficiency: { exact: 7 } } : {}),
            ...(requirement.maxmodified ? { improvement: { exact: 10 } } : {}), locked: false,
          }, placement: { role: 'secretary', mustBeCurrentlyEquipped: true, ...(secretarySelector ? { shipSelector: secretarySelector } : {}) },
        },
      )))
      ;(requirement.slots || []).forEach((slot, index) => addCost(kcwikiCost(
        { name: slot.equipment, amount: slot.count || 1 }, 'equip', 'operation', resolvers, unresolved, questId, `${field}.slots[${index}]`, {
          state: {
            ...(slot.fullyskilled ? { proficiency: { exact: 7 } } : {}),
            ...(slot.maxmodified ? { improvement: { exact: 10 } } : {}),
          }, placement: {
            role: 'secretary', slotIndex: Number(slot.slot) > 0 ? Number(slot.slot) - 1 : null,
            mustBeCurrentlyEquipped: true, ...(secretarySelector ? { shipSelector: secretarySelector } : {}),
          },
        },
      )))
      if (requirement.use_skilled_crew) addCost(kcwikiCost(
        { name: '熟練搭乗員', amount: 1 }, 'consume', 'quest-completion', resolvers, unresolved, questId, `${field}.use_skilled_crew`,
      ))
      if (discardCosts.some((cost) => cost.kind === 'equipment' && cost.operation === 'discard')) {
        discardCosts.forEach((cost, index) => addDiscardObjective(cost, `${field}.scraps[${index}]`))
      } else {
        addObjective(requirement.category === 'modelconversion' ? 'remodel_item' : 'factory_operation', 1, {
          mapIds: [], mapNodes: [], missionIds: [], enemyShipTypeIds: [], executionCounts: [],
        }, fleetConstraint, field, upstream.detail)
      }
      return fleetConstraint
    }
    if (requirement.category === 'modernization') {
      addResources(requirement.resources, `${field}.resources`)
      ;(requirement.consumptions || []).forEach((consumption, index) => {
        const selector = kcwikiShipSelector(consumption.ship, resolvers, unresolved, questId, `${field}.consumptions[${index}].ship`)
        addCost({
          id: '', kind: 'ship', selector, quantity: Number(consumption.amount) || 1, operation: 'consume', timing: 'per-execution',
          label: clean((Array.isArray(consumption.ship) ? consumption.ship : [consumption.ship]).join('、')), ...kcwikiMeta(questId, `${field}.consumptions[${index}]`),
        })
      })
      const target = kcwikiShipSelector(requirement.ship, resolvers, unresolved, questId, `${field}.ship`)
      const constraint = predicate({ kind: 'fleet', positions: [], groups: [{ selector: target, min: 1 }], forbidden: [], size: {}, distinct: true }, kcwikiMeta(questId, `${field}.ship`))
      addObjective('remodel_ship', requirement.times, { mapIds: [], mapNodes: [], missionIds: [], enemyShipTypeIds: [], executionCounts: [] }, constraint, field, upstream.detail)
      return constraint
    }
    unresolved.push({
      kind: 'condition', raw: JSON.stringify(requirement), reason: 'kcwiki-requirement-category-not-modeled',
      ...kcwikiMeta(questId, field, 'unresolved', JSON.stringify(requirement)),
    })
    return expression('all', [], kcwikiMeta(questId, field, 'unresolved'))
  }
  const conditions = dedupeConditionExpression(convert(upstream.requirements, 'requirements'))
  return {
    conditions, objectives, costs, unresolved,
    completion: sequenceStages.length
      ? { logic: 'sequence', objectiveIds: objectives.map((objective) => objective.id), stages: sequenceStages }
      : { logic: 'all', objectiveIds: objectives.map((objective) => objective.id) },
  }
}

function applyKcwikiQuest(quest, upstream, resolvers, questIds) {
  if (!upstream) return quest
  const converted = convertKcwikiRequirement(upstream, resolvers)
  const hasConvertedDiscardCosts = converted.costs.some((cost) => cost.kind === 'equipment' && cost.operation === 'discard')
  const usePoiObjectives = quest.requirements.objectives.some((objective) => objective.confidence === 'verified') && !hasConvertedDiscardCosts
  const dependencies = { questIds: [], unresolved: [] }
  ;(upstream.prerequisite || []).forEach((id, index) => {
    if (questIds.has(Number(id))) dependencies.questIds.push(Number(id))
    else dependencies.unresolved.push({
      kind: 'dependency', code: String(id), raw: String(id), reason: 'prerequisite-id-not-in-local-catalog',
      ...kcwikiMeta(upstream.game_id, `prerequisite[${index}]`, 'unresolved', String(id)),
    })
  })
  const rewards = kcwikiRewards(upstream, quest.rewards, resolvers)
  const unresolved = converted.unresolved
  const useConvertedSequence = converted.completion.logic === 'sequence'
  const objectives = usePoiObjectives && !useConvertedSequence ? quest.requirements.objectives : converted.objectives
  const confidence = unresolved.length || dependencies.unresolved.length || rewards.unresolved.length ? 'unresolved' : 'parsed'
  return {
    ...quest,
    prerequisites: dependencies.questIds,
    unresolvedPrerequisites: dependencies.unresolved.map((entry) => entry.code),
    dependencies,
    requirements: {
      conditions: converted.conditions,
      objectives,
      completion: {
        ...(useConvertedSequence
          ? converted.completion
          : { logic: 'all', objectiveIds: objectives.map((objective) => objective.id) }),
        ...kcwikiMeta(upstream.game_id, 'requirements'),
      },
      costs: converted.costs,
      unresolved,
    },
    rewards,
    sources: Array.from(new Set([...quest.sources, 'kcwiki quest data'])),
    confidence: {
      conditions: unresolved.length ? 'unresolved' : 'parsed',
      objectives: usePoiObjectives ? 'verified' : unresolved.length ? 'unresolved' : 'parsed',
      costs: converted.costs.some((cost) => cost.confidence === 'unresolved') ? 'unresolved' : converted.costs.length ? 'parsed' : 'exact',
      rewards: rewards.unresolved.length || rewards.entries.some((entry) => entry.confidence === 'unresolved') ? 'unresolved' : 'parsed',
      overall: confidence,
    },
  }
}

function equipmentPredicateInExpression(node) {
  if (!node || typeof node !== 'object') return null
  if (node.op === 'predicate' && node.predicate?.kind === 'equipment') return node.predicate
  if (node.op === 'not') return equipmentPredicateInExpression(node.child)
  for (const child of node.children || []) {
    const result = equipmentPredicateInExpression(child)
    if (result) return result
  }
  return null
}

function equipmentSelectorKey(selector) {
  const masterIds = uniqueNumbers(selector?.masterIds || []).sort((left, right) => left - right)
  const type2Ids = uniqueNumbers(selector?.type2Ids || []).sort((left, right) => left - right)
  return `${masterIds.join(',')}|${type2Ids.join(',')}`
}

function reconcileLegacyDiscardObjectives(category, objectives, costs) {
  const discardCosts = costs.filter((cost) => cost.kind === 'equipment' && cost.operation === 'discard')
  if (category !== 'factory' || discardCosts.length === 0) return objectives
  const existing = objectives.filter((objective) => objective.event === 'destory_item')
  return discardCosts.map((cost, index) => {
    const costKey = equipmentSelectorKey(cost.selector)
    const exact = existing.find((objective) => {
      const predicateValue = equipmentPredicateInExpression(objective.constraints)
      return equipmentSelectorKey(predicateValue?.selector) === costKey && Number(objective.count?.required) === Number(cost.quantity)
    })
    const matched = exact || (existing.length === discardCosts.length ? existing[index] : null)
    const exactMapping = Boolean(exact)
    const constraintMeta = { confidence: cost.confidence, sourceRefs: cost.sourceRefs }
    const completionMeta = matched?.completion || constraintMeta
    const automatic = exactMapping && matched?.completion?.automatic === true
    return {
      id: `objective-discard-${index + 1}`,
      event: 'destory_item',
      label: cost.label,
      count: { required: Number(cost.quantity), initial: 0 },
      target: matched?.target || { mapIds: [], mapNodes: [], missionIds: [], enemyShipTypeIds: [], executionCounts: [] },
      constraints: predicate({
        kind: 'equipment', selector: cost.selector, quantity: Number(cost.quantity), operation: 'own',
      }, constraintMeta),
      completion: {
        logic: 'count',
        eventKey: matched?.completion?.eventKey || `destory_item@equipment-${costKey}`,
        automatic,
        ...(automatic ? {} : {
          reason: exactMapping
            ? matched?.completion?.reason || 'conditional-factory-event-mapping-not-verified'
            : 'poi-goal-selector-does-not-exactly-match-normalized-cost',
        }),
        confidence: completionMeta.confidence,
        sourceRefs: completionMeta.sourceRefs,
      },
      confidence: cost.confidence,
      sourceRefs: cost.sourceRefs,
    }
  })
}

function migrateQuest(quest, catalogs, resolvers) {
  const unresolved = []
  const migratedObjectives = (quest.requirements.objectives || []).map((objective, index) => migrateObjective(objective, quest, index, resolvers, unresolved))
  const costs = migrateCosts(quest, resolvers)
  const objectives = reconcileLegacyDiscardObjectives(quest.category, migratedObjectives, costs)
  const conditionConfidence = quest.requirements.confidence === 'exact' ? 'verified' : 'parsed'
  if (quest.requirements.confidence !== 'exact' && quest.requirements.raw) unresolved.push({
    kind: 'condition', raw: clean(quest.requirements.raw), reason: 'text-requires-human-verification',
    ...meta('kcQuests', 'requirements.raw', 'unresolved', quest.requirements.raw),
  })
  ;(quest.requirements.unparsed || []).forEach((raw, index) => unresolved.push({
    kind: 'condition', raw: clean(raw), reason: 'text-parser-did-not-map-clause',
    ...meta('kcQuests', `requirements.unparsed[${index}]`, 'unresolved', raw),
  }))
  if (quest.requirements.source === 'poi-goal') {
    Object.entries(quest.requirements.goal || {}).forEach(([key, value]) => {
      if (['type', 'fuzzy', 'resetInterval'].includes(key) || !value || typeof value !== 'object' || Array.isArray(value)) return
      Object.keys(value).filter((field) => !HANDLED_POI_CONDITION_FIELDS.has(field)).forEach((field) => unresolved.push({
        kind: 'condition', raw: JSON.stringify({ [field]: value[field] }), reason: 'poi-goal-field-not-modeled',
        ...meta('poi', `quest_goal.${quest.id}.${key}.${field}`, 'unresolved', JSON.stringify(value[field])),
      }))
    })
  }
  const dependencies = {
    questIds: (quest.prerequisites || []).map(Number),
    unresolved: (quest.unresolvedPrerequisites || []).map((code, index) => ({
      kind: 'dependency', code: clean(code), raw: clean(code), reason: 'prerequisite-code-not-in-local-catalog',
      ...meta('kcQuests', `prerequisites[${index}]`, 'unresolved', code),
    })),
  }
  const rewards = migrateRewards(quest, resolvers)
  const objectiveIds = objectives.map((objective) => objective.id)
  return {
    id: Number(quest.id), code: clean(quest.code), category: quest.category, repeat: quest.repeat,
    name: clean(quest.name), detail: clean(quest.detail), note: clean(quest.note), rewardText: clean(quest.rewards),
    prerequisites: dependencies.questIds, unresolvedPrerequisites: dependencies.unresolved.map((entry) => entry.code), dependencies,
    requirements: {
      conditions: expression('all', [], meta(quest.requirements.source === 'poi-goal' ? 'poi' : 'kcQuests', 'requirements.conditions', conditionConfidence)),
      objectives,
      completion: { logic: 'all', objectiveIds, ...meta(quest.requirements.source === 'poi-goal' ? 'poi' : 'kcQuests', 'requirements.completion', conditionConfidence) },
      costs, unresolved,
    },
    rewards,
    tracking: {
      poiGoal: quest.requirements.goal || {},
      sourceRefs: sourceRef(quest.requirements.source === 'poi-goal' ? 'poi' : 'kcQuests',
        quest.requirements.source === 'poi-goal' ? `quest_goal.${quest.id}` : 'requirements.goal'),
    },
    sources: Array.from(new Set([
      'kcQuests', 'poi', ...(quest.reward.confidence?.resources === 'exact' ? ['Kcanotify game data'] : []),
    ])),
    confidence: {
      conditions: conditionConfidence, objectives: conditionConfidence,
      costs: costs.length ? 'parsed' : 'exact',
      rewards: rewards.unresolved.length || rewards.entries.some((entry) => entry.confidence === 'unresolved') ? 'unresolved' : 'parsed',
      overall: unresolved.length || dependencies.unresolved.length || rewards.unresolved.length ? 'unresolved' : conditionConfidence,
    },
  }
}

function mergeOverride(base, override) {
  if (Array.isArray(override) || override == null || typeof override !== 'object') return override
  const result = { ...(base || {}) }
  Object.entries(override).forEach(([key, value]) => { result[key] = mergeOverride(result[key], value) })
  return result
}

function manualExpression(value, source, field, confidence = 'verified') {
  const metadata = meta(source, field, confidence, value?.raw)
  if (!value) return expression('all', [], metadata)
  if (value.op === 'predicate') return predicate(value.predicate, metadata)
  if (value.op === 'not') return { op: 'not', child: manualExpression(value.child, source, field, confidence), ...metadata }
  return {
    op: value.op,
    ...(value.count == null ? {} : { count: Number(value.count) }),
    children: (value.children || []).map((child, index) => manualExpression(child, source, `${field}.children[${index}]`, confidence)),
    ...metadata,
  }
}

function buildManualFactoryRequirements(manual) {
  const source = manual.source || '艦隊これくしょん -艦これ- 攻略 Wiki'
  const field = manual.field
  const conditions = manualExpression(manual.conditions, source, `${field}#conditions`)
  const costs = (manual.operations || []).map((operation, index) => ({
    id: operation.id || `cost-wiki-${index + 1}`,
    kind: operation.kind,
    ...(operation.resource ? { resource: operation.resource } : {}),
    ...(operation.useItemId != null ? { useItemId: Number(operation.useItemId) } : {}),
    ...(operation.selector ? { selector: operation.selector } : {}),
    quantity: Number(operation.quantity) || 1,
    operation: operation.operation,
    timing: operation.timing || (operation.operation === 'discard' ? 'operation' : 'quest-completion'),
    label: operation.label || '',
    ...(operation.state ? { state: operation.state } : {}),
    ...(operation.placement ? { placement: operation.placement } : {}),
    ...meta(source, `${field}#operations[${index}]`, 'verified', operation.raw),
  }))
  const discardOperations = costs.filter((cost) => cost.operation === 'discard')
  const objectives = discardOperations.map((cost, index) => {
    const selectorKey = (cost.selector?.masterIds || []).length
      ? `equipment-${cost.selector.masterIds.join('-')}`
      : `equipment-type-${(cost.selector?.type2Ids || []).join('-')}`
    return {
      id: `objective-wiki-${index + 1}`,
      event: 'destory_item',
      label: cost.label,
      count: { required: cost.quantity, initial: 0 },
      target: { mapIds: [], mapNodes: [], missionIds: [], enemyShipTypeIds: [], executionCounts: [] },
      constraints: predicate({
        kind: 'equipment', selector: cost.selector, quantity: cost.quantity, operation: 'own',
      }, meta(source, `${field}#objectives[${index}].constraints`, 'verified', cost.sourceRefs?.[0]?.raw)),
      completion: {
        logic: 'count', eventKey: `destory_item@${selectorKey}`, automatic: false,
        reason: 'conditional-factory-event-mapping-not-verified',
        ...meta(source, `${field}#objectives[${index}].completion`, 'verified'),
      },
      ...meta(source, `${field}#objectives[${index}]`, 'verified', cost.sourceRefs?.[0]?.raw),
    }
  })
  if (objectives.length === 0) {
    objectives.push({
      id: 'objective-wiki-1', event: 'factory_operation', label: manual.label || '工廠任務',
      count: { required: Number(manual.count) || 1, initial: 0 },
      target: { mapIds: [], mapNodes: [], missionIds: [], enemyShipTypeIds: [], executionCounts: [] },
      constraints: conditions,
      completion: {
        logic: 'count', eventKey: 'factory_operation', automatic: false,
        reason: 'conditional-factory-event-mapping-not-verified',
        ...meta(source, `${field}#objectives[0].completion`, 'verified'),
      },
      ...meta(source, `${field}#objectives[0]`, 'verified', manual.raw),
    })
  }
  return {
    conditions,
    objectives,
    completion: {
      logic: 'all', objectiveIds: objectives.map((objective) => objective.id),
      ...meta(source, `${field}#completion`, 'verified'),
    },
    costs,
    unresolved: [],
  }
}

function buildManualSortieRequirements(manual) {
  const source = manual.source || '艦隊これくしょん -艦これ- 攻略 Wiki'
  const field = manual.field
  const confidence = manual.confidence || 'verified'
  const conditions = manualExpression(manual.conditions, source, `${field}#conditions`, confidence)
  const objectiveSpecs = manual.objectives || (manual.mapIds || []).map((mapId) => ({
    event: manual.event, mapId, label: `${Math.floor(Number(mapId) / 10)}-${Number(mapId) % 10}`,
    count: manual.count, raw: `${Math.floor(Number(mapId) / 10)}-${Number(mapId) % 10}`,
  }))
  const objectives = objectiveSpecs.map((objective, index) => ({
    id: objective.id || `objective-wiki-${index + 1}`,
    event: objective.event,
    label: objective.label,
    count: { required: Number(objective.count) || 1, initial: 0 },
    target: {
      mapIds: objective.mapId == null ? [] : [Number(objective.mapId)],
      mapNodes: objective.mapNodes || [], missionIds: [], enemyShipTypeIds: [], executionCounts: [],
    },
    constraints: conditions,
    completion: {
      logic: 'count', eventKey: `${objective.event}@${objective.label}`, automatic: false,
      reason: 'wiki-rule-has-no-verified-poi-event-mapping',
      ...meta(source, `${field}#objectives[${index}].completion`, objective.confidence || manual.objectiveConfidence || confidence),
    },
    ...meta(source, `${field}#objectives[${index}]`, objective.confidence || manual.objectiveConfidence || confidence, objective.raw),
  }))
  const costs = (manual.costs || []).map((cost, index) => ({
    id: cost.id || `cost-wiki-${index + 1}`,
    kind: cost.kind,
    ...(cost.resource ? { resource: cost.resource } : {}),
    ...(cost.useItemId != null ? { useItemId: Number(cost.useItemId) } : {}),
    ...(cost.selector ? { selector: cost.selector } : {}),
    quantity: Number(cost.quantity) || 1,
    operation: cost.operation || 'consume',
    timing: cost.timing || 'quest-completion',
    label: cost.label || '',
    ...(cost.state ? { state: cost.state } : {}),
    ...(cost.placement ? { placement: cost.placement } : {}),
    ...meta(source, `${field}#costs[${index}]`, cost.confidence || confidence, cost.raw),
  }))
  const unresolved = (manual.unresolved || []).map((entry, index) => ({
    kind: entry.kind || 'condition',
    raw: entry.raw,
    reason: entry.reason,
    ...meta(source, `${field}#unresolved[${index}]`, 'unresolved', entry.raw),
  }))
  return {
    conditions, objectives,
    completion: {
      logic: 'all', objectiveIds: objectives.map((objective) => objective.id),
      ...meta(source, `${field}#completion`, manual.completionConfidence || manual.objectiveConfidence || confidence),
    },
    costs, unresolved,
  }
}

function applyOverrides(quests, overrides = {}) {
  const byId = new Map((overrides.quests || []).map((entry) => [Number(entry.id), entry]))
  return quests.map((quest) => {
    const override = byId.get(quest.id)
    if (!override) return quest
    const merged = mergeOverride(quest, override)
    const objectiveOverrides = override.requirements?.objectiveOverrides || {}
    const rewardOverrides = override.rewardOverrides || {}
    delete merged.rewardOverrides
    if (override.requirements?.manualFactory) {
      merged.requirements = buildManualFactoryRequirements(override.requirements.manualFactory)
    } else if (override.requirements?.manualSortie) {
      merged.requirements = buildManualSortieRequirements(override.requirements.manualSortie)
    }
    if (merged.requirements) {
      delete merged.requirements.objectiveOverrides
      merged.requirements.objectives = (merged.requirements.objectives || []).map((objective) => {
        const objectiveOverride = objectiveOverrides[objective.id]
        if (!objectiveOverride) return objective
        const patched = mergeOverride(objective, objectiveOverride)
        if (objectiveOverride.constraints === '$conditions') patched.constraints = merged.requirements.conditions
        return patched
      })
    }
    if (merged.rewards) {
      const entryOverrides = rewardOverrides.entryOverrides || {}
      const removeEntryIds = new Set(rewardOverrides.removeEntryIds || [])
      merged.rewards.entries = (merged.rewards.entries || []).filter((entry) => !removeEntryIds.has(entry.id)).map((entry) =>
        entryOverrides[entry.id] ? mergeOverride(entry, entryOverrides[entry.id]) : entry)
      merged.rewards.entries.push(...(rewardOverrides.additionalEntries || []))
      const choiceOverrides = rewardOverrides.choiceOverrides || {}
      merged.rewards.choices = (merged.rewards.choices || []).map((choice) =>
        choiceOverrides[choice.id] ? mergeOverride(choice, choiceOverrides[choice.id]) : choice)
      merged.rewards.choices.push(...(rewardOverrides.additionalChoices || []))
      if (rewardOverrides.unresolved) merged.rewards.unresolved = rewardOverrides.unresolved
    }
    return merged
  })
}

function isLimitedQuestCode(code) {
  return /^\d{4}[A-Z]/i.test(clean(code))
}

function ignoreLimitedPrerequisites(quests) {
  const byId = new Map(quests.map((quest) => [Number(quest.id), quest]))
  return quests.map((quest) => {
    const ignored = [...(quest.dependencies?.ignored || [])]
    const questIds = []
    ;(quest.dependencies?.questIds || []).forEach((id) => {
      const parent = byId.get(Number(id))
      if (!parent || !isLimitedQuestCode(parent.code)) {
        questIds.push(Number(id))
        return
      }
      ignored.push({
        kind: 'dependency', code: parent.code, questId: Number(id), label: parent.name,
        raw: parent.code, reason: 'limited-prerequisite-ignored-for-inference',
        ...meta(
          quest.sources.includes('kcwiki quest data') ? 'kcwiki quest data' : 'kcQuests',
          quest.sources.includes('kcwiki quest data')
            ? `data/${quest.id}.json#prerequisite`
            : 'prerequisites',
          'parsed', parent.code,
        ),
      })
    })
    const unresolved = []
    ;(quest.dependencies?.unresolved || []).forEach((entry) => {
      if (!isLimitedQuestCode(entry.code)) {
        unresolved.push(entry)
        return
      }
      ignored.push({
        ...entry,
        reason: 'limited-prerequisite-ignored-for-inference',
      })
    })
    return {
      ...quest,
      prerequisites: questIds,
      unresolvedPrerequisites: unresolved.map((entry) => entry.code),
      dependencies: { ...quest.dependencies, questIds, unresolved, ignored },
    }
  })
}

function ensureReferencedCatalogEntries(v3, catalogs) {
  const typeIds = new Set(catalogs.shipTypes.map((entry) => Number(entry.id)))
  const classIds = new Set(catalogs.shipClasses.map((entry) => Number(entry.id)))
  const mapIds = new Set(catalogs.maps.map((entry) => Number(entry.id)))
  const equipmentTypeIds = new Set(catalogs.equipmentTypes.map((entry) => Number(entry.id)))
  catalogs.ships.forEach((ship) => {
    typeIds.add(Number(ship.typeId))
    classIds.add(Number(ship.classId))
  })
  catalogs.equipment.forEach((entry) => equipmentTypeIds.add(Number(entry.type2Id)))
  v3.quests.forEach((quest) => {
    ;(quest.requirements?.objectives || []).forEach((objective) => {
      const fleet = objective.fleet || {}
      ;[...(fleet.flagshipTypes || []), ...(fleet.forbiddenTypes || [])].forEach((id) => typeIds.add(Number(id)))
      ;(fleet.memberTypes || []).forEach((entry) => (entry?.[0] || []).forEach((id) => typeIds.add(Number(id))))
      ;(objective.enemyShipTypes || []).forEach((id) => typeIds.add(Number(id)))
      ;(objective.materialShips?.types || []).forEach((id) => typeIds.add(Number(id)))
      ;[...(fleet.flagshipClasses || []), ...(fleet.secondShipClasses || [])].forEach((id) => classIds.add(Number(id)))
      ;(fleet.memberClasses || []).forEach((entry) => (entry?.[0] || []).forEach((id) => classIds.add(Number(id))))
      ;(objective.maps || []).forEach((entry) => mapIds.add(Number(entry.id)))
      ;(objective.equipment?.types || []).forEach((entry) => {
        const values = Array.isArray(entry?.typeIds) ? entry.typeIds : [entry]
        values.forEach((id) => equipmentTypeIds.add(Number(id)))
      })
    })
  })
  typeIds.forEach((id) => {
    if (Number.isFinite(id) && !catalogs.shipTypes.some((entry) => entry.id === id)) catalogs.shipTypes.push({ id, names: {}, aliases: [], confidence: 'unresolved' })
  })
  classIds.forEach((id) => {
    if (Number.isFinite(id) && !catalogs.shipClasses.some((entry) => entry.id === id)) catalogs.shipClasses.push({ id, shipTypeId: null, names: {}, aliases: [], confidence: 'unresolved' })
  })
  mapIds.forEach((id) => {
    if (Number.isFinite(id) && !catalogs.maps.some((entry) => entry.id === id)) catalogs.maps.push({ id, code: `${Math.floor(id / 10)}-${id % 10}` })
  })
  equipmentTypeIds.forEach((id) => {
    if (Number.isFinite(id) && !catalogs.equipmentTypes.some((entry) => entry.id === id)) catalogs.equipmentTypes.push({ id, names: {}, aliases: [], confidence: 'unresolved' })
  })
  catalogs.shipTypes.sort((a, b) => a.id - b.id)
  catalogs.shipClasses.sort((a, b) => a.id - b.id)
  catalogs.maps.sort((a, b) => a.id - b.id)
  catalogs.equipmentTypes.sort((a, b) => a.id - b.id)
}

function migrateData(v3, options = {}) {
  const catalogs = options.catalogs || buildCatalogs(options)
  ensureReferencedCatalogEntries(v3, catalogs)
  const resolvers = catalogResolvers(catalogs)
  const questIds = new Set(v3.quests.map((quest) => Number(quest.id)))
  const kcwikiQuests = options.kcwikiQuests instanceof Map
    ? options.kcwikiQuests
    : new Map((options.kcwikiQuests || []).map((quest) => [Number(quest.game_id), quest]))
  const quests = ignoreLimitedPrerequisites(applyOverrides(v3.quests.map((quest) => applyKcwikiQuest(
    migrateQuest(quest, catalogs, resolvers), kcwikiQuests.get(Number(quest.id)), resolvers, questIds,
  )), options.overrides))
  return { schemaVersion: 4, generatedAt: v3.generatedAt, sources: v3.sources, catalogVersion: 2, catalogs, quests }
}

function validateData(data) {
  const errors = []
  const fail = (pathName, message) => errors.push(`${pathName}: ${message}`)
  if (data?.schemaVersion !== 4) fail('schemaVersion', 'must equal 4')
  if (!Array.isArray(data?.quests)) fail('quests', 'must be an array')
  if (!Array.isArray(data?.sources) || data.sources.some((entry) => !entry.name || !entry.role)) fail('sources', 'invalid source catalog')
  const sourceNames = new Set((data.sources || []).map((entry) => entry.name))
  const questIds = new Set((data.quests || []).map((quest) => Number(quest.id)))
  const catalogSets = {
    ship: new Set((data.catalogs?.ships || []).map((entry) => Number(entry.masterId))),
    shipGroup: new Set((data.catalogs?.shipGroups || []).map((entry) => String(entry.id))),
    family: new Set((data.catalogs?.ships || []).map((entry) => Number(entry.familyId))),
    type: new Set((data.catalogs?.shipTypes || []).map((entry) => Number(entry.id))),
    class: new Set((data.catalogs?.shipClasses || []).map((entry) => Number(entry.id))),
    equipment: new Set((data.catalogs?.equipment || []).map((entry) => Number(entry.masterId))),
    equipmentType: new Set((data.catalogs?.equipmentTypes || []).map((entry) => Number(entry.id))),
    useItem: new Set((data.catalogs?.useItems || []).map((entry) => Number(entry.id))),
    map: new Set((data.catalogs?.maps || []).map((entry) => Number(entry.id))),
    mission: new Set((data.catalogs?.missions || []).map((entry) => String(entry.id))),
  }
  ;[
    ['ships', 'masterId'], ['shipGroups', 'id'], ['shipTypes', 'id'], ['shipClasses', 'id'], ['equipment', 'masterId'],
    ['equipmentTypes', 'id'], ['useItems', 'id'], ['maps', 'id'], ['missions', 'id'],
  ].forEach(([name, idField]) => {
    const seen = new Set()
    ;(data.catalogs?.[name] || []).forEach((entry) => {
      const id = String(entry[idField])
      if (seen.has(id)) fail(`catalogs.${name}`, `duplicate id ${id}`)
      seen.add(id)
    })
  })
  ;(data.catalogs?.ships || []).forEach((ship) => {
    if (!catalogSets.type.has(Number(ship.typeId))) fail(`catalogs.ships.${ship.masterId}`, `invalid typeId ${ship.typeId}`)
    if (!catalogSets.class.has(Number(ship.classId))) fail(`catalogs.ships.${ship.masterId}`, `invalid classId ${ship.classId}`)
    if (ship.predecessorId != null && !catalogSets.ship.has(Number(ship.predecessorId))) fail(`catalogs.ships.${ship.masterId}`, 'invalid predecessorId')
    ;(ship.successorIds || []).forEach((id) => { if (!catalogSets.ship.has(Number(id))) fail(`catalogs.ships.${ship.masterId}`, `invalid successorId ${id}`) })
    const visited = new Set()
    let current = ship
    while (current?.predecessorId != null) {
      if (visited.has(current.masterId)) { fail(`catalogs.ships.${ship.masterId}`, 'remodel chain contains a cycle'); break }
      visited.add(current.masterId)
      current = data.catalogs.ships.find((entry) => Number(entry.masterId) === Number(current.predecessorId))
    }
  })
  ;(data.catalogs?.shipGroups || []).forEach((group) => {
    if (!Array.isArray(group.memberMasterIds) || group.memberMasterIds.length === 0) fail(`catalogs.shipGroups.${group.id}`, 'empty ship group')
    if (group.unresolvedNames?.length) fail(`catalogs.shipGroups.${group.id}`, `unresolved ship names ${group.unresolvedNames.join(', ')}`)
    ;(group.memberMasterIds || []).forEach((id) => {
      if (!catalogSets.ship.has(Number(id))) fail(`catalogs.shipGroups.${group.id}`, `invalid ship ${id}`)
    })
  })
  ;(data.catalogs?.shipClasses || []).forEach((entry) => {
    if (entry.shipTypeId != null && !catalogSets.type.has(Number(entry.shipTypeId))) fail(`catalogs.shipClasses.${entry.id}`, `invalid shipTypeId ${entry.shipTypeId}`)
  })
  ;(data.catalogs?.equipment || []).forEach((entry) => {
    if (entry.type2Id != null && !catalogSets.equipmentType.has(Number(entry.type2Id))) fail(`catalogs.equipment.${entry.masterId}`, `invalid type2Id ${entry.type2Id}`)
  })
  function validateMeta(value, pathName) {
    if (!CONFIDENCE.has(value?.confidence)) fail(pathName, 'invalid or missing confidence')
    if (!Array.isArray(value?.sourceRefs) || value.sourceRefs.length === 0 || value.sourceRefs.some((entry) => !entry.source || !entry.field)) fail(pathName, 'missing sourceRefs')
    ;(value?.sourceRefs || []).forEach((entry) => { if (!sourceNames.has(entry.source)) fail(pathName, `unknown source ${entry.source}`) })
  }
  function validateSelector(selector, pathName) {
    ;(selector?.masterIds || []).forEach((id) => { if (!catalogSets.ship.has(Number(id))) fail(pathName, `invalid ship ${id}`) })
    ;(selector?.groupIds || []).forEach((id) => { if (!catalogSets.shipGroup.has(String(id))) fail(pathName, `invalid ship group ${id}`) })
    ;(selector?.familyIds || []).forEach((id) => { if (!catalogSets.family.has(Number(id))) fail(pathName, `invalid ship family ${id}`) })
    ;(selector?.typeIds || []).forEach((id) => { if (!catalogSets.type.has(Number(id))) fail(pathName, `invalid ship type ${id}`) })
    ;(selector?.classIds || []).forEach((id) => { if (!catalogSets.class.has(Number(id))) fail(pathName, `invalid ship class ${id}`) })
    ;(selector?.remodel?.exactMasterIds || []).forEach((id) => { if (!catalogSets.ship.has(Number(id))) fail(pathName, `invalid exact remodel ${id}`) })
    ;(selector?.remodel?.allowedMasterIds || []).forEach((id) => { if (!catalogSets.ship.has(Number(id))) fail(pathName, `invalid allowed remodel ${id}`) })
    if (selector?.remodel?.minimumStage != null && !(Number(selector.remodel.minimumStage) >= 0)) fail(pathName, 'invalid minimum remodel stage')
    if (selector?.remodel?.beforeStage != null && !(Number(selector.remodel.beforeStage) >= 0)) fail(pathName, 'invalid before remodel stage')
    if (selector?.level?.min != null && !(Number(selector.level.min) >= 1)) fail(pathName, 'invalid minimum ship level')
    if (selector?.level?.max != null && Number(selector.level.max) < Number(selector.level.min || 1)) fail(pathName, 'invalid maximum ship level')
    if (selector?.speed?.min != null && !(Number(selector.speed.min) >= 0)) fail(pathName, 'invalid minimum ship speed')
    if (selector?.speed?.exact != null && !(Number(selector.speed.exact) >= 0)) fail(pathName, 'invalid exact ship speed')
  }
  function validateExpression(node, pathName) {
    validateMeta(node, pathName)
    if (!EXPRESSION_OPERATORS.has(node?.op)) { fail(pathName, 'invalid condition operator'); return }
    if (node.op === 'not') validateExpression(node.child, `${pathName}.child`)
    if (['all', 'any', 'atLeast'].includes(node.op)) {
      if (!Array.isArray(node.children)) fail(pathName, 'children must be an array')
      else node.children.forEach((child, index) => validateExpression(child, `${pathName}.children[${index}]`))
      if (node.op === 'atLeast' && !(Number(node.count) > 0)) fail(pathName, 'atLeast count must be positive')
    }
    if (node.op !== 'predicate') return
    const predicateValue = node.predicate || {}
    if (!PREDICATE_KINDS.has(predicateValue.kind)) fail(pathName, `invalid predicate kind ${predicateValue.kind}`)
    if (predicateValue.kind === 'fleet') {
      ;(predicateValue.positions || []).forEach((entry, index) => {
        if (!['flagship', 'second', 'escort'].includes(entry.role)) fail(pathName, `invalid fleet role ${entry.role}`)
        validateSelector(entry.selector, `${pathName}.positions[${index}]`)
      })
      ;(predicateValue.groups || []).forEach((entry, index) => {
        if (!(Number(entry.min) >= 0) || (entry.max != null && Number(entry.max) < Number(entry.min))) fail(pathName, 'invalid fleet group bounds')
        if (entry.distinctBy && !['master', 'family'].includes(entry.distinctBy)) fail(pathName, `invalid fleet distinctBy ${entry.distinctBy}`)
        validateSelector(entry.selector, `${pathName}.groups[${index}]`)
      })
      ;(predicateValue.forbidden || []).forEach((entry, index) => validateSelector(entry, `${pathName}.forbidden[${index}]`))
    } else if (predicateValue.kind === 'equipment') {
      ;(predicateValue.selector?.masterIds || []).forEach((id) => { if (!catalogSets.equipment.has(Number(id))) fail(pathName, `invalid equipment ${id}`) })
      ;(predicateValue.selector?.type2Ids || []).forEach((id) => { if (!catalogSets.equipmentType.has(Number(id))) fail(pathName, `invalid equipment type ${id}`) })
      if (predicateValue.placement?.shipSelector) validateSelector(predicateValue.placement.shipSelector, `${pathName}.placement.shipSelector`)
      if (predicateValue.quantity != null && !(Number(predicateValue.quantity) > 0)) fail(pathName, 'equipment quantity must be positive')
      if (predicateValue.state?.locked != null && typeof predicateValue.state.locked !== 'boolean') fail(pathName, 'equipment locked must be boolean')
      ;['improvement', 'proficiency'].forEach((stateKey) => {
        const state = predicateValue.state?.[stateKey]
        if (state?.min != null && !(Number(state.min) >= 0)) fail(pathName, `invalid ${stateKey} minimum`)
        if (state?.exact != null && !(Number(state.exact) >= 0)) fail(pathName, `invalid ${stateKey} exact value`)
      })
      if (predicateValue.placement?.role && !['ship', 'flagship', 'secretary'].includes(predicateValue.placement.role)) fail(pathName, `invalid equipment placement role ${predicateValue.placement.role}`)
      if (predicateValue.placement?.location && predicateValue.placement.location !== 'not-airbase') fail(pathName, `invalid equipment placement location ${predicateValue.placement.location}`)
      if (predicateValue.placement?.slotIndex != null && !(Number.isInteger(Number(predicateValue.placement.slotIndex)) && Number(predicateValue.placement.slotIndex) >= 0)) fail(pathName, 'invalid equipment slot index')
      if (predicateValue.operation && !COST_OPERATIONS.has(predicateValue.operation)) fail(pathName, `invalid equipment operation ${predicateValue.operation}`)
    } else if (predicateValue.kind === 'use-item' && !catalogSets.useItem.has(Number(predicateValue.useItemId))) fail(pathName, `invalid use item ${predicateValue.useItemId}`)
    else if (predicateValue.kind === 'map') (predicateValue.mapIds || []).forEach((id) => { if (!catalogSets.map.has(Number(id))) fail(pathName, `invalid map ${id}`) })
  }
  function discardProgressKey(selector, quantity) {
    const masterIds = uniqueNumbers(selector?.masterIds || []).sort((left, right) => left - right)
    const type2Ids = uniqueNumbers(selector?.type2Ids || []).sort((left, right) => left - right)
    return `${masterIds.join(',')}|${type2Ids.join(',')}|${Number(quantity) || 1}`
  }
  ;(data.quests || []).forEach((quest, questIndex) => {
    const qpath = `quests[${questIndex}]`
    if (!quest.code || typeof quest.name !== 'string' || typeof quest.detail !== 'string' || typeof quest.rewardText !== 'string') fail(qpath, 'missing identity or original text fields')
    ;['conditions', 'objectives', 'completion', 'costs', 'unresolved'].forEach((key) => { if (quest.requirements?.[key] == null) fail(`${qpath}.requirements`, `missing ${key}`) })
    ;['entries', 'choices', 'unresolved'].forEach((key) => { if (!Array.isArray(quest.rewards?.[key])) fail(`${qpath}.rewards`, `missing ${key}`) })
    if (!Array.isArray(quest.sources) || !quest.confidence) fail(qpath, 'missing sources or confidence')
    validateExpression(quest.requirements?.conditions, `${qpath}.requirements.conditions`)
    const objectiveIds = new Set((quest.requirements?.objectives || []).map((entry) => entry.id))
    ;(quest.requirements?.objectives || []).forEach((objective, index) => {
      validateMeta(objective, `${qpath}.requirements.objectives[${index}]`)
      validateExpression(objective.constraints, `${qpath}.requirements.objectives[${index}].constraints`)
      validateMeta(objective.completion, `${qpath}.requirements.objectives[${index}].completion`)
      ;(objective.target?.mapIds || []).forEach((id) => { if (!catalogSets.map.has(Number(id))) fail(qpath, `invalid objective map ${id}`) })
      ;(objective.target?.missionIds || []).forEach((id) => { if (!catalogSets.mission.has(String(id))) fail(qpath, `invalid objective mission ${id}`) })
      ;(objective.target?.enemyShipTypeIds || []).forEach((id) => { if (!catalogSets.type.has(Number(id))) fail(qpath, `invalid enemy ship type ${id}`) })
      ;(objective.target?.executionCounts || []).forEach((count) => { if (!(Number(count) >= 0)) fail(qpath, `invalid execution count ${count}`) })
      if (typeof objective.completion?.automatic !== 'boolean') fail(qpath, `objective ${objective.id} missing automatic flag`)
      if (objective.completion?.automatic === false && !objective.completion.reason) fail(qpath, `objective ${objective.id} missing non-automatic reason`)
      if (objective.event === 'destory_item') {
        const label = clean(objective.label)
        if (!label || label.length > 48 || /<br|[。！※]|^(?:废弃|廃棄)(?:\s|$|[-:：])/.test(label)) {
          fail(qpath, `invalid discard progress label ${objective.id}`)
        }
      }
    })
    validateMeta(quest.requirements?.completion, `${qpath}.requirements.completion`)
    if (!['all', 'any', 'sequence'].includes(quest.requirements?.completion?.logic)) fail(qpath, 'invalid completion logic')
    ;(quest.requirements?.completion?.objectiveIds || []).forEach((id) => { if (!objectiveIds.has(id)) fail(qpath, `invalid objective reference ${id}`) })
    ;(quest.requirements?.completion?.stages || []).flat().forEach((id) => { if (!objectiveIds.has(id)) fail(qpath, `invalid completion stage reference ${id}`) })
    ;(quest.requirements?.costs || []).forEach((cost, index) => {
      validateMeta(cost, `${qpath}.requirements.costs[${index}]`)
      if (!COST_KINDS.has(cost.kind)) fail(qpath, `invalid cost kind ${cost.kind}`)
      if (!(Number(cost.quantity) > 0)) fail(qpath, `cost ${cost.id} quantity must be positive`)
      if (!COST_OPERATIONS.has(cost.operation) || !COST_TIMINGS.has(cost.timing)) fail(qpath, `invalid cost operation or timing ${cost.id}`)
      if (cost.operation === 'discard' && cost.timing !== 'operation') fail(qpath, `discard cost ${cost.id} must use operation timing`)
      if (cost.kind === 'equipment') {
        ;(cost.selector?.masterIds || []).forEach((id) => { if (!catalogSets.equipment.has(Number(id))) fail(qpath, `invalid cost equipment ${id}`) })
        ;(cost.selector?.type2Ids || []).forEach((id) => { if (!catalogSets.equipmentType.has(Number(id))) fail(qpath, `invalid cost equipment type ${id}`) })
        if (cost.placement?.shipSelector) validateSelector(cost.placement.shipSelector, `${qpath}.requirements.costs[${index}].placement.shipSelector`)
        if (cost.placement?.role && !['ship', 'flagship', 'secretary'].includes(cost.placement.role)) fail(qpath, `invalid cost equipment role ${cost.placement.role}`)
        if (cost.placement?.location && cost.placement.location !== 'not-airbase') fail(qpath, `invalid cost equipment location ${cost.placement.location}`)
        if (cost.placement?.slotIndex != null && !(Number.isInteger(Number(cost.placement.slotIndex)) && Number(cost.placement.slotIndex) >= 0)) fail(qpath, `invalid cost equipment slot ${cost.placement.slotIndex}`)
        if (cost.state?.locked != null && typeof cost.state.locked !== 'boolean') fail(qpath, `invalid cost equipment locked state ${cost.id}`)
        ;['improvement', 'proficiency'].forEach((stateKey) => {
          const state = cost.state?.[stateKey]
          if (state?.min != null && !(Number(state.min) >= 0)) fail(qpath, `invalid cost ${stateKey} minimum ${cost.id}`)
          if (state?.exact != null && !(Number(state.exact) >= 0)) fail(qpath, `invalid cost ${stateKey} exact value ${cost.id}`)
        })
      }
      if (cost.kind === 'use-item' && !catalogSets.useItem.has(Number(cost.useItemId))) fail(qpath, `invalid cost use item ${cost.useItemId}`)
      if (cost.kind === 'resource' && !RESOURCE_KEYS.includes(cost.resource)) fail(qpath, `invalid resource ${cost.resource}`)
      if (cost.kind === 'ship') validateSelector(cost.selector, `${qpath}.requirements.costs[${index}].selector`)
      if (cost.kind === 'other' && (!cost.raw || !cost.reason || cost.confidence !== 'unresolved')) fail(qpath, `unresolved cost ${cost.id} needs raw and reason`)
    })
    const discardCosts = (quest.requirements?.costs || []).filter((cost) => cost.kind === 'equipment' && cost.operation === 'discard')
    if (discardCosts.length) {
      const discardObjectives = (quest.requirements?.objectives || []).filter((objective) => objective.event === 'destory_item')
      if (discardObjectives.length !== discardCosts.length) fail(qpath, 'discard progress objective count does not match costs')
      const expected = discardCosts.map((cost) => discardProgressKey(cost.selector, cost.quantity)).sort()
      const actual = discardObjectives.map((objective) => {
        const predicateValue = equipmentPredicateInExpression(objective.constraints)
        if (!predicateValue) {
          fail(qpath, `discard progress objective ${objective.id} lacks equipment selector`)
          return ''
        }
        return discardProgressKey(predicateValue.selector, objective.count?.required)
      }).sort()
      if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(qpath, 'discard progress selectors or quantities do not match costs')
    }
    ;(quest.requirements?.unresolved || []).forEach((entry, index) => {
      validateMeta(entry, `${qpath}.requirements.unresolved[${index}]`)
      if (!entry.raw || !entry.reason) fail(qpath, 'unresolved requirement needs raw and reason')
    })
    ;(quest.dependencies?.questIds || []).forEach((id) => { if (!questIds.has(Number(id))) fail(qpath, `invalid prerequisite ${id}`) })
    ;(quest.dependencies?.unresolved || []).forEach((entry, index) => {
      validateMeta(entry, `${qpath}.dependencies.unresolved[${index}]`)
      if (!entry.code || !entry.raw || !entry.reason) fail(qpath, 'invalid unresolved dependency')
    })
    ;(quest.dependencies?.ignored || []).forEach((entry, index) => {
      validateMeta(entry, `${qpath}.dependencies.ignored[${index}]`)
      if (!entry.code || !entry.raw || entry.reason !== 'limited-prerequisite-ignored-for-inference') {
        fail(qpath, 'invalid ignored dependency')
      }
      if (entry.questId != null && !questIds.has(Number(entry.questId))) fail(qpath, `invalid ignored prerequisite ${entry.questId}`)
    })
    const rewardIds = new Set()
    ;(quest.rewards?.entries || []).forEach((entry, index) => {
      validateMeta(entry, `${qpath}.rewards.entries[${index}]`)
      if (!REWARD_KINDS.has(entry.kind)) fail(qpath, `invalid reward kind ${entry.kind}`)
      if (!(Number(entry.quantity) > 0)) fail(qpath, `reward ${entry.id} quantity must be positive`)
      if (rewardIds.has(entry.id)) fail(qpath, `duplicate reward id ${entry.id}`)
      rewardIds.add(entry.id)
      if (entry.kind === 'equipment' && !catalogSets.equipment.has(Number(entry.equipmentId))) fail(qpath, `invalid reward equipment ${entry.equipmentId}`)
      if (entry.kind === 'ship' && !catalogSets.ship.has(Number(entry.shipId))) fail(qpath, `invalid reward ship ${entry.shipId}`)
      if (entry.kind === 'use-item' && !catalogSets.useItem.has(Number(entry.useItemId))) fail(qpath, `invalid reward use item ${entry.useItemId}`)
      if (entry.kind === 'equipment' && entry.improvement != null && !(Number(entry.improvement) >= 0)) fail(qpath, `invalid reward improvement ${entry.improvement}`)
    })
    ;(quest.rewards?.choices || []).forEach((choice, index) => {
      validateMeta(choice, `${qpath}.rewards.choices[${index}]`)
      ;(choice.entryIds || []).forEach((id) => { if (!rewardIds.has(id)) fail(qpath, `choice references missing reward ${id}`) })
      if (choice.valid && (!(choice.choose > 0) || choice.entryIds.length < choice.choose)) fail(qpath, `invalid choice ${choice.id}`)
      if (!choice.valid && !quest.rewards.unresolved.some((entry) => entry.choiceId === choice.id)) fail(qpath, `invalid choice ${choice.id} lacks unresolved record`)
    })
    ;(quest.rewards?.unresolved || []).forEach((entry, index) => {
      validateMeta(entry, `${qpath}.rewards.unresolved[${index}]`)
      if (!entry.raw || !entry.reason) fail(qpath, 'unresolved reward needs raw and reason')
    })
    ;(quest.sources || []).forEach((source) => { if (!sourceNames.has(source)) fail(qpath, `unknown quest source ${source}`) })
    Object.entries(quest.confidence || {}).forEach(([key, value]) => { if (!CONFIDENCE.has(value)) fail(`${qpath}.confidence.${key}`, 'invalid confidence') })
  })
  return errors
}

function coverage(data, errors = validateData(data)) {
  const confidence = { exact: 0, verified: 0, parsed: 0, unresolved: 0 }
  const questConfidence = { exact: 0, verified: 0, parsed: 0, unresolved: 0 }
  function visit(value) {
    if (!value || typeof value !== 'object') return
    if (CONFIDENCE.has(value.confidence)) confidence[value.confidence] += 1
    Object.values(value).forEach(visit)
  }
  visit(data.quests)
  data.quests.forEach((quest) => { questConfidence[quest.confidence.overall] += 1 })
  return {
    quests: data.quests.length, confidence, questConfidence,
    unresolvedConditions: data.quests.reduce((sum, quest) => sum + quest.requirements.unresolved.length, 0),
    invalidEntityReferences: errors.filter((error) => /invalid (?:ship|equipment|use item|map|objective mission|cost equipment|reward)/.test(error)).length,
    rewardChoiceConflicts: data.quests.reduce((sum, quest) => sum + quest.rewards.unresolved.filter((entry) => entry.kind === 'reward-choice').length, 0),
    unresolvedRewards: data.quests.reduce((sum, quest) => sum + quest.rewards.unresolved.length +
      quest.rewards.entries.filter((entry) => entry.confidence === 'unresolved').length, 0),
    discardProgressConflicts: errors.filter((error) => /discard (?:progress|cost)/.test(error)).length,
    missingPrerequisites: new Set(data.quests.flatMap((quest) => quest.dependencies.unresolved.map((entry) => entry.code))).size,
    ignoredLimitedPrerequisites: new Set(data.quests.flatMap((quest) => (quest.dependencies.ignored || []).map((entry) => entry.code))).size,
    validationErrors: errors.length,
  }
}

module.exports = {
  CONFIDENCE, DEFAULT_WCTF_DB, EXPRESSION_OPERATORS, applyKcwikiQuest, applyOverrides, buildCatalogs, catalogResolvers,
  convertKcwikiRequirement, coverage, ensureReferencedCatalogEntries, mergeOverride, migrateData, normalizedName, readNedb, validateData,
  ignoreLimitedPrerequisites, isLimitedQuestCode,
}
