# poi-plugin-quest-planner

poi 任务检索、依赖关系、进度与待做管理插件。

## 功能

- 搜索任务名、细节、要求与奖励，支持高级分栏搜索和布尔运算，以及类型、完成度、刷新周期常驻多选筛选
- 当前任务与进度同步
- 全任务前置、后续依赖图
- 默认按未解锁、已解锁、已完成、未知显示，可切换细分状态
- 分账号待做状态
- 基于 poi 舰船、装备和海图数据的条件检查
- 详情按前提 A、前提 B、前提 C、完成进度分组显示逐项状态
- 每项完成进度下提示可同时完成的出击、演习、远征与工厂任务；日常和周常不参与推荐，远征提示包含序号
- 推荐 badge 会在窄栏中换行，按季常/年常、已解锁、未解锁排序，并可点击跳转或悬停查看完整任务资料
- 可在工具栏管理持久化的隐藏任务；隐藏任务及其未解锁后续任务从列表、依赖图、关系和推荐中排除
- 离线结构化任务目标、地图、远征、次数、舰队条件与消耗
- 离线结构化基础资源、资材、装备、强化值与选择组奖励

## schemaVersion 4 数据

运行时只读取生成后的 `data/quests.json` 和 poi 游戏状态，不访问上游网站，也不启动额外服务。`data/quests.json` 是生成产物，不直接手工修改；结构说明见 `data/schema-v4.json`，人工修正写入 `data/overrides/quests.json`。

每条任务由以下独立部分组成：

- `dependencies`：可解析前置任务 ID、保留原文/原因的缺失前置，以及仅作备注的限时前置。限时任务作为前置时写入 `ignored`，不参与状态推断或依赖图。
- `requirements.conditions`：全局条件 AST，支持 `all`、`any`、`atLeast`、`not` 和 `predicate`。
- `requirements.objectives`：有独立 ID 的计数目标、目标地图/远征、编成或装备约束和事件映射。
- `requirements.completion`：引用 objective ID 的完成逻辑。
- `requirements.costs`：资源、道具、装备或舰娘的拥有、装备、准备、废弃、消耗与转换，以及操作时、每次执行或任务完成时三个时机。
- `rewards.entries`：资源、useitem、装备、舰娘、家具、功能开放、容量、战果和其他奖励；装备奖励可保存改修值。
- `rewards.choices`：只通过奖励条目 ID 组成选择组。数量冲突的组设为无效，并在 `rewards.unresolved` 保留原文和原因。

奖励生成时，燃料、弹药、钢材、铝土与高速修復材、高速建造材、開発資材、改修資材优先采用本地 Kcanotify 游戏数据中的数值；固定及选择奖励优先采用本地 kcwiki 结构化记录，其余从 kcQuests 原文生成。装备和 useitem 最终以本地 start2 master ID 归一。Kcanotify 的固定资材与 kcwiki 的同类条目重复时保留前者；来源冲突或原文漏项通过 `rewardOverrides` 人工复核，原始 `rewardText` 不改写。
- `tracking.poiGoal`：仅保存 poi 计数器兼容映射，不作为规范化条件格式。
- `catalogs`：舰娘、舰娘分组（含国籍）、舰种、舰级、改造链、装备、装备类型、useitem、地图和远征的本地实体目录；运行时条件引用优先使用游戏 master ID。国籍分组在构建时由 Wiki 名单映射为 master ID，运行时不按显示名称判断。

条件、目标、完成逻辑、消耗和奖励均保存 `sourceRefs` 与 `confidence`。置信度为 `exact`、`verified`、`parsed` 或 `unresolved`；不能确认的规则必须保留 `raw` 和 `reason`。文本解析生成的事件映射默认不参与自动计数，只有已验证映射才可将 `completion.automatic` 设为 `true`。

人工核对后的工厂与出击规则分别以 overrides 中的 `requirements.manualFactory`、`requirements.manualSortie` 保存；构建时展开为完整 schema v4 条件、目标和来源元数据，生成后的 `data/quests.json` 不直接维护。`manualSortie.objectiveConfidence` 可在编成已确认而胜利等级仍待交叉确认时单独降低目标置信度；仍有来源冲突的细节写入 `manualSortie.unresolved`，不得从生成物中丢失。

舰娘 selector 使用 `masterIds`、`groupIds`、`familyIds`、`typeIds`、`classIds`，并可用 `remodel.exactMasterIds`、`allowedMasterIds`、`minimumStage`、`beforeStage` 限制改造形态。舰队 predicate 以 `positions` 表示旗舰、二号舰或僚舰，以 `groups[].min/max`、`forbidden`、`size.min/max` 和 `distinct` 表示数量及独立分配；多套编成由条件 AST 的 `any` 表达。使用 `groupIds` 时若 poi master 数据比本地目录新，求值返回 `unknown`，不会把新舰误判为不符合国籍集合。

装备 predicate 使用 `selector.masterIds/type2Ids`、`quantity`、`state.improvement.min/exact`、`state.proficiency.min/exact`、`state.locked`，并通过 `placement.role`、`shipSelector`、`slotIndex` 和 `mustBeCurrentlyEquipped` 表示装备舰、旗舰、秘书舰与装备栏位置；`placement.location: not-airbase` 表示装备不得处于陆航基地中，陆航状态缺失时求值为 `unknown`。

详情要求列表按语义拆分：前提 A 为舰娘、装备、资源和道具的拥有数量，以及尚未满足的海图解锁；前提 B 为舰娘等级、改造形态、装备改修与熟练度；前提 C 为当前舰队编成、旗舰/二号舰/僚舰位置、装备位置及锁定状态。已满足的海图解锁不显示。完成进度以规范化 objective 为文案和目标数量来源，并用 poi goal 映射实际计数；无可靠事件映射时显示未知。工厂任务的每项废弃操作由结构化 cost 独立生成 objective，poi goal 不得覆盖其对象或数量。编成任务不显示完成进度。

舰娘形态默认接受所要求形态及其后续改造形态；若要求形态位于循环改造段内，则只接受该精确形态。开发资材、改修资材等从 poi `resources` 的扩展槽位求值，家具币从 `basic.api_fcoin` 求值；相应状态缺失或过期时保持未知。

完成状态以游戏“全部任务”列表的完整快照为基准：可见任务的已知前置会标为推定完成；不可见的根任务，以及全部前置均已完成的不可见任务，会递归标为推定完成。存在未收录前置时标为资料缺失；尚未取得完整快照时才保留未知状态。

可同时完成提示只使用本地结构化数据，并显示在对应的每一项完成进度下：出击任务要求存在共同海域及至少一套舰队配置兼容（旗舰/二号舰冲突、禁止舰娘、舰队容量和互斥舰种会排除）；演习任务使用相同的舰队配置兼容判定；远征任务要求存在共同远征编号；工厂任务要求废弃装备 selector（master ID／装备类型）存在交集且秘书舰条件不冲突，任意装备 selector 可与具体 selector 共用。已完成、日常和周常任务不会作为推荐项，尚未解锁任务仍可被推荐。推荐以可换行的任务 badge 显示，按季常/年常、已解锁、未解锁排序，点击可跳转任务，悬停可查看状态、完整前提 A/B/C、进度和带选择组标记的奖励；提示仅作为批量安排参考，不替代游戏内任务判定。

筛选项默认全选，但默认排除已完成任务；左键切换单项，右键仅保留该项，再次右键唯一选中项恢复全选。细分状态与普通状态共用同一组筛选，不会在切换时重置。

普通搜索同时匹配任务名、细节、要求和奖励。开启高级搜索后可分别填写四个字段；字段内支持 `AND`、`OR`、`NOT`、`且`、`或`、`非`、括号及引号短语，多个字段同时填写时取交集。未加运算符的相邻词按 `AND` 处理。

Toolbar 的搜索词、高级搜索开关及四个分栏搜索词、待做筛选、类型/完成度/周期筛选、前提组筛选、细分状态、图方向和暂定完成周期均按账号写入 `state.json`。暂定完成保存日、周、月、季开关本身，重启后继续作为完成证据参与依赖推断；适合窗口和定位任务属于即时操作，不持久化。

周期依赖按刷新跨度和本周期证据处理：长周期或单次任务已解锁，只能证明短周期前置曾完成；短周期前置再次刷新不会直接把后续任务判为未解锁。长周期任务自身刷新时，若当前短周期前置尚未完成则重新判为未解锁；本长周期内已有前置完成记录或任务可见记录时保持已解锁证据。

任务资料由插件独立合并维护，参考：

- [kcQuests](https://github.com/kcwikizh/kcQuests)
- [kcwiki quest data](https://github.com/kcwikizh/kcwiki-quest-data)
- [Kcanotify game data](https://github.com/antest1/kcanotify-gamedata)
- [WhoCallsTheFleet database](https://github.com/kcwikizh/WhoCallsTheFleet-DB)
- [艦隊これくしょん -艦これ- 攻略 Wiki](https://wikiwiki.jp/kancolle/任務)
- [tsunkit](https://tsunkit.net/quests/)
- poi 内置任务计数器
- poi-plugin-quest-info-2

本地更新数据：

```sh
npm run build:data -- \
  --kcquests /path/to/kcQuests/quests-scn.json \
  --categories /path/to/questCategory.json \
  --poi-goals /path/to/poi/assets/data/quest_goal.cson \
  --kcanotify /path/to/kcanotify-gamedata/quests-scn.json \
  --equipment /path/to/kcQuests/equip.json \
  --kcwiki-quests /path/to/kcwiki-quest-data/data \
  --master-data /path/to/api_start2.json \
  --wctf-db /path/to/whocallsthefleet-database/db \
  --overrides ./data/overrides/quests.json
```

`quests-scn-new.json` 默认从同一目录合并，并优先覆盖同 ID 的旧记录。

构建器以本地 `api_start2.json` 快照作为舰娘、舰种、装备、装备类型、道具、地图和远征 ID 的主目录，并以本地 `kcwiki-quest-data/data/*.json` 覆盖其已收录任务的结构化条件、消耗、前置与非资源奖励。生成物记录 start2 的 SHA-256 与各 Git 数据源的提交号；这些文件只在构建时读取，插件运行时不访问对应网站。

kcwiki 的结构字段进入生成物时标为 `parsed`。只有人工对照任务原文并写入 overrides 的内容才标为 `verified`；不支持的顺序条件、实体或字段继续写入 `unresolved`，不会静默降级成推测结果。

覆写在基础数据生成后最后应用。`data/overrides/quests.json` 的 `quests` 数组按任务 `id` 合并；对象递归合并，数组整体替换。可用构建期字段 `requirements.objectiveOverrides` 按 objective ID 局部覆写生成目标；其中 `constraints: "$conditions"` 会复用该任务经覆写后的全局条件。奖励可用构建期字段 `rewardOverrides.removeEntryIds`、`entryOverrides`、`additionalEntries`、`choiceOverrides`、`additionalChoices` 和 `unresolved` 按条目或选择组 ID 删除、替换、补充或修正，避免复制基础资源奖励。构建产物不会保留这些辅助字段。覆写内容同样必须通过 schema、实体引用、改造链、条件操作符、objective 引用、奖励选择组和来源验证。验证器还要求每个装备废弃 cost 使用操作时机，并与一个同选择器、同数量的废弃 objective 一一对应；标签不得继续保存整段任务原文或重复动作前缀。

重复验证当前生成物：

```sh
npm run validate:data
npm test
npm pack --dry-run
```

构建和验证都会输出覆盖率报告，包括四类置信度、未解析条件、失效实体引用、奖励选择冲突、缺失前置及忽略的限时前置编号数量。

## 安装

```sh
npm install --omit=peer
npm link
cd "$HOME/Library/Application Support/poi/plugins"
npm link poi-plugin-quest-planner
```

安装或更新后重新加载插件，必要时重启 poi。
