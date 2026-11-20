import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { mkdir, readdir, writeFile, rename, stat, readFile, rm } from 'node:fs/promises';
import { join, dirname, extname, normalize as normalize$1, sep, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { z } from 'zod';
import { createServer as createServer$1 } from 'node:http';
import Fastify from 'fastify';
import sharp from 'sharp';
import { deflateRawSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const PACK_IDS = ['puzzle', 'stealth', 'quiz', 'card', 'dialogue'];
/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */
const CARD_EFFECT_KINDS = [
    'damage',
    'block',
    'apply_vulnerable',
    'apply_weak',
    'gain_strength',
    'draw',
    'gain_energy',
    'exhaust',
    'retain',
];
/* ------------------------------------------------------------------ */
/* Zod schemas                                                         */
/* ------------------------------------------------------------------ */
const IdSchema$2 = z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-zA-Z0-9_-]+$/, 'IDs may only contain letters, digits, underscore and dash');
const PointSchema = z.strictObject({
    x: z.number().int().min(0).max(63),
    y: z.number().int().min(0).max(63),
});
const DirectionSchema = z.enum(['up', 'down', 'left', 'right']);
const FlagExprSchema = z.lazy(() => z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('flag_is'), flag: IdSchema$2, value: z.boolean() }),
    z.strictObject({ type: z.literal('all'), of: z.array(FlagExprSchema).min(1).max(8) }),
    z.strictObject({ type: z.literal('any'), of: z.array(FlagExprSchema).min(1).max(8) }),
    z.strictObject({ type: z.literal('not'), of: FlagExprSchema }),
]));
const BoolExprSchema = z.lazy(() => z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('flag_is'), flag: IdSchema$2, value: z.boolean() }),
    z.strictObject({
        type: z.literal('inventory_at_least'),
        itemType: IdSchema$2,
        count: z.number().int().min(0).max(99),
    }),
    z.strictObject({
        type: z.literal('collected_at_least'),
        itemType: IdSchema$2,
        count: z.number().int().min(0).max(99),
    }),
    z.strictObject({
        type: z.literal('player_in_zone'),
        cells: z.array(PointSchema).min(1).max(64),
    }),
    z.strictObject({ type: z.literal('all'), of: z.array(BoolExprSchema).min(1).max(8) }),
    z.strictObject({ type: z.literal('any'), of: z.array(BoolExprSchema).min(1).max(8) }),
    z.strictObject({ type: z.literal('not'), of: BoolExprSchema }),
]));
const GoalExprSchema = z.lazy(() => z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('at_exit') }),
    z.strictObject({ type: z.literal('flag_is'), flag: IdSchema$2, value: z.boolean() }),
    z.strictObject({
        type: z.literal('collected_at_least'),
        itemType: IdSchema$2,
        count: z.number().int().min(0).max(99),
    }),
    z.strictObject({ type: z.literal('score_at_least'), count: z.number().int().min(0).max(9999) }),
    z.strictObject({ type: z.literal('all'), of: z.array(GoalExprSchema).min(1).max(8) }),
    z.strictObject({ type: z.literal('any'), of: z.array(GoalExprSchema).min(1).max(8) }),
]));
const PresentationSchema = z.strictObject({
    theme: z.strictObject({
        background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        floor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        wall: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        text: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    }),
    cellSize: z.number().int().min(16).max(96),
    sounds: z.boolean(),
    assets: z.array(z.strictObject({ slot: z.string().min(1).max(40), assetId: z.string().min(1).max(80) })).max(24),
    cardLayout: z.enum(['fan', 'table']).optional(),
    backgroundOpacity: z.number().int().min(0).max(100).optional(),
    backgroundFade: z.number().int().min(0).max(100).optional(),
    foregroundOpacity: z.number().int().min(0).max(100).optional(),
    foregroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
const GenerationSchema = z.strictObject({
    method: z.enum(['handwritten', 'model']),
    seed: z.number().int().min(0).max(2147483647).optional(),
    note: z.string().max(300).optional(),
});
const MetaSchema = z.strictObject({
    name: z.string().min(1).max(60),
    description: z.string().max(800),
    controls: z.string().max(300).optional(),
});
const GridEntitySchema = z.discriminatedUnion('kind', [
    z.strictObject({
        kind: z.literal('item'),
        id: IdSchema$2,
        x: z.number().int().min(0).max(63),
        y: z.number().int().min(0).max(63),
        itemType: IdSchema$2,
        count: z.number().int().min(1).max(99),
        label: z.string().max(40).optional(),
    }),
    z.strictObject({
        kind: z.literal('door'),
        id: IdSchema$2,
        x: z.number().int().min(0).max(63),
        y: z.number().int().min(0).max(63),
        requires: z.strictObject({ itemType: IdSchema$2, count: z.number().int().min(1).max(3) }),
        label: z.string().max(40).optional(),
    }),
    z.strictObject({
        kind: z.literal('gate'),
        id: IdSchema$2,
        x: z.number().int().min(0).max(63),
        y: z.number().int().min(0).max(63),
        openWhen: FlagExprSchema,
        label: z.string().max(40).optional(),
    }),
    z.strictObject({
        kind: z.literal('switch'),
        id: IdSchema$2,
        x: z.number().int().min(0).max(63),
        y: z.number().int().min(0).max(63),
        flag: IdSchema$2,
        mode: z.enum(['set', 'toggle']),
        label: z.string().max(40).optional(),
    }),
    z.strictObject({
        kind: z.literal('guard'),
        id: IdSchema$2,
        x: z.number().int().min(0).max(63),
        y: z.number().int().min(0).max(63),
        facing: DirectionSchema,
        route: z.array(PointSchema).min(2).max(16),
        clock: z.strictObject({
            basis: z.enum(['successful_move', 'action']),
            every: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        }),
        label: z.string().max(40).optional(),
    }),
    z.strictObject({
        kind: z.literal('exit'),
        id: IdSchema$2,
        x: z.number().int().min(0).max(63),
        y: z.number().int().min(0).max(63),
        label: z.string().max(40).optional(),
    }),
    z.strictObject({
        kind: z.literal('zone'),
        id: IdSchema$2,
        cells: z.array(PointSchema).min(1).max(64),
        label: z.string().max(40).optional(),
    }),
]);
const GridEventSchema = z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('item_collected'), entityId: IdSchema$2 }),
    z.strictObject({ type: z.literal('switch_activated'), entityId: IdSchema$2 }),
    z.strictObject({ type: z.literal('player_entered_zone'), zoneId: IdSchema$2 }),
    z.strictObject({ type: z.literal('action_resolved') }),
]);
const GridEffectSchema = z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('set_flag'), flag: IdSchema$2, value: z.boolean() }),
    z.strictObject({ type: z.literal('add_score'), amount: z.number().int().min(0).max(100) }),
    z.strictObject({ type: z.literal('show_message'), text: z.string().min(1).max(160) }),
]);
const GridRuleSchema = z.strictObject({
    id: IdSchema$2,
    description: z.string().max(200).optional(),
    event: GridEventSchema,
    when: BoolExprSchema.optional(),
    effects: z.array(GridEffectSchema).min(1).max(4),
});
const GridRecipeSchema = z.strictObject({
    schemaVersion: z.literal(1),
    pack: z.strictObject({ id: z.enum(['puzzle', 'stealth']), version: z.literal(1) }),
    meta: MetaSchema,
    board: z.strictObject({
        width: z.number().int().min(5).max(20),
        height: z.number().int().min(5).max(20),
        rows: z.array(z.string()).min(5).max(20),
    }),
    player: z.strictObject({
        spawn: PointSchema,
        facing: DirectionSchema,
        assetId: z.string().max(80).optional(),
    }),
    entities: z.array(GridEntitySchema).max(64),
    flags: z.record(z.string().regex(/^[a-zA-Z0-9_-]+$/), z.boolean()),
    rules: z.array(GridRuleSchema).max(32),
    goal: GoalExprSchema,
    presentation: PresentationSchema,
    generation: GenerationSchema,
});
const QuizOptionSchema = z.strictObject({ id: IdSchema$2, text: z.string().min(1).max(200) });
const QuizQuestionSchema = z.discriminatedUnion('type', [
    z.strictObject({
        type: z.literal('single_choice'),
        id: IdSchema$2,
        prompt: z.string().min(1).max(500),
        options: z.array(QuizOptionSchema).min(2).max(6),
        answerKey: z.array(IdSchema$2).min(1).max(6),
        explanation: z.string().max(500).optional(),
        source: z.string().max(200).optional(),
        reviewed: z.boolean(),
        tags: z.array(z.string().max(30)).max(8).optional(),
    }),
    z.strictObject({
        type: z.literal('multi_choice'),
        id: IdSchema$2,
        prompt: z.string().min(1).max(500),
        options: z.array(QuizOptionSchema).min(2).max(6),
        answerKey: z.array(IdSchema$2).min(1).max(6),
        explanation: z.string().max(500).optional(),
        source: z.string().max(200).optional(),
        reviewed: z.boolean(),
        tags: z.array(z.string().max(30)).max(8).optional(),
    }),
    z.strictObject({
        type: z.literal('true_false'),
        id: IdSchema$2,
        prompt: z.string().min(1).max(500),
        answerKey: z.union([z.tuple([z.literal('true')]), z.tuple([z.literal('false')])]),
        explanation: z.string().max(500).optional(),
        source: z.string().max(200).optional(),
        reviewed: z.boolean(),
        tags: z.array(z.string().max(30)).max(8).optional(),
    }),
    z.strictObject({
        type: z.literal('short_text'),
        id: IdSchema$2,
        prompt: z.string().min(1).max(500),
        answerKey: z.array(z.string().min(1).max(60)).min(1).max(8),
        aliases: z.array(z.string().min(1).max(60)).max(8).optional(),
        explanation: z.string().max(500).optional(),
        source: z.string().max(200).optional(),
        reviewed: z.boolean(),
        tags: z.array(z.string().max(30)).max(8).optional(),
    }),
    z.strictObject({
        type: z.literal('matching'),
        id: IdSchema$2,
        prompt: z.string().min(1).max(500),
        pairs: z.array(z.strictObject({ left: z.string().min(1).max(60), right: z.string().min(1).max(60) })).min(2).max(8),
        explanation: z.string().max(500).optional(),
        source: z.string().max(200).optional(),
        reviewed: z.boolean(),
        tags: z.array(z.string().max(30)).max(8).optional(),
    }),
]);
const QuizRecipeSchema = z.strictObject({
    schemaVersion: z.literal(1),
    pack: z.strictObject({ id: z.literal('quiz'), version: z.literal(1) }),
    meta: MetaSchema,
    quiz: z.strictObject({
        questions: z.array(QuizQuestionSchema).min(1).max(200),
        lives: z.number().int().min(1).max(9),
        order: z.enum(['fixed', 'seeded']),
        seed: z.number().int().min(0).max(2147483647),
        pointsPerCorrect: z.number().int().min(1).max(100),
        comboBonus: z.number().int().min(0).max(100),
    }),
    presentation: PresentationSchema,
    generation: GenerationSchema,
});
const CardEffectSchema = z.strictObject({
    kind: z.enum(CARD_EFFECT_KINDS),
    amount: z.number().int().min(1).max(99).optional(),
});
const CardDefSchema = z.strictObject({
    id: IdSchema$2,
    name: z.string().min(1).max(40),
    cost: z.number().int().min(0).max(5),
    rarity: z.enum(['starter', 'common', 'rare']),
    effects: z.array(CardEffectSchema).min(1).max(4),
    description: z.string().max(200).optional(),
    artAssetId: z.string().min(1).max(80).optional(),
});
const EnemyDefSchema = z.strictObject({
    id: IdSchema$2,
    name: z.string().min(1).max(40),
    hp: z.number().int().min(1).max(999),
    intents: z.array(z.strictObject({ kind: z.enum(['attack', 'block']), amount: z.number().int().min(0).max(999) }))
        .min(1)
        .max(16),
});
const CardRecipeSchema = z.strictObject({
    schemaVersion: z.literal(1),
    pack: z.strictObject({ id: z.literal('card'), version: z.literal(1) }),
    meta: MetaSchema,
    cards: z.array(CardDefSchema).min(5).max(40),
    deck: z.array(IdSchema$2).min(5).max(20),
    enemies: z.array(EnemyDefSchema).min(1).max(5),
    run: z.strictObject({
        battles: z.number().int().min(1).max(5),
        startingHp: z.number().int().min(1).max(999),
        energyPerTurn: z.number().int().min(1).max(5),
        seed: z.number().int().min(0).max(2147483647),
        rewardChoices: z.literal(3),
    }),
    presentation: PresentationSchema,
    generation: GenerationSchema,
});
const DialogueChoiceSchema = z.strictObject({
    id: IdSchema$2,
    text: z.string().min(1).max(300),
    require: z.array(FlagExprSchema).max(8).optional(),
    set: z.array(IdSchema$2).max(8).optional(),
    goto: IdSchema$2,
});
const DialogueNodeSchema = z.strictObject({
    id: IdSchema$2,
    speaker: z.string().max(40).optional(),
    text: z.string().min(1).max(600),
    choices: z.array(DialogueChoiceSchema).min(1).max(4).optional(),
    goto: IdSchema$2.optional(),
    set: z.array(IdSchema$2).max(8).optional(),
    reviewed: z.boolean().optional(),
    backgroundAssetId: z.string().min(1).max(80).optional(),
    musicAssetId: z.string().min(1).max(80).optional(),
    voiceAssetId: z.string().min(1).max(80).optional(),
});
const DialogueEndingSchema = z.strictObject({
    id: IdSchema$2,
    title: z.string().min(1).max(60),
    require: z.array(FlagExprSchema).max(8),
    text: z.string().min(1).max(600),
});
const DialogueRecipeSchema = z.strictObject({
    schemaVersion: z.literal(1),
    pack: z.strictObject({ id: z.literal('dialogue'), version: z.literal(1) }),
    meta: MetaSchema,
    dialogue: z.strictObject({
        startNodeId: IdSchema$2,
        maxSteps: z.number().int().min(10).max(200),
        flags: z.array(z.strictObject({ id: IdSchema$2, initial: z.boolean() })).max(16),
        nodes: z.array(DialogueNodeSchema).min(1).max(80),
        endings: z.array(DialogueEndingSchema).min(1).max(8),
    }),
    presentation: PresentationSchema,
    generation: GenerationSchema,
});
const RecipeSchema = z.union([
    GridRecipeSchema,
    QuizRecipeSchema,
    CardRecipeSchema,
    DialogueRecipeSchema,
]);
const GridEntityZ = GridEntitySchema;
function zodIssues(error) {
    return error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
    }));
}
function parseRecipe(input) {
    const result = RecipeSchema.safeParse(input);
    if (!result.success)
        return { ok: false, issues: zodIssues(result.error) };
    return { ok: true, value: result.data };
}
function isGridRecipe(recipe) {
    return recipe.pack.id === 'puzzle' || recipe.pack.id === 'stealth';
}
function isQuizRecipe(recipe) {
    return recipe.pack.id === 'quiz';
}
function isCardRecipe(recipe) {
    return recipe.pack.id === 'card';
}
function isDialogueRecipe(recipe) {
    return recipe.pack.id === 'dialogue';
}

const isFloor = (char) => char === '.';
function inBounds(point, width, height) {
    return point.x >= 0 && point.y >= 0 && point.x < width && point.y < height;
}
function adjacent(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}
function key$1(point) {
    return point.x + ',' + point.y;
}
function exprStats(expr, depth) {
    const children = Array.isArray(expr.of) ? expr.of : [];
    if (children.length === 0)
        return { depth: depth + 1, nodes: 1 };
    let maxDepth = depth + 1;
    let nodes = 1;
    for (const child of children) {
        const stats = exprStats(child, depth + 1);
        maxDepth = Math.max(maxDepth, stats.depth);
        nodes += stats.nodes;
    }
    return { depth: maxDepth, nodes };
}
function collectFlags(expr, out) {
    if (typeof expr !== 'object' || expr === null)
        return;
    const record = expr;
    if (record.type === 'flag_is' && typeof record.flag === 'string')
        out.add(record.flag);
    if (Array.isArray(record.of)) {
        for (const child of record.of)
            collectFlags(child, out);
    }
    if (Array.isArray(record.cells)) ;
}
function collectItemTypes(expr, out) {
    if (typeof expr !== 'object' || expr === null)
        return;
    const record = expr;
    if ((record.type === 'collected_at_least' || record.type === 'inventory_at_least') && typeof record.itemType === 'string') {
        out.add(record.itemType);
    }
    if (Array.isArray(record.of)) {
        for (const child of record.of)
            collectItemTypes(child, out);
    }
}
function goalRequiresAtExit(goal) {
    switch (goal.type) {
        case 'at_exit':
            return true;
        case 'all':
            return goal.of.some((child) => goalRequiresAtExit(child));
        case 'any':
            return goal.of.length > 0 && goal.of.every((child) => goalRequiresAtExit(child));
        default:
            return false;
    }
}
function goalRequiresCollection(goal, itemType, count) {
    switch (goal.type) {
        case 'collected_at_least':
            return goal.itemType === itemType && goal.count >= count;
        case 'at_exit':
        case 'flag_is':
        case 'score_at_least':
            return false;
        case 'all':
            return goal.of.some((child) => goalRequiresCollection(child, itemType, count));
        case 'any':
            return goal.of.length > 0 && goal.of.every((child) => goalRequiresCollection(child, itemType, count));
    }
}
function validateGridEntities(recipe, issues) {
    const { width, height } = recipe.board;
    const ids = new Set();
    const occupied = new Map();
    const itemTypes = new Set();
    const zones = new Set();
    let exitCount = 0;
    let guardCount = 0;
    for (const entity of recipe.entities) {
        if (ids.has(entity.id))
            issues.push({ path: 'entities', message: 'duplicate entity id ' + entity.id });
        ids.add(entity.id);
        if (entity.kind === 'zone') {
            zones.add(entity.id);
            for (const cell of entity.cells) {
                if (!inBounds(cell, width, height)) {
                    issues.push({ path: 'entities.' + entity.id, message: 'zone cell outside the board' });
                }
            }
            continue;
        }
        if (entity.kind === 'exit')
            exitCount += 1;
        if (entity.kind === 'guard')
            guardCount += 1;
        if (!inBounds(entity, width, height)) {
            issues.push({ path: 'entities.' + entity.id, message: 'entity outside the board' });
            continue;
        }
        const row = recipe.board.rows[entity.y];
        if (row === undefined || !isFloor(row[entity.x] ?? '#')) {
            issues.push({ path: 'entities.' + entity.id, message: 'entity must stand on a floor tile' });
        }
        const cellKey = key$1(entity);
        const existing = occupied.get(cellKey);
        if (existing !== undefined) {
            issues.push({ path: 'entities.' + entity.id, message: 'cell already occupied by ' + existing });
        }
        else {
            occupied.set(cellKey, entity.id);
        }
        if (entity.kind === 'item')
            itemTypes.add(entity.itemType);
        if (entity.kind === 'guard') {
            if (entity.route.length < 2) {
                issues.push({ path: 'entities.' + entity.id, message: 'guard route needs at least 2 waypoints' });
            }
            const seen = new Set();
            for (let index = 0; index < entity.route.length; index += 1) {
                const point = entity.route[index];
                if (point === undefined)
                    continue;
                if (!inBounds(point, width, height)) {
                    issues.push({ path: 'entities.' + entity.id, message: 'guard waypoint outside the board' });
                    continue;
                }
                const pointRow = recipe.board.rows[point.y];
                if (pointRow === undefined || !isFloor(pointRow[point.x] ?? '#')) {
                    issues.push({ path: 'entities.' + entity.id, message: 'guard waypoint must be on a floor tile' });
                }
                const pointKey = key$1(point);
                if (seen.has(pointKey)) {
                    issues.push({ path: 'entities.' + entity.id, message: 'guard route repeats a waypoint' });
                }
                seen.add(pointKey);
                const next = entity.route[(index + 1) % entity.route.length];
                if (next !== undefined && !adjacent(point, next)) {
                    issues.push({
                        path: 'entities.' + entity.id,
                        message: 'guard route waypoints (including last to first) must be 4-adjacent',
                    });
                }
            }
            const first = entity.route[0];
            if (first !== undefined && (first.x !== entity.x || first.y !== entity.y)) {
                issues.push({ path: 'entities.' + entity.id, message: 'guard position must equal its first waypoint' });
            }
        }
    }
    if (exitCount !== 1)
        issues.push({ path: 'entities', message: 'exactly one exit is required, found ' + exitCount });
    if (guardCount > 4)
        issues.push({ path: 'entities', message: 'at most 4 guards are supported' });
    if (recipe.entities.length > 64)
        issues.push({ path: 'entities', message: 'at most 64 non player entities' });
    const spawnKey = key$1(recipe.player.spawn);
    if (!inBounds(recipe.player.spawn, width, height)) {
        issues.push({ path: 'player.spawn', message: 'spawn outside the board' });
    }
    else {
        const row = recipe.board.rows[recipe.player.spawn.y];
        if (row === undefined || !isFloor(row[recipe.player.spawn.x] ?? '#')) {
            issues.push({ path: 'player.spawn', message: 'spawn must be on a floor tile' });
        }
        if (occupied.has(spawnKey)) {
            issues.push({ path: 'player.spawn', message: 'spawn cell is occupied by ' + String(occupied.get(spawnKey)) });
        }
    }
    const declaredFlags = new Set(Object.keys(recipe.flags));
    if (declaredFlags.size > 16)
        issues.push({ path: 'flags', message: 'at most 16 flags' });
    for (const [flag] of Object.entries(recipe.flags)) {
        if (!/^[a-zA-Z0-9_-]+$/.test(flag))
            issues.push({ path: 'flags.' + flag, message: 'invalid flag id' });
    }
    for (const entity of recipe.entities) {
        if (entity.kind === 'switch' && !declaredFlags.has(entity.flag)) {
            issues.push({ path: 'entities.' + entity.id, message: 'switch references undeclared flag ' + entity.flag });
        }
        if (entity.kind === 'gate') {
            const used = new Set();
            collectFlags(entity.openWhen, used);
            for (const flag of used) {
                if (!declaredFlags.has(flag)) {
                    issues.push({ path: 'entities.' + entity.id, message: 'gate references undeclared flag ' + flag });
                }
            }
        }
    }
    const ruleIds = new Set();
    let scoreCap = 0;
    for (const rule of recipe.rules) {
        if (ruleIds.has(rule.id))
            issues.push({ path: 'rules.' + rule.id, message: 'duplicate rule id' });
        ruleIds.add(rule.id);
        if (rule.effects.length > 4)
            issues.push({ path: 'rules.' + rule.id, message: 'a rule supports at most 4 effects' });
        if (rule.when !== undefined) {
            const stats = exprStats(rule.when, 0);
            if (stats.depth > 3)
                issues.push({ path: 'rules.' + rule.id, message: 'condition depth exceeds 3' });
            if (stats.nodes > 16)
                issues.push({ path: 'rules.' + rule.id, message: 'condition has more than 16 nodes' });
            const used = new Set();
            collectFlags(rule.when, used);
            for (const flag of used) {
                if (!declaredFlags.has(flag)) {
                    issues.push({ path: 'rules.' + rule.id, message: 'condition references undeclared flag ' + flag });
                }
            }
        }
        if (rule.event.type === 'item_collected') {
            recipe.entities.find((entity) => entity.id === rule.event.type && entity.kind === 'item');
            const targetEntity = recipe.entities.find((entity) => entity.id === rule.event.entityId);
            if (targetEntity === undefined || targetEntity.kind !== 'item') {
                issues.push({ path: 'rules.' + rule.id, message: 'item_collected must reference an item entity' });
            }
        }
        if (rule.event.type === 'switch_activated') {
            const targetEntity = recipe.entities.find((entity) => entity.id === rule.event.entityId);
            if (targetEntity === undefined || targetEntity.kind !== 'switch') {
                issues.push({ path: 'rules.' + rule.id, message: 'switch_activated must reference a switch entity' });
            }
        }
        if (rule.event.type === 'player_entered_zone') {
            const zoneId = rule.event.zoneId;
            if (!zones.has(zoneId)) {
                issues.push({ path: 'rules.' + rule.id, message: 'player_entered_zone must reference a zone entity' });
            }
        }
        for (const effect of rule.effects) {
            if (effect.type === 'set_flag' && !declaredFlags.has(effect.flag)) {
                issues.push({ path: 'rules.' + rule.id, message: 'set_flag references undeclared flag ' + effect.flag });
            }
            if (effect.type === 'add_score') {
                if (rule.event.type !== 'item_collected') {
                    issues.push({ path: 'rules.' + rule.id, message: 'add_score may only be bound to item_collected' });
                }
                const entityId = rule.event.entityId;
                const matches = recipe.entities.filter((entity) => entity.kind === 'item' && entity.id === entityId).length;
                scoreCap += effect.amount * Math.max(1, matches);
            }
        }
    }
    if (scoreCap > 9999) {
        issues.push({ path: 'rules', message: 'conservative score cap ' + scoreCap + ' exceeds 9999' });
    }
    if (!goalRequiresAtExit(recipe.goal)) {
        issues.push({ path: 'goal', message: 'the victory goal must necessarily require at_exit' });
    }
    const goalFlags = new Set();
    collectFlags(recipe.goal, goalFlags);
    for (const flag of goalFlags) {
        if (!declaredFlags.has(flag))
            issues.push({ path: 'goal', message: 'goal references undeclared flag ' + flag });
    }
    const goalItems = new Set();
    collectItemTypes(recipe.goal, goalItems);
    for (const itemType of goalItems) {
        if (!itemTypes.has(itemType)) {
            issues.push({ path: 'goal', message: 'goal references item type ' + itemType + ' that no item entity provides' });
        }
    }
}
function validateQuiz(recipe, issues) {
    const ids = new Set();
    for (const question of recipe.quiz.questions) {
        if (ids.has(question.id))
            issues.push({ path: 'quiz.questions', message: 'duplicate question id ' + question.id });
        ids.add(question.id);
        if (!question.reviewed && question.source === undefined) {
            issues.push({
                path: 'quiz.questions.' + question.id,
                message: 'each question needs a source or reviewed: true',
            });
        }
        if (question.type === 'single_choice' || question.type === 'multi_choice') {
            const optionIds = new Set(question.options.map((option) => option.id));
            if (optionIds.size !== question.options.length) {
                issues.push({ path: 'quiz.questions.' + question.id, message: 'duplicate option ids' });
            }
            if (question.type === 'single_choice' && question.answerKey.length !== 1) {
                issues.push({ path: 'quiz.questions.' + question.id, message: 'single choice needs exactly one answer' });
            }
            if (question.answerKey.length === 0) {
                issues.push({ path: 'quiz.questions.' + question.id, message: 'answer key must not be empty' });
            }
            for (const answer of question.answerKey) {
                if (!optionIds.has(answer)) {
                    issues.push({ path: 'quiz.questions.' + question.id, message: 'answer key ' + answer + ' is not an option' });
                }
            }
            if (question.type === 'multi_choice' && question.answerKey.length === question.options.length) {
                issues.push({ path: 'quiz.questions.' + question.id, message: 'multi choice should not accept every option' });
            }
        }
        if (question.type === 'short_text') {
            const keys = new Set();
            for (const answer of question.answerKey) {
                const normalized = answer.trim();
                if (normalized.length === 0) {
                    issues.push({ path: 'quiz.questions.' + question.id, message: 'empty text answer' });
                }
                if (keys.has(normalized)) {
                    issues.push({ path: 'quiz.questions.' + question.id, message: 'duplicate text answer ' + normalized });
                }
                keys.add(normalized);
            }
            for (const alias of question.aliases ?? []) {
                if (keys.has(alias.trim())) {
                    issues.push({ path: 'quiz.questions.' + question.id, message: 'alias duplicates an answer key' });
                }
            }
        }
    }
    const maxScore = recipe.quiz.questions.length *
        (recipe.quiz.pointsPerCorrect + Math.min(100, recipe.quiz.comboBonus * recipe.quiz.questions.length));
    if (maxScore > 9999) {
        issues.push({ path: 'quiz', message: 'maximum reachable score ' + maxScore + ' exceeds 9999' });
    }
}
function validateDialogue(recipe, issues) {
    const nodeIds = new Set(recipe.dialogue.nodes.map((node) => node.id));
    if (nodeIds.size !== recipe.dialogue.nodes.length) {
        issues.push({ path: 'dialogue.nodes', message: '节点 ID 必须唯一' });
    }
    if (!nodeIds.has(recipe.dialogue.startNodeId)) {
        issues.push({ path: 'dialogue.startNodeId', message: '起始节点不存在' });
    }
    const declaredFlags = new Set(recipe.dialogue.flags.map((flag) => flag.id));
    if (declaredFlags.size !== recipe.dialogue.flags.length) {
        issues.push({ path: 'dialogue.flags', message: '标记 ID 必须唯一' });
    }
    if (declaredFlags.size > 16) {
        issues.push({ path: 'dialogue.flags', message: '标记最多 16 个' });
    }
    const checkFlags = (exprs, path) => {
        for (const expr of exprs ?? []) {
            const used = new Set();
            collectFlags(expr, used);
            for (const flag of used) {
                if (!declaredFlags.has(flag))
                    issues.push({ path, message: '引用了未声明的标记 ' + flag });
            }
        }
    };
    const endingIds = new Set();
    for (const ending of recipe.dialogue.endings) {
        if (endingIds.has(ending.id))
            issues.push({ path: 'dialogue.endings', message: '结局 ID 重复：' + ending.id });
        endingIds.add(ending.id);
        checkFlags(ending.require, 'dialogue.endings.' + ending.id);
    }
    for (const node of recipe.dialogue.nodes) {
        if (node.choices === undefined || node.choices.length === 0) {
            if (node.goto !== undefined && !nodeIds.has(node.goto)) {
                issues.push({ path: 'dialogue.nodes.' + node.id, message: 'goto 指向不存在的节点 ' + node.goto });
            }
            if (node.goto === undefined && recipe.dialogue.endings.length === 0) {
                issues.push({ path: 'dialogue.nodes.' + node.id, message: '该节点既没有选择也没有 goto，且没有任何结局' });
            }
        }
        checkFlags(node.choices?.flatMap((choice) => choice.require ?? []), 'dialogue.nodes.' + node.id);
        const choiceIds = new Set();
        for (const choice of node.choices ?? []) {
            if (choiceIds.has(choice.id)) {
                issues.push({ path: 'dialogue.nodes.' + node.id, message: '同一节点的 choice ID 重复：' + choice.id });
            }
            choiceIds.add(choice.id);
            if (!nodeIds.has(choice.goto)) {
                issues.push({ path: 'dialogue.nodes.' + node.id, message: 'choice ' + choice.id + ' 指向不存在的节点 ' + choice.goto });
            }
            for (const flag of choice.set ?? []) {
                if (!declaredFlags.has(flag)) {
                    issues.push({ path: 'dialogue.nodes.' + node.id, message: 'choice ' + choice.id + ' 设置了未声明的标记 ' + flag });
                }
            }
        }
        for (const flag of node.set ?? []) {
            if (!declaredFlags.has(flag)) {
                issues.push({ path: 'dialogue.nodes.' + node.id, message: '节点设置了未声明的标记 ' + flag });
            }
        }
    }
}
function validateCard(recipe, issues) {
    const cardsById = new Map(recipe.cards.map((card) => [card.id, card]));
    if (cardsById.size !== recipe.cards.length) {
        issues.push({ path: 'cards', message: 'duplicate card ids' });
    }
    const nameCounts = new Map();
    for (const card of recipe.cards) {
        nameCounts.set(card.name, (nameCounts.get(card.name) ?? 0) + 1);
        if (card.cost < 0 || card.cost > 5)
            issues.push({ path: 'cards.' + card.id, message: 'cost must be 0..5' });
        if (card.effects.length > 4)
            issues.push({ path: 'cards.' + card.id, message: 'at most 4 effects' });
        if (card.effects.length === 0)
            issues.push({ path: 'cards.' + card.id, message: 'at least 1 effect' });
        for (const effect of card.effects) {
            const numeric = !(effect.kind === 'exhaust' || effect.kind === 'retain');
            if (numeric && (effect.amount === undefined || effect.amount < 1)) {
                issues.push({ path: 'cards.' + card.id, message: effect.kind + ' needs a positive amount' });
            }
        }
    }
    if (recipe.deck.length < 5 || recipe.deck.length > 20) {
        issues.push({ path: 'deck', message: 'initial deck must contain 5..20 cards' });
    }
    if (recipe.deck.length > 40)
        issues.push({ path: 'deck', message: 'deck total may not exceed 40 cards' });
    const deckNameCounts = new Map();
    for (const cardId of recipe.deck) {
        const card = cardsById.get(cardId);
        if (card === undefined) {
            issues.push({ path: 'deck', message: 'deck references unknown card ' + cardId });
            continue;
        }
        deckNameCounts.set(card.name, (deckNameCounts.get(card.name) ?? 0) + 1);
    }
    for (const [name, count] of deckNameCounts) {
        if (count > 3)
            issues.push({ path: 'deck', message: 'at most 3 copies of ' + name });
    }
    if (recipe.enemies.length !== recipe.run.battles) {
        issues.push({ path: 'enemies', message: 'enemies must match the number of battles exactly' });
    }
    for (const enemy of recipe.enemies) {
        if (enemy.hp < 1 || enemy.hp > 999)
            issues.push({ path: 'enemies.' + enemy.id, message: 'hp must be 1..999' });
        if (enemy.intents.length === 0)
            issues.push({ path: 'enemies.' + enemy.id, message: 'needs at least one intent' });
        for (const intent of enemy.intents) {
            if (intent.amount < 0 || intent.amount > 999) {
                issues.push({ path: 'enemies.' + enemy.id, message: 'intent amount out of range' });
            }
        }
    }
    if (recipe.run.energyPerTurn < 1 || recipe.run.energyPerTurn > 5) {
        issues.push({ path: 'run', message: 'energy per turn must be 1..5' });
    }
    if (recipe.run.startingHp < 1 || recipe.run.startingHp > 999) {
        issues.push({ path: 'run', message: 'starting hp must be 1..999' });
    }
}
function validateRecipe(recipe) {
    const issues = [];
    if (isGridRecipe(recipe)) {
        const { width, height, rows } = recipe.board;
        if (rows.length !== height)
            issues.push({ path: 'board.rows', message: 'row count must equal height' });
        rows.forEach((row, index) => {
            if (row.length !== width) {
                issues.push({ path: 'board.rows.' + index, message: 'row width must equal board width' });
            }
            for (const char of row) {
                if (char !== '.' && char !== '#') {
                    issues.push({ path: 'board.rows.' + index, message: 'rows may only contain . and #' });
                    break;
                }
            }
        });
        for (let x = 0; x < width; x += 1) {
            if (rows[0]?.[x] !== '#' || rows[height - 1]?.[x] !== '#') {
                issues.push({ path: 'board.rows', message: 'the board needs a closed wall border' });
                break;
            }
        }
        for (let y = 0; y < height; y += 1) {
            if (rows[y]?.[0] !== '#' || rows[y]?.[width - 1] !== '#') {
                issues.push({ path: 'board.rows', message: 'the board needs a closed wall border' });
                break;
            }
        }
        validateGridEntities(recipe, issues);
    }
    else if (isQuizRecipe(recipe)) {
        validateQuiz(recipe, issues);
    }
    else if (isCardRecipe(recipe)) {
        validateCard(recipe, issues);
    }
    else if (isDialogueRecipe(recipe)) {
        validateDialogue(recipe, issues);
    }
    return issues;
}

const CONTRACT_KINDS = [
    'door_requires_item',
    'guard_clock_equals',
    'required_entity_exists',
    'goal_requires_collection',
    'reachable_goal',
    'preserve_mechanic',
    'quiz_answer_key_locked',
    'card_deck_legality',
    'card_rule_numbers_locked',
    'ending_locked',
    'choice_effect_locked',
    'dialogue_text_reviewed',
    'no_dead_branch',
];
const IdSchema$1 = z.string().min(1).max(64);
const Pointless = z.strictObject({});
const CONTRACT_PARAM_SCHEMAS = {
    door_requires_item: z.strictObject({
        doorId: IdSchema$1,
        itemType: IdSchema$1,
        count: z.number().int().min(1).max(3),
    }),
    guard_clock_equals: z.strictObject({
        guardId: IdSchema$1,
        basis: z.enum(['successful_move', 'action']),
        every: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    }),
    required_entity_exists: z.strictObject({
        entityId: IdSchema$1,
        entityKind: z.enum(['item', 'door', 'gate', 'switch', 'guard', 'exit', 'zone']),
    }),
    goal_requires_collection: z.strictObject({
        itemType: IdSchema$1,
        count: z.number().int().min(0).max(99),
    }),
    reachable_goal: z.strictObject({
        maxStates: z.number().int().min(100).max(200000).optional(),
        maxSteps: z.number().int().min(10).max(2000).optional(),
        maxMs: z.number().int().min(100).max(60000).optional(),
    }),
    preserve_mechanic: z.union([
        z.strictObject({
            mechanic: z.literal('key_consumption'),
            doorId: IdSchema$1,
            itemType: IdSchema$1,
            count: z.number().int().min(1).max(3),
        }),
        z.strictObject({
            mechanic: z.literal('switch_gate_link'),
            switchId: IdSchema$1,
            flagId: IdSchema$1,
            gateId: IdSchema$1,
            openValue: z.literal(true),
        }),
    ]),
    quiz_answer_key_locked: z.strictObject({
        questionId: IdSchema$1,
    }),
    card_deck_legality: Pointless,
    card_rule_numbers_locked: z.strictObject({
        cardIds: z.array(IdSchema$1).min(1).max(40),
    }),
    ending_locked: z.strictObject({
        endingId: IdSchema$1,
    }),
    choice_effect_locked: z.strictObject({
        nodeId: IdSchema$1,
        choiceId: IdSchema$1,
    }),
    dialogue_text_reviewed: z.strictObject({
        nodeId: IdSchema$1,
    }),
    no_dead_branch: Pointless,
};
const CONTRACT_APPLIES_TO = {
    door_requires_item: ['puzzle', 'stealth'],
    guard_clock_equals: ['puzzle', 'stealth'],
    required_entity_exists: ['puzzle', 'stealth', 'quiz', 'card'],
    goal_requires_collection: ['puzzle', 'stealth'],
    reachable_goal: ['puzzle', 'stealth'],
    preserve_mechanic: ['puzzle', 'stealth'],
    quiz_answer_key_locked: ['quiz'],
    card_deck_legality: ['card'],
    card_rule_numbers_locked: ['card'],
    ending_locked: ['dialogue'],
    choice_effect_locked: ['dialogue'],
    dialogue_text_reviewed: ['dialogue'],
    no_dead_branch: ['dialogue'],
};
function validateContractEntry(entry) {
    const errors = [];
    const schema = CONTRACT_PARAM_SCHEMAS[entry.kind];
    if (schema === undefined) {
        errors.push('unknown contract kind ' + entry.kind);
        return errors;
    }
    const parsed = schema.safeParse(entry.params);
    if (!parsed.success) {
        for (const issue of parsed.error.issues) {
            errors.push(issue.path.map(String).join('.') + ': ' + issue.message);
        }
    }
    return errors;
}
function contractAppliesTo(entry, pack) {
    return CONTRACT_APPLIES_TO[entry.kind].includes(pack);
}

/** Shared, side-effect free helpers usable in browsers, kernels, verifier and server. */
class KernelError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'KernelError';
        this.code = code;
    }
}
function normalize(value, seen) {
    if (value === null || typeof value !== 'object') {
        if (typeof value === 'number' && !Number.isFinite(value)) {
            throw new KernelError('NON_FINITE_NUMBER', 'cannot canonicalize a non finite number');
        }
        return value;
    }
    if (seen.has(value)) {
        throw new KernelError('CYCLIC_VALUE', 'cannot canonicalize a cyclic value');
    }
    seen.add(value);
    try {
        if (Array.isArray(value)) {
            return value.map((item) => normalize(item, seen));
        }
        const record = value;
        const out = {};
        for (const key of Object.keys(record).sort()) {
            const item = record[key];
            if (item === undefined)
                continue;
            out[key] = normalize(item, seen);
        }
        return out;
    }
    finally {
        seen.delete(value);
    }
}
/** Stable JSON used for hashing and state keys: object keys are sorted, arrays keep order. */
function canonicalJson(value) {
    return JSON.stringify(normalize(value, new Set()));
}
function deepFreeze(value) {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const item of Object.values(value)) {
            deepFreeze(item);
        }
    }
    return value;
}
/** Deterministic PRNG (mulberry32). Only pattern packs that declare usesRandomness may consume it. */
function createPrng(seed) {
    let state = (seed >>> 0) || 1;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function shuffled(items, rng) {
    const copy = items.slice();
    for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(rng() * (index + 1));
        const left = copy[index];
        const right = copy[swap];
        if (left === undefined || right === undefined)
            continue;
        copy[index] = right;
        copy[swap] = left;
    }
    return copy;
}

function sha256Hex(input) {
    return createHash('sha256').update(input).digest('hex');
}
function hashJson(value) {
    return sha256Hex(canonicalJson(value));
}

const SCHEMA_VERSION = 1;
const ENGINE_VERSION = '0.1.0';
function recipeHash(recipe) {
    return sha256Hex(canonicalJson(recipe));
}
function contractHash(contracts) {
    return sha256Hex(canonicalJson(contracts));
}
function assetManifestHash(assets) {
    return sha256Hex(canonicalJson(assets.map((asset) => ({ hash: asset.contentHash, name: asset.name })).sort((a, b) => a.hash.localeCompare(b.hash))));
}
function engineHash() {
    return sha256Hex(canonicalJson({ engine: ENGINE_VERSION, schema: SCHEMA_VERSION, kernels: ['grid-1', 'quiz-1', 'card-1'] }));
}
function buildId(recipe, assets = []) {
    return sha256Hex(canonicalJson({
        recipeHash: recipeHash(recipe),
        engineHash: engineHash(),
        assetManifestHash: assetManifestHash(assets),
        schemaVersion: SCHEMA_VERSION,
    }));
}
function verificationId(build, contracts, testVersion, runId) {
    return sha256Hex(canonicalJson({ buildId: build, contractHash: contractHash(contracts), testVersion, runId }));
}

function evaluateFlagExpr$1(expr, flags) {
    switch (expr.type) {
        case 'flag_is':
            return (flags[expr.flag] ?? false) === expr.value;
        case 'all':
            return expr.of.every((child) => evaluateFlagExpr$1(child, flags));
        case 'any':
            return expr.of.some((child) => evaluateFlagExpr$1(child, flags));
        case 'not':
            return !evaluateFlagExpr$1(expr.of, flags);
    }
}
function evaluateBool(expr, state, zones = new Map()) {
    switch (expr.type) {
        case 'flag_is':
            return (state.flags[expr.flag] ?? false) === expr.value;
        case 'inventory_at_least':
            return (state.inventory[expr.itemType] ?? 0) >= expr.count;
        case 'collected_at_least':
            return (state.collected[expr.itemType] ?? 0) >= expr.count;
        case 'player_in_zone': {
            const zoneCells = expr.cells;
            const target = zoneCells.some((cell) => cell.x === state.player.x && cell.y === state.player.y);
            return target;
        }
        case 'all':
            return expr.of.every((child) => evaluateBool(child, state, zones));
        case 'any':
            return expr.of.some((child) => evaluateBool(child, state, zones));
        case 'not':
            return !evaluateBool(expr.of, state, zones);
    }
}
function evaluateGoal(goal, recipe, state) {
    switch (goal.type) {
        case 'at_exit': {
            const exit = recipe.entities.find((entity) => entity.kind === 'exit');
            if (exit === undefined || exit.kind !== 'exit')
                return false;
            return state.player.x === exit.x && state.player.y === exit.y;
        }
        case 'flag_is':
            return (state.flags[goal.flag] ?? false) === goal.value;
        case 'collected_at_least':
            return (state.collected[goal.itemType] ?? 0) >= goal.count;
        case 'score_at_least':
            return state.score >= goal.count;
        case 'all':
            return goal.of.every((child) => evaluateGoal(child, recipe, state));
        case 'any':
            return goal.of.some((child) => evaluateGoal(child, recipe, state));
    }
}

const cache$3 = new WeakMap();
function prepareGrid(input) {
    if (typeof input === 'object' && input !== null) {
        const cached = cache$3.get(input);
        if (cached !== undefined)
            return cached;
    }
    const parsed = parseRecipe(input);
    if (!parsed.ok) {
        throw new KernelError('RECIPE_INVALID', 'recipe schema rejected: ' + parsed.issues.map((issue) => issue.path + ' ' + issue.message).join('; '));
    }
    const recipe = parsed.value;
    if (!isGridRecipe(recipe)) {
        throw new KernelError('RECIPE_INVALID', 'this kernel only runs puzzle/stealth recipes');
    }
    const issues = validateRecipe(recipe);
    if (issues.length > 0) {
        throw new KernelError('RECIPE_INVALID', 'recipe semantics rejected: ' + issues.map((issue) => issue.path + ' ' + issue.message).join('; '));
    }
    const walls = new Set();
    recipe.board.rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x += 1) {
            if (row[x] === '#')
                walls.add(x + ',' + y);
        }
    });
    const prepared = {
        recipe,
        width: recipe.board.width,
        height: recipe.board.height,
        walls,
        items: new Map(),
        doors: new Map(),
        gates: new Map(),
        switches: new Map(),
        exits: [],
        entityById: new Map(),
    };
    for (const entity of recipe.entities) {
        prepared.entityById.set(entity.id, entity);
        if (entity.kind === 'zone')
            continue;
        const key = entity.x + ',' + entity.y;
        if (entity.kind === 'item')
            prepared.items.set(key, entity);
        else if (entity.kind === 'door')
            prepared.doors.set(key, entity);
        else if (entity.kind === 'gate')
            prepared.gates.set(key, entity);
        else if (entity.kind === 'switch')
            prepared.switches.set(key, entity);
        else if (entity.kind === 'exit')
            prepared.exits.push(entity);
    }
    if (typeof input === 'object' && input !== null)
        cache$3.set(input, prepared);
    return prepared;
}

const DIRECTIONS$1 = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
};
function cellKey(x, y) {
    return x + ',' + y;
}

const MAX_SCORE = 9999;
function directionBetween(from, to) {
    if (to.x === from.x && to.y === from.y - 1)
        return 'up';
    if (to.x === from.x && to.y === from.y + 1)
        return 'down';
    if (to.x === from.x - 1 && to.y === from.y)
        return 'left';
    if (to.x === from.x + 1 && to.y === from.y)
        return 'right';
    return null;
}
function blockedCell(prepared, state, x, y) {
    if (prepared.walls.has(cellKey(x, y)))
        return true;
    const door = prepared.doors.get(cellKey(x, y));
    if (door !== undefined && state.doorsOpen[door.id] !== true)
        return true;
    const gate = prepared.gates.get(cellKey(x, y));
    if (gate !== undefined && state.gatesOpen[gate.id] !== true)
        return true;
    return false;
}
function guardAt(state, x, y) {
    return state.guards.find((guard) => guard.x === x && guard.y === y);
}
function guardSeesPlayer(prepared, state, guard) {
    const step = DIRECTIONS$1[guard.facing];
    let x = guard.x + step.x;
    let y = guard.y + step.y;
    for (let guardStep = 0; guardStep < 64; guardStep += 1) {
        if (prepared.walls.has(cellKey(x, y)))
            return false;
        const door = prepared.doors.get(cellKey(x, y));
        if (door !== undefined && state.doorsOpen[door.id] !== true)
            return false;
        const gate = prepared.gates.get(cellKey(x, y));
        if (gate !== undefined && state.gatesOpen[gate.id] !== true)
            return false;
        if (x === state.player.x && y === state.player.y)
            return true;
        x += step.x;
        y += step.y;
    }
    return false;
}
function cloneState$3(state) {
    return {
        actionIndex: state.actionIndex,
        successfulMoveCount: state.successfulMoveCount,
        player: { ...state.player },
        guards: state.guards.map((guard) => ({ ...guard })),
        guardClocks: { ...state.guardClocks },
        inventory: { ...state.inventory },
        collected: { ...state.collected },
        picked: state.picked.slice(),
        doorsOpen: { ...state.doorsOpen },
        gatesOpen: { ...state.gatesOpen },
        gatePending: { ...state.gatePending },
        flags: { ...state.flags },
        score: state.score,
        messages: state.messages.slice(),
        status: state.status,
        lostReason: state.lostReason,
    };
}
function eventMatches(ruleEvent, fired) {
    return fired.some((event) => {
        if (ruleEvent.type !== event.type)
            return false;
        if (ruleEvent.type === 'item_collected' && event.type === 'item_collected') {
            return ruleEvent.entityId === event.entityId;
        }
        if (ruleEvent.type === 'switch_activated' && event.type === 'switch_activated') {
            return ruleEvent.entityId === event.entityId;
        }
        if (ruleEvent.type === 'player_entered_zone' && event.type === 'player_entered_zone') {
            return ruleEvent.zoneId === event.zoneId;
        }
        return ruleEvent.type === 'action_resolved';
    });
}
function applyEffects$1(effects, state, proposals, scoreRef, messages) {
    for (const effect of effects) {
        if (effect.type === 'set_flag') {
            const existing = proposals.get(effect.flag);
            if (existing !== undefined && existing !== effect.value) {
                return {
                    ok: false,
                    error: {
                        code: 'RULE_CONFLICT',
                        message: 'conflicting writes to flag ' + effect.flag + ' in the same action',
                    },
                };
            }
            proposals.set(effect.flag, effect.value);
        }
        else if (effect.type === 'add_score') {
            if (!Number.isInteger(effect.amount) || effect.amount < 0) {
                return { ok: false, error: { code: 'RULE_SCORE_INVALID', message: 'score increments must be non negative integers' } };
            }
            scoreRef.value += effect.amount;
            if (scoreRef.value > MAX_SCORE) {
                return { ok: false, error: { code: 'SCORE_OUT_OF_RANGE', message: 'score exceeded the supported maximum of 9999' } };
            }
        }
        else if (effect.type === 'show_message') {
            if (messages[messages.length - 1] !== effect.text)
                messages.push(effect.text);
        }
    }
    return null;
}
function makeState(recipe) {
    const state = {
        actionIndex: 0,
        successfulMoveCount: 0,
        player: { x: recipe.player.spawn.x, y: recipe.player.spawn.y, facing: recipe.player.facing },
        guards: recipe.entities
            .filter((entity) => entity.kind === 'guard')
            .map((guard) => ({
            id: guard.id,
            x: guard.x,
            y: guard.y,
            facing: guard.facing,
            routeIndex: 0,
        })),
        guardClocks: {},
        inventory: {},
        collected: {},
        picked: [],
        doorsOpen: {},
        gatesOpen: {},
        gatePending: {},
        flags: { ...recipe.flags },
        score: 0,
        messages: [],
        status: 'playing',
        lostReason: null,
    };
    for (const guard of state.guards)
        state.guardClocks[guard.id] = 0;
    for (const entity of recipe.entities) {
        if (entity.kind === 'gate') {
            state.gatesOpen[entity.id] = evaluateFlagExpr$1(entity.openWhen, state.flags);
            state.gatePending[entity.id] = false;
        }
        if (entity.kind === 'door') {
            state.doorsOpen[entity.id] = false;
        }
    }
    return state;
}
function createInitialState$3(input, seed) {
    if (seed !== 0) {
        throw new KernelError('RANDOM_NOT_SUPPORTED', 'the grid kernel does not consume randomness');
    }
    const prepared = prepareGrid(input);
    const state = makeState(prepared.recipe);
    const initialFailure = detectCapture(prepared, state);
    if (initialFailure !== null) {
        state.status = 'lost';
        state.lostReason = initialFailure;
    }
    return deepFreeze(state);
}
function detectCapture(prepared, state) {
    const collision = guardAt(state, state.player.x, state.player.y);
    if (collision !== undefined)
        return 'guard_collision';
    for (const guard of state.guards) {
        if (guardSeesPlayer(prepared, state, guard))
            return 'guard_sight';
    }
    return null;
}
function stepGrid(input, previous, action) {
    const prepared = prepareGrid(input);
    const recipe = prepared.recipe;
    if (action === null || typeof action !== 'object' || typeof action.type !== 'string') {
        return { ok: false, error: { code: 'INVALID_ACTION', message: 'action must be an object with a type' } };
    }
    if (previous.status !== 'playing') {
        return { ok: true, state: previous, events: [] };
    }
    const state = cloneState$3(previous);
    state.actionIndex += 1;
    const events = [];
    const fired = [];
    let moved = false;
    let latchedFailure = null;
    const startingCell = { x: state.player.x, y: state.player.y };
    if (action.type === 'move') {
        const direction = action.direction;
        if (!(direction in DIRECTIONS$1)) {
            return { ok: false, error: { code: 'INVALID_ACTION', message: 'unknown direction ' + String(direction) } };
        }
        const step = DIRECTIONS$1[direction];
        state.player.facing = direction;
        const target = { x: state.player.x + step.x, y: state.player.y + step.y };
        const targetGuard = guardAt(state, target.x, target.y);
        if (targetGuard !== undefined) {
            latchedFailure = 'player_entered_guard';
            events.push({ type: 'caught', guardId: targetGuard.id, cause: 'player_entered_guard' });
        }
        else if (blockedCell(prepared, state, target.x, target.y)) {
            events.push({ type: 'blocked', cell: target });
        }
        else {
            state.player.x = target.x;
            state.player.y = target.y;
            moved = true;
            state.successfulMoveCount += 1;
            events.push({ type: 'moved', to: target });
        }
        if (moved) {
            const item = prepared.items.get(cellKey(state.player.x, state.player.y));
            if (item !== undefined && !state.picked.includes(item.id)) {
                state.picked.push(item.id);
                state.inventory[item.itemType] = (state.inventory[item.itemType] ?? 0) + item.count;
                state.collected[item.itemType] = (state.collected[item.itemType] ?? 0) + item.count;
                events.push({ type: 'item_collected', entityId: item.id, itemType: item.itemType, count: item.count });
                fired.push({ type: 'item_collected', entityId: item.id });
            }
        }
    }
    else if (action.type === 'interact') {
        const step = DIRECTIONS$1[state.player.facing];
        const front = { x: state.player.x + step.x, y: state.player.y + step.y };
        const frontKey = cellKey(front.x, front.y);
        const door = prepared.doors.get(frontKey);
        const toggle = prepared.switches.get(frontKey);
        if (door !== undefined && state.doorsOpen[door.id] !== true) {
            const have = state.inventory[door.requires.itemType] ?? 0;
            if (have >= door.requires.count) {
                state.inventory[door.requires.itemType] = have - door.requires.count;
                state.doorsOpen[door.id] = true;
                events.push({ type: 'door_opened', doorId: door.id, itemType: door.requires.itemType, consumed: door.requires.count });
            }
            else {
                events.push({
                    type: 'door_locked',
                    doorId: door.id,
                    required: door.requires.count,
                    itemType: door.requires.itemType,
                    have,
                });
            }
        }
        else if (toggle !== undefined) {
            const nextValue = toggle.mode === 'set' ? true : !(state.flags[toggle.flag] ?? false);
            state.flags[toggle.flag] = nextValue;
            events.push({ type: 'switch_activated', entityId: toggle.id, flag: toggle.flag, value: nextValue });
            fired.push({ type: 'switch_activated', entityId: toggle.id });
        }
        else {
            events.push({ type: 'nothing_to_interact', at: front });
        }
    }
    else if (action.type === 'wait') {
        events.push({ type: 'waited' });
    }
    else {
        return { ok: false, error: { code: 'INVALID_ACTION', message: 'unknown action type' } };
    }
    // Zone entry events (only when the player actually changed cell).
    if (moved) {
        for (const entity of recipe.entities) {
            if (entity.kind !== 'zone')
                continue;
            const contains = (x, y) => entity.cells.some((cell) => cell.x === x && cell.y === y);
            if (contains(state.player.x, state.player.y) && !contains(startingCell.x, startingCell.y)) {
                fired.push({ type: 'player_entered_zone', zoneId: entity.id });
                events.push({ type: 'zone_entered', zoneId: entity.id });
            }
        }
    }
    fired.push({ type: 'action_resolved' });
    // Step 4: rule evaluation on one snapshot taken at the start of this phase.
    const snapshot = cloneState$3(state);
    const proposals = new Map();
    const scoreRef = { value: state.score };
    const messages = state.messages.slice();
    for (const rule of recipe.rules) {
        if (!eventMatches(rule.event, fired))
            continue;
        if (rule.when !== undefined && !evaluateBool(rule.when, snapshot))
            continue;
        const failure = applyEffects$1(rule.effects, state, proposals, scoreRef, messages);
        if (failure !== null && failure.ok === false)
            return failure;
        events.push({ type: 'rule_applied', ruleId: rule.id });
    }
    for (const [flag, value] of proposals)
        state.flags[flag] = value;
    state.score = scoreRef.value;
    // Step 5: gate state follows flags; a gate closing under an occupant is deferred.
    for (const entity of recipe.entities) {
        if (entity.kind !== 'gate')
            continue;
        const desired = evaluateFlagExpr$1(entity.openWhen, state.flags);
        if (desired) {
            state.gatesOpen[entity.id] = true;
            state.gatePending[entity.id] = false;
        }
        else if (state.gatesOpen[entity.id] === true) {
            const occupied = (state.player.x === entity.x && state.player.y === entity.y) ||
                state.guards.some((guard) => guard.x === entity.x && guard.y === entity.y);
            if (occupied) {
                state.gatePending[entity.id] = true;
            }
            else {
                state.gatesOpen[entity.id] = false;
                state.gatePending[entity.id] = false;
            }
        }
    }
    // Step 6: guard clock.
    for (const guardEntity of recipe.entities) {
        if (guardEntity.kind !== 'guard')
            continue;
        const guard = state.guards.find((item) => item.id === guardEntity.id);
        if (guard === undefined)
            continue;
        const counted = guardEntity.clock.basis === 'successful_move' ? moved : true;
        if (counted)
            state.guardClocks[guard.id] = (state.guardClocks[guard.id] ?? 0) + 1;
        if ((state.guardClocks[guard.id] ?? 0) < guardEntity.clock.every)
            continue;
        state.guardClocks[guard.id] = 0;
        const nextIndex = (guard.routeIndex + 1) % guardEntity.route.length;
        const nextPoint = guardEntity.route[nextIndex];
        if (nextPoint === undefined)
            continue;
        const occupiedByGuard = state.guards.some((other) => other.id !== guard.id && other.x === nextPoint.x && other.y === nextPoint.y);
        if (occupiedByGuard) {
            events.push({ type: 'guard_blocked', guardId: guard.id, reason: 'guard' });
            continue;
        }
        if (blockedCell(prepared, state, nextPoint.x, nextPoint.y)) {
            events.push({ type: 'guard_blocked', guardId: guard.id, reason: 'terrain' });
            continue;
        }
        if (nextPoint.x === state.player.x && nextPoint.y === state.player.y) {
            latchedFailure = 'guard_entered_player';
            events.push({ type: 'caught', guardId: guard.id, cause: 'guard_entered_player' });
            continue;
        }
        const facing = directionBetween(guard, nextPoint);
        guard.x = nextPoint.x;
        guard.y = nextPoint.y;
        guard.routeIndex = nextIndex;
        if (facing !== null)
            guard.facing = facing;
        events.push({ type: 'guard_moved', guardId: guard.id, to: nextPoint });
    }
    // Step 7: collision and sight.
    if (latchedFailure === null)
        latchedFailure = detectCapture(prepared, state);
    // Step 8: terminal check; failure wins ties.
    if (latchedFailure !== null) {
        state.status = 'lost';
        state.lostReason = latchedFailure;
        state.messages = messages.slice(-8);
        events.push({ type: 'lost', reason: latchedFailure });
        return { ok: true, state: deepFreeze(state), events };
    }
    if (moved || action.type !== 'move') {
        const exitEntity = prepared.exits[0];
        const onExit = exitEntity !== undefined &&
            exitEntity.kind === 'exit' &&
            state.player.x === exitEntity.x &&
            state.player.y === exitEntity.y;
        if (onExit && evaluateGoal(recipe.goal, recipe, state)) {
            state.status = 'won';
            events.push({ type: 'won' });
        }
    }
    state.messages = messages.slice(-8);
    return { ok: true, state: deepFreeze(state), events };
}
function getAvailableActions$1() {
    return [
        { type: 'move', direction: 'up' },
        { type: 'move', direction: 'down' },
        { type: 'move', direction: 'left' },
        { type: 'move', direction: 'right' },
        { type: 'interact' },
        { type: 'wait' },
    ];
}
function getCanonicalStateKey$3(input, state) {
    void prepareGrid(input);
    return canonicalJson({
        player: state.player,
        guards: state.guards,
        guardClocks: state.guardClocks,
        inventory: state.inventory,
        collected: state.collected,
        picked: state.picked.slice().sort(),
        doorsOpen: state.doorsOpen,
        gatesOpen: state.gatesOpen,
        gatePending: state.gatePending,
        flags: state.flags,
        score: state.score,
        status: state.status,
        lostReason: state.lostReason,
    });
}

const gridKernel = {
    init: createInitialState$3,
    step: stepGrid,
    key: getCanonicalStateKey$3,
};

const DEFAULT_BUDGET = { maxStates: 50000, maxSteps: 600, maxMs: 5000 };
function searchGrid(recipe, budget = DEFAULT_BUDGET) {
    const startedAt = Date.now();
    let states;
    let startState;
    try {
        startState = createInitialState$3(recipe, 0);
    }
    catch (error) {
        return {
            status: 'invalid',
            message: error instanceof Error ? error.message : String(error),
            statesVisited: 0,
            elapsedMs: Date.now() - startedAt,
        };
    }
    const startKey = getCanonicalStateKey$3(recipe, startState);
    states = new Map();
    states.set(startKey, { state: startState, depth: 0, parent: null, action: null });
    const queue = [startKey];
    let head = 0;
    let visited = 0;
    if (startState.status === 'won') {
        return { status: 'found', actions: [], statesVisited: 1, depth: 0, elapsedMs: Date.now() - startedAt };
    }
    while (head < queue.length) {
        const key = queue[head];
        head += 1;
        if (key === undefined)
            continue;
        const node = states.get(key);
        if (node === undefined)
            continue;
        if (node.state.status !== 'playing')
            continue;
        visited += 1;
        if (visited > budget.maxStates) {
            return { status: 'budget_exceeded', statesVisited: visited, reason: 'states', elapsedMs: Date.now() - startedAt };
        }
        if (visited % 256 === 0 && Date.now() - startedAt > budget.maxMs) {
            return { status: 'budget_exceeded', statesVisited: visited, reason: 'time', elapsedMs: Date.now() - startedAt };
        }
        if (node.depth >= budget.maxSteps) {
            continue;
        }
        for (const action of getAvailableActions$1()) {
            const result = stepGrid(recipe, node.state, action);
            if (!result.ok) {
                return {
                    status: 'rule_error',
                    message: result.error.code + ': ' + result.error.message,
                    statesVisited: visited,
                    elapsedMs: Date.now() - startedAt,
                };
            }
            const nextState = result.state;
            if (nextState.status === 'won') {
                const actions = [action];
                let cursor = node;
                while (cursor.parent !== null && cursor.action !== null) {
                    actions.unshift(cursor.action);
                    const parent = states.get(cursor.parent);
                    if (parent === undefined)
                        break;
                    cursor = parent;
                }
                return {
                    status: 'found',
                    actions,
                    statesVisited: visited + 1,
                    depth: node.depth + 1,
                    elapsedMs: Date.now() - startedAt,
                };
            }
            if (nextState.status !== 'playing')
                continue;
            const nextKey = getCanonicalStateKey$3(recipe, nextState);
            if (states.has(nextKey))
                continue;
            states.set(nextKey, { state: nextState, depth: node.depth + 1, parent: key, action });
            queue.push(nextKey);
        }
    }
    return { status: 'exhausted', statesVisited: visited, elapsedMs: Date.now() - startedAt };
}
/**
 * 软锁死检测：枚举所有可达状态，反向求“还能赢”的吸引子。
 * 仍处于 playing、但已经没有任何动作序列能走到 won 的状态 = 死局；
 * 只上报“临界死局”（前一步还可赢的那批），用于告诉玩家是哪一步走死了。
 * 'lost'（被守卫抓住等）属于硬失败，不算软锁死。
 */
function findSoftlocks(recipe, budget = DEFAULT_BUDGET) {
    const startedAt = Date.now();
    let startState;
    try {
        startState = createInitialState$3(recipe, 0);
    }
    catch (error) {
        return { status: 'invalid', message: error instanceof Error ? error.message : String(error), elapsedMs: Date.now() - startedAt };
    }
    const nodes = new Map();
    const startKey = getCanonicalStateKey$3(recipe, startState);
    nodes.set(startKey, { state: startState, depth: 0, parent: null, action: null, parents: [] });
    const queue = [startKey];
    const reverse = new Map();
    const wonKeys = new Set();
    let head = 0;
    let expanded = 0;
    if (startState.status === 'won') {
        return { status: 'clean', statesChecked: 1, elapsedMs: Date.now() - startedAt };
    }
    while (head < queue.length) {
        const key = queue[head];
        head += 1;
        if (key === undefined)
            continue;
        const node = nodes.get(key);
        if (node === undefined || node.state.status !== 'playing')
            continue;
        expanded += 1;
        if (expanded > budget.maxStates) {
            return { status: 'budget_exceeded', statesChecked: expanded, reason: 'states', elapsedMs: Date.now() - startedAt };
        }
        if (expanded % 256 === 0 && Date.now() - startedAt > budget.maxMs) {
            return { status: 'budget_exceeded', statesChecked: expanded, reason: 'time', elapsedMs: Date.now() - startedAt };
        }
        if (node.depth >= budget.maxSteps)
            continue;
        for (const action of getAvailableActions$1()) {
            const result = stepGrid(recipe, node.state, action);
            if (!result.ok) {
                return { status: 'invalid', message: result.error.code + ': ' + result.error.message, elapsedMs: Date.now() - startedAt };
            }
            if (result.state.status === 'won') {
                wonKeys.add(key);
                if (!reverse.has(key))
                    reverse.set(key, []);
                break;
            }
            if (result.state.status !== 'playing')
                continue;
            const nextKey = getCanonicalStateKey$3(recipe, result.state);
            const parents = reverse.get(nextKey);
            if (parents === undefined)
                reverse.set(nextKey, [key]);
            else
                parents.push(key);
            if (!nodes.has(nextKey)) {
                nodes.set(nextKey, { state: result.state, depth: node.depth + 1, parent: key, action, parents: [key] });
                queue.push(nextKey);
            }
        }
    }
    // 从“能直接赢”的状态沿反向边扩张 = 还能赢的吸引子
    const winnable = new Set(wonKeys);
    const back = [...wonKeys];
    while (back.length > 0) {
        const key = back.pop();
        if (key === undefined)
            continue;
        const parents = reverse.get(key);
        if (parents === undefined)
            continue;
        for (const p of parents) {
            if (winnable.has(p))
                continue;
            winnable.add(p);
            back.push(p);
        }
    }
    const reconstruct = (key) => {
        const actions = [];
        let cursor = nodes.get(key);
        while (cursor !== undefined && cursor.parent !== null && cursor.action !== null) {
            actions.unshift(cursor.action);
            cursor = nodes.get(cursor.parent);
        }
        return actions;
    };
    const deadSpots = [];
    for (const [key, node] of nodes) {
        if (node.state.status !== 'playing' || winnable.has(key))
            continue;
        const parentKey = node.parent;
        if (parentKey !== null && !winnable.has(parentKey))
            continue; // 只报临界死局
        deadSpots.push({ player: { x: node.state.player.x, y: node.state.player.y }, path: reconstruct(key), pathLength: node.depth });
        if (deadSpots.length >= 8)
            break;
    }
    return deadSpots.length === 0
        ? { status: 'clean', statesChecked: nodes.size, elapsedMs: Date.now() - startedAt }
        : { status: 'found', deadSpots, statesChecked: nodes.size, elapsedMs: Date.now() - startedAt };
}

function findEntity(recipe, entityId) {
    return recipe.entities.find((entity) => entity.id === entityId);
}
function checkGridContract(entry, recipe, search, browserReplay) {
    const base = { entryId: entry.id, kind: entry.kind, description: entry.description };
    const params = entry.params;
    switch (entry.kind) {
        case 'door_requires_item': {
            const door = recipe.entities.find((entity) => entity.id === params.doorId);
            if (door === undefined || door.kind !== 'door') {
                return { ...base, status: 'failed', detail: '找不到门 ' + String(params.doorId) };
            }
            const ok = door.requires.itemType === params.itemType && door.requires.count === params.count;
            return {
                ...base,
                status: ok ? 'passed' : 'failed',
                detail: ok
                    ? '门 ' + door.id + ' 需要 ' + door.requires.count + ' 个 ' + door.requires.itemType
                    : '门要求已变为 ' + door.requires.count + ' 个 ' + door.requires.itemType,
            };
        }
        case 'guard_clock_equals': {
            const guard = recipe.entities.find((entity) => entity.id === params.guardId);
            if (guard === undefined || guard.kind !== 'guard') {
                return { ...base, status: 'failed', detail: '找不到守卫 ' + String(params.guardId) };
            }
            const ok = guard.clock.basis === params.basis && guard.clock.every === params.every;
            return {
                ...base,
                status: ok ? 'passed' : 'failed',
                detail: '守卫节拍为 ' + guard.clock.basis + ' / every=' + guard.clock.every,
            };
        }
        case 'required_entity_exists': {
            const entity = findEntity(recipe, String(params.entityId));
            if (entity === undefined)
                return { ...base, status: 'failed', detail: '对象已被删除' };
            const ok = entity.kind === params.entityKind;
            return {
                ...base,
                status: ok ? 'passed' : 'failed',
                detail: ok ? '对象 ' + entity.id + ' 仍然存在且类型为 ' + entity.kind : '对象类型被改为 ' + entity.kind,
            };
        }
        case 'goal_requires_collection': {
            const ok = goalRequiresCollection(recipe.goal, String(params.itemType), Number(params.count));
            return {
                ...base,
                status: ok ? 'passed' : 'failed',
                detail: ok ? '胜利条件在结构上必然要求收集 ' + String(params.itemType) : '胜利条件可以被绕过收集要求',
            };
        }
        case 'reachable_goal': {
            if (search === undefined)
                return { ...base, status: 'unverified', detail: '未执行搜索' };
            if (search.status === 'found') {
                if (browserReplay !== null && browserReplay.ok && browserReplay.finalStatus === 'won') {
                    return {
                        ...base,
                        status: 'passed',
                        detail: '搜索通过 ' + search.actions.length + ' 步，且浏览器真实输入重放已绑定（' + browserReplay.source + '）',
                    };
                }
                return {
                    ...base,
                    status: 'partial',
                    detail: '搜索通过 ' + search.actions.length + ' 步；浏览器真实输入重放未绑定本次验证，不能标记为完全通过',
                };
            }
            if (search.status === 'exhausted') {
                return { ...base, status: 'failed', detail: '在有限状态空间中未找到通关路线' };
            }
            if (search.status === 'budget_exceeded') {
                return { ...base, status: 'unknown', detail: '搜索预算耗尽，不能断言无解' };
            }
            if (search.status === 'rule_error') {
                return { ...base, status: 'failed', detail: '搜索中发现运行规则错误：' + search.message };
            }
            return { ...base, status: 'failed', detail: '配方无效：' + search.message };
        }
        case 'preserve_mechanic': {
            if (params.mechanic === 'key_consumption') {
                const door = recipe.entities.find((entity) => entity.id === params.doorId);
                if (door === undefined || door.kind !== 'door') {
                    return { ...base, status: 'failed', detail: '找不到门 ' + String(params.doorId) };
                }
                const ok = door.requires.itemType === params.itemType && door.requires.count === params.count;
                return {
                    ...base,
                    status: ok ? 'passed' : 'failed',
                    detail: ok ? '钥匙消耗机制保持' : '钥匙消耗机制被改动',
                };
            }
            const toggle = recipe.entities.find((entity) => entity.id === params.switchId);
            const gate = recipe.entities.find((entity) => entity.id === params.gateId);
            if (toggle === undefined || toggle.kind !== 'switch') {
                return { ...base, status: 'failed', detail: '找不到开关 ' + String(params.switchId) };
            }
            if (gate === undefined || gate.kind !== 'gate') {
                return { ...base, status: 'failed', detail: '找不到机关门 ' + String(params.gateId) };
            }
            const flag = String(params.flagId);
            const openValue = params.openValue === true;
            const whenTrue = evaluateFlagExpr$1(gate.openWhen, { [flag]: true });
            const whenFalse = evaluateFlagExpr$1(gate.openWhen, { [flag]: false });
            const ok = toggle.flag === flag && whenTrue === openValue && whenFalse === !openValue;
            return {
                ...base,
                status: ok ? 'passed' : 'failed',
                detail: ok ? '开关 ' + toggle.id + ' 仍然通过 ' + flag + ' 控制机关门 ' + gate.id : '开关与机关门的依赖关系被破坏',
            };
        }
        default:
            return { ...base, status: 'unverified', detail: '该契约不适用于网格包' };
    }
}
function checkQuizContract(entry, recipe, baseline) {
    const base = { entryId: entry.id, kind: entry.kind, description: entry.description };
    if (entry.kind !== 'quiz_answer_key_locked' || !isQuizRecipe(recipe)) {
        return { ...base, status: 'unverified', detail: '未知的知识包契约' };
    }
    if (baseline === undefined || !isQuizRecipe(baseline)) {
        return { ...base, status: 'unverified', detail: '缺少确认时的基线配方，无法比较答案键' };
    }
    const questionId = String(entry.params.questionId);
    const current = recipe.quiz.questions.find((question) => question.id === questionId);
    const original = baseline.quiz.questions.find((question) => question.id === questionId);
    if (current === undefined)
        return { ...base, status: 'failed', detail: '题目 ' + questionId + ' 被删除' };
    if (original === undefined)
        return { ...base, status: 'failed', detail: '基线与当前配方不匹配' };
    const currentOptions = 'options' in current ? current.options : [];
    const originalOptions = 'options' in original ? original.options : [];
    const sameOptions = JSON.stringify(currentOptions) === JSON.stringify(originalOptions);
    const currentKey = 'answerKey' in current ? current.answerKey : current.pairs;
    const originalKey = 'answerKey' in original ? original.answerKey : original.pairs;
    const sameKey = JSON.stringify(currentKey) === JSON.stringify(originalKey);
    return {
        ...base,
        status: sameOptions && sameKey ? 'passed' : 'failed',
        detail: sameOptions && sameKey ? '选项与答案键未被改动' : '选项或答案键被改动',
    };
}
function checkCardContract(entry, recipe, baseline) {
    const base = { entryId: entry.id, kind: entry.kind, description: entry.description };
    if (!isCardRecipe(recipe))
        return { ...base, status: 'unverified', detail: '该契约不适用于卡牌包' };
    if (entry.kind === 'card_deck_legality') {
        const names = new Map();
        for (const id of recipe.deck) {
            const card = recipe.cards.find((item) => item.id === id);
            if (card === undefined)
                return { ...base, status: 'failed', detail: '牌组引用了不存在的卡 ' + id };
            names.set(card.name, (names.get(card.name) ?? 0) + 1);
        }
        const tooMany = [...names.entries()].find(([, count]) => count > 3);
        const sizeOk = recipe.deck.length >= 5 && recipe.deck.length <= 20;
        if (!sizeOk)
            return { ...base, status: 'failed', detail: '初始牌组数量为 ' + recipe.deck.length };
        if (tooMany !== undefined)
            return { ...base, status: 'failed', detail: '同名卡超过 3 张：' + tooMany[0] };
        return { ...base, status: 'passed', detail: '牌组数量与同名上限合法' };
    }
    if (entry.kind === 'card_rule_numbers_locked') {
        if (baseline === undefined || !isCardRecipe(baseline)) {
            return { ...base, status: 'unverified', detail: '缺少确认时的基线配方，无法比较卡牌数值' };
        }
        const cardIds = entry.params.cardIds;
        const changed = [];
        for (const cardId of cardIds) {
            const current = recipe.cards.find((card) => card.id === cardId);
            const original = baseline.cards.find((card) => card.id === cardId);
            if (current === undefined || original === undefined) {
                changed.push(cardId);
                continue;
            }
            if (current.cost !== original.cost || JSON.stringify(current.effects) !== JSON.stringify(original.effects)) {
                changed.push(cardId);
            }
        }
        return {
            ...base,
            status: changed.length === 0 ? 'passed' : 'failed',
            detail: changed.length === 0 ? '受保护卡牌数值未变' : '受保护卡牌数值被改动：' + changed.join(', '),
        };
    }
    return { ...base, status: 'unverified', detail: '未知的卡牌包契约' };
}
function checkDialogueContract(entry, recipe, baseline, summary) {
    const base = { entryId: entry.id, kind: entry.kind, description: entry.description };
    if (!isDialogueRecipe(recipe))
        return { ...base, status: 'unverified', detail: '该契约不适用于对话包' };
    const params = entry.params;
    if (entry.kind === 'dialogue_text_reviewed') {
        const node = recipe.dialogue.nodes.find((item) => item.id === params.nodeId);
        if (node === undefined)
            return { ...base, status: 'failed', detail: '节点不存在：' + String(params.nodeId) };
        const explicit = typeof node.reviewed === 'boolean';
        return {
            ...base,
            status: explicit ? 'passed' : 'failed',
            detail: explicit ? '节点已显式标注审核状态：' + String(node.reviewed) : '节点缺少 reviewed 标记，AI 生成的台词必须写明未审核',
        };
    }
    if (entry.kind === 'no_dead_branch') {
        if (summary === undefined)
            return { ...base, status: 'unverified', detail: '没有运行对话图检查' };
        return {
            ...base,
            status: summary.deadBranchNodes.length === 0 ? 'passed' : 'failed',
            detail: summary.deadBranchNodes.length === 0 ? '所有可达节点都能走向结局' : '以下节点走投无路：' + summary.deadBranchNodes.join('、'),
        };
    }
    if (baseline === undefined || !isDialogueRecipe(baseline)) {
        return { ...base, status: 'unverified', detail: '缺少确认时的基线配方，无法比较' };
    }
    if (entry.kind === 'ending_locked') {
        const current = recipe.dialogue.endings.find((item) => item.id === params.endingId);
        const original = baseline.dialogue.endings.find((item) => item.id === params.endingId);
        if (current === undefined)
            return { ...base, status: 'failed', detail: '结局被删除：' + String(params.endingId) };
        if (original === undefined)
            return { ...base, status: 'failed', detail: '基线与当前配方不匹配' };
        const same = current.title === original.title && JSON.stringify(current.require) === JSON.stringify(original.require);
        return { ...base, status: same ? 'passed' : 'failed', detail: same ? '结局标题与条件未被改动' : '结局标题或达成条件被改动' };
    }
    if (entry.kind === 'choice_effect_locked') {
        const currentNode = recipe.dialogue.nodes.find((item) => item.id === params.nodeId);
        const originalNode = baseline.dialogue.nodes.find((item) => item.id === params.nodeId);
        const current = currentNode?.choices?.find((item) => item.id === params.choiceId);
        const original = originalNode?.choices?.find((item) => item.id === params.choiceId);
        if (current === undefined)
            return { ...base, status: 'failed', detail: '选择被删除' };
        if (current === undefined || original === undefined)
            return { ...base, status: 'failed', detail: '选择不存在' };
        const same = current.goto === original.goto && JSON.stringify(current.set ?? []) === JSON.stringify(original.set ?? []);
        return { ...base, status: same ? 'passed' : 'failed', detail: same ? '选择的跳转与标记未被改动' : '选择的跳转或标记被改动' };
    }
    return { ...base, status: 'unverified', detail: '未知的对话包契约' };
}
function checkContracts(recipe, contracts, options) {
    const results = [];
    for (const entry of contracts.entries) {
        if (!contractAppliesTo(entry, recipe.pack.id))
            continue;
        if (entry.verificationMode === 'manual') {
            results.push({
                entryId: entry.id,
                kind: entry.kind,
                description: entry.description,
                status: 'unverified',
                detail: '人工确认项，等待用户试玩确认',
            });
            continue;
        }
        if (isGridRecipe(recipe)) {
            results.push(checkGridContract(entry, recipe, options.search, options.browserReplay ?? null));
        }
        else if (isQuizRecipe(recipe)) {
            results.push(checkQuizContract(entry, recipe, options.baseline));
        }
        else if (isDialogueRecipe(recipe)) {
            results.push(checkDialogueContract(entry, recipe, options.baseline, options.dialogue));
        }
        else {
            results.push(checkCardContract(entry, recipe, options.baseline));
        }
    }
    return results;
}

const HAND_LIMIT = 10;
const MAX_BLOCK = 999;
const MAX_STATUS = 99;
const cache$2 = new WeakMap();
function prepareCard(input) {
    if (typeof input === 'object' && input !== null) {
        const cached = cache$2.get(input);
        if (cached !== undefined)
            return cached;
    }
    const parsed = parseRecipe(input);
    if (!parsed.ok) {
        throw new KernelError('RECIPE_INVALID', 'recipe schema rejected: ' + parsed.issues.map((issue) => issue.path + ' ' + issue.message).join('; '));
    }
    if (!isCardRecipe(parsed.value))
        throw new KernelError('RECIPE_INVALID', 'this kernel only runs card recipes');
    const issues = validateRecipe(parsed.value);
    if (issues.length > 0) {
        throw new KernelError('RECIPE_INVALID', 'recipe semantics rejected: ' + issues.map((issue) => issue.path + ' ' + issue.message).join('; '));
    }
    if (typeof input === 'object' && input !== null)
        cache$2.set(input, parsed.value);
    return parsed.value;
}
function cardMap(recipe) {
    return new Map(recipe.cards.map((card) => [card.id, card]));
}
function mixSeed(seed, counter) {
    return (seed + Math.imul(counter + 1, 0x9e3779b9)) >>> 0;
}
function drawCards(recipe, battle, count, rngRef) {
    for (let drawn = 0; drawn < count; drawn += 1) {
        if (battle.hand.length >= HAND_LIMIT) {
            battle.log.push('手牌已满，抽牌效果不生效');
            return;
        }
        if (battle.draw.length === 0) {
            if (battle.discard.length === 0) {
                battle.log.push('牌库与弃牌堆均为空，无法继续抽牌');
                return;
            }
            rngRef.value += 1;
            battle.draw = shuffled(battle.discard, createPrng(mixSeed(recipe.run.seed, rngRef.value)));
            battle.discard = [];
            battle.log.push('弃牌堆已按固定种子洗回抽牌堆');
        }
        const next = battle.draw.shift();
        if (next === undefined)
            return;
        battle.hand.push(next);
    }
}
function drawTo(recipe, battle, target, rngRef) {
    const missing = target - battle.hand.length;
    if (missing > 0)
        drawCards(recipe, battle, missing, rngRef);
}
function rewardChoices(recipe, rngRef) {
    rngRef.value += 1;
    const rng = createPrng(mixSeed(recipe.run.seed, rngRef.value));
    const pool = recipe.cards.map((card) => card.id);
    return shuffled(pool, rng).slice(0, recipe.run.rewardChoices);
}
function startBattle(recipe, deck, hp, battleIndex, rngCount) {
    const enemy = recipe.enemies[battleIndex];
    if (enemy === undefined)
        throw new KernelError('CARD_STATE_INVALID', 'no enemy configured for battle ' + battleIndex);
    const rngRef = { value: rngCount + 1 };
    const instances = deck.map((cardId, index) => ({
        uid: 'b' + battleIndex + 'c' + index,
        cardId,
    }));
    const battle = {
        enemyId: enemy.id,
        enemyName: enemy.name,
        enemyHp: enemy.hp,
        enemyMaxHp: enemy.hp,
        enemyBlock: 0,
        enemyWeak: 0,
        enemyVulnerable: 0,
        enemyIntentIndex: 0,
        block: 0,
        energy: recipe.run.energyPerTurn,
        maxEnergy: recipe.run.energyPerTurn,
        hand: [],
        draw: shuffled(instances, createPrng(mixSeed(recipe.run.seed, rngRef.value))),
        discard: [],
        exhaust: [],
        strength: 0,
        turn: 1,
        phase: 'player',
        rewardChoices: [],
        log: ['第 ' + (battleIndex + 1) + ' 场战斗开始：' + enemy.name],
    };
    drawTo(recipe, battle, 5, rngRef);
    return { battle, rngCount: rngRef.value };
}
function createState$1(recipe) {
    const started = startBattle(recipe, recipe.deck.slice(), recipe.run.startingHp, 0, 0);
    return {
        battleIndex: 0,
        battles: recipe.run.battles,
        deck: recipe.deck.slice(),
        hp: recipe.run.startingHp,
        maxHp: recipe.run.startingHp,
        battle: started.battle,
        status: 'playing',
        rngCount: started.rngCount,
        chosenRewards: [],
    };
}
function createInitialState$2(input, seed) {
    if (seed !== 0)
        throw new KernelError('RANDOM_NOT_SUPPORTED', 'the card kernel takes its seed from the recipe only');
    return deepFreeze(createState$1(prepareCard(input)));
}
function cloneBattle(battle) {
    return {
        ...battle,
        hand: battle.hand.map((card) => ({ ...card })),
        draw: battle.draw.map((card) => ({ ...card })),
        discard: battle.discard.map((card) => ({ ...card })),
        exhaust: battle.exhaust.map((card) => ({ ...card })),
        rewardChoices: battle.rewardChoices.slice(),
        log: battle.log.slice(),
    };
}
function cloneState$2(state) {
    return {
        ...state,
        deck: state.deck.slice(),
        battle: cloneBattle(state.battle),
        chosenRewards: state.chosenRewards.slice(),
    };
}
function damageEnemy(battle, base) {
    let damage = base + battle.strength;
    if (battle.enemyVulnerable > 0)
        damage = Math.floor(damage * 1.5);
    const blocked = Math.min(battle.enemyBlock, damage);
    battle.enemyBlock -= blocked;
    const hpDamage = Math.max(0, damage - blocked);
    battle.enemyHp = Math.max(0, battle.enemyHp - hpDamage);
    return { damage, blocked, hpDamage };
}
function applyEffects(recipe, battle, effects, rngRef) {
    const flags = { exhausted: false, retained: false };
    for (const effect of effects) {
        const amount = effect.amount ?? 0;
        switch (effect.kind) {
            case 'damage':
                damageEnemy(battle, amount);
                break;
            case 'block':
                battle.block = Math.min(MAX_BLOCK, battle.block + amount);
                break;
            case 'apply_vulnerable':
                battle.enemyVulnerable = Math.min(MAX_STATUS, battle.enemyVulnerable + amount);
                break;
            case 'apply_weak':
                battle.enemyWeak = Math.min(MAX_STATUS, battle.enemyWeak + amount);
                break;
            case 'gain_strength':
                battle.strength = Math.min(MAX_STATUS, battle.strength + amount);
                break;
            case 'draw':
                drawCards(recipe, battle, amount, rngRef);
                break;
            case 'gain_energy':
                battle.energy = Math.min(99, battle.energy + amount);
                break;
            case 'exhaust':
                flags.exhausted = true;
                break;
            case 'retain':
                flags.retained = true;
                break;
        }
    }
    return flags;
}
function finishBattle(recipe, state, rngRef) {
    if (state.battleIndex + 1 < recipe.run.battles) {
        state.battle.phase = 'reward';
        state.battle.rewardChoices = rewardChoices(recipe, rngRef);
        state.battle.log.push('战斗胜利，请从三张奖励中选择一张或跳过');
    }
    else {
        state.status = 'won';
        state.battle.phase = 'won';
        state.battle.log.push('全部战斗完成');
    }
}
function stepCard(input, previous, action) {
    const recipe = prepareCard(input);
    if (action === null || typeof action !== 'object') {
        return { ok: false, error: { code: 'INVALID_ACTION', message: 'action must be an object' } };
    }
    if (action.type === 'restart') {
        return { ok: true, state: deepFreeze(createState$1(recipe)), events: [{ type: 'restarted' }] };
    }
    if (previous.status !== 'playing') {
        return { ok: true, state: previous, events: [] };
    }
    const state = cloneState$2(previous);
    const battle = state.battle;
    const events = [];
    const rngRef = { value: state.rngCount };
    const cards = cardMap(recipe);
    if (action.type === 'play_card') {
        if (battle.phase !== 'player') {
            return { ok: false, error: { code: 'INVALID_ACTION', message: '当前阶段不能出牌' } };
        }
        const handIndex = battle.hand.findIndex((card) => card.uid === action.uid);
        if (handIndex < 0) {
            return { ok: false, error: { code: 'INVALID_ACTION', message: '这张牌不在手牌中' } };
        }
        const instance = battle.hand[handIndex];
        if (instance === undefined)
            return { ok: false, error: { code: 'INVALID_ACTION', message: '手牌读取失败' } };
        const definition = cards.get(instance.cardId);
        if (definition === undefined) {
            return { ok: false, error: { code: 'RUNTIME_ERROR', message: 'unknown card ' + instance.cardId } };
        }
        if (battle.energy < definition.cost) {
            return {
                ok: false,
                error: { code: 'INVALID_ACTION', message: '能量不足：需要 ' + definition.cost + '，当前 ' + battle.energy },
            };
        }
        battle.hand.splice(handIndex, 1);
        battle.energy -= definition.cost;
        const flags = applyEffects(recipe, battle, definition.effects, rngRef);
        if (flags.exhausted)
            battle.exhaust.push(instance);
        else
            battle.discard.push(instance);
        battle.log.push('打出「' + definition.name + '」');
        events.push({ type: 'card_played', cardId: definition.id, name: definition.name });
        if (battle.enemyHp <= 0) {
            finishBattle(recipe, state, rngRef);
            events.push({ type: 'battle_won', battleIndex: state.battleIndex });
        }
        state.rngCount = rngRef.value;
        return { ok: true, state: deepFreeze(state), events };
    }
    if (action.type === 'end_turn') {
        if (battle.phase !== 'player') {
            return { ok: false, error: { code: 'INVALID_ACTION', message: '当前阶段不能结束回合' } };
        }
        const retained = [];
        for (const card of battle.hand) {
            const definition = cards.get(card.cardId);
            const keep = definition !== undefined && definition.effects.some((effect) => effect.kind === 'retain');
            if (keep)
                retained.push(card);
            else
                battle.discard.push(card);
        }
        battle.hand = retained;
        const enemy = recipe.enemies[state.battleIndex];
        if (enemy !== undefined && battle.enemyHp > 0) {
            const intent = enemy.intents[battle.enemyIntentIndex % enemy.intents.length];
            if (intent !== undefined) {
                if (intent.kind === 'attack') {
                    let damage = intent.amount;
                    if (battle.enemyWeak > 0)
                        damage = Math.floor(damage * 0.75);
                    const blocked = Math.min(battle.block, damage);
                    battle.block -= blocked;
                    state.hp = Math.max(0, state.hp - (damage - blocked));
                    battle.log.push(enemy.name + ' 攻击 ' + damage + ' 点（格挡 ' + blocked + '）');
                    events.push({ type: 'enemy_attacked', damage, blocked });
                }
                else {
                    battle.enemyBlock = Math.min(MAX_BLOCK, battle.enemyBlock + intent.amount);
                    battle.log.push(enemy.name + ' 获得 ' + intent.amount + ' 点格挡');
                    events.push({ type: 'enemy_blocked', amount: intent.amount });
                }
            }
            battle.enemyIntentIndex += 1;
            if (battle.enemyWeak > 0)
                battle.enemyWeak -= 1;
            if (battle.enemyVulnerable > 0)
                battle.enemyVulnerable -= 1;
        }
        if (state.hp <= 0) {
            state.status = 'lost';
            battle.phase = 'lost';
            events.push({ type: 'run_lost' });
            state.rngCount = rngRef.value;
            return { ok: true, state: deepFreeze(state), events };
        }
        battle.turn += 1;
        battle.block = 0;
        battle.energy = battle.maxEnergy;
        drawTo(recipe, battle, 5, rngRef);
        battle.log.push('第 ' + battle.turn + ' 回合开始');
        state.rngCount = rngRef.value;
        return { ok: true, state: deepFreeze(state), events };
    }
    if (action.type === 'choose_reward') {
        if (battle.phase !== 'reward') {
            return { ok: false, error: { code: 'INVALID_ACTION', message: '当前没有可选择的奖励' } };
        }
        if (action.cardId !== null && !battle.rewardChoices.includes(action.cardId)) {
            return { ok: false, error: { code: 'INVALID_ACTION', message: '该卡牌不在本次奖励候选中' } };
        }
        if (action.cardId !== null) {
            if (state.deck.length >= 40) {
                return { ok: false, error: { code: 'INVALID_ACTION', message: '牌库总量不能超过 40 张' } };
            }
            state.deck.push(action.cardId);
            state.chosenRewards.push(action.cardId);
        }
        const nextIndex = state.battleIndex + 1;
        const started = startBattle(recipe, state.deck, state.hp, nextIndex, rngRef.value);
        state.battleIndex = nextIndex;
        state.battle = started.battle;
        state.rngCount = started.rngCount;
        events.push({ type: 'battle_started', battleIndex: nextIndex });
        return { ok: true, state: deepFreeze(state), events };
    }
    return { ok: false, error: { code: 'INVALID_ACTION', message: 'unknown card action' } };
}
function getCanonicalStateKey$2(input, state) {
    void prepareCard(input);
    return canonicalJson(state);
}
const cardKernel = {
    init: createInitialState$2,
    step: stepCard,
    key: getCanonicalStateKey$2,
};

const cache$1 = new WeakMap();
function prepareQuiz(input) {
    if (typeof input === 'object' && input !== null) {
        const cached = cache$1.get(input);
        if (cached !== undefined)
            return cached;
    }
    const parsed = parseRecipe(input);
    if (!parsed.ok) {
        throw new KernelError('RECIPE_INVALID', 'recipe schema rejected: ' + parsed.issues.map((issue) => issue.path + ' ' + issue.message).join('; '));
    }
    if (!isQuizRecipe(parsed.value))
        throw new KernelError('RECIPE_INVALID', 'this kernel only runs quiz recipes');
    const issues = validateRecipe(parsed.value);
    if (issues.length > 0) {
        throw new KernelError('RECIPE_INVALID', 'recipe semantics rejected: ' + issues.map((issue) => issue.path + ' ' + issue.message).join('; '));
    }
    if (typeof input === 'object' && input !== null)
        cache$1.set(input, parsed.value);
    return parsed.value;
}
function normalizeAnswer(text) {
    return text
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}
function sameSet(left, right) {
    if (left.length !== right.length)
        return false;
    const leftSet = new Set(left);
    if (leftSet.size !== left.length)
        return false;
    return right.every((item) => leftSet.has(item));
}
function judgeAnswer(question, state) {
    switch (question.type) {
        case 'single_choice':
        case 'multi_choice':
            return sameSet(state.selected, question.answerKey);
        case 'true_false':
            return state.selected.length === 1 && state.selected[0] === question.answerKey[0];
        case 'matching':
            return sameSet(state.selected, question.pairs.map((pair) => pair.left + '=>' + pair.right));
        case 'short_text': {
            const normalized = normalizeAnswer(state.textAnswer);
            if (normalized.length === 0)
                return false;
            const accepted = new Set([
                ...question.answerKey.map(normalizeAnswer),
                ...(question.aliases ?? []).map(normalizeAnswer),
            ]);
            return accepted.has(normalized);
        }
    }
}
function createState(recipe) {
    const indices = recipe.quiz.questions.map((_, index) => index);
    let order = indices;
    if (recipe.quiz.order === 'seeded') {
        order = shuffled(indices, createPrng(recipe.quiz.seed));
    }
    return {
        order,
        index: 0,
        phase: 'question',
        selected: [],
        textAnswer: '',
        lives: recipe.quiz.lives,
        score: 0,
        combo: 0,
        maxCombo: 0,
        answers: [],
        wrongQuestionIds: [],
        status: 'playing',
        lastJudge: null,
        rngCount: 0,
    };
}
function currentQuestion(recipe, state) {
    const questionIndex = state.order[state.index];
    const question = questionIndex === undefined ? undefined : recipe.quiz.questions[questionIndex];
    if (question === undefined)
        throw new KernelError('QUIZ_STATE_INVALID', 'current question index is out of range');
    return question;
}
function createInitialState$1(input, seed) {
    if (seed !== 0)
        throw new KernelError('RANDOM_NOT_SUPPORTED', 'the quiz kernel does not consume gameplay randomness');
    return deepFreeze(createState(prepareQuiz(input)));
}
function cloneState$1(state) {
    return {
        ...state,
        order: state.order.slice(),
        selected: state.selected.slice(),
        answers: state.answers.map((answer) => ({ ...answer, selected: answer.selected.slice() })),
        wrongQuestionIds: state.wrongQuestionIds.slice(),
        lastJudge: state.lastJudge === null ? null : { ...state.lastJudge },
    };
}
function stepQuiz(input, previous, action) {
    const recipe = prepareQuiz(input);
    if (action === null || typeof action !== 'object') {
        return { ok: false, error: { code: 'INVALID_ACTION', message: 'action must be an object' } };
    }
    if (action.type === 'restart') {
        return { ok: true, state: deepFreeze(createState(recipe)), events: [{ type: 'restarted' }] };
    }
    if (previous.status !== 'playing') {
        return { ok: true, state: previous, events: [] };
    }
    const state = cloneState$1(previous);
    const events = [];
    const question = currentQuestion(recipe, state);
    if (action.type === 'select') {
        if (state.phase !== 'question') {
            return { ok: false, error: { code: 'INVALID_ACTION', message: 'this question has already been answered' } };
        }
        if (question.type === 'short_text') {
            state.textAnswer = action.text ?? '';
            state.selected = [];
        }
        else if (question.type === 'matching') {
            state.selected = (action.pairs ?? []).map((pair) => pair.left + '=>' + pair.right).sort();
            state.textAnswer = '';
        }
        else {
            state.selected = (action.optionIds ?? []).slice().sort();
            state.textAnswer = '';
        }
        events.push({ type: 'selected', count: state.selected.length });
        return { ok: true, state: deepFreeze(state), events };
    }
    if (action.type === 'submit') {
        if (state.phase !== 'question') {
            return { ok: false, error: { code: 'INVALID_ACTION', message: 'this question has already been answered' } };
        }
        const empty = question.type === 'short_text' ? normalizeAnswer(state.textAnswer).length === 0 : state.selected.length === 0;
        if (empty) {
            return { ok: false, error: { code: 'INVALID_ACTION', message: '请先选择或填写答案' } };
        }
        const correct = judgeAnswer(question, state);
        state.answers.push({
            questionId: question.id,
            correct,
            selected: state.selected.slice(),
            text: state.textAnswer,
        });
        if (correct) {
            const priorCombo = state.combo;
            state.combo += 1;
            state.maxCombo = Math.max(state.maxCombo, state.combo);
            const bonus = Math.min(100, priorCombo * recipe.quiz.comboBonus);
            const gained = Math.min(100, recipe.quiz.pointsPerCorrect + bonus);
            state.score += gained;
            if (state.score > 9999) {
                return { ok: false, error: { code: 'SCORE_OUT_OF_RANGE', message: 'score exceeded 9999' } };
            }
            events.push({ type: 'correct', gained, score: state.score });
        }
        else {
            state.combo = 0;
            state.lives -= 1;
            state.wrongQuestionIds.push(question.id);
            events.push({ type: 'wrong', lives: state.lives });
            if (state.lives <= 0) {
                state.status = 'lost';
                state.phase = 'finished';
                state.lastJudge = { correct: false, explanation: question.explanation, source: question.source };
                events.push({ type: 'finished', status: 'lost' });
                return { ok: true, state: deepFreeze(state), events };
            }
        }
        state.phase = 'answered';
        state.lastJudge = { correct, explanation: question.explanation, source: question.source };
        events.push({ type: 'answered', correct });
        return { ok: true, state: deepFreeze(state), events };
    }
    if (action.type === 'next') {
        if (state.phase !== 'answered') {
            return { ok: false, error: { code: 'INVALID_ACTION', message: '先提交答案再进入下一题' } };
        }
        state.lastJudge = null;
        if (state.index + 1 >= state.order.length) {
            state.phase = 'finished';
            state.status = 'won';
            events.push({ type: 'finished', status: 'won' });
            return { ok: true, state: deepFreeze(state), events };
        }
        state.index += 1;
        state.phase = 'question';
        state.selected = [];
        state.textAnswer = '';
        events.push({ type: 'next_question', index: state.index });
        return { ok: true, state: deepFreeze(state), events };
    }
    return { ok: false, error: { code: 'INVALID_ACTION', message: 'unknown quiz action' } };
}
function getCanonicalStateKey$1(input, state) {
    void prepareQuiz(input);
    const { ...key } = state;
    return canonicalJson({ ...key, lastJudge: undefined });
}
function currentQuestionOf(recipe, state) {
    return currentQuestion(recipe, state);
}
const quizKernel = {
    init: createInitialState$1,
    step: stepQuiz,
    key: getCanonicalStateKey$1,
};

const cache = new WeakMap();
function prepareDialogue(input) {
    if (typeof input === 'object' && input !== null) {
        const cached = cache.get(input);
        if (cached !== undefined)
            return cached;
    }
    const parsed = parseRecipe(input);
    if (!parsed.ok) {
        throw new KernelError('RECIPE_INVALID', 'recipe schema rejected: ' + parsed.issues.map((issue) => issue.path + ' ' + issue.message).join('; '));
    }
    if (!isDialogueRecipe(parsed.value))
        throw new KernelError('RECIPE_INVALID', 'this kernel only runs dialogue recipes');
    const issues = validateRecipe(parsed.value);
    if (issues.length > 0) {
        throw new KernelError('RECIPE_INVALID', 'recipe semantics rejected: ' + issues.map((issue) => issue.path + ' ' + issue.message).join('; '));
    }
    if (typeof input === 'object' && input !== null)
        cache.set(input, parsed.value);
    return parsed.value;
}
function evaluateFlagExpr(expr, flags) {
    switch (expr.type) {
        case 'flag_is':
            return (flags[expr.flag] ?? false) === expr.value;
        case 'all':
            return expr.of.every((child) => evaluateFlagExpr(child, flags));
        case 'any':
            return expr.of.some((child) => evaluateFlagExpr(child, flags));
        case 'not':
            return !evaluateFlagExpr(expr.of, flags);
    }
}
function requirementsMet(expressions, flags) {
    return (expressions ?? []).every((expr) => evaluateFlagExpr(expr, flags));
}
function nodeOf(recipe, nodeId) {
    const node = recipe.dialogue.nodes.find((item) => item.id === nodeId);
    if (node === undefined)
        throw new KernelError('DIALOGUE_STATE_INVALID', 'node not found: ' + nodeId);
    return node;
}
function applySet(node, flags) {
    for (const flag of node.set ?? [])
        flags[flag] = true;
}
function resolveEnding(recipe, state, events) {
    const ending = recipe.dialogue.endings.find((item) => requirementsMet(item.require, state.flags));
    if (ending === undefined) {
        state.status = 'lost';
        events.push({ type: 'dialogue_no_ending' });
        return;
    }
    state.status = 'ended';
    state.endId = ending.id;
    events.push({ type: 'dialogue_ended', endingId: ending.id, title: ending.title });
}
function enterNode(recipe, state, nodeId, events) {
    const node = nodeOf(recipe, nodeId);
    state.node = nodeId;
    state.path.push(nodeId);
    applySet(node, state.flags);
    events.push({ type: 'dialogue_node', nodeId, speaker: node.speaker ?? null, text: node.text });
    if ((node.choices === undefined || node.choices.length === 0) && node.goto === undefined) {
        resolveEnding(recipe, state, events);
    }
}
function createInitialState(input, seed) {
    if (seed !== 0)
        throw new KernelError('RANDOM_NOT_SUPPORTED', 'the dialogue kernel does not consume randomness');
    const recipe = prepareDialogue(input);
    const flags = {};
    for (const flag of recipe.dialogue.flags)
        flags[flag.id] = flag.initial;
    const state = {
        node: recipe.dialogue.startNodeId,
        flags,
        steps: 0,
        status: 'playing',
        path: [],
    };
    const events = [];
    enterNode(recipe, state, recipe.dialogue.startNodeId, events);
    return deepFreeze(state);
}
function cloneState(state) {
    return {
        node: state.node,
        flags: { ...state.flags },
        steps: state.steps,
        status: state.status,
        endId: state.endId,
        path: state.path.slice(),
    };
}
function stepDialogue(input, previous, action) {
    const recipe = prepareDialogue(input);
    if (action === null || typeof action !== 'object') {
        return { ok: false, error: { code: 'INVALID_ACTION', message: 'action must be an object' } };
    }
    if (action.type === 'restart') {
        return { ok: true, state: deepFreeze(createInitialState(recipe, 0)), events: [{ type: 'restarted' }] };
    }
    if (previous.status !== 'playing') {
        return { ok: true, state: previous, events: [] };
    }
    const state = cloneState(previous);
    const events = [];
    const node = nodeOf(recipe, state.node);
    if (state.steps >= recipe.dialogue.maxSteps) {
        state.status = 'lost';
        events.push({ type: 'dialogue_step_limit' });
        return { ok: true, state: deepFreeze(state), events };
    }
    if (action.type === 'advance') {
        if (node.choices !== undefined && node.choices.length > 0) {
            return { ok: false, error: { code: 'INVALID_ACTION', message: '当前节点需要做出选择，不能直接推进' } };
        }
        state.steps += 1;
        if (node.goto !== undefined) {
            enterNode(recipe, state, node.goto, events);
        }
        else {
            resolveEnding(recipe, state, events);
        }
        return { ok: true, state: deepFreeze(state), events };
    }
    if (action.type === 'choose') {
        const choice = (node.choices ?? []).find((item) => item.id === action.choiceId);
        if (choice === undefined) {
            return { ok: false, error: { code: 'INVALID_ACTION', message: '这个选择不存在' } };
        }
        if (!requirementsMet(choice.require, state.flags)) {
            return { ok: false, error: { code: 'INVALID_ACTION', message: '这个选择的前置条件还不满足' } };
        }
        state.steps += 1;
        applySet(choice, state.flags);
        events.push({ type: 'dialogue_choice', choiceId: choice.id, text: choice.text });
        enterNode(recipe, state, choice.goto, events);
        return { ok: true, state: deepFreeze(state), events };
    }
    return { ok: false, error: { code: 'INVALID_ACTION', message: 'unknown dialogue action' } };
}
function getAvailableActions(input, state) {
    const recipe = prepareDialogue(input);
    if (state.status !== 'playing')
        return [];
    const node = nodeOf(recipe, state.node);
    const choices = (node.choices ?? []).filter((choice) => requirementsMet(choice.require, state.flags));
    if (choices.length > 0)
        return choices.map((choice) => ({ type: 'choose', choiceId: choice.id }));
    if (node.goto !== undefined)
        return [{ type: 'advance' }];
    return [{ type: 'advance' }];
}
function getCanonicalStateKey(input, state) {
    void prepareDialogue(input);
    return canonicalJson({
        node: state.node,
        flags: state.flags,
        steps: state.steps,
        status: state.status,
        endId: state.endId,
    });
}

const PLACEHOLDER = /\{todo\}|TODO|XXX/i;
function checkDialogue(recipe, maxStates = 5000) {
    const checks = [];
    const start = createInitialState(recipe, 0);
    const startKey = getCanonicalStateKey(recipe, start);
    const states = new Map();
    states.set(startKey, { state: start, depth: 0, parent: null, action: null });
    const queue = [startKey];
    let head = 0;
    const endingsReachable = new Set();
    const visitedNodes = new Set();
    const deadBranchNodes = new Set();
    let replay = [];
    let replayEndingId = null;
    let budgetExceeded = false;
    while (head < queue.length) {
        const key = queue[head];
        head += 1;
        if (key === undefined)
            continue;
        const node = states.get(key);
        if (node === undefined)
            continue;
        visitedNodes.add(node.state.node);
        if (node.state.status === 'ended' && node.state.endId !== undefined) {
            endingsReachable.add(node.state.endId);
            if (replay.length === 0) {
                const actions = [];
                let cursor = node;
                while (cursor !== undefined && cursor.parent !== null && cursor.action !== null) {
                    actions.unshift(cursor.action);
                    cursor = states.get(cursor.parent);
                }
                replay = actions;
                replayEndingId = node.state.endId;
            }
            continue;
        }
        if (node.state.status === 'lost') {
            deadBranchNodes.add(node.state.node);
            continue;
        }
        if (states.size >= maxStates) {
            budgetExceeded = true;
            break;
        }
        for (const action of getAvailableActions(recipe, node.state)) {
            const result = stepDialogue(recipe, node.state, action);
            if (!result.ok)
                continue;
            const nextKey = getCanonicalStateKey(recipe, result.state);
            if (states.has(nextKey))
                continue;
            states.set(nextKey, { state: result.state, depth: node.depth + 1, parent: key, action });
            queue.push(nextKey);
        }
    }
    const allNodes = recipe.dialogue.nodes.map((node) => node.id);
    const unreachableNodes = allNodes.filter((id) => !visitedNodes.has(id));
    const placeholderNodes = recipe.dialogue.nodes.filter((node) => PLACEHOLDER.test(node.text) || (node.speaker !== undefined && PLACEHOLDER.test(node.speaker))).map((node) => node.id);
    const missingEndings = recipe.dialogue.endings.filter((ending) => !endingsReachable.has(ending.id)).map((ending) => ending.id);
    checks.push({
        id: 'dialogue_endings',
        title: '全部结局可达',
        kind: 'auto',
        status: missingEndings.length === 0 ? 'passed' : 'failed',
        detail: missingEndings.length === 0 ? '全部结局都在可达路径上' : '以下结局不可达：' + missingEndings.join('、'),
    });
    checks.push({
        id: 'dialogue_nodes',
        title: '节点可达性',
        kind: 'auto',
        status: unreachableNodes.length === 0 ? 'passed' : 'partial',
        detail: unreachableNodes.length === 0 ? '所有节点都在可达路径上' : '有节点不可达（可能是删改遗留）：' + unreachableNodes.join('、'),
    });
    checks.push({
        id: 'dialogue_dead_branch',
        title: '没有走投无路的节点',
        kind: 'auto',
        status: deadBranchNodes.size === 0 ? 'passed' : 'failed',
        detail: deadBranchNodes.size === 0 ? '每个可达节点都能走向结局' : '以下节点在可达状态下无法满足任何结局：' + [...deadBranchNodes].join('、'),
    });
    checks.push({
        id: 'dialogue_text',
        title: '台词没有占位符',
        kind: 'auto',
        status: placeholderNodes.length === 0 ? 'passed' : 'unverified',
        detail: placeholderNodes.length === 0 ? '未发现 TODO/XXX/{todo} 占位词' : '以下节点仍是占位文案，需要人工补写：' + placeholderNodes.join('、'),
    });
    checks.push({
        id: 'dialogue_replay',
        title: '结局可重放',
        kind: 'auto',
        status: replay.length > 0 ? 'passed' : 'failed',
        detail: replay.length > 0 ? '找到通往结局 ' + String(replayEndingId) + ' 的 ' + replay.length + ' 步动作' : '没有找到任何可达结局的动作序列',
    });
    if (budgetExceeded) {
        checks.push({
            id: 'dialogue_budget',
            title: '图搜索预算',
            kind: 'auto',
            status: 'unknown',
            detail: '状态搜索达到 ' + String(maxStates) + ' 个状态上限，未完成探索，不能断言全部可达',
        });
    }
    return {
        checks,
        summary: {
            statesVisited: states.size,
            endingsReachable: [...endingsReachable],
            unreachableNodes,
            deadBranchNodes: [...deadBranchNodes],
            placeholderNodes,
            replay,
            replayEndingId,
            budgetExceeded,
        },
    };
}

function structuralCheck(recipe) {
    const issues = validateRecipe(recipe);
    return {
        id: 'structure',
        title: 'Schema 与配方语义',
        kind: 'auto',
        status: issues.length === 0 ? 'passed' : 'failed',
        detail: issues.length === 0
            ? '字段、上限、引用与结构检查通过'
            : issues.map((issue) => issue.path + ': ' + issue.message).join('; '),
    };
}
function gridChecks(recipe, budget) {
    const checks = [];
    let determinism = true;
    let determinismDetail = '相同配方与动作产生相同结果，输入状态未被修改';
    try {
        const first = gridKernel.init(recipe, 0);
        const second = gridKernel.init(recipe, 0);
        if (gridKernel.key(recipe, first) !== gridKernel.key(recipe, second)) {
            determinism = false;
            determinismDetail = '两次初始化的状态键不一致';
        }
        for (const action of getAvailableActions$1()) {
            const before = JSON.stringify(first);
            const left = gridKernel.step(recipe, first, action);
            const right = gridKernel.step(recipe, first, action);
            if (JSON.stringify(first) !== before) {
                determinism = false;
                determinismDetail = 'step 修改了输入状态';
                break;
            }
            if (left.ok !== right.ok) {
                determinism = false;
                determinismDetail = '同一动作两次调用结果不同';
                break;
            }
            if (!left.ok || !right.ok)
                continue;
            if (gridKernel.key(recipe, left.state) !== gridKernel.key(recipe, right.state)) {
                determinism = false;
                determinismDetail = '同一动作两次调用得到不同状态键';
                break;
            }
        }
    }
    catch (error) {
        determinism = false;
        determinismDetail = error instanceof Error ? error.message : String(error);
    }
    checks.push({
        id: 'determinism',
        title: '纯函数确定性',
        kind: 'auto',
        status: determinism ? 'passed' : 'failed',
        detail: determinismDetail,
    });
    let initialStatus = 'passed';
    let initialDetail = '初始状态可玩';
    try {
        const initial = gridKernel.init(recipe, 0);
        if (initial.status === 'lost') {
            initialStatus = 'failed';
            initialDetail = '初始状态即失败：' + String(initial.lostReason);
        }
    }
    catch (error) {
        initialStatus = 'failed';
        initialDetail = error instanceof Error ? error.message : String(error);
    }
    checks.push({ id: 'initial_state', title: '初始状态合法性', kind: 'auto', status: initialStatus, detail: initialDetail });
    const search = searchGrid(recipe, budget);
    const status = search.status === 'found' ? 'passed' : search.status === 'budget_exceeded' ? 'unknown' : 'failed';
    checks.push({
        id: 'reachable_goal',
        title: '通关路线搜索',
        kind: 'auto',
        status,
        detail: search.status === 'found'
            ? '找到 ' + search.actions.length + ' 步路线（' + search.statesVisited + ' 个状态）'
            : search.status === 'budget_exceeded'
                ? '搜索预算耗尽（' + search.reason + '），不能断言无解'
                : search.status === 'exhausted'
                    ? '在 ' + search.statesVisited + ' 个可达状态中未找到通关路线'
                    : search.status === 'rule_error'
                        ? '搜索中发现运行规则错误：' + search.message
                        : '配方无效：' + search.message,
    });
    if (search.status === 'found') {
        const soft = findSoftlocks(recipe, { maxStates: Math.min(budget.maxStates, 40000), maxSteps: Math.min(budget.maxSteps, 60), maxMs: Math.min(budget.maxMs, 6000) });
        checks.push({
            id: 'grid_softlock_free',
            title: '软锁死检测',
            kind: 'auto',
            status: soft.status === 'clean' ? 'passed' : soft.status === 'found' ? 'failed' : soft.status === 'budget_exceeded' ? 'unknown' : 'failed',
            detail: soft.status === 'clean'
                ? '已枚举 ' + String(soft.statesChecked) + ' 个可达状态：每一步之后都存在通关路线'
                : soft.status === 'found'
                    ? '发现 ' + String(soft.deadSpots.length) + ' 处临界死局，例如走到 (' + soft.deadSpots[0].player.x + ',' + soft.deadSpots[0].player.y + ') 后再也无法胜利（进入它用了 ' + String(soft.deadSpots[0].pathLength) + ' 步）'
                    : soft.status === 'budget_exceeded'
                        ? '状态空间超出预算（' + String(soft.statesChecked) + ' 个状态），软锁死未判定'
                        : '检测中断：' + ('message' in soft ? soft.message : '未知错误'),
        });
    }
    return { checks, search };
}
function quizPerfectRun(recipe) {
    let state = quizKernel.init(recipe, 0);
    let guard = 0;
    let needSubmit = false;
    while (state.status === 'playing' && guard < 1000) {
        guard += 1;
        const question = currentQuestionOf(recipe, state);
        let action;
        if (state.phase === 'answered') {
            action = { type: 'next' };
            needSubmit = false;
        }
        else if (state.phase === 'question' && needSubmit) {
            action = { type: 'submit' };
        }
        else if (state.phase === 'question') {
            action =
                question.type === 'short_text'
                    ? { type: 'select', text: question.answerKey[0] }
                    : question.type === 'matching'
                        ? { type: 'select', pairs: question.pairs }
                        : { type: 'select', optionIds: question.answerKey.slice() };
            needSubmit = true;
        }
        else
            break;
        const result = quizKernel.step(recipe, state, action);
        if (!result.ok)
            break;
        state = result.state;
    }
    return state;
}
function quizFailingRun(recipe) {
    let state = quizKernel.init(recipe, 0);
    let guard = 0;
    let needSubmit = false;
    while (state.status === 'playing' && guard < 1000) {
        guard += 1;
        const question = currentQuestionOf(recipe, state);
        let action;
        if (state.phase === 'answered') {
            action = { type: 'next' };
            needSubmit = false;
        }
        else if (state.phase === 'question' && needSubmit) {
            action = { type: 'submit' };
        }
        else if (state.phase === 'question') {
            if (question.type === 'short_text') {
                action = { type: 'select', text: 'definitely-wrong-' + guard };
                needSubmit = true;
            }
            else {
                if (question.type === 'true_false') {
                    action = { type: 'select', optionIds: [question.answerKey[0] === 'true' ? 'false' : 'true'] };
                    needSubmit = true;
                }
                else if (question.type === 'matching') {
                    const pairs = question.pairs.map((pair, index) => index === 0 ? { left: pair.left, right: question.pairs[1]?.right ?? pair.right } : pair);
                    action = { type: 'select', pairs };
                    needSubmit = true;
                }
                else {
                    const wrong = question.options.find((option) => !question.answerKey.includes(option.id));
                    if (wrong === undefined)
                        break;
                    action = { type: 'select', optionIds: [wrong.id] };
                    needSubmit = true;
                }
            }
        }
        else
            break;
        const result = quizKernel.step(recipe, state, action);
        if (!result.ok)
            break;
        state = result.state;
    }
    return state;
}
function quizChecks(recipe) {
    const checks = [];
    const perfect = quizPerfectRun(recipe);
    const failing = quizFailingRun(recipe);
    checks.push({
        id: 'quiz_perfect_run',
        title: '满分作答序列',
        kind: 'auto',
        status: perfect.status === 'won' ? 'passed' : 'failed',
        detail: '终局状态 ' + perfect.status + '，得分 ' + perfect.score + '，连击峰值 ' + perfect.maxCombo,
    });
    checks.push({
        id: 'quiz_failure_run',
        title: '答错到生命归零',
        kind: 'auto',
        status: failing.status === 'lost' && failing.lives === 0 ? 'passed' : 'failed',
        detail: '终局状态 ' + failing.status + '，剩余生命 ' + failing.lives,
    });
    const unreviewed = recipe.quiz.questions.filter((question) => !question.reviewed).length;
    checks.push({
        id: 'quiz_reviewed',
        title: '题目审核状态',
        kind: 'auto',
        status: unreviewed === 0 ? 'passed' : 'unverified',
        detail: unreviewed === 0 ? '全部题目已审核或带出处' : unreviewed + ' 道题未审核，导出前需要用户确认',
    });
    return { checks, summary: { perfectRun: perfect.status, failingRun: failing.status, unreviewed } };
}
function cardScript(recipe) {
    const violations = [];
    const actions = [];
    let state = cardKernel.init(recipe, 0);
    const keys = [cardKernel.key(recipe, state)];
    let previousRng = state.rngCount;
    let guard = 0;
    while (state.status === 'playing' && guard < 200) {
        guard += 1;
        let action;
        if (state.battle.phase === 'reward') {
            action = { type: 'choose_reward', cardId: state.battle.rewardChoices[0] ?? null };
        }
        else if (state.battle.phase === 'player') {
            const playable = state.battle.hand.find((card) => {
                const definition = recipe.cards.find((item) => item.id === card.cardId);
                return definition !== undefined && definition.cost <= state.battle.energy;
            });
            action = playable === undefined ? { type: 'end_turn' } : { type: 'play_card', uid: playable.uid };
        }
        else
            break;
        const result = cardKernel.step(recipe, state, action);
        if (!result.ok) {
            violations.push(result.error.code + ': ' + result.error.message);
            break;
        }
        actions.push(action);
        state = result.state;
        keys.push(cardKernel.key(recipe, state));
        if (state.hp < 0 || state.hp > 999)
            violations.push('生命越界 ' + state.hp);
        if (state.battle.block < 0 || state.battle.block > 999)
            violations.push('格挡越界 ' + state.battle.block);
        if (state.battle.energy < 0)
            violations.push('能量为负 ' + state.battle.energy);
        if (state.battle.hand.length > 10)
            violations.push('手牌超过上限 ' + state.battle.hand.length);
        if (state.deck.length > 40)
            violations.push('牌库超过 40 张 ' + state.deck.length);
        if (state.rngCount < previousRng)
            violations.push('RNG 计数倒退');
        previousRng = state.rngCount;
    }
    return { keys, final: state, violations, actions };
}
function cardChecks(recipe) {
    const checks = [];
    const first = cardScript(recipe);
    const second = cardScript(recipe);
    const deterministic = first.keys.length === second.keys.length && first.keys.every((key, index) => key === second.keys[index]);
    checks.push({
        id: 'card_determinism',
        title: '同种子脚本重放一致',
        kind: 'auto',
        status: deterministic ? 'passed' : 'failed',
        detail: deterministic
            ? '两次相同动作序列得到相同的 ' + first.keys.length + ' 个状态键'
            : '相同动作序列产生了不同结果',
    });
    checks.push({
        id: 'card_invariants',
        title: '数值与手牌上限',
        kind: 'auto',
        status: first.violations.length === 0 ? 'passed' : 'failed',
        detail: first.violations.length === 0 ? '生命、格挡、能量、手牌与牌库均未越界' : first.violations.join('; '),
    });
    checks.push({
        id: 'card_rng_evidence',
        title: '随机性证据',
        kind: 'auto',
        status: first.final.rngCount > 0 ? 'passed' : 'failed',
        detail: '本次脚本运行记录了 ' + first.final.rngCount + ' 次洗牌，种子 ' + recipe.run.seed,
    });
    return {
        checks,
        summary: {
            scriptedSteps: first.keys.length - 1,
            rngCount: first.final.rngCount,
            deterministic,
            finalStatus: first.final.status + '/' + first.final.battle.phase,
        },
    };
}
function verifyRecipe(recipe, contracts, options = {}) {
    const budget = { ...DEFAULT_BUDGET, ...options.budget };
    const checks = [structuralCheck(recipe)];
    const errors = [];
    let search;
    let replay;
    let quizSummary;
    let cardSummary;
    let dialogueSummary;
    let dialogueView;
    if (isGridRecipe(recipe)) {
        const grid = gridChecks(recipe, budget);
        checks.push(...grid.checks);
        search = grid.search;
        if (search.status === 'found')
            replay = search.actions;
        if (search.status === 'rule_error')
            errors.push(search.message);
    }
    else if (isQuizRecipe(recipe)) {
        const quiz = quizChecks(recipe);
        checks.push(...quiz.checks);
        quizSummary = quiz.summary;
    }
    else if (isDialogueRecipe(recipe)) {
        const dialogue = checkDialogue(recipe);
        checks.push(...dialogue.checks);
        dialogueSummary = dialogue.summary;
        dialogueView = {
            statesVisited: dialogue.summary.statesVisited,
            endingsReachable: dialogue.summary.endingsReachable,
            unreachableNodes: dialogue.summary.unreachableNodes,
            deadBranchNodes: dialogue.summary.deadBranchNodes,
            placeholderNodes: dialogue.summary.placeholderNodes,
            replayEndingId: dialogue.summary.replayEndingId,
            budgetExceeded: dialogue.summary.budgetExceeded,
            replay: dialogue.summary.replay,
        };
    }
    else {
        const card = cardChecks(recipe);
        checks.push(...card.checks);
        cardSummary = card.summary;
    }
    const contractChecks = checkContracts(recipe, contracts, {
        baseline: options.baseline,
        search,
        browserReplay: options.browserReplay ?? null,
        dialogue: dialogueSummary,
    });
    for (const entry of contractChecks) {
        checks.push({
            id: 'contract:' + entry.entryId,
            title: '契约 · ' + entry.description,
            kind: 'auto',
            status: entry.status,
            detail: entry.detail,
            evidence: ['contracts#' + entry.entryId],
        });
    }
    const build = buildId(recipe, options.assets ?? []);
    const testVersion = options.testVersion ?? 'verifier-1';
    const runId = options.runId ?? 'static';
    const autoChecks = checks.filter((check) => check.kind === 'auto');
    const hasFailed = autoChecks.some((check) => check.status === 'failed');
    const hasBlocked = autoChecks.some((check) => check.status === 'blocked');
    const hasUnknown = autoChecks.some((check) => check.status === 'unknown' || check.status === 'unverified');
    const hasPartial = autoChecks.some((check) => check.status === 'partial');
    const status = hasFailed ? 'failed' : hasBlocked ? 'blocked' : hasUnknown ? 'unknown' : hasPartial ? 'partial' : 'passed';
    return {
        packId: recipe.pack.id,
        status,
        recipeHash: recipeHash(recipe),
        contractHash: contractHash(contracts),
        buildId: build,
        verificationId: verificationId(build, contracts, testVersion, runId),
        engineVersion: ENGINE_VERSION,
        schemaVersion: 1,
        checks,
        contracts: contractChecks,
        search,
        replay,
        quiz: quizSummary,
        card: cardSummary,
        dialogue: dialogueView,
        errors,
        createdAt: new Date().toISOString(),
    };
}

const key = (x, y) => x + ',' + y;
const DIRS = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
];
function isWall(recipe, x, y) {
    if (x < 0 || y < 0 || x >= recipe.board.width || y >= recipe.board.height)
        return true;
    return (recipe.board.rows[y] ?? '')[x] === '#';
}
function flood(recipe, blocked) {
    const start = recipe.player.spawn;
    const seen = new Set();
    if (isWall(recipe, start.x, start.y))
        return seen;
    const queue = [start];
    seen.add(key(start.x, start.y));
    while (queue.length > 0) {
        const cell = queue.shift();
        for (const dir of DIRS) {
            const nx = cell.x + dir.x;
            const ny = cell.y + dir.y;
            const id = key(nx, ny);
            if (seen.has(id) || isWall(recipe, nx, ny) || blocked.has(id))
                continue;
            seen.add(id);
            queue.push({ x: nx, y: ny });
        }
    }
    return seen;
}
function nearestFreeCell(recipe, region, from, occupied) {
    let best = null;
    let bestDistance = Infinity;
    for (const id of region) {
        if (occupied.has(id))
            continue;
        const [x, y] = id.split(',').map(Number);
        if (x === recipe.player.spawn.x && y === recipe.player.spawn.y)
            continue;
        const distance = Math.abs(x - from.x) + Math.abs(y - from.y);
        if (distance < bestDistance || (distance === bestDistance && best !== null && (y < best.y || (y === best.y && x < best.x)))) {
            best = { x, y };
            bestDistance = distance;
        }
    }
    return best;
}
function flagsInFlagExpr(expr, out) {
    if (expr.type === 'flag_is')
        out.add(expr.flag);
    else if (expr.type === 'not')
        flagsInFlagExpr(expr.of, out);
    else
        for (const inner of expr.of)
            flagsInFlagExpr(inner, out);
}
function walkBool(expr, flags, items) {
    if (expr.type === 'flag_is')
        flags.add(expr.flag);
    else if (expr.type === 'inventory_at_least' || expr.type === 'collected_at_least')
        items.add(expr.itemType);
    else if (expr.type === 'not')
        walkBool(expr.of, flags, items);
    else if (expr.type === 'all' || expr.type === 'any')
        for (const inner of expr.of)
            walkBool(inner, flags, items);
}
function walkGoal(expr, flags, items) {
    if (expr.type === 'flag_is')
        flags.add(expr.flag);
    else if (expr.type === 'collected_at_least')
        items.add(expr.itemType);
    else if (expr.type === 'all' || expr.type === 'any')
        for (const inner of expr.of)
            walkGoal(inner, flags, items);
}
function lintGrid(recipe) {
    const findings = [];
    const placed = recipe.entities.filter((entity) => entity.kind !== 'zone');
    const ids = new Set(recipe.entities.map((entity) => entity.id));
    const spawn = recipe.player.spawn;
    if (isWall(recipe, spawn.x, spawn.y)) {
        findings.push({ ruleId: 'grid/spawn-in-wall', severity: 'error', message: '玩家出生点在墙里或地图外，游戏一开始就动不了。', targets: ['player'] });
    }
    const occupied = new Set(placed.map((entity) => key(entity.x, entity.y)));
    const allOpen = flood(recipe, new Set());
    const blockers = new Set(placed.filter((entity) => entity.kind === 'door' || entity.kind === 'gate').map((entity) => key(entity.x, entity.y)));
    const beforeDoors = flood(recipe, blockers);
    const seenCells = new Map();
    for (const entity of placed) {
        const cell = key(entity.x, entity.y);
        if (isWall(recipe, entity.x, entity.y)) {
            const target = nearestFreeCell(recipe, allOpen, entity, occupied);
            findings.push({
                ruleId: 'grid/entity-in-wall',
                severity: 'error',
                message: entity.id + ' 放在了墙里或地图外，玩家碰不到它。',
                targets: [entity.id],
                quickFix: target === null ? undefined : {
                    label: '移到最近的空地 (' + target.x + ',' + target.y + ')',
                    explain: '在玩家能走到的格子里找离原位置最近、没有其他物体的格子。',
                    ops: [{ op: 'move_entity', entityId: entity.id, x: target.x, y: target.y }],
                },
            });
            continue;
        }
        const other = seenCells.get(cell);
        if (other !== undefined) {
            const target = nearestFreeCell(recipe, allOpen, entity, occupied);
            findings.push({
                ruleId: 'grid/entity-overlap',
                severity: 'warning',
                message: entity.id + ' 和 ' + other + ' 叠在同一格 (' + entity.x + ',' + entity.y + ')。',
                targets: [entity.id, other],
                quickFix: target === null ? undefined : {
                    label: '把 ' + entity.id + ' 移到 (' + target.x + ',' + target.y + ')',
                    explain: '选离原位置最近的空地，不改动 ' + other + '。',
                    ops: [{ op: 'move_entity', entityId: entity.id, x: target.x, y: target.y }],
                },
            });
        }
        else {
            seenCells.set(cell, entity.id);
        }
        if (cell === key(spawn.x, spawn.y) && (entity.kind === 'door' || entity.kind === 'gate' || entity.kind === 'guard')) {
            findings.push({ ruleId: 'grid/spawn-blocked', severity: 'error', message: '出生点上放了 ' + entity.id + '。', targets: [entity.id, 'player'] });
        }
    }
    const items = placed.filter((entity) => entity.kind === 'item');
    const total = (itemType) => items.filter((item) => item.itemType === itemType).reduce((sum, item) => sum + item.count, 0);
    for (const door of placed) {
        if (door.kind !== 'door')
            continue;
        const need = door.requires.count;
        const have = total(door.requires.itemType);
        if (have < need) {
            const spot = nearestFreeCell(recipe, beforeDoors, spawn, occupied);
            findings.push({
                ruleId: 'grid/door-item-missing',
                severity: 'error',
                message: door.id + ' 需要 ' + need + ' 个 ' + door.requires.itemType + '，地图上只有 ' + have + ' 个，门永远打不开。',
                targets: [door.id],
                quickFix: spot === null ? undefined : {
                    label: '在出生点附近 (' + spot.x + ',' + spot.y + ') 补 ' + (need - have) + ' 个',
                    explain: '不改门的条件（创作底线常常锁定它），只补齐缺少的道具。',
                    ops: [{ op: 'add_entity', entity: { kind: 'item', id: 'item-fix-' + door.id, x: spot.x, y: spot.y, itemType: door.requires.itemType, count: need - have } }],
                },
            });
            continue;
        }
        const reachable = items.filter((item) => item.itemType === door.requires.itemType && beforeDoors.has(key(item.x, item.y)));
        const reachableCount = reachable.reduce((sum, item) => sum + item.count, 0);
        const otherBlockers = placed.filter((entity) => (entity.kind === 'door' && entity.id !== door.id) || entity.kind === 'gate').length;
        // 多门或机关门链需要状态搜索才能判断，体检只在单门场景下下结论，避免误报
        if (reachableCount < need && otherBlockers === 0) {
            const locked = items.find((item) => item.itemType === door.requires.itemType && !beforeDoors.has(key(item.x, item.y)));
            const spot = locked === undefined ? null : nearestFreeCell(recipe, beforeDoors, locked, occupied);
            findings.push({
                ruleId: 'grid/key-behind-door',
                severity: 'error',
                message: '开 ' + door.id + ' 需要的 ' + door.requires.itemType + ' 被锁在门后（或墙后），玩家拿不到。',
                targets: [door.id, ...(locked === undefined ? [] : [locked.id])],
                quickFix: locked === undefined || spot === null ? undefined : {
                    label: '把 ' + locked.id + ' 移到门前可达的 (' + spot.x + ',' + spot.y + ')',
                    explain: '在不经过任何门就能走到的区域里，选离原位置最近的空地；门、出口和胜利条件都不改。',
                    ops: [{ op: 'move_entity', entityId: locked.id, x: spot.x, y: spot.y }],
                },
            });
        }
    }
    for (const exit of placed) {
        if (exit.kind === 'exit' && !allOpen.has(key(exit.x, exit.y))) {
            findings.push({ ruleId: 'grid/exit-unreachable', severity: 'error', message: '出口 ' + exit.id + ' 被墙围死，即使所有门都打开也走不到。', targets: [exit.id] });
        }
    }
    const usedFlags = new Set();
    const usedItems = new Set();
    walkGoal(recipe.goal, usedFlags, usedItems);
    for (const door of placed)
        if (door.kind === 'door')
            usedItems.add(door.requires.itemType);
    for (const gate of placed)
        if (gate.kind === 'gate')
            flagsInFlagExpr(gate.openWhen, usedFlags);
    for (const rule of recipe.rules)
        if (rule.when !== undefined)
            walkBool(rule.when, usedFlags, usedItems);
    const settable = new Set(Object.keys(recipe.flags).filter((flag) => recipe.flags[flag] === true));
    for (const entity of placed)
        if (entity.kind === 'switch')
            settable.add(entity.flag);
    for (const rule of recipe.rules)
        for (const effect of rule.effects)
            if (effect.type === 'set_flag')
                settable.add(effect.flag);
    for (const itemType of new Set(items.map((item) => item.itemType))) {
        if (!usedItems.has(itemType)) {
            findings.push({ ruleId: 'grid/unused-item', severity: 'info', message: '道具 ' + itemType + ' 放在地图上，但门、规则和胜利条件都没用到它。', targets: items.filter((item) => item.itemType === itemType).map((item) => item.id) });
        }
    }
    for (const entity of placed) {
        if (entity.kind === 'switch' && !usedFlags.has(entity.flag)) {
            findings.push({ ruleId: 'grid/switch-unused', severity: 'warning', message: '开关 ' + entity.id + ' 设置的标记 ' + entity.flag + ' 没有被任何机关门、规则或胜利条件使用。', targets: [entity.id] });
        }
        if (entity.kind === 'gate') {
            const needed = new Set();
            flagsInFlagExpr(entity.openWhen, needed);
            const never = [...needed].filter((flag) => !settable.has(flag) && !(flag in recipe.flags));
            if (never.length > 0) {
                findings.push({ ruleId: 'grid/gate-never-opens', severity: 'error', message: '机关门 ' + entity.id + ' 依赖的标记 ' + never.join('、') + ' 没有任何开关或规则会设置。', targets: [entity.id] });
            }
        }
        if (entity.kind === 'guard') {
            const bad = entity.route.filter((point) => isWall(recipe, point.x, point.y));
            if (bad.length > 0) {
                findings.push({ ruleId: 'grid/guard-route-wall', severity: 'error', message: '守卫 ' + entity.id + ' 的巡逻点 ' + bad.map((point) => '(' + point.x + ',' + point.y + ')').join('、') + ' 在墙里。', targets: [entity.id] });
            }
        }
    }
    for (const rule of recipe.rules) {
        const ref = rule.event.type === 'item_collected' || rule.event.type === 'switch_activated' ? rule.event.entityId : rule.event.type === 'player_entered_zone' ? rule.event.zoneId : null;
        if (ref !== null && !ids.has(ref)) {
            findings.push({ ruleId: 'grid/rule-dangling-ref', severity: 'error', message: '规则 ' + rule.id + ' 引用了不存在的对象 ' + ref + '，永远不会触发。', targets: [rule.id] });
        }
    }
    return findings;
}
function lintQuiz(recipe) {
    const findings = [];
    const questions = recipe.quiz.questions;
    if (questions.length === 0)
        findings.push({ ruleId: 'quiz/no-questions', severity: 'error', message: '还没有任何题目。', targets: [] });
    const prompts = new Map();
    for (const question of questions) {
        const text = question.prompt.trim();
        const dup = prompts.get(text);
        if (dup !== undefined)
            findings.push({ ruleId: 'quiz/duplicate-prompt', severity: 'warning', message: question.id + ' 和 ' + dup + ' 题干完全相同。', targets: [question.id, dup] });
        else
            prompts.set(text, question.id);
        if (question.type === 'single_choice' || question.type === 'multi_choice') {
            const optionIds = question.options.map((option) => option.id);
            const missing = question.answerKey.filter((id) => !optionIds.includes(id));
            if (missing.length > 0)
                findings.push({ ruleId: 'quiz/answer-not-in-options', severity: 'error', message: question.id + ' 的答案 ' + missing.join('、') + ' 不在选项里，这题永远答不对。', targets: [question.id] });
            if (question.type === 'single_choice' && question.answerKey.length !== 1)
                findings.push({ ruleId: 'quiz/single-answer-count', severity: 'error', message: question.id + ' 是单选题，却有 ' + question.answerKey.length + ' 个答案。', targets: [question.id] });
            const texts = question.options.map((option) => option.text.trim());
            if (new Set(texts).size !== texts.length)
                findings.push({ ruleId: 'quiz/duplicate-option', severity: 'warning', message: question.id + ' 有两个选项文字一样，玩家没法区分。', targets: [question.id] });
        }
        if (question.type === 'matching') {
            if (question.pairs.length < 2)
                findings.push({ ruleId: 'quiz/matching-too-short', severity: 'error', message: question.id + ' 的配对题至少需要 2 对。', targets: [question.id] });
            const lefts = question.pairs.map((pair) => pair.left.trim());
            const rights = question.pairs.map((pair) => pair.right.trim());
            if (new Set(lefts).size !== lefts.length || new Set(rights).size !== rights.length) {
                findings.push({ ruleId: 'quiz/matching-duplicate', severity: 'error', message: question.id + ' 的配对题有重复的左项或右项，玩家无法唯一匹配。', targets: [question.id] });
            }
            if (new Set(rights).size !== question.pairs.length)
                findings.push({ ruleId: 'quiz/matching-not-one-to-one', severity: 'error', message: question.id + ' 的配对不是一对一。', targets: [question.id] });
        }
        if (question.type === 'short_text' && question.answerKey.some((answer) => answer.trim().length === 0)) {
            findings.push({ ruleId: 'quiz/empty-answer', severity: 'error', message: question.id + ' 的参考答案里有空字符串。', targets: [question.id] });
        }
    }
    return findings;
}
function lintCard(recipe) {
    const findings = [];
    const cardIds = recipe.cards.map((card) => card.id);
    const energy = recipe.run.energyPerTurn;
    const canGainEnergy = recipe.cards.some((card) => card.effects.some((effect) => effect.kind === 'gain_energy'));
    for (const card of recipe.cards) {
        if (card.cost > energy && !canGainEnergy) {
            findings.push({
                ruleId: 'card/unplayable-cost',
                severity: 'error',
                message: card.name + '（' + card.id + '）费用 ' + card.cost + '，但每回合只有 ' + energy + ' 点能量，永远打不出来。',
                targets: [card.id],
                quickFix: { label: '费用改为 ' + energy, explain: '把费用降到每回合能量上限。', ops: [{ op: 'update_card', cardId: card.id, changes: { cost: energy } }] },
            });
        }
    }
    const missing = recipe.deck.filter((id) => !cardIds.includes(id));
    if (missing.length > 0) {
        const kept = recipe.deck.filter((id) => cardIds.includes(id));
        findings.push({
            ruleId: 'card/deck-missing-card',
            severity: 'error',
            message: '牌组里有不存在的卡：' + [...new Set(missing)].join('、') + '。',
            targets: [...new Set(missing)],
            quickFix: kept.length >= 5 ? { label: '从牌组移除这些卡', explain: '保留其余 ' + kept.length + ' 张。', ops: [{ op: 'set_deck', deck: kept }] } : undefined,
        });
    }
    const deckCards = recipe.cards.filter((card) => recipe.deck.includes(card.id));
    if (!deckCards.some((card) => card.effects.some((effect) => effect.kind === 'damage'))) {
        findings.push({ ruleId: 'card/no-damage', severity: 'error', message: '起始牌组里没有任何造成伤害的卡，打不赢敌人。', targets: [] });
    }
    for (const enemy of recipe.enemies) {
        if (enemy.intents.length === 0)
            findings.push({ ruleId: 'card/enemy-no-intent', severity: 'error', message: '敌人 ' + enemy.name + ' 没有任何行动。', targets: [enemy.id] });
    }
    if (recipe.enemies.length === 0)
        findings.push({ ruleId: 'card/no-enemy', severity: 'error', message: '还没有敌人。', targets: [] });
    return findings;
}
function lintDialogue(recipe) {
    const findings = [];
    const nodeIds = new Set(recipe.dialogue.nodes.map((node) => node.id));
    const declared = new Set(recipe.dialogue.flags.map((flag) => flag.id));
    if (!nodeIds.has(recipe.dialogue.startNodeId))
        findings.push({ ruleId: 'dialogue/missing-start', severity: 'error', message: '起始节点 ' + recipe.dialogue.startNodeId + ' 不存在。', targets: [] });
    const checkFlags = (owner, flags) => {
        const unknown = flags.filter((flag) => !declared.has(flag));
        if (unknown.length > 0)
            findings.push({ ruleId: 'dialogue/undeclared-flag', severity: 'error', message: owner + ' 用到了没声明的标记 ' + unknown.join('、') + '。', targets: [owner] });
    };
    for (const node of recipe.dialogue.nodes) {
        if (node.text.trim().length === 0)
            findings.push({ ruleId: 'dialogue/empty-line', severity: 'warning', message: '节点 ' + node.id + ' 台词为空。', targets: [node.id] });
        if (node.goto !== undefined && !nodeIds.has(node.goto))
            findings.push({ ruleId: 'dialogue/dead-link', severity: 'error', message: '节点 ' + node.id + ' 指向不存在的节点 ' + node.goto + '。', targets: [node.id] });
        checkFlags(node.id, node.set ?? []);
        const texts = new Set();
        for (const choice of node.choices ?? []) {
            if (!nodeIds.has(choice.goto))
                findings.push({ ruleId: 'dialogue/dead-link', severity: 'error', message: '选项 ' + choice.id + ' 指向不存在的节点 ' + choice.goto + '。', targets: [node.id, choice.id] });
            const required = new Set();
            for (const expr of choice.require ?? [])
                flagsInFlagExpr(expr, required);
            checkFlags(choice.id, [...(choice.set ?? []), ...required]);
            const text = choice.text.trim();
            if (texts.has(text))
                findings.push({ ruleId: 'dialogue/duplicate-choice', severity: 'warning', message: '节点 ' + node.id + ' 有两个选项文字一样。', targets: [node.id] });
            texts.add(text);
        }
    }
    for (const ending of recipe.dialogue.endings) {
        const required = new Set();
        for (const expr of ending.require)
            flagsInFlagExpr(expr, required);
        checkFlags(ending.id, [...required]);
    }
    return findings;
}
function lintRecipe(recipe, context = {}) {
    const findings = isGridRecipe(recipe)
        ? lintGrid(recipe)
        : isQuizRecipe(recipe)
            ? lintQuiz(recipe)
            : isCardRecipe(recipe)
                ? lintCard(recipe)
                : isDialogueRecipe(recipe)
                    ? lintDialogue(recipe)
                    : [];
    if (context.assetIds !== undefined) {
        const known = new Set(context.assetIds);
        for (const slot of recipe.presentation.assets) {
            if (!known.has(slot.assetId))
                findings.push({ ruleId: 'assets/missing', severity: 'error', message: '素材槽 ' + slot.slot + ' 引用的素材 ' + slot.assetId + ' 不存在或已删除。', targets: [slot.slot] });
        }
    }
    const order = { error: 0, warning: 1, info: 2 };
    return findings
        .sort((a, b) => order[a.severity] - order[b.severity])
        .map((finding) => ({ ...finding, origin: 'local', suggestedGuidance: finding.suggestedGuidance ?? '自动体检发现：' + finding.message + ' 请修复这个问题，不要改动其他内容。' }));
}

const theme = {
    background: '#0b1220',
    floor: '#1e293b',
    wall: '#475569',
    accent: '#fbbf24',
    text: '#e2e8f0',
};
const lightTheme = {
    background: '#f8fafc',
    floor: '#e2e8f0',
    wall: '#94a3b8',
    accent: '#2563eb',
    text: '#0f172a',
};
function presentation(themeValue) {
    return { theme: themeValue, cellSize: 48, sounds: false, assets: [] };
}
function starterGrid(packId, name, idea) {
    const rows = [
        '########',
        '#......#',
        '#......#',
        '#......#',
        '#......#',
        '#......#',
        '#......#',
        '########',
    ];
    return {
        schemaVersion: 1,
        pack: { id: packId, version: 1 },
        meta: { name, description: idea.length > 0 ? idea : '一个从空白骨架开始的小游戏。', controls: '方向键/WASD 移动，E 交互，Space 等待，R 重开' },
        board: { width: 8, height: 8, rows },
        player: { spawn: { x: 1, y: 1 }, facing: 'down' },
        entities: [{ kind: 'exit', id: 'exit-1', x: 6, y: 6, label: '出口' }],
        flags: {},
        rules: [],
        goal: { type: 'at_exit' },
        presentation: presentation(theme),
        generation: { method: 'handwritten', note: '空白骨架' },
    };
}
function starterQuiz(name, idea) {
    const questions = [
        {
            type: 'single_choice',
            id: 'q-01',
            prompt: '新题目',
            options: [
                { id: 'a', text: '选项 A' },
                { id: 'b', text: '选项 B' },
            ],
            answerKey: ['a'],
            explanation: '',
            source: '空白新建',
            reviewed: false,
        },
    ];
    return {
        schemaVersion: 1,
        pack: { id: 'quiz', version: 1 },
        meta: { name, description: idea.length > 0 ? idea : '一个从空白骨架开始的知识闯关。', controls: '鼠标选择选项，回车提交，继续进入下一题' },
        quiz: { questions, lives: 3, order: 'fixed', seed: 2026, pointsPerCorrect: 10, comboBonus: 2 },
        presentation: presentation(lightTheme),
        generation: { method: 'handwritten', note: '空白骨架' },
    };
}
function starterCard(name, idea) {
    const cards = [
        { id: 'strike', name: '打击', cost: 1, rarity: 'starter', effects: [{ kind: 'damage', amount: 6 }], description: '造成 6 点伤害' },
        { id: 'defend', name: '防御', cost: 1, rarity: 'starter', effects: [{ kind: 'block', amount: 5 }], description: '获得 5 点格挡' },
        { id: 'jab', name: '刺击', cost: 0, rarity: 'common', effects: [{ kind: 'damage', amount: 3 }], description: '造成 3 点伤害' },
        { id: 'focus', name: '专注', cost: 1, rarity: 'common', effects: [{ kind: 'gain_strength', amount: 1 }], description: '获得 1 点力量' },
        { id: 'insight', name: '洞察', cost: 1, rarity: 'common', effects: [{ kind: 'draw', amount: 1 }], description: '抽 1 张牌' },
    ];
    return {
        schemaVersion: 1,
        pack: { id: 'card', version: 1 },
        meta: { name, description: idea.length > 0 ? idea : '一个从空白骨架开始的卡牌小战。', controls: '点击手牌出牌，点击结束回合' },
        cards,
        deck: ['strike', 'strike', 'strike', 'defend', 'defend', 'jab', 'focus'],
        enemies: [{ id: 'opponent', name: '对手', hp: 12, intents: [{ kind: 'attack', amount: 4 }, { kind: 'block', amount: 3 }] }],
        run: { battles: 1, startingHp: 30, energyPerTurn: 3, seed: 20261112, rewardChoices: 3 },
        presentation: presentation({ ...lightTheme, background: '#1c1917', floor: '#292524', wall: '#57534e' }),
        generation: { method: 'handwritten', note: '空白骨架' },
    };
}
function starterDialogue(name, idea) {
    return {
        schemaVersion: 1,
        pack: { id: 'dialogue', version: 1 },
        meta: {
            name,
            description: idea.length > 0 ? idea : '一个从空白骨架开始的分支对话故事。',
            controls: 'Enter 推进，数字键 1-4 选择',
        },
        dialogue: {
            startNodeId: 'n-start',
            maxSteps: 60,
            flags: [{ id: 'flag-1', initial: false }],
            nodes: [
                {
                    id: 'n-start',
                    speaker: '旁白',
                    text: '在这里写下故事的第一句。',
                    goto: 'n-end',
                    reviewed: false,
                },
                {
                    id: 'n-end',
                    speaker: '旁白',
                    text: '在这里写下结局。',
                    reviewed: false,
                },
            ],
            endings: [{ id: 'ending-end', title: '结局', require: [], text: '在这里写下结局。' }],
        },
        presentation: presentation({ ...lightTheme, background: '#111827', floor: '#1f2937', wall: '#4b5563' }),
        generation: { method: 'handwritten', note: '空白新建' },
    };
}
function createStarterRecipe(packId, name, idea) {
    if (packId === 'quiz')
        return starterQuiz(name, idea);
    if (packId === 'card')
        return starterCard(name, idea);
    if (packId === 'dialogue')
        return starterDialogue(name, idea);
    return starterGrid(packId, name, idea);
}

function nextVersionLabel(labels, bump) {
    let major = 0;
    let minor = 0;
    for (const label of labels) {
        if (label === undefined)
            continue;
        const [a, b] = label.split('.').map((part) => Number(part));
        if (!Number.isFinite(a) || !Number.isFinite(b))
            continue;
        if (a > major || (a === major && b > minor)) {
            major = a;
            minor = b;
        }
    }
    if (major === 0)
        return '1.0';
    return bump === 'major' ? major + 1 + '.0' : major + '.' + (minor + 1);
}
async function readJson(path) {
    try {
        const text = await readFile(path, 'utf8');
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
async function writeJsonAtomic(path, value) {
    await mkdir(dirname(path), { recursive: true });
    const tmp = path + '.' + randomUUID() + '.tmp';
    await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
    await rename(tmp, path);
}
/** Windows 上目录里还有没释放的文件句柄时 rename 会 EPERM/EBUSY，稍等一下再试就能过去。 */
async function renameWhenFree(source, target, attempts = 4) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            await rename(source, target);
            return;
        }
        catch (error) {
            const code = error.code;
            const busy = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
            if (!busy || attempt === attempts - 1)
                throw error;
            await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
        }
    }
}
class Storage {
    dataRoot;
    repoRoot;
    /** 同一工程的 read-modify-write 串行化，避免并发请求生成相同 vN 或互相覆盖 project.json。 */
    projectQueues = new Map();
    constructor(options) {
        this.dataRoot = options.dataRoot;
        this.repoRoot = options.repoRoot;
    }
    async withProjectLock(projectId, action) {
        const previous = this.projectQueues.get(projectId);
        let release;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        const tail = (previous ?? Promise.resolve()).then(() => gate);
        this.projectQueues.set(projectId, tail);
        if (previous !== undefined)
            await previous;
        try {
            return await action();
        }
        finally {
            release();
            if (this.projectQueues.get(projectId) === tail)
                this.projectQueues.delete(projectId);
        }
    }
    async mutateProject(projectId, mutate) {
        return this.withProjectLock(projectId, async () => {
            const project = await this.requireProject(projectId);
            const result = await mutate(project);
            await writeJsonAtomic(join(this.projectDir(projectId), 'project.json'), project);
            return result;
        });
    }
    async init() {
        await mkdir(join(this.dataRoot, 'projects'), { recursive: true });
    }
    safeId(id) {
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
            throw Object.assign(new Error('非法的标识符'), { code: 'INVALID_ARGUMENT' });
        }
        return id;
    }
    projectDir(id) {
        return join(this.dataRoot, 'projects', this.safeId(id));
    }
    versionDir(projectId, versionId) {
        return join(this.projectDir(projectId), 'versions', this.safeId(versionId));
    }
    async listProjects() {
        const root = join(this.dataRoot, 'projects');
        const entries = await readdir(root).catch(() => []);
        const projects = [];
        for (const entry of entries) {
            const meta = await readJson(join(root, entry, 'project.json'));
            if (meta !== null)
                projects.push(meta);
        }
        return projects.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    }
    async getProject(id) {
        return readJson(join(this.projectDir(id), 'project.json'));
    }
    async requireProject(id) {
        const project = await this.getProject(id);
        if (project === null)
            throw Object.assign(new Error('project not found'), { code: 'NOT_FOUND' });
        return project;
    }
    async getRecipe(projectId, versionId) {
        const recipe = await readJson(join(this.versionDir(projectId, versionId), 'recipe.json'));
        if (recipe === null)
            return null;
        const parsed = parseRecipe(recipe);
        if (!parsed.ok)
            return null;
        return parsed.value;
    }
    async getVersionMeta(projectId, versionId) {
        return readJson(join(this.versionDir(projectId, versionId), 'meta.json'));
    }
    sampleRecipe(sample) {
        return null;
    }
    async loadSample(sample) {
        const base = join(this.repoRoot, 'examples', sample);
        const recipeRaw = await readJson(join(base, 'recipe.json'));
        const contractsRaw = await readJson(join(base, 'contracts.json'));
        if (recipeRaw === null || contractsRaw === null)
            throw Object.assign(new Error('sample not found'), { code: 'NOT_FOUND' });
        const parsed = parseRecipe(recipeRaw);
        if (!parsed.ok)
            throw Object.assign(new Error('sample recipe invalid'), { code: 'RECIPE_INVALID' });
        return { recipe: parsed.value, entries: contractsRaw.entries };
    }
    async createProject(input) {
        const id = randomUUID();
        let recipe;
        let entries = [];
        let sample = null;
        if (input.imported !== undefined) {
            recipe = input.imported.recipe;
        }
        else if (input.sample !== undefined) {
            const loaded = await this.loadSample(input.sample);
            recipe = loaded.recipe;
            entries = loaded.entries;
            sample = input.sample;
        }
        else {
            const packId = input.packId ?? 'puzzle';
            recipe = createStarterRecipe(packId, input.name ?? '未命名游戏', input.idea ?? '');
        }
        const name = input.name !== undefined && input.name.trim().length > 0 ? input.name.trim().slice(0, 60) : recipe.meta.name;
        const now = new Date().toISOString();
        const versionId = 'v1';
        const projectId = id;
        const recipeWithMeta = { ...recipe, meta: { ...recipe.meta, name } };
        const issues = validateRecipe(recipeWithMeta);
        if (issues.length > 0) {
            throw Object.assign(new Error('recipe rejected: ' + issues.map((issue) => issue.path + ' ' + issue.message).join('; ')), { code: 'RECIPE_INVALID' });
        }
        const contracts = {
            contractVersion: 1,
            id: 'contracts-' + projectId,
            projectId,
            entries,
            createdAt: now,
            confirmedAt: null,
        };
        const version = {
            id: versionId,
            createdAt: now,
            note: input.imported !== undefined ? input.imported.note : sample === null ? '初始骨架' : '来自样例 ' + sample,
            source: sample === null ? 'user' : 'sample',
            buildId: buildId(recipeWithMeta),
            recipeHash: recipeHash(recipeWithMeta),
            status: 'stable',
            parentId: null,
            verified: null,
            label: '1.0',
        };
        const project = {
            id: projectId,
            name,
            packId: recipeWithMeta.pack.id,
            createdAt: now,
            updatedAt: now,
            currentVersionId: versionId,
            adoptedVersionId: versionId,
            lastVerifiedVersionId: null,
            versions: [version],
            contracts,
            sample,
            ...(input.imported?.origin === undefined ? {} : { origin: input.imported.origin }),
        };
        await mkdir(this.versionDir(projectId, versionId), { recursive: true });
        await writeJsonAtomic(join(this.versionDir(projectId, versionId), 'recipe.json'), recipeWithMeta);
        await writeJsonAtomic(join(this.versionDir(projectId, versionId), 'meta.json'), {
            buildId: version.buildId,
            note: version.note,
            source: version.source,
            createdAt: version.createdAt,
        });
        await writeJsonAtomic(join(this.projectDir(projectId), 'project.json'), project);
        return project;
    }
    async addVersion(projectId, input) {
        const issues = validateRecipe(input.recipe);
        if (issues.length > 0) {
            throw Object.assign(new Error(issues.map((issue) => issue.path + ' ' + issue.message).join('; ')), { code: 'RECIPE_INVALID' });
        }
        return this.mutateProject(projectId, async (project) => {
            if (input.expectedCurrentVersionId !== undefined && project.currentVersionId !== input.expectedCurrentVersionId) {
                throw Object.assign(new Error('当前版本已变化，请刷新后再保存'), { code: 'VERSION_CONFLICT' });
            }
            let nextNumber = project.versions.length + 1;
            while (project.versions.some((version) => version.id === 'v' + nextNumber))
                nextNumber += 1;
            const versionId = 'v' + nextNumber;
            const now = new Date().toISOString();
            const version = {
                id: versionId,
                createdAt: now,
                note: input.note.slice(0, 300),
                source: input.source,
                buildId: buildId(input.recipe),
                recipeHash: recipeHash(input.recipe),
                status: input.status ?? 'candidate',
                parentId: input.parentId,
                verified: null,
            };
            await mkdir(this.versionDir(projectId, versionId), { recursive: true });
            await writeJsonAtomic(join(this.versionDir(projectId, versionId), 'recipe.json'), input.recipe);
            await writeJsonAtomic(join(this.versionDir(projectId, versionId), 'meta.json'), {
                buildId: version.buildId,
                note: version.note,
                source: version.source,
                createdAt: version.createdAt,
            });
            project.versions.push(version);
            project.currentVersionId = versionId;
            project.updatedAt = now;
            return { project, version };
        });
    }
    async confirmContracts(projectId, entries, confirmedBy) {
        return this.mutateProject(projectId, (project) => {
            const confirmedAt = new Date().toISOString();
            const contracts = {
                ...project.contracts,
                entries,
                confirmedAt,
                id: 'contracts-' + projectId + '-' + Date.now().toString(36) + '-' + randomUUID().slice(0, 8),
            };
            project.contracts = contracts;
            project.updatedAt = confirmedAt;
            return contracts;
        });
    }
    async adopt(projectId, versionId, bump = 'minor') {
        return this.mutateProject(projectId, (project) => {
            const target = project.versions.find((version) => version.id === versionId);
            if (target === undefined) {
                throw Object.assign(new Error('version not found'), { code: 'NOT_FOUND' });
            }
            if (target.label === undefined) {
                target.label = nextVersionLabel(project.versions.map((version) => version.label), bump);
                target.status = 'stable';
            }
            project.adoptedVersionId = versionId;
            project.currentVersionId = versionId;
            project.updatedAt = new Date().toISOString();
            return project;
        });
    }
    async recordVerification(projectId, versionId, report) {
        return this.mutateProject(projectId, (project) => {
            const version = project.versions.find((item) => item.id === versionId);
            if (version !== undefined) {
                version.verified = { status: report.status, verificationId: report.verificationId, at: new Date().toISOString() };
            }
            project.lastVerifiedVersionId = versionId;
            project.updatedAt = new Date().toISOString();
            return project;
        });
    }
    async recordReplayEvidence(projectId, versionId, evidence) {
        const dir = join(this.projectDir(projectId), 'versions', this.safeId(versionId));
        await mkdir(dir, { recursive: true });
        await writeJsonAtomic(join(dir, 'replay-evidence.json'), evidence);
    }
    async getReplayEvidence(projectId, versionId) {
        try {
            return await readJson(join(this.projectDir(projectId), 'versions', this.safeId(versionId), 'replay-evidence.json'));
        }
        catch {
            return null;
        }
    }
    async runDir(projectId, runId) {
        const dir = join(this.projectDir(projectId), 'runs', runId);
        await mkdir(dir, { recursive: true });
        return dir;
    }
    async writeRunFile(projectId, runId, name, content) {
        const dir = await this.runDir(projectId, runId);
        const path = join(dir, name);
        await mkdir(dirname(path), { recursive: true });
        // 临时文件 + rename：两次并发 persist 交错时不会留下被截断的 run.json / events.jsonl。
        const tmp = path + '.' + randomUUID() + '.tmp';
        await writeFile(tmp, content, 'utf8');
        await rename(tmp, path);
        return path;
    }
    async readRunFile(projectId, runId, name, maxBytes = 20000) {
        try {
            const path = join(this.projectDir(projectId), 'runs', runId, name);
            const info = await stat(path);
            if (!info.isFile())
                return null;
            const text = await readFile(path, 'utf8');
            return text.slice(0, maxBytes);
        }
        catch {
            return null;
        }
    }
    async markInterruptedRuns() {
        const root = join(this.dataRoot, 'projects');
        const projects = await readdir(root).catch(() => []);
        let count = 0;
        for (const project of projects) {
            const runsDir = join(root, project, 'runs');
            const runs = await readdir(runsDir).catch(() => []);
            for (const run of runs) {
                const file = join(runsDir, run, 'run.json');
                const data = await readJson(file);
                if (data === null)
                    continue;
                const status = String(data.status ?? '');
                if (['completed', 'failed', 'cancelled', 'ready_for_review', 'blocked'].includes(status))
                    continue;
                data.status = 'cancelled';
                data.interrupted = true;
                data.recoveredAt = new Date().toISOString();
                await writeJsonAtomic(file, data);
                count += 1;
            }
        }
        return count;
    }
    /** 删除一个会话线程的全部 run 目录；调用方需先确认线程里没有未结束的任务。 */
    async deleteThreadRuns(projectId, threadId) {
        const dir = join(this.projectDir(projectId), 'runs');
        const entries = await readdir(dir).catch(() => []);
        const removed = [];
        for (const entry of entries) {
            const data = await readJson(join(dir, entry, 'run.json'));
            if (data === null || data.threadId !== threadId)
                continue;
            await rm(join(dir, entry), { recursive: true, force: true });
            removed.push(entry);
        }
        return removed;
    }
    async listRuns(projectId) {
        const dir = join(this.projectDir(projectId), 'runs');
        return (await readdir(dir).catch(() => [])).sort();
    }
    async saveReport(projectId, report) {
        const dir = join(this.projectDir(projectId), 'reports');
        await mkdir(dir, { recursive: true });
        const file = this.safeId(String(report.verificationId ?? Date.now().toString(36)));
        await writeJsonAtomic(join(dir, file + '.json'), report);
    }
    async getReport(projectId, verificationId) {
        // 与其它外部可控标识符一样走白名单，否则 URL 里的 ../ 能读到别的工程文件。
        return readJson(join(this.projectDir(projectId), 'reports', this.safeId(verificationId) + '.json'));
    }
    async listAssets(projectId) {
        return (await readJson(join(this.projectDir(projectId), 'assets', 'manifest.json'))) ?? [];
    }
    async addAsset(projectId, asset, bytes) {
        const dir = join(this.projectDir(projectId), 'assets');
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, asset.contentHash + '.' + asset.mime.split('/')[1]), bytes);
        const assets = await this.listAssets(projectId);
        assets.push(asset);
        await writeJsonAtomic(join(dir, 'manifest.json'), assets);
        return assets;
    }
    async projectStorageUsage(projectId) {
        const dir = this.projectDir(projectId);
        let total = 0;
        const walk = async (current) => {
            const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
            for (const entry of entries) {
                const target = join(current, entry.name);
                if (entry.isDirectory())
                    await walk(target);
                else
                    total += (await stat(target).catch(() => ({ size: 0 }))).size;
            }
        };
        await walk(dir);
        return total;
    }
    async setReviewMode(projectId, mode) {
        return this.mutateProject(projectId, (project) => {
            project.reviewMode = mode;
            project.updatedAt = new Date().toISOString();
            return project;
        });
    }
    trashRoot() {
        return join(this.dataRoot, 'trash');
    }
    trashDir(id) {
        return join(this.trashRoot(), this.safeId(id));
    }
    /** 删除先进回收站（整目录移动，可还原），不直接抹掉证据。 */
    async moveToTrash(projectId) {
        const project = await this.requireProject(projectId);
        const bytes = await this.projectStorageUsage(projectId);
        const target = this.trashDir(projectId);
        await mkdir(this.trashRoot(), { recursive: true });
        await rm(target, { recursive: true, force: true });
        await renameWhenFree(this.projectDir(projectId), target);
        const entry = {
            id: projectId,
            name: project.name,
            packId: project.packId,
            deletedAt: new Date().toISOString(),
            bytes,
            versions: project.versions.length,
        };
        await writeJsonAtomic(join(target, 'trash.json'), entry);
        return entry;
    }
    async listTrash() {
        const entries = await readdir(this.trashRoot()).catch(() => []);
        const items = [];
        for (const entry of entries) {
            const meta = await readJson(join(this.trashRoot(), entry, 'trash.json'));
            if (meta !== null)
                items.push(meta);
        }
        return items.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));
    }
    async restoreFromTrash(projectId) {
        const source = this.trashDir(projectId);
        const info = await readJson(join(source, 'trash.json'));
        if (info === null)
            throw Object.assign(new Error('回收站里没有这个项目'), { code: 'NOT_FOUND' });
        const target = this.projectDir(projectId);
        if ((await stat(target).catch(() => null)) !== null) {
            // 只有「被删除后仍在收尾的长任务重建出的幽灵目录」才允许清理：它没有
            // project.json，且带 runs/ 或 exports/ 任务产物。其余同名目录一律不覆盖。
            const ghost = await readJson(join(target, 'project.json'));
            const taskRuns = await stat(join(target, 'runs')).catch(() => null);
            const taskExports = await stat(join(target, 'exports')).catch(() => null);
            if (ghost !== null || (taskRuns === null && taskExports === null)) {
                throw Object.assign(new Error('同名项目已经存在，无法还原'), { code: 'CONFLICT' });
            }
            await rm(target, { recursive: true, force: true });
        }
        await mkdir(join(this.dataRoot, 'projects'), { recursive: true });
        await renameWhenFree(source, target);
        await rm(join(target, 'trash.json'), { force: true });
        const project = await this.getProject(projectId);
        if (project === null)
            throw Object.assign(new Error('还原后读不到项目'), { code: 'INTERNAL_ERROR' });
        return project;
    }
    /** 回收站里彻底删除，不可恢复。 */
    async purgeTrash(projectId) {
        await rm(this.trashDir(projectId), { recursive: true, force: true });
    }
    async emptyTrash() {
        const entries = await this.listTrash();
        for (const entry of entries)
            await this.purgeTrash(entry.id);
        return entries.length;
    }
    snapshotContractBaseline(projectId) {
        return [];
    }
    quizUnreviewed(recipe) {
        if (!isQuizRecipe(recipe))
            return 0;
        return recipe.quiz.questions.filter((question) => !question.reviewed).length;
    }
    contractHashOf(contracts) {
        return contractHash(contracts);
    }
}

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[index] = value >>> 0;
    }
    return table;
})();
function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function dosTime(date) {
    return {
        time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
        date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
}
/** Minimal deterministic ZIP writer (no external binaries). */
function createZip(entries, now = new Date()) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    const stamp = dosTime(now);
    for (const entry of entries) {
        const name = Buffer.from(entry.path.split('\\').join('/'), 'utf8');
        const compress = entry.compress !== false && entry.data.length > 64;
        const body = compress ? deflateRawSync(entry.data) : entry.data;
        const method = compress ? 8 : 0;
        const crc = crc32(entry.data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6);
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(stamp.time, 10);
        local.writeUInt16LE(stamp.date, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(entry.data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);
        locals.push(local, name, body);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(method, 10);
        central.writeUInt16LE(stamp.time, 12);
        central.writeUInt16LE(stamp.date, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(body.length, 20);
        central.writeUInt32LE(entry.data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        central.writeUInt32LE(0, 38);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, name);
        offset += local.length + name.length + body.length;
    }
    const centralBuffer = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralBuffer.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);
    return Buffer.concat([...locals, centralBuffer, eocd]);
}

const SOURCE_INCLUDE = [
    'package.json',
    'pnpm-workspace.yaml',
    'tsconfig.json',
    'packages/shared',
    'packages/schema',
    'packages/kernel-grid',
    'packages/kernel-quiz',
    'packages/kernel-card',
    'packages/kernel-dialogue',
    'packages/runtime',
    'apps/player',
    // build-player.mjs 会从这里复制样式表；缺了它重建出的播放器会完全没有样式。
    'apps/web/src/styles.css',
    'scripts/build-player.mjs',
];
async function collectFiles(root, relativePath, out) {
    const abs = join(root, relativePath);
    const info = await stat(abs).catch(() => null);
    if (info === null)
        return;
    if (info.isDirectory()) {
        const entries = await readdir(abs);
        for (const entry of entries.sort()) {
            if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.'))
                continue;
            await collectFiles(root, join(relativePath, entry), out);
        }
        return;
    }
    out.push({ path: relativePath.split('\\').join('/'), abs });
}
const START_GAME_CMD = [
    '@echo off',
    'setlocal',
    'chcp 65001 >nul',
    'cd /d "%~dp0"',
    'if exist "runtime\\node.exe" (',
    '  set "NODE_EXE=%~dp0runtime\\node.exe"',
    ') else (',
    '  where node >nul 2>nul',
    '  if errorlevel 1 (',
    '    echo 找不到 Node 运行时，请保留 runtime 目录或安装 Node.js 后重试。',
    '    pause',
    '    exit /b 1',
    '  )',
    '  set "NODE_EXE=node"',
    ')',
    '"%NODE_EXE%" server.mjs',
    'pause',
].join('\r\n');
const SERVER_MJS = [
    "import { createServer } from 'node:http';",
    "import { readFile, stat } from 'node:fs/promises';",
    "import { extname, join, normalize, sep } from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    '',
    "const root = fileURLToPath(new URL('.', import.meta.url));",
    "const gameDir = join(root, 'game');",
    "const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mpeg': 'audio/mpeg' };",
    '',
    'const server = createServer(async (req, res) => {',
    '  const url = new URL(req.url ?? "/", "http://127.0.0.1");',
    '  let pathname = decodeURIComponent(url.pathname);',
    '  if (pathname === "/") pathname = "/index.html";',
    '  const target = normalize(join(gameDir, pathname));',
    '  if (!target.startsWith(gameDir + sep)) { res.writeHead(403).end("forbidden"); return; }',
    '  try {',
    '    const info = await stat(target);',
    '    if (!info.isFile()) { res.writeHead(404).end("not found"); return; }',
    '    const body = await readFile(target);',
    '    res.writeHead(200, { "content-type": types[extname(target)] ?? "application/octet-stream", "cache-control": "no-store" });',
    '    res.end(body);',
    '  } catch { res.writeHead(404).end("not found"); }',
    '});',
    '',
    'server.listen(0, "127.0.0.1", () => {',
    '  const address = server.address();',
    '  const port = typeof address === "object" && address !== null ? address.port : 0;',
    '  console.log("游戏已启动：http://127.0.0.1:" + port + "/");',
    '  const opener = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";',
    '  import("node:child_process").then(({ spawn }) => {',
    '    const args = process.platform === "win32" ? ["/c", "start", "", "http://127.0.0.1:" + port + "/"] : ["http://127.0.0.1:" + port + "/"];',
    '    try { spawn(opener, args, { detached: true, stdio: "ignore" }).unref(); } catch (error) {}',
    '  });',
    '});',
].join('\n');
async function buildGameExport(options) {
    const entries = [];
    const distFiles = [];
    await collectFiles(options.playerDistDir, '', distFiles);
    for (const file of distFiles) {
        entries.push({ path: 'game/' + file.path, data: await readFile(file.abs) });
    }
    const recipeJson = JSON.stringify(options.recipe, null, 2) + '\n';
    entries.push({ path: 'recipe.json', data: Buffer.from(recipeJson, 'utf8') });
    // 播放器从自己所在目录取 recipe/manifest/assets，所以 game/ 内也必须有一份，双击 Start-Game.cmd 才能直接跑起来。
    entries.push({ path: 'game/recipe.json', data: Buffer.from(recipeJson, 'utf8') });
    const assetMap = {};
    for (const asset of options.assets ?? []) {
        const safeExt = asset.ext.replace(/[^a-z0-9]/gi, '') || 'bin';
        const fileName = asset.id + '.' + safeExt;
        entries.push({ path: 'game/assets/' + fileName, data: asset.data });
        assetMap[asset.id] = './assets/' + fileName;
    }
    const assetsJson = JSON.stringify(assetMap, null, 2) + '\n';
    entries.push({ path: 'game/assets.json', data: Buffer.from(assetsJson, 'utf8') });
    entries.push({ path: 'assets.json', data: Buffer.from(assetsJson, 'utf8') });
    entries.push({ path: 'contracts.json', data: Buffer.from(JSON.stringify(options.contracts, null, 2) + '\n', 'utf8') });
    entries.push({ path: 'Start-Game.cmd', data: Buffer.from(START_GAME_CMD, 'utf8') });
    entries.push({ path: 'server.mjs', data: Buffer.from(SERVER_MJS, 'utf8') });
    const withNode = options.nodeRuntime !== undefined;
    const manifest = {
        schemaVersion: 1,
        kind: 'zaowan-game-export',
        projectName: options.projectName,
        packId: options.recipe.pack.id,
        versionId: options.versionId,
        buildId: options.buildId,
        recipeHash: hashJson(options.recipe),
        contractHash: hashJson(options.contracts),
        exportedAt: new Date().toISOString(),
        containsModelKey: false,
        nodeRuntimeIncluded: withNode,
        notes: [
            '游戏包不需要模型服务，也不包含创作后台。',
            withNode
                ? '已包含 Node 运行时：runtime/node.exe；不需要另装 Node。'
                : '未包含 Node 运行时：需要安装 Node.js 20+，或选择“便携版（含 Node）”重新导出。',
            '源码需要联网安装依赖后才能重新构建，离线可运行不等于离线可重建。',
        ],
        verification: options.verificationSummary ?? null,
    };
    const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
    entries.push({ path: 'manifest.json', data: Buffer.from(manifestJson, 'utf8') });
    entries.push({ path: 'game/manifest.json', data: Buffer.from(manifestJson, 'utf8') });
    const readme = '# ' + options.projectName + '\n\n' +
        '这是一个由造玩工坊导出的独立游戏包。\n\n' +
        '## 运行\n\n双击 Start-Game.cmd，启动器会使用回环地址打开游戏；不会连接模型服务，也不包含创作后台。\n\n' +
        (withNode
            ? '已包含 Node 运行时（runtime/node.exe），双击 Start-Game.cmd 即可，不需要另装 Node。\n\n'
            : '未包含 Node 运行时：请安装 Node.js 20 以上版本，或重新导出“便携版（含 Node）”。\n\n') +
        '## 文件\n\n- game/：预构建的网页游戏资源，含 index.html、assets/（素材）、recipe.json、assets.json、manifest.json\n- 根目录的 recipe.json / manifest.json / contracts.json 是同一份数据的备份，便于查看\n- source/：可重新构建的工程源码\n\n' +
        '## 限制\n\n游戏可靠运行不代表源码可离线重建；重新构建需要联网安装依赖。验证摘要只覆盖声明的检查范围，不代表题目事实正确或卡牌平衡。\n';
    entries.push({ path: 'README.md', data: Buffer.from(readme, 'utf8') });
    entries.push({
        path: 'LICENSE',
        data: Buffer.from('MIT License\n\nCopyright (c) 2026 Zaowan Workshop\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.\n', 'utf8'),
    });
    for (const include of SOURCE_INCLUDE) {
        const files = [];
        await collectFiles(options.sourceRoot, include, files);
        for (const file of files) {
            entries.push({ path: 'source/' + file.path, data: await readFile(file.abs) });
        }
    }
    entries.push({
        path: 'source/README.md',
        data: Buffer.from('# 导出的游戏源码\n\n本目录包含运行游戏所需的规则内核、运行时组件与播放器工程（packages/* 与 apps/player）。\n\n安装依赖并构建：\n\n    pnpm install\n    node scripts/build-player.mjs\n\n构建产物会写入 apps/player/dist。将 recipe.json 复制到该目录即可用任意静态服务器预览。\n', 'utf8'),
    });
    if (options.nodeRuntime !== undefined) {
        entries.push({ path: 'runtime/node.exe', data: await readFile(options.nodeRuntime) });
    }
    const zip = createZip(entries);
    await mkdir(dirname(options.outFile), { recursive: true });
    await writeFile(options.outFile, zip);
    return { file: options.outFile, entries: entries.length, bytes: zip.length };
}

function validateBaseUrl(raw) {
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        return { ok: false, message: 'Base URL 不是合法的 URL' };
    }
    if (url.username !== '' || url.password !== '') {
        return { ok: false, message: 'Base URL 不能包含用户名或密码' };
    }
    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
    if (url.protocol === 'https:')
        return { ok: true, url: url.toString() };
    if (url.protocol === 'http:' && loopback)
        return { ok: true, url: url.toString() };
    return { ok: false, message: '远程模型服务必须使用 HTTPS；HTTP 只允许回环地址（本地模型）' };
}
function endpoint(baseUrl) {
    return baseUrl.replace(/\/+$/, '') + '/chat/completions';
}
class OpenAICompatibleProvider {
    config;
    kind = 'openai-compatible';
    constructor(config) {
        this.config = config;
    }
    async post(body, signal) {
        const timeout = AbortSignal.timeout(this.config.timeoutMs);
        const merged = AbortSignal.any([signal, timeout]);
        const response = await fetch(endpoint(this.config.baseUrl), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: 'Bearer ' + this.config.apiKey,
            },
            body: JSON.stringify(body),
            signal: merged,
            redirect: 'manual',
        });
        if (response.status >= 300 && response.status < 400) {
            throw Object.assign(new Error('模型端点返回重定向，已拒绝跟随，避免凭据被转发到其它主机'), { code: 'MODEL_PROTOCOL_UNSUPPORTED' });
        }
        return response;
    }
    async chat(messages, tools, signal) {
        const body = {
            model: this.config.model,
            messages: messages.map((message) => {
                if (message.role === 'assistant' && message.toolCalls !== undefined) {
                    return {
                        role: 'assistant',
                        content: message.content,
                        tool_calls: message.toolCalls.map((call) => ({
                            id: call.id,
                            type: 'function',
                            function: { name: call.name, arguments: call.argumentsJson },
                        })),
                    };
                }
                if (message.role === 'tool') {
                    return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
                }
                return { role: message.role, content: message.content };
            }),
            ...(tools.length > 0
                ? {
                    tools: tools.map((tool) => ({
                        type: 'function',
                        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
                    })),
                    tool_choice: 'auto',
                }
                : {}),
            temperature: 0,
        };
        const response = await this.post(body, signal);
        if (response.status === 401 || response.status === 403) {
            throw Object.assign(new Error('模型认证失败'), { code: 'MODEL_AUTH_FAILED' });
        }
        if (response.status === 429) {
            throw Object.assign(new Error('模型服务限流'), { code: 'MODEL_RATE_LIMITED' });
        }
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw Object.assign(new Error('模型请求失败 HTTP ' + response.status + ' ' + text.slice(0, 200)), { code: 'RUNTIME_ERROR' });
        }
        const payload = (await response.json());
        const choice = payload.choices?.[0];
        if (choice === undefined) {
            throw Object.assign(new Error('模型响应缺少 choices，可能是非标准工具调用协议'), { code: 'MODEL_PROTOCOL_UNSUPPORTED' });
        }
        const toolCalls = (choice.message?.tool_calls ?? []).map((call) => ({
            id: call.id,
            name: call.function.name,
            argumentsJson: call.function.arguments,
        }));
        return {
            content: choice.message?.content ?? null,
            toolCalls,
            usage: {
                promptTokens: payload.usage?.prompt_tokens ?? 'unknown',
                completionTokens: payload.usage?.completion_tokens ?? 'unknown',
                totalTokens: payload.usage?.total_tokens ?? 'unknown',
            },
            finishReason: choice.finish_reason ?? null,
        };
    }
    async testConnection() {
        const controller = new AbortController();
        try {
            const response = await this.chat([
                { role: 'system', content: '你是一个连接测试助手。必须调用提供的工具。' },
                { role: 'user', content: '请调用 ping 工具，参数 {"value":"ok"}。' },
            ], [
                {
                    name: 'ping',
                    description: '连接测试工具',
                    parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false },
                },
            ], controller.signal);
            const called = response.toolCalls.some((call) => call.name === 'ping');
            return {
                ok: true,
                toolCalling: called,
                detail: called ? '认证、文本响应与工具调用均正常' : '认证与文本响应正常，但端到端返回没有工具调用',
            };
        }
        catch (error) {
            return { ok: false, toolCalling: false, detail: error instanceof Error ? error.message : String(error) };
        }
    }
}

async function verifyVersion(storage, projectId, versionId, options = {}) {
    const project = await storage.requireProject(projectId);
    const recipe = await storage.getRecipe(projectId, versionId);
    if (recipe === null)
        throw Object.assign(new Error('version not found'), { code: 'NOT_FOUND' });
    const baseline = await storage.getRecipe(projectId, project.adoptedVersionId);
    const runId = options.runId ?? 'verify-' + randomUUID().slice(0, 8);
    const evidence = await storage.getReplayEvidence(projectId, versionId);
    let result = verifyRecipe(recipe, project.contracts, {
        baseline: baseline ?? undefined,
        runId,
        testVersion: options.testVersion ?? 'verifier-1',
    });
    if (evidence !== null && evidence.ok && evidence.buildId === result.buildId) {
        result = verifyRecipe(recipe, project.contracts, {
            baseline: baseline ?? undefined,
            runId,
            testVersion: options.testVersion ?? 'verifier-1',
            browserReplay: { ok: evidence.ok, finalStatus: evidence.finalStatus, source: evidence.source },
        });
    }
    const dir = await storage.runDir(projectId, runId);
    const now = new Date().toISOString();
    const manifest = {
        runId,
        kind: 'static-verification',
        projectId,
        versionId,
        createdAt: now,
        recipeHash: result.recipeHash,
        buildId: result.buildId,
        contractHash: result.contractHash,
        verificationId: result.verificationId,
        engineVersion: result.engineVersion,
        schemaVersion: result.schemaVersion,
        seed: 'card' === recipe.pack.id ? recipe.run?.seed : 0,
        baselineVersionId: project.adoptedVersionId,
        mode: 'static',
    };
    await storage.writeRunFile(projectId, runId, 'manifest.json', JSON.stringify(manifest, null, 2));
    await storage.writeRunFile(projectId, runId, 'checks.json', JSON.stringify(result.checks, null, 2));
    await storage.writeRunFile(projectId, runId, 'report.json', JSON.stringify(result, null, 2));
    const events = result.checks.map((check, index) => ({
        seq: index + 1,
        runId,
        at: now,
        type: 'validation',
        payload: { id: check.id, status: check.status, detail: check.detail },
    }));
    await storage.writeRunFile(projectId, runId, 'events.jsonl', events.map((event) => JSON.stringify(event)).join('\n') + '\n');
    await storage.saveReport(projectId, result);
    await storage.recordVerification(projectId, versionId, { status: result.status, verificationId: result.verificationId });
    return { runId, report: result, dir, baselineVersionId: project.adoptedVersionId };
}

const KEY_FOR_ACTION = {
    'move:up': 'ArrowUp',
    'move:down': 'ArrowDown',
    'move:left': 'ArrowLeft',
    'move:right': 'ArrowRight',
    interact: 'e',
    wait: ' ',
};
function actionKey(action) {
    return action.type === 'move' ? 'move:' + action.direction : action.type;
}
function answerFor(question) {
    if (question.type === 'short_text')
        return [question.answerKey[0] ?? ''];
    if (question.type === 'matching')
        return [];
    return question.answerKey.slice();
}
async function runBrowserPlaytest(options) {
    const trace = [];
    const consoleErrors = [];
    const screenshots = [];
    let browser = null;
    let context = null;
    let browserMode = 'unavailable';
    const cdp = process.env.ZAOWAN_CDP_URL;
    try {
        if (cdp !== undefined && cdp.length > 0) {
            browser = await chromium.connectOverCDP(cdp);
            browserMode = 'cdp';
        }
        else {
            browser = await chromium
                .launch({ channel: 'chrome', headless: true })
                .catch(() => chromium.launch({ channel: 'msedge', headless: true }));
            browserMode = 'launched';
        }
        context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    }
    catch (error) {
        return {
            ok: false,
            code: 'BROWSER_UNAVAILABLE',
            message: '浏览器不可用：' + (error instanceof Error ? error.message : String(error)),
            trace,
            consoleErrors,
            screenshots,
            finalStatus: 'unavailable',
            browserMode,
        };
    }
    const shot = async (page, name) => {
        const dir = join(options.runDir, 'screenshots');
        await mkdir(dir, { recursive: true });
        const file = join(dir, name + '.png');
        await page.screenshot({ path: file, fullPage: false });
        screenshots.push(file);
    };
    try {
        const page = await context.newPage();
        page.on('console', (message) => {
            if (message.type() === 'error')
                consoleErrors.push(message.text());
        });
        page.on('pageerror', (error) => consoleErrors.push('pageerror: ' + error.message));
        const url = options.baseUrl + '/#/play/' + options.projectId + '/' + options.versionId + '?bridge=1';
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction((expected) => window.__ZAOWAN_TEST__ !== undefined && window.__ZAOWAN_TEST__.ready === true && window.__ZAOWAN_TEST__.buildId === expected, options.buildId, { timeout: 20000 });
        const bridgeIndex = () => page.evaluate(() => (window.__ZAOWAN_TEST__ ? window.__ZAOWAN_TEST__.renderedActionIndex : -1));
        const bridgeStatus = () => page.evaluate(() => (window.__ZAOWAN_TEST__ ? window.__ZAOWAN_TEST__.status : 'unknown'));
        if (isGridRecipe(options.recipe)) {
            const replay = options.replay ?? [];
            if (replay.length === 0) {
                return {
                    ok: false,
                    code: 'PLAYTEST_FAILED',
                    message: '没有可重放的动作序列',
                    trace,
                    consoleErrors,
                    screenshots,
                    finalStatus: await bridgeStatus(),
                    browserMode,
                };
            }
            await page.focus('[data-testid="grid-canvas"]').catch(() => undefined);
            for (const action of replay) {
                const expected = (await bridgeIndex()) + 1;
                const key = KEY_FOR_ACTION[actionKey(action)];
                if (key === undefined) {
                    trace.push({ action: actionKey(action), index: expected, ok: false, detail: 'unsupported action' });
                    continue;
                }
                await page.keyboard.press(key);
                try {
                    await page.waitForFunction((value) => window.__ZAOWAN_TEST__ !== undefined && window.__ZAOWAN_TEST__.renderedActionIndex >= value, expected, { timeout: 5000 });
                    trace.push({ action: actionKey(action), index: expected, ok: true });
                }
                catch {
                    trace.push({ action: actionKey(action), index: expected, ok: false, detail: 'renderedActionIndex did not advance' });
                }
            }
            await shot(page, 'grid-final');
            const finalStatus = await bridgeStatus();
            const ok = finalStatus === 'won';
            return {
                ok,
                code: ok ? 'OK' : 'PLAYTEST_FAILED',
                message: ok ? '浏览器真实键盘输入完成通关' : '浏览器重放结束但终局状态为 ' + finalStatus,
                trace,
                consoleErrors,
                screenshots,
                finalStatus,
                browserMode,
            };
        }
        if (isQuizRecipe(options.recipe)) {
            let index = 0;
            const legibilityFailures = [];
            const checkLegible = async () => {
                const bad = await page.evaluate(() => {
                    const out = [];
                    document.querySelectorAll('[data-testid^="quiz-option-"]').forEach((node) => {
                        const style = window.getComputedStyle(node);
                        const fg = style.color;
                        const bg = style.backgroundColor;
                        const invisible = fg === bg ||
                            (fg === 'rgb(255, 255, 255)' && (bg === 'rgb(255, 255, 255)' || bg === 'rgba(0, 0, 0, 0)'));
                        if (invisible)
                            out.push((node.getAttribute('data-testid') ?? '?') + ' 前景 ' + fg + ' 背景 ' + bg);
                    });
                    return out;
                });
                for (const item of bad) {
                    if (legibilityFailures.includes(item))
                        continue;
                    legibilityFailures.push(item);
                    trace.push({ action: 'legibility', index: index + 1, ok: false, detail: item });
                }
            };
            for (const question of options.recipe.quiz.questions) {
                const answers = answerFor(question);
                if (question.type === 'short_text') {
                    await page.fill('[data-testid="quiz-text"]', answers[0] ?? '');
                }
                else if (question.type === 'matching') {
                    const rightOrder = question.pairs.map((pair) => pair.right).slice().reverse();
                    for (const [leftIndex, pair] of question.pairs.entries()) {
                        const rightIndex = rightOrder.indexOf(pair.right);
                        await page.click('[data-testid="quiz-match-left-' + leftIndex + '"]');
                        await page.click('[data-testid="quiz-match-right-' + rightIndex + '"]');
                    }
                }
                else {
                    await checkLegible();
                    for (const answer of answers) {
                        await page.click('[data-testid="quiz-option-' + answer + '"]');
                    }
                }
                await page.click('[data-testid="quiz-submit"]');
                await page.waitForSelector('[data-testid="quiz-feedback"]', { timeout: 5000 });
                trace.push({ action: 'answer ' + question.id, index: index + 1, ok: true });
                await page.click('[data-testid="quiz-next"]').catch(() => undefined);
                index += 1;
            }
            await shot(page, 'quiz-final');
            const finalStatus = await page.evaluate(() => (window.__ZAOWAN_TEST__ ? window.__ZAOWAN_TEST__.status : 'unknown'));
            const ok = finalStatus === 'won' && legibilityFailures.length === 0;
            const message = finalStatus !== 'won'
                ? '答题流程结束但终局状态为 ' + finalStatus
                : legibilityFailures.length > 0
                    ? '选项文字与背景同色，无法辨认：' + legibilityFailures.join('；')
                    : '浏览器真实点击答完全部题目并通关';
            return {
                ok,
                code: ok ? 'OK' : 'PLAYTEST_FAILED',
                message,
                trace,
                consoleErrors,
                screenshots,
                finalStatus,
                browserMode,
            };
        }
        if (isDialogueRecipe(options.recipe)) {
            const dialogueRecipe = options.recipe;
            let dialogueState = createInitialState(dialogueRecipe, 0);
            const replay = options.dialogueReplay ?? [];
            if (replay.length === 0) {
                return {
                    ok: false,
                    code: 'PLAYTEST_FAILED',
                    message: '没有可重放的对话动作序列',
                    trace,
                    consoleErrors,
                    screenshots,
                    finalStatus: await bridgeStatus(),
                    browserMode,
                };
            }
            for (const action of replay) {
                const expected = (await bridgeIndex()) + 1;
                let key = 'Enter';
                if (action.type === 'choose') {
                    const available = getAvailableActions(dialogueRecipe, dialogueState).filter((item) => item.type === 'choose');
                    const position = available.findIndex((item) => item.type === 'choose' && item.choiceId === action.choiceId);
                    key = String(position + 1);
                }
                await page.keyboard.press(key);
                const stepped = stepDialogue(dialogueRecipe, dialogueState, action);
                if (stepped.ok)
                    dialogueState = stepped.state;
                try {
                    await page.waitForFunction((value) => window.__ZAOWAN_TEST__ !== undefined && window.__ZAOWAN_TEST__.renderedActionIndex >= value, expected, { timeout: 5000 });
                    trace.push({ action: action.type === 'choose' ? 'choose:' + action.choiceId : action.type, index: expected, ok: true });
                }
                catch {
                    trace.push({ action: action.type, index: expected, ok: false, detail: 'renderedActionIndex did not advance' });
                }
            }
            await page
                .waitForFunction(() => window.__ZAOWAN_TEST__ !== undefined && (window.__ZAOWAN_TEST__.status === 'ended' || window.__ZAOWAN_TEST__.status === 'lost'), undefined, { timeout: 15000 })
                .catch(() => undefined);
            await shot(page, 'dialogue-final');
            const finalStatus = await bridgeStatus();
            const endTestId = await page.locator('[data-testid^="dlg-end-"]').first().getAttribute('data-testid').catch(() => null);
            const ok = finalStatus === 'ended' && endTestId !== null;
            return {
                ok,
                code: ok ? 'OK' : 'PLAYTEST_FAILED',
                message: ok ? '浏览器真实按键完成对话分支并到达结局 ' + String(endTestId) : '对话流程结束但终局状态为 ' + finalStatus,
                trace,
                consoleErrors,
                screenshots,
                finalStatus,
                browserMode,
            };
        }
        if (isCardRecipe(options.recipe)) {
            const cardDeadline = Date.now() + 90000;
            for (let turn = 0; turn < 30; turn += 1) {
                if (Date.now() > cardDeadline) {
                    trace.push({ action: 'card loop deadline', index: turn, ok: false, detail: '90s budget exhausted' });
                    break;
                }
                if ((await page.locator('[data-testid="card-finished"]').count()) > 0)
                    break;
                // 打赢一场后会进入奖励阶段，此时手牌与「结束回合」按钮都不在 DOM 里。
                // 必须先选奖励才能进入下一场战斗，否则循环提前退出，终局永远是 playing。
                const reward = page.locator('[data-testid^="card-reward-"]');
                if ((await reward.count()) > 0) {
                    let picked = true;
                    await reward.first().click({ timeout: 3000 }).catch(() => {
                        picked = false;
                    });
                    trace.push({ action: 'choose reward', index: turn + 1, ok: picked, detail: picked ? undefined : '选择奖励失败' });
                    if (!picked)
                        break;
                    continue;
                }
                const endTurn = page.locator('[data-testid="card-end-turn"]');
                if ((await endTurn.count()) === 0) {
                    // 阶段切换中的中间帧，短暂等待再试，不要直接放弃。
                    await page.waitForTimeout(120);
                    continue;
                }
                // 每次只点第一张可用牌：出牌后手牌会收缩，按固定索引遍历会漏牌。
                for (let played = 0; played < 12; played += 1) {
                    const cards = page.locator('[data-testid^="card-hand-"]');
                    const count = await cards.count();
                    let clickedAny = false;
                    for (let cardIndex = 0; cardIndex < count; cardIndex += 1) {
                        const button = cards.nth(cardIndex);
                        if (await button.isEnabled().catch(() => false)) {
                            let clicked = true;
                            await button.click({ timeout: 3000 }).catch(() => {
                                clicked = false;
                            });
                            // 点击失败必须记进 trace，不能吞掉后仍按成功算。
                            trace.push({ action: 'play card', index: turn + 1, ok: clicked, detail: clicked ? undefined : '点击失败' });
                            clickedAny = true;
                            break;
                        }
                    }
                    if (!clickedAny)
                        break;
                }
                await endTurn.click({ timeout: 3000 }).catch(() => undefined);
                trace.push({ action: 'end turn', index: turn + 1, ok: true });
            }
            await shot(page, 'card-final');
            const finalStatus = await page.evaluate(() => (window.__ZAOWAN_TEST__ ? window.__ZAOWAN_TEST__.status : 'unknown'));
            // 与 grid/quiz 保持一致：必须真的打赢才算试玩通过，仅在页面上出过牌不算证据。
            const ok = finalStatus === 'won' && consoleErrors.length === 0 && trace.length > 0;
            return {
                ok,
                code: ok ? 'OK' : 'PLAYTEST_FAILED',
                message: ok ? '浏览器真实点击出牌并打赢全部战斗，未出现控制台错误' : '卡牌试玩未通关或发现问题（终局：' + finalStatus + '）',
                trace,
                consoleErrors,
                screenshots,
                finalStatus,
                browserMode,
            };
        }
        return {
            ok: false,
            code: 'PLAYTEST_FAILED',
            message: '未知模式包',
            trace,
            consoleErrors,
            screenshots,
            finalStatus: 'unknown',
            browserMode,
        };
    }
    catch (error) {
        return {
            ok: false,
            code: 'PLAYTEST_FAILED',
            message: error instanceof Error ? error.message : String(error),
            trace,
            consoleErrors,
            screenshots,
            finalStatus: 'error',
            browserMode,
        };
    }
    finally {
        await context?.close().catch(() => undefined);
        if (browserMode === 'launched')
            await browser?.close().catch(() => undefined);
    }
}

const IdSchema = z.string().min(1).max(64);
const PatchOpSchema = z.discriminatedUnion('op', [
    z.strictObject({ op: z.literal('set_tile'), x: z.number().int().min(0).max(63), y: z.number().int().min(0).max(63), tile: z.enum(['wall', 'floor']) }),
    z.strictObject({ op: z.literal('move_entity'), entityId: IdSchema, x: z.number().int().min(0).max(63), y: z.number().int().min(0).max(63) }),
    z.strictObject({ op: z.literal('add_entity'), entity: z.unknown() }),
    z.strictObject({ op: z.literal('update_entity'), entityId: IdSchema, changes: z.record(z.string(), z.unknown()) }),
    z.strictObject({ op: z.literal('remove_entity'), entityId: IdSchema }),
    z.strictObject({ op: z.literal('add_rule'), rule: z.unknown() }),
    z.strictObject({ op: z.literal('update_rule'), ruleId: IdSchema, changes: z.record(z.string(), z.unknown()) }),
    z.strictObject({ op: z.literal('remove_rule'), ruleId: IdSchema }),
    z.strictObject({ op: z.literal('update_goal'), goal: z.unknown() }),
    z.strictObject({ op: z.literal('update_presentation'), changes: z.record(z.string(), z.unknown()) }),
    z.strictObject({
        op: z.literal('update_meta'),
        name: z.string().min(1).max(60).optional(),
        description: z.string().max(800).optional(),
        controls: z.string().max(300).optional(),
    }),
    z.strictObject({ op: z.literal('add_quiz_question'), question: z.unknown() }),
    z.strictObject({ op: z.literal('update_quiz_question'), questionId: IdSchema, changes: z.record(z.string(), z.unknown()) }),
    z.strictObject({ op: z.literal('update_quiz_answer'), questionId: IdSchema, options: z.unknown().optional(), answerKey: z.array(z.string()).optional() }),
    z.strictObject({ op: z.literal('add_card'), card: z.unknown() }),
    z.strictObject({ op: z.literal('update_card'), cardId: IdSchema, changes: z.record(z.string(), z.unknown()) }),
    z.strictObject({ op: z.literal('set_deck'), deck: z.array(z.string()).min(5).max(20) }),
    z.strictObject({ op: z.literal('update_dialogue_node'), nodeId: IdSchema, changes: z.record(z.string(), z.unknown()) }),
    z.strictObject({ op: z.literal('update_dialogue_choice'), nodeId: IdSchema, choiceId: IdSchema, changes: z.record(z.string(), z.unknown()) }),
    z.strictObject({ op: z.literal('update_dialogue_ending'), endingId: IdSchema, changes: z.record(z.string(), z.unknown()) }),
    z.strictObject({ op: z.literal('set_player_spawn'), spawn: z.strictObject({ x: z.number().int().min(0).max(63), y: z.number().int().min(0).max(63) }) }),
    z.strictObject({ op: z.literal('add_enemy'), enemy: z.unknown() }),
    z.strictObject({ op: z.literal('update_enemy'), enemyId: IdSchema, changes: z.record(z.string(), z.unknown()) }),
    z.strictObject({ op: z.literal('update_run'), changes: z.record(z.string(), z.unknown()) }),
    z.strictObject({ op: z.literal('add_dialogue_node'), node: z.unknown() }),
    z.strictObject({ op: z.literal('add_dialogue_choice'), nodeId: IdSchema, choice: z.unknown() }),
    z.strictObject({ op: z.literal('add_dialogue_ending'), ending: z.unknown() }),
    z.strictObject({ op: z.literal('set_start_node'), nodeId: IdSchema }),
]);
const PROTECTED_KINDS = [
    'door_requires_item',
    'guard_clock_equals',
    'required_entity_exists',
    'goal_requires_collection',
    'preserve_mechanic',
    'quiz_answer_key_locked',
    'card_deck_legality',
    'card_rule_numbers_locked',
    'ending_locked',
    'choice_effect_locked',
    'dialogue_text_reviewed',
    'no_dead_branch',
];
/** 给 inspect_project 的实体模板：字段名必须与 schema 完全一致，模型照抄即可。 */
const GRID_ENTITY_TEMPLATES = {
    item: { kind: 'item', id: 'key-1', x: 3, y: 5, itemType: 'key', count: 1, label: '黄铜钥匙' },
    door: { kind: 'door', id: 'door-1', x: 3, y: 2, requires: { itemType: 'key', count: 1 }, label: '卷帘门' },
    gate: { kind: 'gate', id: 'gate-1', x: 3, y: 4, openWhen: { type: 'flag_is', flag: 'gate-1-open', value: true }, label: '机关门' },
    switch: { kind: 'switch', id: 'switch-1', x: 5, y: 5, flag: 'gate-1-open', mode: 'set', label: '开关' },
    guard: { kind: 'guard', id: 'guard-1', x: 5, y: 3, facing: 'left', route: [{ x: 5, y: 3 }, { x: 3, y: 3 }], clock: { basis: 'action', every: 2 }, label: '守卫' },
    exit: { kind: 'exit', id: 'exit-2', x: 6, y: 6, label: '出口（不要新增第二个出口，移动现有 exit-1）' },
    zone: { kind: 'zone', id: 'zone-1', cells: [{ x: 2, y: 2 }, { x: 2, y: 3 }], label: '区域' },
};
function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
function describeEntity(entity) {
    if (entity.kind === 'zone')
        return JSON.stringify(entity.cells ?? []);
    const x = entity.x;
    const y = entity.y;
    return entity.kind + '@' + String(x) + ',' + String(y);
}
function buildPatchDiff(before, after) {
    if (isGridRecipe(before) && isGridRecipe(after)) {
        const beforeMap = new Map(before.entities.filter((entity) => entity.kind !== 'zone').map((entity) => [entity.id, entity]));
        const afterMap = new Map(after.entities.filter((entity) => entity.kind !== 'zone').map((entity) => [entity.id, entity]));
        const changed = [];
        for (const [id, entity] of beforeMap) {
            const next = afterMap.get(id);
            if (next === undefined) {
                changed.push({ id, kind: entity.kind, before: describeEntity(entity), after: '已删除' });
                continue;
            }
            const left = describeEntity(entity);
            const right = describeEntity(next);
            if (left !== right)
                changed.push({ id, kind: entity.kind, before: left, after: right });
        }
        for (const [id, entity] of afterMap) {
            if (!beforeMap.has(id)) {
                changed.push({ id, kind: entity.kind, before: '新增', after: describeEntity(entity) });
            }
        }
        const untouched = [...beforeMap.keys()].filter((id) => !changed.some((entry) => entry.id === id));
        return { changed, untouched, boardChanged: JSON.stringify(before.board.rows) !== JSON.stringify(after.board.rows), goalChanged: JSON.stringify(before.goal) !== JSON.stringify(after.goal) };
    }
    if (isQuizRecipe(before) && isQuizRecipe(after)) {
        const beforeIds = before.quiz.questions.map((question) => question.id);
        const afterIds = after.quiz.questions.map((question) => question.id);
        const changed = afterIds.filter((id) => {
            const left = before.quiz.questions.find((question) => question.id === id);
            const right = after.quiz.questions.find((question) => question.id === id);
            return left !== undefined && right !== undefined && JSON.stringify(left) !== JSON.stringify(right);
        });
        return {
            changed: changed.map((id) => ({ id, kind: 'question', before: '原题', after: '已修改' })),
            untouched: beforeIds.filter((id) => !changed.includes(id) && afterIds.includes(id)),
            added: afterIds.filter((id) => !beforeIds.includes(id)),
            removed: beforeIds.filter((id) => !afterIds.includes(id)),
        };
    }
    if (isCardRecipe(before) && isCardRecipe(after)) {
        const changed = after.cards
            .filter((card) => {
            const original = before.cards.find((item) => item.id === card.id);
            return original !== undefined && JSON.stringify(original) !== JSON.stringify(card);
        })
            .map((card) => ({ id: card.id, kind: 'card', before: '原数值', after: '已修改' }));
        return { changed, untouched: before.cards.map((card) => card.id).filter((id) => !changed.some((entry) => entry.id === id)), deckChanged: JSON.stringify(before.deck) !== JSON.stringify(after.deck) };
    }
    if (isDialogueRecipe(before) && isDialogueRecipe(after)) {
        const changed = [];
        for (const node of before.dialogue.nodes) {
            const next = after.dialogue.nodes.find((item) => item.id === node.id);
            if (next === undefined) {
                changed.push({ id: node.id, kind: 'dialogue_node', before: '原节点', after: '已删除' });
                continue;
            }
            if (node.text !== next.text || node.goto !== next.goto || node.reviewed !== next.reviewed) {
                changed.push({ id: node.id, kind: 'dialogue_node', before: '原台词/去向', after: '已修改' });
            }
        }
        for (const ending of before.dialogue.endings) {
            const next = after.dialogue.endings.find((item) => item.id === ending.id);
            if (next === undefined) {
                changed.push({ id: ending.id, kind: 'dialogue_ending', before: '原结局', after: '已删除' });
                continue;
            }
            if (ending.title !== next.title || JSON.stringify(ending.require) !== JSON.stringify(next.require)) {
                changed.push({ id: ending.id, kind: 'dialogue_ending', before: '原结局条件', after: '已修改' });
            }
        }
        const untouched = before.dialogue.nodes.map((node) => node.id).filter((id) => !changed.some((entry) => entry.id === id));
        return { changed, untouched, endingsBefore: before.dialogue.endings.length, endingsAfter: after.dialogue.endings.length };
    }
    return { changed: [], untouched: [] };
}
class PatchError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
function applyPatch(recipe, ops) {
    const next = clone(recipe);
    for (const op of ops) {
        if (isGridRecipe(next)) {
            if (op.op === 'set_tile') {
                const rows = next.board.rows.slice();
                const row = rows[op.y];
                if (row === undefined || op.x < 0 || op.x >= next.board.width)
                    throw new PatchError('INVALID_ARGUMENT', 'tile outside board');
                const char = op.tile === 'wall' ? '#' : '.';
                rows[op.y] = row.slice(0, op.x) + char + row.slice(op.x + 1);
                next.board.rows = rows;
                continue;
            }
            if (op.op === 'move_entity') {
                const entity = next.entities.find((item) => item.id === op.entityId);
                if (entity === undefined || entity.kind === 'zone')
                    throw new PatchError('INVALID_ARGUMENT', 'entity not found: ' + op.entityId);
                entity.x = op.x;
                entity.y = op.y;
                if (entity.kind === 'guard') {
                    entity.route = entity.route.map((point, index) => (index === 0 ? { x: op.x, y: op.y } : point));
                }
                continue;
            }
            if (op.op === 'add_entity') {
                const parsedEntity = GridEntityZ.safeParse(op.entity);
                if (!parsedEntity.success) {
                    throw new PatchError('INVALID_ARGUMENT', 'add_entity 字段形状不对：' + zodIssues(parsedEntity.error).map((issue) => issue.path + ' ' + issue.message).join('; ') +
                        '。请照抄 inspect_project.entityTemplates；钥匙是 {kind:"item",itemType:"key",count:1}，不是 kind:"key"。');
                }
                next.entities.push(parsedEntity.data);
                continue;
            }
            if (op.op === 'update_entity') {
                const entity = next.entities.find((item) => item.id === op.entityId);
                if (entity === undefined)
                    throw new PatchError('INVALID_ARGUMENT', 'entity not found: ' + op.entityId);
                Object.assign(entity, op.changes);
                continue;
            }
            if (op.op === 'remove_entity') {
                next.entities = next.entities.filter((item) => item.id !== op.entityId);
                continue;
            }
            if (op.op === 'add_rule') {
                next.rules.push(op.rule);
                continue;
            }
            if (op.op === 'update_rule') {
                const rule = next.rules.find((item) => item.id === op.ruleId);
                if (rule === undefined)
                    throw new PatchError('INVALID_ARGUMENT', 'rule not found: ' + op.ruleId);
                Object.assign(rule, op.changes);
                continue;
            }
            if (op.op === 'remove_rule') {
                next.rules = next.rules.filter((item) => item.id !== op.ruleId);
                continue;
            }
            if (op.op === 'update_goal') {
                next.goal = op.goal;
                continue;
            }
            if (op.op === 'set_player_spawn') {
                next.player.spawn = op.spawn;
                continue;
            }
            if (op.op === 'update_presentation') {
                Object.assign(next.presentation, op.changes);
                continue;
            }
            if (op.op === 'update_meta') {
                if (op.name !== undefined)
                    next.meta.name = op.name;
                if (op.description !== undefined)
                    next.meta.description = op.description;
                if (op.controls !== undefined)
                    next.meta.controls = op.controls;
                continue;
            }
            throw new PatchError('INVALID_ARGUMENT', 'patch op ' + op.op + ' does not apply to grid recipes');
        }
        if (isQuizRecipe(next)) {
            if (op.op === 'update_meta') {
                if (op.name !== undefined)
                    next.meta.name = op.name;
                if (op.description !== undefined)
                    next.meta.description = op.description;
                continue;
            }
            if (op.op === 'add_quiz_question') {
                next.quiz.questions.push(op.question);
                continue;
            }
            if (op.op === 'update_quiz_question') {
                const question = next.quiz.questions.find((item) => item.id === op.questionId);
                if (question === undefined)
                    throw new PatchError('INVALID_ARGUMENT', 'question not found: ' + op.questionId);
                Object.assign(question, op.changes);
                continue;
            }
            if (op.op === 'update_quiz_answer') {
                const question = next.quiz.questions.find((item) => item.id === op.questionId);
                if (question === undefined)
                    throw new PatchError('INVALID_ARGUMENT', 'question not found: ' + op.questionId);
                if (op.options !== undefined) {
                    Object.assign(question, { options: op.options });
                }
                if (op.answerKey !== undefined) {
                    Object.assign(question, { answerKey: op.answerKey });
                }
                continue;
            }
            throw new PatchError('INVALID_ARGUMENT', 'patch op ' + op.op + ' does not apply to quiz recipes');
        }
        if (isCardRecipe(next)) {
            if (op.op === 'update_meta') {
                if (op.name !== undefined)
                    next.meta.name = op.name;
                if (op.description !== undefined)
                    next.meta.description = op.description;
                continue;
            }
            if (op.op === 'add_card') {
                next.cards.push(op.card);
                continue;
            }
            if (op.op === 'update_card') {
                const card = next.cards.find((item) => item.id === op.cardId);
                if (card === undefined)
                    throw new PatchError('INVALID_ARGUMENT', 'card not found: ' + op.cardId);
                Object.assign(card, op.changes);
                continue;
            }
            if (op.op === 'set_deck') {
                next.deck = op.deck;
                continue;
            }
            if (op.op === 'add_enemy') {
                const enemy = op.enemy;
                if (next.enemies.some((item) => item.id === enemy.id))
                    throw new PatchError('INVALID_ARGUMENT', 'enemy already exists: ' + enemy.id);
                next.enemies.push(enemy);
                continue;
            }
            if (op.op === 'update_enemy') {
                const enemy = next.enemies.find((item) => item.id === op.enemyId);
                if (enemy === undefined)
                    throw new PatchError('INVALID_ARGUMENT', 'enemy not found: ' + op.enemyId);
                Object.assign(enemy, op.changes);
                continue;
            }
            if (op.op === 'update_run') {
                Object.assign(next.run, op.changes);
                continue;
            }
            throw new PatchError('INVALID_ARGUMENT', 'patch op ' + op.op + ' does not apply to card recipes');
        }
        if (isDialogueRecipe(next)) {
            if (op.op === 'update_meta') {
                if (op.name !== undefined)
                    next.meta.name = op.name;
                if (op.description !== undefined)
                    next.meta.description = op.description;
                if (op.controls !== undefined)
                    next.meta.controls = op.controls;
                continue;
            }
            if (op.op === 'update_dialogue_node') {
                const node = next.dialogue.nodes.find((item) => item.id === op.nodeId);
                if (node === undefined)
                    throw new PatchError('INVALID_ARGUMENT', 'node not found: ' + op.nodeId);
                Object.assign(node, op.changes);
                continue;
            }
            if (op.op === 'update_dialogue_choice') {
                const node = next.dialogue.nodes.find((item) => item.id === op.nodeId);
                const choice = node?.choices?.find((item) => item.id === op.choiceId);
                if (choice === undefined)
                    throw new PatchError('INVALID_ARGUMENT', 'choice not found: ' + op.nodeId + '/' + op.choiceId);
                Object.assign(choice, op.changes);
                continue;
            }
            if (op.op === 'update_dialogue_ending') {
                const ending = next.dialogue.endings.find((item) => item.id === op.endingId);
                if (ending === undefined)
                    throw new PatchError('INVALID_ARGUMENT', 'ending not found: ' + op.endingId);
                Object.assign(ending, op.changes);
                continue;
            }
            if (op.op === 'add_dialogue_node') {
                const node = op.node;
                if (next.dialogue.nodes.some((item) => item.id === node.id))
                    throw new PatchError('INVALID_ARGUMENT', 'node already exists: ' + node.id);
                next.dialogue.nodes.push(node);
                continue;
            }
            if (op.op === 'add_dialogue_choice') {
                const node = next.dialogue.nodes.find((item) => item.id === op.nodeId);
                if (node === undefined)
                    throw new PatchError('INVALID_ARGUMENT', 'node not found: ' + op.nodeId);
                const choice = op.choice;
                const allChoices = next.dialogue.nodes.flatMap((item) => item.choices ?? []);
                if (allChoices.some((item) => item.id === choice.id))
                    throw new PatchError('INVALID_ARGUMENT', 'choice already exists: ' + choice.id);
                node.choices = [...(node.choices ?? []), choice];
                continue;
            }
            if (op.op === 'add_dialogue_ending') {
                const ending = op.ending;
                if (next.dialogue.endings.some((item) => item.id === ending.id))
                    throw new PatchError('INVALID_ARGUMENT', 'ending already exists: ' + ending.id);
                next.dialogue.endings.push(ending);
                continue;
            }
            if (op.op === 'set_start_node') {
                if (!next.dialogue.nodes.some((item) => item.id === op.nodeId))
                    throw new PatchError('INVALID_ARGUMENT', 'node not found: ' + op.nodeId);
                next.dialogue.startNodeId = op.nodeId;
                continue;
            }
            throw new PatchError('INVALID_ARGUMENT', 'patch op ' + op.op + ' does not apply to dialogue recipes');
        }
    }
    return next;
}
const PlanSchema = z.strictObject({
    steps: z
        .array(z.strictObject({
        id: z.string().min(1).max(32),
        goal: z.string().trim().min(1).max(120),
        doneWhen: z.string().trim().min(1).max(160),
        checkIds: z.array(z.string().min(1).max(80)).max(8).optional(),
    }))
        .min(2)
        .max(6),
});
function planProgress(plan, checks) {
    return plan.map((step) => {
        if (step.checkIds.length === 0)
            return { id: step.id, status: 'manual' };
        const statuses = step.checkIds.map((id) => checks.find((check) => check.id === id)?.status ?? 'pending');
        if (statuses.includes('failed'))
            return { id: step.id, status: 'failed' };
        if (statuses.includes('pending'))
            return { id: step.id, status: 'pending' };
        if (statuses.every((status) => status === 'passed'))
            return { id: step.id, status: 'passed' };
        return { id: step.id, status: 'partial' };
    });
}
function outcome(ok, code, data, artifacts = [], retryable = false) {
    return { ok, code, data, artifacts, retryable };
}
async function currentVersion(ctx, requested) {
    return requested ?? ctx.candidateVersionId ?? ctx.baseVersionId;
}
async function loadRecipe(ctx, versionId) {
    const recipe = await ctx.storage.getRecipe(ctx.projectId, versionId);
    if (recipe === null)
        throw new PatchError('INVALID_ARGUMENT', 'version not found: ' + versionId);
    return recipe;
}
const TOOL_DEFINITIONS = [
    {
        name: 'inspect_project',
        description: '读取当前工程摘要：模式包、版本、对象、规则、已确认契约与素材数量。不要请求任意文件路径。',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'inspect_assets',
        description: '列出已授权素材的尺寸、格式与许可证标记。',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'create_candidate',
        description: '基于一个确定版本创建隔离候选版本，后续补丁写入候选。',
        parameters: { type: 'object', properties: { versionId: { type: 'string' } }, additionalProperties: false },
    },
    {
        name: 'apply_recipe_patch',
        description: '对候选版本应用受限的类型化补丁，不能修改契约、测试或引擎。允许的 op：set_tile{x,y,tile}、move_entity{entityId,x,y}、add_entity{entity}（字段必须照抄 inspect_project.entityTemplates；钥匙是 kind:"item",itemType:"key",count:1，不是 kind:"key"）、update_entity{entityId,changes}、remove_entity{entityId}、add_rule{rule}、update_rule{ruleId,changes}、remove_rule{ruleId}、update_goal{goal}、set_player_spawn{spawn}、update_presentation{changes}、update_meta{name?,description?}、add_quiz_question{question}、update_quiz_question{questionId,changes}、update_quiz_answer{questionId,options?,answerKey?}、add_card{card}、update_card{cardId,changes}、set_deck{deck}、add_enemy{enemy}、update_enemy{enemyId,changes}、update_run{changes}、add_dialogue_node{node}、add_dialogue_choice{nodeId,choice}、add_dialogue_ending{ending}、set_start_node{nodeId}、update_dialogue_node{nodeId,changes}、update_dialogue_choice{nodeId,choiceId,changes}、update_dialogue_ending{endingId,changes}。例：把钥匙移到 (2,1)：{"ops":[{"op":"move_entity","entityId":"key-1","x":2,"y":1}]}。对象 id 与当前位置请先用 inspect_project 获取。',
        parameters: {
            type: 'object',
            properties: {
                versionId: { type: 'string', description: '缺省时使用当前候选，否则基于该版本创建新候选' },
                ops: {
                    type: 'array',
                    description: '类型化补丁操作列表，每个元素必须含 op 字段，字段名必须与描述完全一致',
                    items: { type: 'object', additionalProperties: true },
                },
                note: { type: 'string' },
            },
            required: ['ops'],
            additionalProperties: false,
        },
    },
    {
        name: 'validate_recipe',
        description: '对候选配方执行 Schema 与语义检查。',
        parameters: { type: 'object', properties: { versionId: { type: 'string' } }, additionalProperties: false },
    },
    {
        name: 'build_candidate',
        description: '计算候选的构建身份（buildId、配方哈希、契约哈希）。',
        parameters: { type: 'object', properties: { versionId: { type: 'string' } }, additionalProperties: false },
    },
    {
        name: 'run_rule_checks',
        description: '运行可信检查：契约、金标适用项、搜索与确定性。可能返回 partial——表示检查已执行但还缺少浏览器重放证据，属正常状态，请继续调用 run_browser_playtest。',
        parameters: { type: 'object', properties: { versionId: { type: 'string' } }, additionalProperties: false },
    },
    {
        name: 'run_browser_playtest',
        description: '在隔离浏览器中用真实键盘/点击输入重放通关路线，收集证据。',
        parameters: {
            type: 'object',
            properties: { versionId: { type: 'string' } },
            additionalProperties: false,
        },
    },
    {
        name: 'read_evidence',
        description: '读取本任务生成的有限日志文件（manifest.json、checks.json、report.json 等）。',
        parameters: { type: 'object', properties: { file: { type: 'string' } }, required: ['file'], additionalProperties: false },
    },
    {
        name: 'compare_versions',
        description: '比较两个版本的配方差异与受影响契约。',
        parameters: {
            type: 'object',
            properties: { fromVersionId: { type: 'string' }, toVersionId: { type: 'string' } },
            required: ['fromVersionId', 'toVersionId'],
            additionalProperties: false,
        },
    },
    {
        name: 'submit_plan',
        description: '提交任务拆解：2–6 个子任务，每个写目标与完成判据。能用机器检查判定的子任务必须在 checkIds 里填 run_rule_checks 返回的检查 id（如 "contract:c-reach"），后端会按检查结果自动判定子任务是否完成。不修改配方。',
        parameters: {
            type: 'object',
            properties: {
                steps: {
                    type: 'array',
                    minItems: 2,
                    maxItems: 6,
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            goal: { type: 'string' },
                            doneWhen: { type: 'string' },
                            checkIds: { type: 'array', items: { type: 'string' } },
                        },
                        required: ['id', 'goal', 'doneWhen'],
                        additionalProperties: false,
                    },
                },
            },
            required: ['steps'],
            additionalProperties: false,
        },
    },
    {
        name: 'prepare_review',
        description: '汇总候选、检查结果与人工待确认项，请求后端进入待审核状态。它不能自行授予通过。',
        parameters: { type: 'object', properties: { versionId: { type: 'string' } }, additionalProperties: false },
    },
];
function parseArgs(raw) {
    if (raw.trim().length === 0)
        return {};
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new Error('arguments must be a JSON object');
        }
        return parsed;
    }
    catch (error) {
        throw new PatchError('INVALID_ARGUMENT', '工具参数不是合法 JSON 对象：' + (error instanceof Error ? error.message : String(error)));
    }
}
function diffSummary(from, to) {
    const fromJson = JSON.stringify(from);
    const toJson = JSON.stringify(to);
    const summary = { changed: fromJson !== toJson, fields: [] };
    if (isGridRecipe(from) && isGridRecipe(to)) {
        const fields = [];
        if (JSON.stringify(from.board.rows) !== JSON.stringify(to.board.rows))
            fields.push('board');
        if (JSON.stringify(from.entities) !== JSON.stringify(to.entities))
            fields.push('entities');
        if (JSON.stringify(from.rules) !== JSON.stringify(to.rules))
            fields.push('rules');
        if (JSON.stringify(from.goal) !== JSON.stringify(to.goal))
            fields.push('goal');
        if (JSON.stringify(from.meta) !== JSON.stringify(to.meta))
            fields.push('meta');
        summary.fields = fields;
    }
    else if (isQuizRecipe(from) && isQuizRecipe(to)) {
        const fields = [];
        if (from.quiz.questions.length !== to.quiz.questions.length)
            fields.push('questions.length');
        if (JSON.stringify(from.quiz.questions) !== JSON.stringify(to.quiz.questions))
            fields.push('questions');
        if (JSON.stringify(from.meta) !== JSON.stringify(to.meta))
            fields.push('meta');
        summary.fields = fields;
    }
    else if (isCardRecipe(from) && isCardRecipe(to)) {
        const fields = [];
        if (JSON.stringify(from.cards) !== JSON.stringify(to.cards))
            fields.push('cards');
        if (JSON.stringify(from.deck) !== JSON.stringify(to.deck))
            fields.push('deck');
        if (JSON.stringify(from.enemies) !== JSON.stringify(to.enemies))
            fields.push('enemies');
        if (JSON.stringify(from.meta) !== JSON.stringify(to.meta))
            fields.push('meta');
        summary.fields = fields;
    }
    return summary;
}
async function executeTool(ctx, name, rawArgs) {
    let args;
    try {
        args = parseArgs(rawArgs);
    }
    catch (error) {
        return outcome(false, 'INVALID_ARGUMENT', { message: error instanceof Error ? error.message : String(error) }, [], true);
    }
    if (ctx.isCancelled?.() === true) {
        return outcome(false, 'RUN_CANCELLED', { message: '任务已取消，未执行工具' });
    }
    try {
        const project = await ctx.storage.requireProject(ctx.projectId);
        if (name === 'inspect_project') {
            const recipe = await loadRecipe(ctx, ctx.baseVersionId);
            return outcome(true, 'OK', {
                project: { id: project.id, name: project.name, packId: project.packId },
                origin: project.origin === undefined ? undefined : { source: project.origin.source, importWarnings: project.origin.warnings, mappedObjects: project.origin.mapped },
                versions: project.versions.map((version) => ({ id: version.id, note: version.note, status: version.status, verified: version.verified?.status ?? null })),
                adoptedVersionId: project.adoptedVersionId,
                contracts: project.contracts.entries.map((entry) => ({ id: entry.id, kind: entry.kind, description: entry.description, confirmed: project.contracts.confirmedAt !== null })),
                recipe: {
                    meta: recipe.meta,
                    pack: recipe.pack,
                    entityIds: isGridRecipe(recipe) ? recipe.entities.map((entity) => ({ id: entity.id, kind: entity.kind })) : [],
                    entities: isGridRecipe(recipe) ? recipe.entities : undefined,
                    rules: isGridRecipe(recipe) ? recipe.rules : undefined,
                    entityTemplates: isGridRecipe(recipe) ? GRID_ENTITY_TEMPLATES : undefined,
                    entityRules: isGridRecipe(recipe)
                        ? 'exactly one exit is required; to add a key use kind:"item" + itemType + count; never kind:"key"'
                        : undefined,
                    ruleIds: isGridRecipe(recipe) ? recipe.rules.map((rule) => rule.id) : [],
                    questionIds: isQuizRecipe(recipe) ? recipe.quiz.questions.map((question) => question.id) : [],
                    questions: isQuizRecipe(recipe) ? recipe.quiz.questions : undefined,
                    cardIds: isCardRecipe(recipe) ? recipe.cards.map((card) => card.id) : [],
                    board: isGridRecipe(recipe)
                        ? { width: recipe.board.width, height: recipe.board.height, rows: recipe.board.rows, spawn: recipe.player.spawn, goal: recipe.goal, flags: recipe.flags }
                        : undefined,
                    quiz: isQuizRecipe(recipe)
                        ? { lives: recipe.quiz.lives, order: recipe.quiz.order, seed: recipe.quiz.seed }
                        : undefined,
                    card: isCardRecipe(recipe)
                        ? { cards: recipe.cards, deck: recipe.deck, enemies: recipe.enemies, run: recipe.run }
                        : undefined,
                    dialogue: isDialogueRecipe(recipe)
                        ? {
                            startNodeId: recipe.dialogue.startNodeId,
                            flags: recipe.dialogue.flags,
                            nodeIds: recipe.dialogue.nodes.map((node) => node.id),
                            nodes: recipe.dialogue.nodes,
                            endingIds: recipe.dialogue.endings.map((ending) => ending.id),
                            endings: recipe.dialogue.endings,
                        }
                        : undefined,
                },
            });
        }
        if (name === 'inspect_assets') {
            const assets = await ctx.storage.listAssets(ctx.projectId);
            return outcome(true, 'OK', { assets });
        }
        if (name === 'create_candidate') {
            const baseVersionId = typeof args.versionId === 'string' ? args.versionId : ctx.baseVersionId;
            const recipe = await loadRecipe(ctx, baseVersionId);
            if (ctx.isCancelled?.() === true)
                return outcome(false, 'RUN_CANCELLED', { message: '任务已取消，未创建候选版本' });
            const created = await ctx.storage.addVersion(ctx.projectId, {
                recipe,
                note: 'Agent 候选（基于 ' + baseVersionId + '）',
                source: 'agent',
                parentId: baseVersionId,
                status: 'candidate',
            });
            ctx.setCandidate(created.version.id);
            ctx.emit('patch', { candidateVersionId: created.version.id, parent: baseVersionId });
            return outcome(true, 'OK', { versionId: created.version.id, buildId: created.version.buildId });
        }
        if (name === 'apply_recipe_patch') {
            const parsedOps = z.array(PatchOpSchema).safeParse(args.ops);
            if (!parsedOps.success) {
                return outcome(false, 'INVALID_ARGUMENT', { issues: zodIssues(parsedOps.error) }, [], true);
            }
            const baseVersionId = await currentVersion(ctx, typeof args.versionId === 'string' ? args.versionId : undefined);
            const baseRecipe = await loadRecipe(ctx, baseVersionId);
            let patched;
            try {
                patched = applyPatch(baseRecipe, parsedOps.data);
            }
            catch (error) {
                if (error instanceof PatchError)
                    return outcome(false, error.code, { message: error.message }, [], true);
                throw error;
            }
            const parsedRecipe = parseRecipe(patched);
            if (!parsedRecipe.ok)
                return outcome(false, 'RECIPE_INVALID', { issues: parsedRecipe.issues });
            const issues = validateRecipe(parsedRecipe.value);
            if (issues.length > 0)
                return outcome(false, 'RECIPE_INVALID', { issues });
            const contractChecks = checkContracts(parsedRecipe.value, ctx.contracts, { baseline: ctx.baselineRecipe ?? undefined });
            const violated = contractChecks.filter((entry) => PROTECTED_KINDS.includes(entry.kind) && entry.status === 'failed');
            if (violated.length > 0) {
                return outcome(false, 'CONTRACT_VIOLATION', {
                    message: '补丁违反已确认的创作底线，已拒绝',
                    violations: violated.map((entry) => ({ id: entry.entryId, kind: entry.kind, detail: entry.detail })),
                });
            }
            const note = typeof args.note === 'string' ? args.note : 'Agent 补丁';
            if (ctx.isCancelled?.() === true)
                return outcome(false, 'RUN_CANCELLED', { message: '任务已取消，未应用补丁' });
            const created = await ctx.storage.addVersion(ctx.projectId, {
                recipe: parsedRecipe.value,
                note,
                source: ctx.versionSource ?? 'agent',
                parentId: baseVersionId,
                status: 'candidate',
            });
            ctx.setCandidate(created.version.id);
            ctx.emit('patch', {
                candidateVersionId: created.version.id,
                baseVersionId,
                ops: parsedOps.data.length,
                diffSummary: buildPatchDiff(baseRecipe, parsedRecipe.value),
            });
            return outcome(true, 'OK', { versionId: created.version.id, buildId: created.version.buildId, ops: parsedOps.data.length });
        }
        if (name === 'validate_recipe') {
            const versionId = await currentVersion(ctx, typeof args.versionId === 'string' ? args.versionId : undefined);
            const recipe = await loadRecipe(ctx, versionId);
            const issues = validateRecipe(recipe);
            return outcome(issues.length === 0, issues.length === 0 ? 'OK' : 'RECIPE_INVALID', { versionId, issues });
        }
        if (name === 'build_candidate') {
            const versionId = await currentVersion(ctx, typeof args.versionId === 'string' ? args.versionId : undefined);
            const recipe = await loadRecipe(ctx, versionId);
            const meta = project.versions.find((version) => version.id === versionId);
            return outcome(true, 'OK', {
                versionId,
                buildId: meta?.buildId ?? null,
                recipeHash: meta?.recipeHash ?? null,
                contractHash: ctx.storage.contractHashOf(ctx.contracts),
            });
        }
        if (name === 'run_rule_checks') {
            const versionId = await currentVersion(ctx, typeof args.versionId === 'string' ? args.versionId : undefined);
            const verification = await verifyVersion(ctx.storage, ctx.projectId, versionId, { runId: ctx.runId + '-verify-' + Date.now().toString(36) });
            const checks = verification.report.checks.map((check) => ({ id: check.id, status: check.status, detail: check.detail }));
            ctx.lastVerification = { buildId: verification.report.buildId, status: verification.report.status, checks };
            await ctx.storage.writeRunFile(ctx.projectId, ctx.runId, 'checks.json', JSON.stringify(checks, null, 2));
            await ctx.storage.writeRunFile(ctx.projectId, ctx.runId, 'report.json', JSON.stringify(verification.report, null, 2));
            const failed = verification.report.checks.filter((check) => check.status === 'failed');
            ctx.emit('validation', { versionId, status: verification.report.status, checks: checks.length, verificationId: verification.report.verificationId });
            const acceptable = verification.report.status === 'passed' || verification.report.status === 'partial';
            return outcome(acceptable, acceptable ? 'OK' : 'PLAYTEST_FAILED', {
                versionId,
                status: verification.report.status,
                buildId: verification.report.buildId,
                checks,
                verificationId: verification.report.verificationId,
            }, [verification.dir]);
        }
        if (name === 'run_browser_playtest') {
            const versionId = await currentVersion(ctx, typeof args.versionId === 'string' ? args.versionId : undefined);
            const recipe = await loadRecipe(ctx, versionId);
            const verification = await verifyVersion(ctx.storage, ctx.projectId, versionId, { runId: ctx.runId + '-preplay-' + Date.now().toString(36) });
            if (verification.report.status === 'failed' || verification.report.status === 'blocked' || verification.report.status === 'unknown') {
                return outcome(false, 'PLAYTEST_FAILED', { message: '静态检查未通过，先修复再试玩', checks: verification.report.checks.filter((check) => check.status !== 'passed' && check.status !== 'partial') });
            }
            const replay = verification.report.replay ?? [];
            const dialogueReplay = (verification.report.dialogue?.replay ?? []);
            const dir = await ctx.storage.runDir(ctx.projectId, ctx.runId);
            const result = await runBrowserPlaytest({
                baseUrl: ctx.baseUrl,
                projectId: ctx.projectId,
                versionId,
                buildId: verification.report.buildId,
                recipe,
                replay,
                dialogueReplay,
                runDir: dir,
            });
            // 试玩期间被取消：真实浏览器结果不再写回工程，避免「已取消的任务」产生版本与通过证据。
            if (ctx.isCancelled?.() === true) {
                return outcome(false, 'RUN_CANCELLED', { message: '任务在试玩期间被取消，试玩结果未写入工程' });
            }
            await ctx.storage.writeRunFile(ctx.projectId, ctx.runId, 'inputs.jsonl', result.trace.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
            await ctx.storage.writeRunFile(ctx.projectId, ctx.runId, 'runtime-trace.jsonl', result.trace.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
            await ctx.storage.writeRunFile(ctx.projectId, ctx.runId, 'console.jsonl', result.consoleErrors.map((line) => JSON.stringify({ line })).join('\n') + '\n');
            await ctx.storage.writeRunFile(ctx.projectId, ctx.runId, 'playtest.json', JSON.stringify(result, null, 2));
            ctx.lastPlaytest = result;
            if (result.ok) {
                await ctx.storage.recordReplayEvidence(ctx.projectId, versionId, {
                    buildId: verification.report.buildId,
                    ok: true,
                    finalStatus: result.finalStatus,
                    source: ctx.runId,
                    at: new Date().toISOString(),
                });
                const rebound = await verifyVersion(ctx.storage, ctx.projectId, versionId, { runId: ctx.runId + '-bound-' + Date.now().toString(36) });
                ctx.lastVerification = {
                    buildId: rebound.report.buildId,
                    status: rebound.report.status,
                    checks: rebound.report.checks.map((check) => ({ id: check.id, status: check.status, detail: check.detail })),
                };
                await ctx.storage.writeRunFile(ctx.projectId, ctx.runId, 'report.json', JSON.stringify(rebound.report, null, 2));
                await ctx.storage.writeRunFile(ctx.projectId, ctx.runId, 'checks.json', JSON.stringify(rebound.report.checks, null, 2));
                await ctx.storage.writeRunFile(ctx.projectId, ctx.runId, 'manifest.json', JSON.stringify({
                    runId: ctx.runId,
                    versionId,
                    buildId: rebound.report.buildId,
                    contractHash: rebound.report.contractHash,
                    verificationId: rebound.report.verificationId,
                    status: rebound.report.status,
                    replayBound: true,
                    at: new Date().toISOString(),
                }, null, 2));
            }
            ctx.emit('evidence', { kind: 'browser-playtest', ok: result.ok, mode: result.browserMode, screenshots: result.screenshots.length });
            return outcome(result.ok, result.ok ? 'OK' : result.code, {
                ok: result.ok,
                message: result.message,
                finalStatus: result.finalStatus,
                browserMode: result.browserMode,
                screenshots: result.screenshots,
                trace: result.trace.slice(0, 60),
                consoleErrors: result.consoleErrors.slice(0, 20),
            }, result.screenshots);
        }
        if (name === 'read_evidence') {
            const file = typeof args.file === 'string' ? args.file : '';
            if (!/^[a-z0-9_.-]+$/i.test(file))
                return outcome(false, 'INVALID_ARGUMENT', { message: '只允许读取本任务目录下的文件' }, [], true);
            const content = await ctx.storage.readRunFile(ctx.projectId, ctx.runId, file);
            if (content === null)
                return outcome(false, 'NOT_FOUND', { message: '没有该证据文件' });
            return outcome(true, 'OK', { file, content });
        }
        if (name === 'compare_versions') {
            const fromVersionId = String(args.fromVersionId ?? '');
            const toVersionId = String(args.toVersionId ?? '');
            const from = await loadRecipe(ctx, fromVersionId);
            const to = await loadRecipe(ctx, toVersionId);
            return outcome(true, 'OK', diffSummary(from, to));
        }
        if (name === 'submit_plan') {
            const parsed = PlanSchema.safeParse(args);
            if (!parsed.success) {
                return outcome(false, 'INVALID_ARGUMENT', { issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) }, [], true);
            }
            const known = ctx.lastVerification?.checks.map((check) => check.id) ?? null;
            const steps = parsed.data.steps.map((step) => ({ ...step, checkIds: step.checkIds ?? [] }));
            const unknown = known === null ? [] : steps.flatMap((step) => step.checkIds).filter((id) => !known.includes(id));
            if (unknown.length > 0) {
                return outcome(false, 'INVALID_ARGUMENT', { message: '这些检查 id 不存在：' + unknown.join('、'), knownCheckIds: known }, [], true);
            }
            if (new Set(steps.map((step) => step.id)).size !== steps.length) {
                return outcome(false, 'INVALID_ARGUMENT', { message: '子任务 id 重复' }, [], true);
            }
            ctx.plan = steps;
            const progress = ctx.lastVerification === null ? steps.map((step) => ({ id: step.id, status: 'pending' })) : planProgress(steps, ctx.lastVerification.checks);
            await ctx.storage.writeRunFile(ctx.projectId, ctx.runId, 'plan.json', JSON.stringify({ steps, progress }, null, 2));
            ctx.emit('plan', { steps, progress });
            return outcome(true, 'OK', { steps: steps.length, progress });
        }
        if (name === 'prepare_review') {
            const versionId = await currentVersion(ctx, typeof args.versionId === 'string' ? args.versionId : undefined);
            const meta = project.versions.find((version) => version.id === versionId);
            if (meta === undefined)
                return outcome(false, 'NOT_FOUND', { message: '版本不存在' });
            if (ctx.lastVerification === null) {
                return outcome(false, 'PLAYTEST_FAILED', { message: '还没有在该候选上运行 run_rule_checks' });
            }
            const candidateVersionId = ctx.candidateVersionId;
            const candidateMeta = candidateVersionId === null ? undefined : project.versions.find((version) => version.id === candidateVersionId);
            const baseMeta = project.versions.find((version) => version.id === ctx.baseVersionId);
            const hasCandidate = candidateVersionId !== null && candidateMeta !== undefined;
            const nonEmptyDiff = candidateMeta !== undefined && baseMeta !== undefined && candidateMeta.recipeHash !== baseMeta.recipeHash;
            const buildMatches = ctx.lastVerification.buildId === meta.buildId;
            const candidateBuildMatches = candidateMeta === undefined ? false : candidateMeta.buildId === meta.buildId;
            const verificationPassed = ctx.lastVerification.status === 'passed';
            const playtestOk = ctx.lastPlaytest === null ? false : ctx.lastPlaytest.ok;
            const needsDiff = (ctx.kind ?? 'modify') !== 'explain';
            const diffOk = needsDiff ? nonEmptyDiff : true;
            const planState = ctx.plan == null ? [] : planProgress(ctx.plan, ctx.lastVerification.checks);
            const planOpen = planState.filter((step) => step.status === 'failed' || step.status === 'pending').map((step) => step.id);
            const ready = hasCandidate && buildMatches && candidateBuildMatches && verificationPassed && playtestOk && diffOk && planOpen.length === 0;
            const failureReasons = [];
            if (planOpen.length > 0)
                failureReasons.push('plan_incomplete:' + planOpen.join(','));
            if (!hasCandidate)
                failureReasons.push('no_candidate');
            if (needsDiff && !nonEmptyDiff)
                failureReasons.push('no_recipe_diff');
            if (!buildMatches || !candidateBuildMatches)
                failureReasons.push('build_mismatch');
            if (!verificationPassed)
                failureReasons.push('verification_not_passed');
            if (!playtestOk)
                failureReasons.push('browser_playtest_missing');
            const manual = project.contracts.entries.filter((entry) => entry.verificationMode === 'manual').map((entry) => entry.id);
            return outcome(ready, ready ? 'OK' : 'PLAYTEST_FAILED', {
                versionId,
                candidateVersionId,
                buildId: meta.buildId,
                hasCandidate,
                nonEmptyDiff,
                buildMatches,
                candidateBuildMatches,
                verificationPassed,
                browserPlaytestPassed: playtestOk,
                ready,
                failureReasons,
                plan: planState,
                manualItems: manual,
                checks: ctx.lastVerification.checks,
            });
        }
        return outcome(false, 'INVALID_ARGUMENT', { message: 'unknown tool ' + name }, [], true);
    }
    catch (error) {
        const code = error.code ?? 'INTERNAL_ERROR';
        return outcome(false, code, { message: error instanceof Error ? error.message : String(error) });
    }
}

const GRID_OPS = [
    'set_tile',
    'move_entity',
    'add_entity',
    'update_entity',
    'remove_entity',
    'add_rule',
    'update_rule',
    'remove_rule',
    'update_goal',
    'update_presentation',
    'set_player_spawn',
    'update_meta',
];
const QUIZ_OPS = ['add_quiz_question', 'update_quiz_question', 'update_quiz_answer', 'update_meta'];
const CARD_OPS = ['add_card', 'update_card', 'set_deck', 'add_enemy', 'update_enemy', 'update_run', 'update_meta'];
const DIALOGUE_OPS = [
    'add_dialogue_node',
    'add_dialogue_choice',
    'add_dialogue_ending',
    'set_start_node',
    'update_dialogue_node',
    'update_dialogue_choice',
    'update_dialogue_ending',
    'update_meta',
];
function allowedOpsFor(packId, kind) {
    if (kind === 'explain')
        return [];
    if (packId === 'quiz')
        return [...QUIZ_OPS];
    if (packId === 'card')
        return [...CARD_OPS];
    if (packId === 'dialogue')
        return [...DIALOGUE_OPS];
    return [...GRID_OPS];
}
const LEADING_POLITE = /^(?:(?:帮我|请|麻烦|我想|我想要|我要|能不能|可以帮我|可以|给我)\s*)+/;
const CONSTRAINT_PATTERN = /(不要|不许|别动|别改|不能改|不得|保持|必须保留|必须保持|不要碰|不要删)/;
function cleanText(raw, max = 160) {
    let text = raw.replace(/\s+/g, ' ').trim();
    while (LEADING_POLITE.test(text))
        text = text.replace(LEADING_POLITE, '').trim();
    if (text.length === 0)
        text = raw.replace(/\s+/g, ' ').trim();
    return text.slice(0, max);
}
function extractUserConstraints(rawText) {
    const parts = rawText
        .split(/[。；;！!？?\n]/)
        .map((part) => part.replace(/\s+/g, ' ').trim())
        .filter((part) => part.length > 0 && CONSTRAINT_PATTERN.test(part))
        .map((part) => part.slice(0, 80));
    return [...new Set(parts)].slice(0, 8);
}
function acceptanceFor(kind) {
    if (kind === 'initial_generation') {
        return ['生成一个可试玩的第一版（必须有非空配方改动）', '结构检查与已确认创作底线通过', '能力不足的部分在总结里明确说明，不得省略'];
    }
    if (kind === 'repair') {
        return ['同一失败检查由失败变为通过', '修复候选绑定真实浏览器回放证据', '未删除失败证据与历史版本'];
    }
    if (kind === 'explain') {
        return ['只读取状态，不修改配方'];
    }
    return ['本次修改形成非空配方 diff', '已确认创作底线保持不变', '机器检查结果与 AI 自述分开呈现'];
}
function compileTaskBrief(input) {
    const rawText = input.rawText.trim().slice(0, 4000);
    const goal = cleanText(input.goal !== undefined && input.goal.trim().length > 0 ? input.goal : rawText);
    const issue = input.issue ?? null;
    const threadId = input.threadId ?? null;
    const parentRunId = input.parentRunId ?? null;
    const issueId = issue?.id ?? null;
    const evidenceRefs = {};
    if (issue !== null) {
        if (issue.reproduction.verificationId !== undefined)
            evidenceRefs.verificationId = issue.reproduction.verificationId;
        if (issue.checkIds.length > 0)
            evidenceRefs.failedCheckIds = [...issue.checkIds];
        if (issue.reproduction.consoleErrors !== undefined)
            evidenceRefs.consoleErrors = [...issue.reproduction.consoleErrors];
        if (issue.reproduction.actions !== undefined)
            evidenceRefs.recentActions = issue.reproduction.actions;
    }
    const failedChecks = (input.lastVerification?.checks ?? []).filter((check) => check.status === 'failed');
    if (failedChecks.length > 0) {
        const merged = new Set([...(evidenceRefs.failedCheckIds ?? []), ...failedChecks.map((check) => check.id)]);
        evidenceRefs.failedCheckIds = [...merged];
    }
    if (input.lastVerification?.verificationId !== undefined) {
        evidenceRefs.verificationId = input.lastVerification.verificationId;
    }
    const confirmed = input.contracts.confirmedAt !== undefined && input.contracts.confirmedAt !== null;
    const protectedContracts = input.contracts.entries.slice(0, 6).map((entry) => ({
        id: entry.id,
        description: (confirmed ? '' : '（待确认）') + entry.description,
    }));
    const extraConstraints = (input.userConstraints ?? []).map((text) => text.trim()).filter((text) => text.length > 0);
    const userConstraints = [...new Set([...extraConstraints, ...extractUserConstraints(rawText)])].slice(0, 8);
    const acceptance = acceptanceFor(input.kind);
    const hash = createHash('sha256')
        .update([input.kind, input.packId, input.baseVersionId, rawText].join('|'))
        .digest('hex')
        .slice(0, 10);
    const brief = {
        compilerVersion: 1,
        id: 'brief-' + hash,
        kind: input.kind,
        rawText,
        goal,
        packId: input.packId,
        baseVersionId: input.baseVersionId,
        threadId,
        parentRunId,
        issueId,
        targetRefs: (input.targetRefs ?? []).filter((ref) => ref.length > 0).slice(0, 16),
        protectedContracts,
        allowedOps: allowedOpsFor(input.packId, input.kind),
        evidenceRefs,
        userConstraints,
        acceptance,
        support: 'supported',
    };
    if (input.kind === 'initial_generation') {
        brief.supportNote = '会在当前最小骨架上生成第一版；只允许受约束的玩法配方操作，不会执行任意代码。';
    }
    else if (input.kind === 'repair' && brief.evidenceRefs.failedCheckIds === undefined) {
        brief.supportNote = '这次修复没有可自动回归的失败检查，修完只能标注“待你试玩确认”。';
    }
    return brief;
}
function renderBriefPrompt(brief) {
    const lines = [
        '任务编译器 v' + brief.compilerVersion + '（服务端可信字段，不要在回答里改写这些事实）',
        '类型：' + kindLabel(brief.kind),
        '目标：' + brief.goal,
        '基础版本：' + brief.baseVersionId,
        '允许的操作：' + (brief.allowedOps.length > 0 ? brief.allowedOps.join('、') : '只读，不修改'),
        '不能改的创作底线：' +
            (brief.protectedContracts.length > 0
                ? brief.protectedContracts.map((entry) => entry.id + ' ' + entry.description).join('；')
                : '无已登记底线，但仍不得删除出口或绕过胜利条件'),
    ];
    if (brief.issueId !== null)
        lines.push('关联问题：' + brief.issueId);
    const failed = brief.evidenceRefs.failedCheckIds;
    if (failed !== undefined && failed.length > 0) {
        lines.push('失败证据：检查 ' + failed.join('、') + (brief.evidenceRefs.verificationId !== undefined ? '（报告 ' + brief.evidenceRefs.verificationId + '）' : ''));
    }
    if (brief.evidenceRefs.recentActions !== undefined && brief.evidenceRefs.recentActions.length > 0) {
        lines.push('用户最近操作：' + JSON.stringify(brief.evidenceRefs.recentActions.slice(0, 12)).slice(0, 800));
    }
    if (brief.userConstraints.length > 0)
        lines.push('用户额外约束：' + brief.userConstraints.join('；'));
    lines.push('完成标准：' + brief.acceptance.join('；'));
    lines.push('要求：先 inspect_project；新增实体/题目/卡牌/节点时必须照抄 inspect_project 返回的实体模板或原对象字段，不要猜 kind 或字段名（钥匙是 kind:"item" + itemType + count，不是 kind:"key"）。先说明你要改什么、为什么；只使用允许的操作；修改后必须走 validate_recipe → run_rule_checks → run_browser_playtest → prepare_review。');
    return lines.join('\n');
}
function kindLabel(kind) {
    if (kind === 'initial_generation')
        return '从想法生成第一版';
    if (kind === 'repair')
        return '修复当前版本的问题';
    if (kind === 'explain')
        return '解释当前状态（只读）';
    return '修改当前版本';
}

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'ready_for_review', 'blocked'];
function issuesPath(storage, projectId) {
    return join(storage.projectDir(projectId), 'issues.json');
}
function normalizeIssue(projectId, raw) {
    if (typeof raw.id !== 'string' || raw.id.length === 0)
        return null;
    const now = new Date().toISOString();
    const reproduction = raw.reproduction !== undefined && raw.reproduction !== null ? raw.reproduction : {};
    return {
        id: raw.id,
        projectId,
        title: typeof raw.title === 'string' && raw.title.length > 0 ? raw.title : '未命名问题',
        source: raw.source ?? 'user',
        status: raw.status ?? 'open',
        versionId: typeof raw.versionId === 'string' ? raw.versionId : '',
        buildId: raw.buildId,
        checkIds: Array.isArray(raw.checkIds) ? raw.checkIds.filter((id) => typeof id === 'string') : [],
        userDescription: raw.userDescription,
        reproduction,
        linkedRunIds: Array.isArray(raw.linkedRunIds) ? raw.linkedRunIds.filter((id) => typeof id === 'string') : [],
        resolution: raw.resolution,
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
    };
}
/**
 * 读取项目的问题单。文件缺失或损坏时返回空列表（问题单不是可信证据，不阻塞主流程）。
 */
async function listIssues(storage, projectId) {
    let text;
    try {
        text = await readFile(issuesPath(storage, projectId), 'utf8');
    }
    catch {
        return [];
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return [];
    }
    const file = parsed;
    const rawIssues = file !== null && Array.isArray(file.issues) ? file.issues : [];
    const issues = [];
    for (const raw of rawIssues) {
        const issue = normalizeIssue(projectId, raw);
        if (issue !== null)
            issues.push(issue);
    }
    return issues;
}
async function writeIssues(storage, projectId, issues) {
    const path = issuesPath(storage, projectId);
    const file = { version: 1, projectId, issues };
    await mkdir(dirname(path), { recursive: true });
    const tmp = path + '.' + randomUUID() + '.tmp';
    await writeFile(tmp, JSON.stringify(file, null, 2) + '\n', 'utf8');
    await rename(tmp, path);
}
function issueNotFound(issueId) {
    return Object.assign(new Error('问题不存在：' + issueId), { code: 'ISSUE_NOT_FOUND' });
}
async function getIssue(storage, projectId, issueId) {
    const issues = await listIssues(storage, projectId);
    return issues.find((issue) => issue.id === issueId) ?? null;
}
/**
 * 用户反馈入口。状态按契约 §3.3：
 * - checkIds 非空 → reproduced（可自动回归）
 * - 否则有 userSteps / recentActions → open（待复现，绝不自动 resolved）
 * - 都没有 → cannot_reproduce
 */
async function createIssue(storage, projectId, input) {
    const project = await storage.getProject(projectId);
    if (project === null)
        throw Object.assign(new Error('项目不存在'), { code: 'NOT_FOUND' });
    const now = new Date().toISOString();
    const checkIds = (input.checkIds ?? []).filter((id) => typeof id === 'string' && id.length > 0);
    const userSteps = input.userSteps !== undefined && input.userSteps.trim().length > 0 ? input.userSteps.trim() : undefined;
    const recentActions = input.recentActions !== undefined && input.recentActions.length > 0 ? input.recentActions : undefined;
    const consoleErrors = input.consoleErrors !== undefined && input.consoleErrors.length > 0 ? input.consoleErrors : undefined;
    let status;
    if (checkIds.length > 0)
        status = 'reproduced';
    else if (userSteps !== undefined || recentActions !== undefined)
        status = 'open';
    else
        status = 'cannot_reproduce';
    const issue = {
        id: 'issue-' + randomUUID().slice(0, 8),
        projectId,
        title: input.title.trim().slice(0, 200) || '我遇到的问题',
        source: input.source ?? 'user',
        status,
        versionId: input.versionId ?? project.currentVersionId,
        buildId: input.buildId,
        checkIds,
        userDescription: input.description,
        reproduction: {
            userSteps,
            actions: recentActions,
            consoleErrors,
        },
        linkedRunIds: [],
        createdAt: now,
        updatedAt: now,
    };
    const issues = await listIssues(storage, projectId);
    issues.push(issue);
    await writeIssues(storage, projectId, issues);
    return issue;
}
async function updateIssue(storage, projectId, issueId, patch) {
    const issues = await listIssues(storage, projectId);
    const index = issues.findIndex((issue) => issue.id === issueId);
    if (index < 0)
        throw issueNotFound(issueId);
    const current = issues[index];
    const next = {
        ...current,
        title: patch.title ?? current.title,
        status: patch.status ?? current.status,
        checkIds: patch.checkIds ?? current.checkIds,
        buildId: patch.buildId ?? current.buildId,
        userDescription: patch.userDescription ?? current.userDescription,
        reproduction: patch.reproduction !== undefined ? { ...current.reproduction, ...patch.reproduction } : current.reproduction,
        linkedRunIds: patch.linkedRunIds ?? current.linkedRunIds,
        resolution: patch.resolution === null ? undefined : (patch.resolution ?? current.resolution),
        updatedAt: new Date().toISOString(),
    };
    issues[index] = next;
    await writeIssues(storage, projectId, issues);
    return next;
}
/** 仅关闭问题单，不修改验证事实。 */
async function dismissIssue(storage, projectId, issueId) {
    const issue = await getIssue(storage, projectId, issueId);
    if (issue === null)
        throw issueNotFound(issueId);
    return updateIssue(storage, projectId, issueId, { status: 'dismissed' });
}
/**
 * 人工确认：resolved=true → resolved；false → 回到 open。
 * 用于 awaiting_review（尤其是用户口述、机器无法自动判定的体验问题）。
 */
async function confirmIssue(storage, projectId, issueId, input) {
    const issue = await getIssue(storage, projectId, issueId);
    if (issue === null)
        throw issueNotFound(issueId);
    if (issue.status === 'dismissed') {
        throw Object.assign(new Error('已关闭的问题不能确认，请重新报告'), { code: 'ISSUE_DISMISSED' });
    }
    const now = new Date().toISOString();
    if (!input.resolved) {
        return updateIssue(storage, projectId, issueId, { status: 'open', resolution: null });
    }
    const project = await storage.getProject(projectId);
    const candidateVersionId = issue.resolution?.candidateVersionId ?? project?.currentVersionId ?? issue.versionId;
    return updateIssue(storage, projectId, issueId, {
        status: 'resolved',
        resolution: {
            candidateVersionId,
            verificationId: issue.resolution?.verificationId ?? '',
            resolvedCheckIds: issue.resolution?.resolvedCheckIds ?? issue.checkIds,
            requiresUserReview: false,
            note: input.note,
            at: now,
        },
    });
}
function titleForCheck(check) {
    const title = typeof check.title === 'string' && check.title.trim().length > 0 ? check.title.trim() : '规则检查未通过';
    return title.slice(0, 200);
}
/**
 * 验证失败后自动 upsert：同一 versionId + buildId + checkId 不重复创建。
 * 返回本次新建或更新的问题单。
 */
async function upsertIssuesFromVerification(storage, projectId, versionId, report) {
    const failed = report.checks.filter((check) => check.status === 'failed');
    if (failed.length === 0)
        return [];
    const issues = await listIssues(storage, projectId);
    const now = new Date().toISOString();
    const affected = [];
    let dirty = false;
    for (const check of failed) {
        const existing = issues.find((issue) => issue.source === 'verification' &&
            issue.versionId === versionId &&
            issue.buildId === report.buildId &&
            issue.checkIds.includes(check.id));
        if (existing !== undefined) {
            if (existing.status === 'dismissed')
                continue;
            if (existing.status !== 'resolved') {
                existing.status = 'reproduced';
                existing.reproduction = {
                    ...existing.reproduction,
                    verificationId: report.verificationId,
                    actions: report.replay !== undefined ? report.replay : existing.reproduction.actions,
                    consoleErrors: report.errors !== undefined && report.errors.length > 0 ? report.errors : existing.reproduction.consoleErrors,
                };
                existing.updatedAt = now;
                dirty = true;
            }
            affected.push(existing);
            continue;
        }
        const issue = {
            id: 'issue-' + randomUUID().slice(0, 8),
            projectId,
            title: titleForCheck(check),
            source: 'verification',
            status: 'reproduced',
            versionId,
            buildId: report.buildId,
            checkIds: [check.id],
            reproduction: {
                verificationId: report.verificationId,
                actions: report.replay !== undefined ? report.replay : undefined,
                consoleErrors: report.errors !== undefined && report.errors.length > 0 ? report.errors : undefined,
            },
            linkedRunIds: [],
            createdAt: now,
            updatedAt: now,
        };
        issues.push(issue);
        affected.push(issue);
        dirty = true;
    }
    if (dirty)
        await writeIssues(storage, projectId, issues);
    return affected;
}
/**
 * 契约 §3.3：run 终态后回归判定。
 * - 有 checkIds：候选 report.status === 'passed' 且同一批 checkIds 全部 passed → resolved
 * - 用户口述（无 checkIds）：最多 awaiting_review（requiresUserReview=true）
 * - 其余：回到 open，不谎称修好
 */
async function evaluateIssueAfterRun(storage, issueId, run) {
    const issues = await listIssues(storage, run.projectId);
    const issue = issues.find((item) => item.id === issueId);
    if (issue === undefined)
        return null;
    if (issue.status === 'dismissed' || issue.status === 'resolved')
        return issue;
    if (!TERMINAL_STATUSES.includes(run.status))
        return issue;
    const withRun = issue.linkedRunIds.includes(run.id) ? issue.linkedRunIds : [...issue.linkedRunIds, run.id];
    const now = new Date().toISOString();
    const candidateVersionId = run.candidateVersionId;
    const persist = async (patch) => {
        const next = {
            ...issue,
            ...patch,
            linkedRunIds: withRun,
            resolution: patch.resolution === null ? undefined : (patch.resolution ?? issue.resolution),
            updatedAt: now,
        };
        const index = issues.findIndex((item) => item.id === issueId);
        issues[index] = next;
        await writeIssues(storage, run.projectId, issues);
        return next;
    };
    if (candidateVersionId === null) {
        // 本次任务没有产生候选：不能谎称修好，也不能进入待确认。
        return persist({ status: issue.status === 'fixing' ? 'open' : issue.status, resolution: null });
    }
    if (issue.checkIds.length === 0) {
        // 用户口述问题：机器无法判定，只能等用户试玩确认。
        const verificationId = await candidateVerificationId(storage, run.projectId, candidateVersionId);
        return persist({
            status: 'awaiting_review',
            resolution: {
                candidateVersionId,
                verificationId: verificationId ?? '',
                resolvedCheckIds: [],
                requiresUserReview: true,
                at: now,
            },
        });
    }
    const verificationId = await candidateVerificationId(storage, run.projectId, candidateVersionId);
    const report = verificationId === null
        ? null
        : (await storage.getReport(run.projectId, verificationId));
    if (report !== null && report.status === 'passed') {
        const statusById = new Map(report.checks.map((check) => [check.id, check.status]));
        let changed = false;
        // 同一候选可能覆盖多个由同一批失败检查拆出来的问题单；全部按“检查真的通过”处理。
        for (const item of issues) {
            if (item.status === 'resolved' || item.status === 'dismissed')
                continue;
            if ((item.source === 'user' && item.id !== issueId) || item.checkIds.length === 0)
                continue;
            if (!item.checkIds.every((id) => statusById.get(id) === 'passed'))
                continue;
            item.status = 'resolved';
            item.resolution = {
                candidateVersionId,
                verificationId: report.verificationId,
                resolvedCheckIds: item.checkIds.slice(),
                requiresUserReview: false,
                at: now,
            };
            if (!item.linkedRunIds.includes(run.id))
                item.linkedRunIds = [...item.linkedRunIds, run.id];
            item.updatedAt = now;
            changed = true;
        }
        if (changed)
            await writeIssues(storage, run.projectId, issues);
        return issues.find((item) => item.id === issueId) ?? issue;
    }
    // 候选存在但同一检查未全部通过：回到 open（保留 update 时间与关联任务，不删证据）。
    return persist({ status: 'open', resolution: null });
}
async function candidateVerificationId(storage, projectId, candidateVersionId) {
    const project = await storage.getProject(projectId);
    const version = project?.versions.find((item) => item.id === candidateVersionId);
    return version?.verified?.verificationId ?? null;
}

/** 终态集合必须与 app.ts / issues.ts / storage.ts 保持一致，blocked 也是终态。 */
const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'cancelled', 'ready_for_review', 'blocked'];
class ModelConfigStore {
    config = null;
    filePath = null;
    /** 容器等常驻实例可挂接文件路径：Key 跨重启保留（仅外部模式启用，本地包维持"只存内存"）。 */
    async attach(filePath) {
        this.filePath = filePath;
        try {
            const text = await readFile(filePath, 'utf8');
            const parsed = JSON.parse(text);
            if (typeof parsed.baseUrl === 'string' && typeof parsed.model === 'string' && typeof parsed.apiKey === 'string') {
                this.config = {
                    baseUrl: parsed.baseUrl,
                    model: parsed.model,
                    apiKey: parsed.apiKey,
                    timeoutMs: parsed.timeoutMs ?? 60000,
                    maxRequests: parsed.maxRequests ?? 12,
                };
            }
        }
        catch {
            // 首次运行或文件损坏：保持未配置
        }
    }
    set(config) {
        this.config = config;
        void this.persist();
    }
    get() {
        return this.config;
    }
    clear() {
        this.config = null;
        if (this.filePath !== null) {
            void rm(this.filePath, { force: true }).catch(() => undefined);
        }
    }
    async persist() {
        if (this.filePath === null || this.config === null)
            return;
        try {
            await writeFile(this.filePath, JSON.stringify(this.config), 'utf8');
        }
        catch {
            // 落盘失败不影响本次会话内的使用
        }
    }
    configured() {
        return this.config !== null;
    }
    publicView() {
        const current = this.config;
        if (current === null) {
            return { configured: false, baseUrl: null, model: null, timeoutMs: null, maxRequests: null, hasApiKey: false };
        }
        return {
            configured: true,
            baseUrl: current.baseUrl,
            model: current.model,
            timeoutMs: current.timeoutMs,
            maxRequests: current.maxRequests,
            hasApiKey: current.apiKey.length > 0,
        };
    }
}
const SYSTEM_PROMPT$1 = [
    '你是造玩工坊的创作 Agent，负责把用户的游戏想法落成受支持的玩法配方。',
    '你只能使用提供的工具；不能执行 shell、不能访问任意文件、不能读取密钥、不能修改契约或测试。',
    '工作流（顺序固定，但验证失败必须依据失败详情修改后重试）：',
    'inspect_project → run_rule_checks（先诊断当前版本，拿到失败项与检查 id）→ submit_plan（把任务拆成 2–6 个子任务，能机器判定的子任务填 checkIds）→ apply_recipe_patch → validate_recipe → run_rule_checks → run_browser_playtest → prepare_review。',
    '若复测或试玩失败：读失败项的 detail 与反例，写新的最小补丁再复测；不要原样重复同一补丁。prepare_review 会检查计划里绑定检查的子任务是否全部通过。',
    '不要调用 create_candidate（apply_recipe_patch 会自动创建候选），不要调用 read_evidence 或 compare_versions 探索。',
    '叙述要求（每一步都必须说人话）：',
    '1) 发起工具调用前，先用一句不超过 40 字的中文说明“要做什么 + 为什么”。',
    '2) 收到工具结果后，用一句中文说明“这个结果意味着什么”。',
    '3) 调用 apply_recipe_patch 前，先列出将要改动的实体 ID，并声明不会碰哪些受保护对象。',
    '4) 结束前给三段式总结：我改了什么 / 后端证据怎么说 / 你还需要看哪里。',
    '5) 不许把未验证的事说成已验证；证据只到 partial 时必须照实说。',
    'run_rule_checks 返回 partial 是正常状态（搜索已通过但还没有浏览器重放证据），必须继续调用 run_browser_playtest，不要重复跑检查。',
    '同一失败连续重复两次时停止并报告受阻，不要机械重试。',
    '不得删除门、敌人或受保护对象，不得改写胜利条件来绕过检查。',
    '最终总结不超过 8 行中文。',
].join('\n');
function lintPrompt(findings) {
    const relevant = findings.filter((finding) => finding.severity !== 'info').slice(0, 8);
    if (relevant.length === 0)
        return '';
    return '\n\n算法体检结果（本地规则，未调用模型，可直接作为诊断依据）：\n' +
        relevant.map((finding) => '- [' + finding.ruleId + '] ' + finding.message + (finding.quickFix !== undefined ? '（算法建议：' + finding.quickFix.label + '）' : '')).join('\n');
}
const CLAIM_PATTERN = /(完成|通过了|已经修好|修好了|搞定|处理好了|success|done)/i;
const NEGATED_CLAIM = /(未完成|没完成|尚未|还没|不能算|没有完成|未通过|未验证|不能算完成)/;
function detectSilentStep(content, hasToolCalls) {
    return hasToolCalls && content.trim().length === 0;
}
function detectClaimGap(content, status) {
    if (status === null || status === 'passed')
        return false;
    if (NEGATED_CLAIM.test(content))
        return false;
    return CLAIM_PATTERN.test(content);
}
function detectScopeDrift(touched, mentioned) {
    if (mentioned.length === 0)
        return [];
    return touched.filter((id) => !mentioned.includes(id));
}
function detectContractGuarded(code) {
    return code === 'CONTRACT_VIOLATION';
}
function detectLoopSpin(count) {
    return count >= 2;
}
class DemoProvider {
    script;
    finalMessage;
    kind = 'fixture';
    index = 0;
    constructor(script, finalMessage) {
        this.script = script;
        this.finalMessage = finalMessage;
    }
    async chat() {
        const next = this.script[this.index] ?? {
            content: this.finalMessage(),
            toolCalls: [],
            finishReason: 'stop',
            usage: { promptTokens: 'unknown', completionTokens: 'unknown', totalTokens: 'unknown' },
        };
        this.index += 1;
        return next;
    }
    async testConnection() {
        return { ok: true, toolCalling: true, detail: '示例回放 provider（未调用真实模型）' };
    }
}
function toolCallResponse(name, args, content = null) {
    return {
        content,
        toolCalls: [{ id: 'call-' + randomUUID().slice(0, 8), name, argumentsJson: JSON.stringify(args) }],
        finishReason: 'tool_calls',
        usage: { promptTokens: 'unknown', completionTokens: 'unknown', totalTokens: 'unknown' },
    };
}
function demoKeyMovePatch(recipe) {
    if (!isGridRecipe(recipe))
        return null;
    const door = recipe.entities.find((entity) => entity.kind === 'door');
    if (door === undefined || door.kind !== 'door')
        return null;
    const key = recipe.entities.find((entity) => entity.kind === 'item' && entity.itemType === door.requires.itemType);
    if (key === undefined || key.kind !== 'item')
        return null;
    const spawn = recipe.player.spawn;
    const occupied = new Set(recipe.entities
        .filter((entity) => entity.kind !== 'zone')
        .map((entity) => entity.x + ',' + entity.y));
    const candidates = [
        { x: spawn.x + 1, y: spawn.y },
        { x: spawn.x, y: spawn.y + 1 },
        { x: spawn.x - 1, y: spawn.y },
        { x: spawn.x, y: spawn.y - 1 },
        { x: spawn.x + 1, y: spawn.y + 1 },
    ];
    for (const candidate of candidates) {
        if (candidate.x < 0 || candidate.y < 0 || candidate.x >= recipe.board.width || candidate.y >= recipe.board.height)
            continue;
        const row = recipe.board.rows[candidate.y] ?? '';
        if (row[candidate.x] !== '.')
            continue;
        if (occupied.has(candidate.x + ',' + candidate.y))
            continue;
        return [{ op: 'move_entity', entityId: key.id, x: candidate.x, y: candidate.y }];
    }
    return null;
}
function touchedEntityIds(opsJson) {
    try {
        const parsed = JSON.parse(opsJson);
        const ids = new Set();
        for (const op of parsed.ops ?? []) {
            if (typeof op.entityId === 'string')
                ids.add(op.entityId);
            if (typeof op.cardId === 'string')
                ids.add(op.cardId);
            if (typeof op.questionId === 'string')
                ids.add(op.questionId);
            if (typeof op.nodeId === 'string')
                ids.add(op.nodeId);
            if (typeof op.choiceId === 'string')
                ids.add(op.choiceId);
            if (typeof op.endingId === 'string')
                ids.add(op.endingId);
        }
        return [...ids];
    }
    catch {
        return [];
    }
}
function recipeIds(recipe) {
    if (isGridRecipe(recipe))
        return recipe.entities.map((entity) => entity.id);
    if (isQuizRecipe(recipe))
        return recipe.quiz.questions.map((question) => question.id);
    if (isCardRecipe(recipe))
        return recipe.cards.map((card) => card.id);
    if (isDialogueRecipe(recipe)) {
        const ids = [];
        for (const node of recipe.dialogue.nodes) {
            ids.push(node.id);
            for (const choice of node.choices ?? [])
                ids.push(choice.id);
        }
        for (const ending of recipe.dialogue.endings)
            ids.push(ending.id);
        return ids;
    }
    return [];
}
function mentionedIds(text, candidates) {
    return candidates.filter((candidate) => text.includes(candidate));
}
class RunManager {
    storage;
    config;
    baseUrl;
    providerFactory;
    pauseTimeoutMs;
    runs = new Map();
    listeners = new Map();
    controllers = new Map();
    constructor(storage, config, baseUrl, providerFactory, pauseTimeoutMs = 10 * 60 * 1000) {
        this.storage = storage;
        this.config = config;
        this.baseUrl = baseUrl;
        this.providerFactory = providerFactory;
        this.pauseTimeoutMs = pauseTimeoutMs;
    }
    /** 启动时从磁盘恢复 run 摘要；未终态的运行诚实标记，不自动重放。 */
    async hydrate() {
        const projects = await this.storage.listProjects();
        for (const project of projects) {
            const runIds = await this.storage.listRuns(project.id);
            for (const runId of runIds) {
                if (this.runs.has(runId))
                    continue;
                const raw = await this.storage.readRunFile(project.id, runId, 'run.json', 200000);
                if (raw === null)
                    continue;
                let data;
                try {
                    data = JSON.parse(raw);
                }
                catch {
                    continue;
                }
                const persistedStatus = String(data.status ?? 'cancelled');
                const terminal = TERMINAL_RUN_STATUSES.includes(persistedStatus);
                const now = new Date().toISOString();
                const createdAt = typeof data.createdAt === 'string' ? data.createdAt : now;
                const baseVersionId = typeof data.baseVersionId === 'string' && project.versions.some((version) => version.id === data.baseVersionId)
                    ? data.baseVersionId
                    : project.currentVersionId;
                const kind = (typeof data.kind === 'string' ? data.kind : 'modify');
                const issueId = typeof data.issueId === 'string' ? data.issueId : null;
                const threadId = typeof data.threadId === 'string' ? data.threadId : 'thread-' + runId.slice(-6);
                let brief = null;
                const briefRaw = await this.storage.readRunFile(project.id, runId, 'task-brief.json', 200000);
                if (briefRaw !== null) {
                    try {
                        const parsed = JSON.parse(briefRaw);
                        if (parsed !== null && typeof parsed === 'object' && parsed.kind !== undefined) {
                            brief = parsed;
                        }
                    }
                    catch {
                        brief = null;
                    }
                }
                if (brief === null) {
                    brief = compileTaskBrief({
                        rawText: typeof data.instruction === 'string' ? data.instruction : '',
                        kind,
                        packId: project.packId,
                        baseVersionId,
                        contracts: { entries: project.contracts.entries, confirmedAt: project.contracts.confirmedAt },
                        threadId,
                    });
                }
                const parsedStarted = Date.parse(createdAt);
                const run = {
                    id: runId,
                    projectId: project.id,
                    instruction: typeof data.instruction === 'string' ? data.instruction : '',
                    mode: data.mode === 'model' ? 'model' : 'demo',
                    kind,
                    threadId,
                    parentRunId: typeof data.parentRunId === 'string' ? data.parentRunId : null,
                    issueId,
                    brief,
                    status: (terminal ? persistedStatus : 'cancelled'),
                    createdAt,
                    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : now,
                    baseVersionId,
                    candidateVersionId: typeof data.candidateVersionId === 'string' ? data.candidateVersionId : null,
                    modelResponses: Number(data.modelResponses ?? 0),
                    toolCalls: Number(data.toolCalls ?? 0),
                    repairs: 0,
                    narratedSteps: 0,
                    silentSteps: 0,
                    concerns: data.concerns ?? {},
                    feedbackFixes: data.feedbackFixes ?? [],
                    guidance: [],
                    pendingGuidance: [],
                    pauseRequested: false,
                    resumeRequested: false,
                    startedAt: Number.isNaN(parsedStarted) ? Date.now() : parsedStarted,
                    events: [],
                    error: terminal ? (typeof data.error === 'string' ? data.error : null) : '服务重启，未继续执行',
                    usage: { promptTokens: 'unknown', completionTokens: 'unknown', totalTokens: 'unknown', requests: 0 },
                    cancelled: !terminal,
                };
                this.runs.set(runId, run);
                // 重启恢复时补一次回归判定：否则中断或受阻的 run 会让关联 issue 永久停在 fixing。
                if (run.issueId !== null && (!terminal || persistedStatus === 'blocked')) {
                    await evaluateIssueAfterRun(this.storage, run.issueId, run).catch(() => undefined);
                }
                if (!terminal) {
                    await this.storage
                        .writeRunFile(project.id, runId, 'run.json', JSON.stringify({ ...data, status: 'cancelled', interrupted: true, error: run.error, updatedAt: now }, null, 2) + '\n')
                        .catch(() => undefined);
                }
            }
        }
    }
    listRuns(projectId) {
        return [...this.runs.values()]
            .filter((run) => run.projectId === projectId)
            .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
            .map((run) => this.publicView(run));
    }
    get(runId) {
        const run = this.runs.get(runId);
        return run === undefined ? null : this.publicView(run);
    }
    /** 删除会话时清掉内存摘要；调用方必须先确认这些 run 都已结束。 */
    dropRuns(runIds) {
        for (const runId of runIds) {
            if (this.runs.get(runId) === undefined)
                continue;
            this.runs.delete(runId);
            this.listeners.delete(runId);
            this.controllers.delete(runId);
        }
    }
    subscribe(runId, listener) {
        const set = this.listeners.get(runId) ?? new Set();
        set.add(listener);
        this.listeners.set(runId, set);
        return () => {
            set.delete(listener);
        };
    }
    cancel(runId) {
        const run = this.runs.get(runId);
        if (run === undefined)
            return false;
        if (TERMINAL_RUN_STATUSES.includes(run.status))
            return false;
        run.cancelled = true;
        run.status = 'cancelled';
        run.updatedAt = new Date().toISOString();
        this.controllers.get(runId)?.abort();
        void this.emit(run, 'run_status', { status: 'cancelled', reason: '用户取消' });
        void this.persist(run).catch(() => undefined);
        if (run.issueId !== null) {
            void evaluateIssueAfterRun(this.storage, run.issueId, run).catch(() => undefined);
        }
        return true;
    }
    async guidance(runId, text, pauseBeforeNextTool) {
        const run = this.runs.get(runId);
        if (run === undefined)
            return { ok: false, code: 'NOT_FOUND', message: '任务不存在' };
        if (TERMINAL_RUN_STATUSES.includes(run.status)) {
            return { ok: false, code: 'RUN_NOT_RUNNING', message: '任务已结束。请基于这个版本新建一次任务再引导。' };
        }
        if (run.mode === 'demo') {
            return {
                ok: false,
                code: 'DEMO_NOT_INTERACTIVE',
                message: '示例回放是固定脚本，不会响应插话；请使用真实模型。',
            };
        }
        const record = {
            id: 'g-' + randomUUID().slice(0, 6),
            text: text.slice(0, 1000),
            at: new Date().toISOString(),
            pauseBeforeNextTool,
            appliedAtStep: null,
        };
        run.pendingGuidance.push(record);
        run.guidance.push(record);
        if (pauseBeforeNextTool)
            run.pauseRequested = true;
        await this.emit(run, 'guidance', {
            from: 'user',
            text: record.text,
            pauseBeforeNextTool,
            synthetic: false,
        });
        await this.persistGuidance(run);
        return { ok: true };
    }
    resume(runId) {
        const run = this.runs.get(runId);
        if (run === undefined)
            return { ok: false, code: 'NOT_FOUND', message: '任务不存在' };
        if (run.status !== 'awaiting_confirmation') {
            return { ok: false, code: 'RUN_NOT_PAUSED', message: '任务当前没有暂停等待确认。' };
        }
        run.resumeRequested = true;
        return { ok: true };
    }
    async start(projectId, instruction, mode, options = {}) {
        const project = await this.storage.requireProject(projectId);
        if (mode === 'model' && !this.config.configured()) {
            throw Object.assign(new Error('还没有配置模型服务，请先在“AI 设置”里填写 Base URL、模型与 API Key'), { code: 'MODEL_AUTH_FAILED' });
        }
        const id = 'run-' + randomUUID().slice(0, 8);
        const now = new Date().toISOString();
        const kind = options.kind ?? (options.issueId !== null && options.issueId !== undefined ? 'repair' : 'modify');
        const issue = options.issueId === null || options.issueId === undefined ? null : await getIssue(this.storage, projectId, options.issueId);
        const requestedBase = options.baseVersionId;
        const issueVersion = issue?.versionId;
        const baseVersionId = requestedBase !== undefined && project.versions.some((version) => version.id === requestedBase)
            ? requestedBase
            : issueVersion !== undefined && project.versions.some((version) => version.id === issueVersion)
                ? issueVersion
                : project.currentVersionId;
        const threadId = options.threadId ?? 'thread-' + id.slice(4);
        const parentRunId = options.parentRunId ?? null;
        const brief = options.brief ??
            compileTaskBrief({
                rawText: instruction,
                kind,
                packId: project.packId,
                baseVersionId,
                issue,
                contracts: { entries: project.contracts.entries, confirmedAt: project.contracts.confirmedAt },
                threadId,
                parentRunId,
                goal: options.goal,
                userConstraints: options.userConstraints,
                targetRefs: options.targetRefs,
            });
        const run = {
            id,
            projectId,
            instruction,
            mode,
            status: 'created',
            createdAt: now,
            updatedAt: now,
            baseVersionId,
            candidateVersionId: null,
            kind,
            threadId,
            parentRunId,
            issueId: options.issueId ?? null,
            brief,
            modelResponses: 0,
            toolCalls: 0,
            repairs: 0,
            narratedSteps: 0,
            silentSteps: 0,
            concerns: {},
            feedbackFixes: [],
            guidance: [],
            pendingGuidance: [],
            pauseRequested: false,
            resumeRequested: false,
            startedAt: Date.now(),
            events: [],
            error: null,
            usage: { promptTokens: 'unknown', completionTokens: 'unknown', totalTokens: 'unknown', requests: 0 },
            cancelled: false,
        };
        this.runs.set(id, run);
        await this.emit(run, 'run_status', { status: 'created', mode, kind, threadId, instruction: instruction.slice(0, 300) });
        if (mode === 'demo') {
            await this.emit(run, 'log', { message: '示例回放：未调用真实模型。该记录不计入真实 Agent 成功率。', synthetic: true });
        }
        void this.execute(run).catch(async (error) => {
            // 已取消或已处于终态的 run 不能被异常改写成 failed。
            if (run.cancelled || TERMINAL_RUN_STATUSES.includes(run.status)) {
                await this.persist(run).catch(() => undefined);
                return;
            }
            run.error = error instanceof Error ? error.message : String(error);
            run.status = 'failed';
            run.updatedAt = new Date().toISOString();
            await this.emit(run, 'error', { message: run.error });
            await this.persist(run).catch(() => undefined);
            if (run.issueId !== null) {
                await evaluateIssueAfterRun(this.storage, run.issueId, run).catch(() => undefined);
            }
        });
        return this.publicView(run);
    }
    publicView(run) {
        const total = run.narratedSteps + run.silentSteps;
        return {
            id: run.id,
            projectId: run.projectId,
            instruction: run.instruction,
            mode: run.mode,
            kind: run.kind,
            threadId: run.threadId,
            parentRunId: run.parentRunId,
            issueId: run.issueId,
            brief: run.brief,
            status: run.status,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
            baseVersionId: run.baseVersionId,
            candidateVersionId: run.candidateVersionId,
            modelResponses: run.modelResponses,
            toolCalls: run.toolCalls,
            repairs: run.repairs,
            narratedSteps: run.narratedSteps,
            silentSteps: run.silentSteps,
            explanationCoverage: total === 0 ? 1 : Number((run.narratedSteps / total).toFixed(2)),
            concerns: run.concerns,
            feedbackFixes: run.feedbackFixes,
            guidance: run.guidance,
            durationMs: Date.now() - run.startedAt,
            error: run.error,
            usage: run.usage,
            events: run.events,
            toolBudget: 30,
            modelBudget: 12,
        };
    }
    setStatus(run, status) {
        if (run.cancelled)
            return;
        run.status = status;
        run.updatedAt = new Date().toISOString();
        void this.emit(run, 'run_status', { status });
    }
    async emit(run, type, payload) {
        const event = {
            seq: run.events.length + 1,
            runId: run.id,
            at: new Date().toISOString(),
            type,
            payload,
        };
        run.events.push(event);
        for (const listener of this.listeners.get(run.id) ?? []) {
            try {
                listener(event);
            }
            catch {
                // a broken SSE listener must not stop the run
            }
        }
    }
    async concern(run, code, message, severity, suggestedGuidance) {
        run.concerns[code] = (run.concerns[code] ?? 0) + 1;
        await this.emit(run, 'concern', { code, message, severity, suggestedGuidance });
    }
    async persistGuidance(run) {
        await this.storage.writeRunFile(run.projectId, run.id, 'guidance.jsonl', run.guidance.map((record) => JSON.stringify(record)).join('\n') + (run.guidance.length > 0 ? '\n' : ''));
    }
    async persist(run) {
        await this.storage.writeRunFile(run.projectId, run.id, 'events.jsonl', run.events.map((event) => JSON.stringify(event)).join('\n') + '\n');
        await this.persistGuidance(run);
        await this.storage.writeRunFile(run.projectId, run.id, 'model-usage.json', JSON.stringify(run.usage, null, 2) + '\n');
        await this.storage.writeRunFile(run.projectId, run.id, 'task-brief.json', JSON.stringify(run.brief, null, 2) + '\n');
        await this.storage.writeRunFile(run.projectId, run.id, 'run.json', JSON.stringify({
            id: run.id,
            projectId: run.projectId,
            instruction: run.instruction,
            mode: run.mode,
            kind: run.kind,
            threadId: run.threadId,
            parentRunId: run.parentRunId,
            issueId: run.issueId,
            status: run.status,
            createdAt: run.createdAt,
            updatedAt: new Date().toISOString(),
            baseVersionId: run.baseVersionId,
            candidateVersionId: run.candidateVersionId,
            modelResponses: run.modelResponses,
            toolCalls: run.toolCalls,
            repairs: run.repairs,
            guidanceCount: run.guidance.length,
            concerns: run.concerns,
            feedbackFixes: run.feedbackFixes,
            error: run.error,
            demo: run.mode === 'demo',
            interrupted: false,
        }, null, 2) + '\n');
        const total = run.narratedSteps + run.silentSteps;
        await this.storage.writeRunFile(run.projectId, run.id, 'plan-summary.json', JSON.stringify({
            runId: run.id,
            mode: run.mode,
            kind: run.kind,
            threadId: run.threadId,
            parentRunId: run.parentRunId,
            issueId: run.issueId,
            instruction: run.instruction.slice(0, 400),
            status: run.status,
            baseVersionId: run.baseVersionId,
            candidateVersionId: run.candidateVersionId,
            modelResponses: run.modelResponses,
            toolCalls: run.toolCalls,
            repairs: run.repairs,
            narratedSteps: run.narratedSteps,
            silentSteps: run.silentSteps,
            explanationCoverage: total === 0 ? 1 : Number((run.narratedSteps / total).toFixed(2)),
            concerns: run.concerns,
            feedbackFixes: run.feedbackFixes,
            guidanceCount: run.guidance.length,
            durationMs: Date.now() - run.startedAt,
            demo: run.mode === 'demo',
        }, null, 2) + '\n');
    }
    buildDemoScript(failed, keyMove, reachCheckIds = []) {
        const script = [
            toolCallResponse('inspect_project', {}, '示例脚本：先读取工程摘要与已确认契约。'),
            toolCallResponse('validate_recipe', {}, '示例脚本：检查候选配方结构。'),
            toolCallResponse('run_rule_checks', {}, '示例脚本：先诊断当前版本，拿到失败项。'),
            toolCallResponse('submit_plan', {
                steps: [
                    { id: 's1', goal: '找出拿不到钥匙的原因', doneWhen: '基线检查给出失败项与反例' },
                    { id: 's2', goal: '把钥匙移到可达区域，不动门和胜利条件', doneWhen: '通关路线检查通过', checkIds: reachCheckIds },
                    { id: 's3', goal: '用真实浏览器重放通关', doneWhen: '浏览器试玩终局为胜利' },
                ],
            }, '示例脚本：把任务拆成 3 步，第 2 步由通关检查机器判定。'),
        ];
        if (failed && keyMove !== null) {
            script.push(toolCallResponse('apply_recipe_patch', { ops: keyMove, note: '回归样例修复：把钥匙移到门前可达区域' }, '示例脚本：检查显示目标不可达，把钥匙移到门前可达区域，不删除门。'), toolCallResponse('validate_recipe', {}, '示例脚本：确认补丁没有破坏结构。'), toolCallResponse('run_rule_checks', {}, '示例脚本：在新候选上复测契约与可达性。'));
        }
        script.push(toolCallResponse('run_browser_playtest', {}, '示例脚本：在真实浏览器中重放通关路线，收集截图与输入轨迹。'));
        script.push(toolCallResponse('prepare_review', {}, '示例脚本：汇总证据，请求人工审核。'));
        return script;
    }
    demoFinalMessage(run) {
        if (run.status === 'ready_for_review') {
            return '示例脚本结束：候选、检查与浏览器证据已写入运行目录，等待人工审核。本记录为固定脚本，不计入真实 Agent 成功率。';
        }
        const reason = run.error !== null ? '，原因：' + run.error.slice(0, 200) : '';
        return '示例脚本结束：本次运行状态为 ' + run.status + reason + '。未通过或未验证项不得视为通过，证据已写入运行目录。';
    }
    async trackFeedback(run, ctx, tool, ok, state) {
        if (tool === 'apply_recipe_patch' && ok) {
            state.patched = true;
            return;
        }
        let current = null;
        if (tool === 'run_rule_checks' && ctx.lastVerification !== null)
            current = ctx.lastVerification.checks;
        if (tool === 'run_browser_playtest')
            current = [{ id: 'browser_playtest', status: ok ? 'passed' : 'failed' }];
        if (current === null)
            return;
        if (state.failed.size > 0 && state.patched) {
            const resolved = [...state.failed].filter((id) => {
                const status = current?.find((check) => check.id === id)?.status;
                return status === 'passed' || status === 'partial';
            });
            if (resolved.length > 0) {
                state.attempt += 1;
                const fix = {
                    failedCheckIds: [...state.failed],
                    resolvedCheckIds: resolved,
                    attempt: state.attempt,
                    candidateVersionId: ctx.candidateVersionId,
                };
                run.feedbackFixes.push(fix);
                for (const id of resolved)
                    state.failed.delete(id);
                await this.emit(run, 'feedback_fix', { ...fix, synthetic: run.mode === 'demo' });
            }
        }
        const failedNow = current.filter((check) => check.status === 'failed').map((check) => check.id);
        if (failedNow.length > 0) {
            for (const id of failedNow)
                state.failed.add(id);
            state.patched = false;
        }
        if ((tool === 'run_rule_checks' || tool === 'run_browser_playtest') && ctx.plan != null && ctx.lastVerification !== null) {
            const progress = planProgress(ctx.plan, ctx.lastVerification.checks);
            await this.storage.writeRunFile(run.projectId, run.id, 'plan.json', JSON.stringify({ steps: ctx.plan, progress }, null, 2));
            await this.emit(run, 'plan_progress', { progress });
        }
    }
    async waitForResume(run) {
        const deadline = Date.now() + this.pauseTimeoutMs;
        while (!run.resumeRequested && !run.cancelled) {
            if (Date.now() > deadline)
                return 'timeout';
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (run.cancelled)
            return 'cancelled';
        run.resumeRequested = false;
        run.pauseRequested = false;
        return 'resumed';
    }
    async handlePause(run) {
        if (!run.pauseRequested)
            return 'continue';
        this.setStatus(run, 'awaiting_confirmation');
        await this.emit(run, 'log', { message: '按用户要求暂停，等待确认后再继续。' });
        const outcome = await this.waitForResume(run);
        if (outcome === 'cancelled')
            return 'stop';
        if (outcome === 'timeout') {
            run.error = '等待用户确认超时（10 分钟），任务转入受阻。可以基于当前版本重新发起任务。';
            this.setStatus(run, 'blocked');
            await this.emit(run, 'error', { message: run.error, code: 'GUIDANCE_TIMEOUT' });
            return 'stop';
        }
        this.setStatus(run, 'planning');
        await this.emit(run, 'log', { message: '用户已确认，继续执行。' });
        return 'continue';
    }
    async applyPendingGuidance(run, messages) {
        if (run.pendingGuidance.length === 0)
            return;
        for (const record of run.pendingGuidance) {
            messages.push({
                role: 'user',
                content: '用户在执行过程中插话（优先级高于原指令，但不得违反已确认创作底线）：' + record.text,
            });
            record.appliedAtStep = run.modelResponses;
            await this.emit(run, 'guidance', {
                from: 'system',
                text: '已注入，第 ' + run.modelResponses + ' 步生效：' + record.text.slice(0, 120),
                appliedAtStep: record.appliedAtStep,
                synthetic: false,
            });
        }
        run.pendingGuidance = [];
        await this.persistGuidance(run);
    }
    async execute(run) {
        const controller = new AbortController();
        this.controllers.set(run.id, controller);
        const project = await this.storage.requireProject(run.projectId);
        const baseRecipe = await this.storage.getRecipe(run.projectId, run.baseVersionId);
        const baselineRecipe = await this.storage.getRecipe(run.projectId, project.adoptedVersionId);
        if (baseRecipe === null)
            throw new Error('base version missing');
        this.setStatus(run, 'inspecting');
        let demoFailed = false;
        let keyMove = null;
        if (run.mode === 'demo') {
            const precheck = await verifyVersion(this.storage, run.projectId, run.baseVersionId, {
                runId: run.id + '-precheck',
            });
            demoFailed = precheck.report.status !== 'passed';
            keyMove = demoKeyMovePatch(baseRecipe);
        }
        const ctx = {
            storage: this.storage,
            projectId: run.projectId,
            runId: run.id,
            baseUrl: this.baseUrl(),
            baseVersionId: run.baseVersionId,
            candidateVersionId: null,
            kind: run.kind,
            contracts: project.contracts,
            baselineRecipe: baselineRecipe ?? baseRecipe,
            lastVerification: null,
            lastPlaytest: null,
            emit: (type, payload) => {
                void this.emit(run, type, payload);
            },
            setCandidate: (versionId) => {
                run.candidateVersionId = versionId;
                ctx.candidateVersionId = versionId;
            },
            isCancelled: () => run.cancelled,
        };
        const provider = run.mode === 'demo'
            ? new DemoProvider(this.buildDemoScript(demoFailed, keyMove, project.contracts.entries.filter((entry) => entry.kind === 'reachable_goal').map((entry) => 'contract:' + entry.id)), () => this.demoFinalMessage(run))
            : this.providerFactory !== undefined
                ? this.providerFactory(run)
                : new OpenAICompatibleProvider(this.config.get());
        const messages = [
            { role: 'system', content: SYSTEM_PROMPT$1 },
            {
                role: 'user',
                content: renderBriefPrompt(run.brief) +
                    '\n\n用户原话：' + run.instruction +
                    '\n当前工程：' + project.name + '（' + project.packId + '），基础版本 ' + run.baseVersionId +
                    '。请用工具完成任务，并在每一步用一句话说明理由。' +
                    lintPrompt(lintRecipe(baseRecipe)),
            },
        ];
        this.setStatus(run, 'planning');
        let stop = false;
        let afterResults = false;
        const failureCounts = new Map();
        const feedback = { failed: new Set(), patched: false, attempt: 0 };
        const maxResponses = Math.min(12, this.config.get()?.maxRequests ?? 12);
        try {
            while (run.modelResponses < maxResponses) {
                if (run.cancelled)
                    return;
                if ((await this.handlePause(run)) === 'stop')
                    return;
                await this.applyPendingGuidance(run, messages);
                run.modelResponses += 1;
                run.usage.requests += 1;
                let response;
                try {
                    response = await provider.chat(messages, TOOL_DEFINITIONS, controller.signal);
                }
                catch (error) {
                    const code = error.code ?? 'RUNTIME_ERROR';
                    run.error = (error instanceof Error ? error.message : String(error)) + ' (' + code + ')';
                    this.setStatus(run, code === 'MODEL_AUTH_FAILED' || code === 'MODEL_PROTOCOL_UNSUPPORTED' ? 'blocked' : 'failed');
                    await this.emit(run, 'error', { message: run.error, code });
                    break;
                }
                if (run.cancelled)
                    return;
                for (const key of ['promptTokens', 'completionTokens', 'totalTokens']) {
                    if (response.usage[key] !== 'unknown') {
                        run.usage[key] = response.usage[key];
                    }
                }
                const content = response.content === null ? '' : response.content.trim();
                const hasTools = response.toolCalls.length > 0;
                if (content.length > 0) {
                    run.narratedSteps += 1;
                    const phase = hasTools ? (afterResults ? 'after_result' : 'before_tools') : 'final';
                    await this.emit(run, 'model', {
                        content: content.slice(0, 2000),
                        phase,
                        synthetic: run.mode === 'demo',
                    });
                    const evidenceStatus = ctx.lastVerification === null ? null : ctx.lastVerification.status;
                    if (phase === 'final' && detectClaimGap(content, evidenceStatus)) {
                        await this.concern(run, 'claim_gap', 'AI 说完成，但后端判定是“' + String(evidenceStatus) + '”。', 'high', '你说完成了，但后端判定只是“' + String(evidenceStatus) + '”，请把未验证项说清楚。');
                    }
                }
                else if (detectSilentStep(content, hasTools)) {
                    run.silentSteps += 1;
                    await this.emit(run, 'log', { message: '模型未解释该步意图，只发起了工具调用。', synthetic: run.mode === 'demo' });
                    await this.concern(run, 'silent_step', '这一步 AI 没有解释原因，只丢出工具调用。', 'low', '请先说明这一步要做什么、为什么，再调用工具。');
                }
                if (!hasTools) {
                    stop = true;
                    break;
                }
                messages.push({ role: 'assistant', content: response.content, toolCalls: response.toolCalls });
                afterResults = false;
                for (const call of response.toolCalls) {
                    if (run.cancelled)
                        return;
                    if (run.toolCalls >= 30) {
                        run.error = '工具调用预算耗尽（30 次）';
                        this.setStatus(run, 'blocked');
                        await this.emit(run, 'error', { message: run.error, code: 'BUDGET_EXCEEDED' });
                        return;
                    }
                    run.toolCalls += 1;
                    await this.emit(run, 'tool_call', { name: call.name, arguments: call.argumentsJson.slice(0, 1200) });
                    if (call.name === 'apply_recipe_patch')
                        this.setStatus(run, 'editing');
                    if (call.name === 'run_rule_checks' || call.name === 'run_browser_playtest')
                        this.setStatus(run, 'validating');
                    const result = await executeTool(ctx, call.name, call.argumentsJson);
                    // 工具执行期间可能被取消，此时结果不再参与后续状态推进。
                    if (run.cancelled)
                        return;
                    await this.emit(run, 'tool_result', {
                        name: call.name,
                        ok: result.ok,
                        code: result.code,
                        data: result.data,
                        artifacts: result.artifacts.slice(0, 8),
                    });
                    messages.push({
                        role: 'tool',
                        toolCallId: call.id,
                        content: JSON.stringify({ ok: result.ok, code: result.code, data: result.data }).slice(0, 12000),
                    });
                    await this.trackFeedback(run, ctx, call.name, result.ok, feedback);
                    if (result.ok && call.name === 'apply_recipe_patch') {
                        const touched = touchedEntityIds(call.argumentsJson);
                        const candidates = recipeIds(baseRecipe);
                        const allowed = mentionedIds(run.instruction + '\n' + run.guidance.map((record) => record.text).join('\n'), candidates);
                        const extra = detectScopeDrift(touched, allowed);
                        if (extra.length > 0) {
                            await this.concern(run, 'scope_drift', '你只要求改 ' + allowed.join('、') + '，AI 还改动了 ' + extra.join('、') + '。', 'medium', '只修改我指定的对象（' + allowed.join('、') + '），其它保持原样。');
                        }
                    }
                    if (detectContractGuarded(result.code)) {
                        await this.concern(run, 'contract_guarded', 'AI 试图修改创作底线，已被后端拦下。', 'medium', '不要修改已确认的创作底线；如果确实需要改，先说明原因并等我确认。');
                    }
                    if (!result.ok && result.code !== 'CONTRACT_VIOLATION') {
                        const key = call.name + '|' + call.argumentsJson.slice(0, 200);
                        const count = (failureCounts.get(key) ?? 0) + 1;
                        failureCounts.set(key, count);
                        if (detectLoopSpin(count)) {
                            await this.concern(run, 'loop_spin', '同名工具与相同参数已经连续失败 ' + count + ' 次，AI 在原地重试。', 'high', '停止重复同一调用，换个思路；如果修不动就先停下来说明卡在哪里。');
                        }
                    }
                    if (call.name === 'run_rule_checks' && !result.ok && ctx.candidateVersionId !== null) {
                        run.repairs += 1;
                        if (run.repairs > 3) {
                            run.error = '修复轮次超过 3 轮，停止机械重试';
                            this.setStatus(run, 'blocked');
                            await this.emit(run, 'error', { message: run.error, code: 'BUDGET_EXCEEDED' });
                            return;
                        }
                        if (run.repairs === 3) {
                            await this.concern(run, 'loop_spin', '修复轮次已经到了 3 轮，仍在失败。', 'high', '停下来，先说明你判断的问题和需要我确认的选择，不要继续自动试。');
                        }
                    }
                    if (call.name === 'prepare_review') {
                        if (result.ok) {
                            this.setStatus(run, 'ready_for_review');
                        }
                        else {
                            run.error = '后端未判定通过：' + JSON.stringify(result.data).slice(0, 600);
                            this.setStatus(run, 'failed');
                        }
                        stop = true;
                    }
                    if (stop)
                        break;
                    if ((await this.handlePause(run)) === 'stop')
                        return;
                }
                afterResults = true;
                if (stop)
                    break;
            }
            if (run.status === 'planning' || run.status === 'editing' || run.status === 'validating' || run.status === 'inspecting') {
                if (run.error === null) {
                    run.error = '模型响应预算耗尽或没有给出结论';
                    this.setStatus(run, 'blocked');
                }
            }
        }
        finally {
            this.controllers.delete(run.id);
            if (run.issueId !== null &&
                ['ready_for_review', 'failed', 'blocked', 'cancelled', 'completed'].includes(run.status)) {
                await evaluateIssueAfterRun(this.storage, run.issueId, run).catch(() => undefined);
            }
            await this.persist(run).catch(() => undefined);
        }
    }
}

// 模型可以多说字段，但只认这些键：quickFix / ops / patch 一律被丢弃，AI 审查结论永远不能直接改配方。
const AiFinding = z.object({
    ruleId: z
        .string()
        .regex(/^[a-z0-9][a-z0-9._/-]{1,40}$/),
    severity: z.enum(['error', 'warning', 'info']),
    message: z.string().min(4).max(300),
    targets: z.array(z.string().min(1).max(80)).max(12).default([]),
    suggestedGuidance: z.string().min(4).max(300).optional(),
});
const AiPayload = z.object({
    summary: z.string().max(600).default(''),
    findings: z.array(AiFinding).default([]),
});
const MAX_AI_FINDINGS = 12;
function extractJson(text) {
    const trimmed = text.trim();
    const candidates = [];
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
    if (fenced !== null && fenced[1] !== undefined)
        candidates.push(fenced[1].trim());
    candidates.push(trimmed);
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start)
        candidates.push(trimmed.slice(start, end + 1));
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if (parsed !== null && typeof parsed === 'object')
                return parsed;
        }
        catch {
            continue;
        }
    }
    return null;
}
const SYSTEM_PROMPT = [
    '你是游戏创作工具的配方审查助手，只做审查，不修改内容，不调用工具。',
    '只输出一个 JSON 对象，不要输出解释文字、不要用 Markdown。结构：',
    '{"summary":"一句话总体判断","findings":[{"ruleId":"ai-开头的短横线英文标识","severity":"error|warning|info","message":"中文说明问题","targets":["配方里真实存在的对象 id"],"suggestedGuidance":"创作者可以直接发给 AI 修复助手的一句中文指令"}]}',
    '只报告会让玩家玩不通、数据断链、规则永远无法触发、或内容明显自相矛盾的确定问题。',
    '不要评价美术风格、难度平衡、剧情文笔；没有把握就不要写；没有问题就返回空数组。',
    'targets 必须逐字使用配方里出现的 id，不得编造。禁止输出 quickFix、ops 或任何补丁。',
].join('\n');
function buildReviewPrompt(recipe, entries, local) {
    const compact = JSON.stringify(recipe);
    const clipped = compact.length > 12000 ? compact.slice(0, 12000) + '…（已截断，只审查可见部分）' : compact;
    const localText = local.length === 0 ? '无' : local.map((item) => item.ruleId + '：' + item.message).join('\n');
    const contracts = entries.length === 0 ? '无' : entries.map((entry) => entry.description).join('\n');
    return ['【本地规则体检已有的结论】', localText, '', '【创作者确认的底线】', contracts, '', '【配方 JSON】', clipped].join('\n');
}
function toFindings(payload, recipe) {
    const ids = collectIds(recipe);
    const out = [];
    for (const item of payload.findings.slice(0, MAX_AI_FINDINGS)) {
        const severity = item.severity;
        const ruleId = item.ruleId.startsWith('ai/') ? item.ruleId : 'ai/' + item.ruleId;
        const known = item.targets.filter((target) => ids.has(target) || target.startsWith('r[') || /^\d+,\d+$/.test(target));
        out.push({
            ruleId,
            severity,
            message: item.message,
            targets: known,
            origin: 'ai',
            suggestedGuidance: item.suggestedGuidance ?? '请修复这个问题：' + item.message,
        });
    }
    return out;
}
function collectIds(recipe) {
    const ids = new Set();
    const walk = (value, depth) => {
        if (depth > 6)
            return;
        if (Array.isArray(value)) {
            for (const item of value)
                walk(item, depth + 1);
            return;
        }
        if (value === null || typeof value !== 'object')
            return;
        const record = value;
        if (typeof record.id === 'string' && record.id.length > 0 && record.id.length <= 80)
            ids.add(record.id);
        for (const nested of Object.values(record))
            walk(nested, depth + 1);
    };
    walk(recipe, 0);
    return ids;
}
async function reviewRecipeWithModel(input) {
    const at = new Date().toISOString();
    const prompt = buildReviewPrompt(input.recipe, input.entries, input.local);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
        const response = await input.provider.chat([
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt },
        ], [], controller.signal);
        const usage = {
            requests: 1,
            promptTokens: response.usage.promptTokens,
            completionTokens: response.usage.completionTokens,
            totalTokens: response.usage.totalTokens,
        };
        const content = response.content ?? '';
        if (content.trim().length === 0) {
            return { status: 'failed', findings: [], summary: '', detail: '模型没有返回内容', model: input.model, usage, promptChars: prompt.length, at };
        }
        const parsed = AiPayload.safeParse(extractJson(content));
        if (!parsed.success) {
            return {
                status: 'failed',
                findings: [],
                summary: '',
                detail: '模型返回的不是约定的 JSON 结构（' + parsed.error.issues[0]?.message + '）',
                model: input.model,
                usage,
                promptChars: prompt.length,
                at,
            };
        }
        return {
            status: 'ok',
            findings: toFindings(parsed.data, input.recipe),
            summary: parsed.data.summary +
                (parsed.data.findings.length > MAX_AI_FINDINGS
                    ? '（模型给了 ' + String(parsed.data.findings.length) + ' 条，只保留前 ' + String(MAX_AI_FINDINGS) + ' 条）'
                    : ''),
            detail: '',
            model: input.model,
            usage,
            promptChars: prompt.length,
            at,
        };
    }
    catch (error) {
        const aborted = controller.signal.aborted;
        return {
            status: 'failed',
            findings: [],
            summary: '',
            detail: aborted ? '云端审查超时（' + input.timeoutMs + 'ms）' : error instanceof Error ? error.message : String(error),
            model: input.model,
            usage: { requests: 1, promptTokens: 'unknown', completionTokens: 'unknown', totalTokens: 'unknown' },
            promptChars: prompt.length,
            at,
        };
    }
    finally {
        clearTimeout(timer);
    }
}
function skippedReview(reason) {
    return {
        status: 'skipped',
        findings: [],
        summary: '',
        detail: reason,
        model: null,
        usage: { requests: 0, promptTokens: 'unknown', completionTokens: 'unknown', totalTokens: 'unknown' },
        promptChars: 0,
        at: new Date().toISOString(),
    };
}
const REVIEW_MODES = ['local', 'ai', 'both'];
function isReviewMode(value) {
    return typeof value === 'string' && REVIEW_MODES.includes(value);
}

// Tiled (mapeditor.org) JSON 地图 → 网格配方。只认正交、有限尺寸地图；无法映射的内容写进报告而不是静默丢弃。
const PropertySchema = z.object({ name: z.string(), type: z.string().optional(), value: z.unknown() });
const ObjectSchema = z.object({
    id: z.number().optional(),
    name: z.string().optional(),
    type: z.string().optional(),
    class: z.string().optional(),
    x: z.number(),
    y: z.number(),
    width: z.number().optional(),
    height: z.number().optional(),
    gid: z.number().optional(),
    point: z.boolean().optional(),
    polyline: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
    polygon: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
    properties: z.array(PropertySchema).optional(),
});
const LayerSchema = z.lazy(() => z.object({
    type: z.string(),
    name: z.string().optional(),
    visible: z.boolean().optional(),
    data: z.union([z.array(z.number()), z.string()]).optional(),
    encoding: z.string().optional(),
    compression: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    objects: z.array(ObjectSchema).optional(),
    layers: z.array(LayerSchema).optional(),
    properties: z.array(PropertySchema).optional(),
}));
const TilesetSchema = z.object({
    firstgid: z.number(),
    source: z.string().optional(),
    tiles: z
        .array(z.object({
        id: z.number(),
        type: z.string().optional(),
        class: z.string().optional(),
        properties: z.array(PropertySchema).optional(),
    }))
        .optional(),
});
const TiledMapSchema = z.object({
    type: z.literal('map').optional(),
    orientation: z.string(),
    infinite: z.boolean().optional(),
    width: z.number().int(),
    height: z.number().int(),
    tilewidth: z.number().positive(),
    tileheight: z.number().positive(),
    backgroundcolor: z.string().optional(),
    layers: z.array(LayerSchema),
    tilesets: z.array(TilesetSchema).optional(),
    properties: z.array(PropertySchema).optional(),
});
class TiledImportError extends Error {
    code = 'IMPORT_INVALID';
}
const GID_MASK = 0x1fffffff;
const WALL_LAYER = /wall|collision|collide|solid|block|墙|碰撞|障碍/i;
const WALL_CLASS = new Set(['wall', 'solid', 'collision', 'block', '墙']);
const KIND_ALIASES = {
    player: 'spawn', spawn: 'spawn', start: 'spawn', 玩家: 'spawn', 起点: 'spawn', 出生点: 'spawn',
    key: 'item', item: 'item', pickup: 'item', coin: 'item', 钥匙: 'item', 道具: 'item',
    door: 'door', 门: 'door',
    exit: 'exit', goal: 'exit', finish: 'exit', 出口: 'exit', 终点: 'exit',
    guard: 'guard', enemy: 'guard', patrol: 'guard', 守卫: 'guard', 敌人: 'guard',
    switch: 'switch', lever: 'switch', button: 'switch', 开关: 'switch', 机关: 'switch',
    gate: 'gate', 机关门: 'gate', 闸门: 'gate',
};
const DIRECTIONS = ['up', 'down', 'left', 'right'];
function props(list) {
    const out = new Map();
    for (const entry of list ?? [])
        out.set(entry.name.toLowerCase(), entry.value);
    return out;
}
function str(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
function int(value, fallback, min, max) {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}
function safeId(raw) {
    if (raw === undefined)
        return undefined;
    const cleaned = raw.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return cleaned.length > 0 ? cleaned : undefined;
}
function decodeData(layer, count) {
    if (Array.isArray(layer.data))
        return layer.data;
    if (typeof layer.data !== 'string')
        return [];
    if (layer.encoding !== 'base64')
        throw new TiledImportError('图层“' + (layer.name ?? '') + '”使用了不支持的编码 ' + String(layer.encoding) + '，请在 Tiled 中改为 CSV 或未压缩 Base64。');
    if (layer.compression !== undefined && layer.compression !== '') {
        throw new TiledImportError('图层“' + (layer.name ?? '') + '”使用了 ' + layer.compression + ' 压缩，请在 Tiled 地图属性里把图层格式改为 CSV。');
    }
    const bytes = Buffer.from(layer.data, 'base64');
    if (bytes.length < count * 4)
        throw new TiledImportError('图层“' + (layer.name ?? '') + '”的 Base64 数据长度不足。');
    const out = [];
    for (let index = 0; index < count; index += 1)
        out.push(bytes.readUInt32LE(index * 4));
    return out;
}
function flatten(layers) {
    const out = [];
    for (const layer of layers) {
        if (layer.type === 'group')
            out.push(...flatten(layer.layers ?? []));
        else
            out.push(layer);
    }
    return out;
}
function expandPath(points, closed) {
    const cells = [];
    const total = closed ? points.length : points.length - 1;
    for (let index = 0; index < total; index += 1) {
        const from = points[index];
        const to = points[(index + 1) % points.length];
        if (from === undefined || to === undefined)
            return null;
        if (from.x !== to.x && from.y !== to.y)
            return null;
        const dx = Math.sign(to.x - from.x);
        const dy = Math.sign(to.y - from.y);
        let cursor = { ...from };
        while (cursor.x !== to.x || cursor.y !== to.y) {
            cells.push(cursor);
            cursor = { x: cursor.x + dx, y: cursor.y + dy };
        }
    }
    if (!closed) {
        const last = points[points.length - 1];
        if (last !== undefined)
            cells.push(last);
    }
    const deduped = cells.filter((cell, index) => {
        const prev = cells[index - 1];
        return prev === undefined || prev.x !== cell.x || prev.y !== cell.y;
    });
    return deduped;
}
function importTiledMap(input, options = {}) {
    const parsed = TiledMapSchema.safeParse(input);
    if (!parsed.success) {
        throw new TiledImportError('不是有效的 Tiled JSON 地图：' + parsed.error.issues.slice(0, 3).map((issue) => issue.path.join('.') + ' ' + issue.message).join('；'));
    }
    const map = parsed.data;
    if (map.orientation !== 'orthogonal')
        throw new TiledImportError('只支持正交（orthogonal）地图，当前是 ' + map.orientation + '。');
    if (map.infinite === true)
        throw new TiledImportError('不支持无限地图，请在 Tiled 中关闭“无限”后再导出。');
    const W = map.width;
    const H = map.height;
    if (W < 3 || H < 3 || W > 20 || H > 20)
        throw new TiledImportError('地图尺寸 ' + W + '×' + H + ' 超出支持范围（3–20 格，含外墙后 5–20 格）。');
    const warnings = [];
    const collidable = new Set();
    for (const tileset of map.tilesets ?? []) {
        if (tileset.source !== undefined)
            warnings.push('外部图块集 ' + tileset.source + ' 未内嵌，其中的 collides 属性无法读取；请在 Tiled 中“嵌入图块集”或把墙放进名为 walls 的图层。');
        for (const tile of tileset.tiles ?? []) {
            const p = props(tile.properties);
            const cls = (tile.class ?? tile.type ?? '').toLowerCase();
            if (p.get('collides') === true || p.get('solid') === true || p.get('wall') === true || WALL_CLASS.has(cls)) {
                collidable.add(tileset.firstgid + tile.id);
            }
        }
    }
    const layers = flatten(map.layers).filter((layer) => layer.visible !== false);
    const walls = Array.from({ length: H }, () => Array.from({ length: W }, () => false));
    const tileLayers = layers.filter((layer) => layer.type === 'tilelayer');
    for (const layer of tileLayers) {
        const data = decodeData(layer, W * H);
        const wallLayer = WALL_LAYER.test(layer.name ?? '') || props(layer.properties).get('collides') === true;
        for (let index = 0; index < Math.min(data.length, W * H); index += 1) {
            const gid = (data[index] ?? 0) & GID_MASK;
            if (gid === 0)
                continue;
            if (wallLayer || collidable.has(gid)) {
                const row = walls[Math.floor(index / W)];
                if (row !== undefined)
                    row[index % W] = true;
            }
        }
    }
    if (tileLayers.length > 0 && !walls.some((row) => row.some(Boolean))) {
        warnings.push('没有识别到墙：请把墙放在名为 walls / collision 的图层，或给墙图块加布尔属性 collides=true。');
    }
    const borderClosed = walls.every((row, y) => row.every((wall, x) => wall || (x > 0 && y > 0 && x < W - 1 && y < H - 1)));
    const pad = !borderClosed && W + 2 <= 20 && H + 2 <= 20 ? 1 : 0;
    const BW = W + pad * 2;
    const BH = H + pad * 2;
    if (BW < 5 || BH < 5)
        throw new TiledImportError('地图太小：加上外墙后为 ' + BW + '×' + BH + '，至少需要 5×5。');
    const grid = Array.from({ length: BH }, (_, y) => Array.from({ length: BW }, (_, x) => {
        if (x === 0 || y === 0 || x === BW - 1 || y === BH - 1)
            return '#';
        const wall = walls[y - pad]?.[x - pad] ?? false;
        return wall ? '#' : '.';
    }));
    if (pad === 1)
        warnings.push('原地图四周不是封闭的墙，已在外围加了一圈墙（坐标整体 +1）。');
    else if (!borderClosed)
        warnings.push('原地图四周不是封闭的墙且已到 20 格上限，已把最外一圈强制改为墙。');
    const toCell = (object) => {
        const w = object.width ?? 0;
        const h = object.height ?? 0;
        const cx = object.gid !== undefined ? object.x + w / 2 : object.point === true ? object.x : object.x + w / 2;
        const cy = object.gid !== undefined ? object.y - h / 2 : object.point === true ? object.y : object.y + h / 2;
        return { x: Math.floor(cx / map.tilewidth) + pad, y: Math.floor(cy / map.tileheight) + pad };
    };
    const pathCells = (object, list) => list.map((point) => ({
        x: Math.floor((object.x + point.x) / map.tilewidth) + pad,
        y: Math.floor((object.y + point.y) / map.tileheight) + pad,
    }));
    const inside = (cell) => cell.x > 0 && cell.y > 0 && cell.x < BW - 1 && cell.y < BH - 1;
    const usedIds = new Set();
    const counters = new Map();
    const makeId = (kind, object, p) => {
        let base = safeId(str(p.get('id'))) ?? safeId(object.name) ?? undefined;
        if (base === undefined || usedIds.has(base)) {
            do {
                const next = (counters.get(kind) ?? 0) + 1;
                counters.set(kind, next);
                base = kind + '-' + next;
            } while (usedIds.has(base));
        }
        usedIds.add(base);
        return base;
    };
    const label = (object) => {
        const name = str(object.name);
        return name === undefined ? undefined : name.slice(0, 40);
    };
    let spawn = null;
    let facing = 'down';
    const entities = [];
    const mapped = [];
    const occupied = new Map();
    const flags = {};
    const pendingGates = [];
    const keyOf = (cell) => cell.x + ',' + cell.y;
    const floorAt = (cell, what) => {
        const row = grid[cell.y];
        if (row !== undefined && row[cell.x] === '#') {
            row[cell.x] = '.';
            warnings.push(what + ' 落在墙上 (' + cell.x + ',' + cell.y + ')，已把该格改为地面。');
        }
    };
    const place = (entity, from) => {
        if (entity.kind === 'zone')
            return false;
        const cell = { x: entity.x, y: entity.y };
        const taken = occupied.get(keyOf(cell));
        if (taken !== undefined) {
            warnings.push('对象“' + from + '”与 ' + taken + ' 重叠于 (' + cell.x + ',' + cell.y + ')，已跳过。');
            return false;
        }
        floorAt(cell, '对象“' + from + '”');
        occupied.set(keyOf(cell), entity.id);
        entities.push(entity);
        mapped.push({ kind: entity.kind, id: entity.id, x: entity.x, y: entity.y, from });
        return true;
    };
    for (const layer of layers.filter((entry) => entry.type === 'objectgroup')) {
        for (const object of layer.objects ?? []) {
            const p = props(object.properties);
            const rawKind = (object.class ?? object.type ?? '').trim().toLowerCase() || (object.name ?? '').trim().toLowerCase();
            const kind = KIND_ALIASES[rawKind] ?? KIND_ALIASES[(object.name ?? '').trim().toLowerCase()];
            const from = (object.name ?? rawKind) || 'object#' + String(object.id ?? '?');
            if (kind === undefined) {
                warnings.push('未识别的对象“' + from + '”（class/type=' + (rawKind || '空') + '），已忽略；可用 player/key/door/exit/guard/switch/gate。');
                continue;
            }
            const cell = toCell(object);
            if (!inside(cell)) {
                warnings.push('对象“' + from + '”位于地图边界外或外墙上 (' + cell.x + ',' + cell.y + ')，已忽略。');
                continue;
            }
            if (kind === 'spawn') {
                if (spawn !== null) {
                    warnings.push('有多个玩家起点，只保留第一个。');
                    continue;
                }
                floorAt(cell, '玩家起点');
                spawn = cell;
                const f = str(p.get('facing'));
                if (f !== undefined && DIRECTIONS.includes(f))
                    facing = f;
                mapped.push({ kind: 'spawn', id: 'player', x: cell.x, y: cell.y, from });
                continue;
            }
            if (kind === 'exit' && entities.some((entity) => entity.kind === 'exit')) {
                warnings.push('有多个出口，只保留第一个，“' + from + '”已忽略。');
                continue;
            }
            if (kind === 'gate') {
                pendingGates.push({ object, cell, p });
                continue;
            }
            const id = makeId(kind === 'item' ? 'key' : kind, object, p);
            const lbl = label(object);
            const base = { id, x: cell.x, y: cell.y, ...(lbl === undefined ? {} : { label: lbl }) };
            if (kind === 'item') {
                place({ kind: 'item', ...base, itemType: safeId(str(p.get('itemtype'))) ?? 'key', count: int(p.get('count'), 1, 1, 99) }, from);
            }
            else if (kind === 'door') {
                place({ kind: 'door', ...base, requires: { itemType: safeId(str(p.get('itemtype')) ?? str(p.get('requires'))) ?? 'key', count: int(p.get('count'), 1, 1, 3) } }, from);
            }
            else if (kind === 'exit') {
                place({ kind: 'exit', ...base }, from);
            }
            else if (kind === 'switch') {
                const flag = safeId(str(p.get('flag'))) ?? id + '-on';
                const mode = str(p.get('mode')) === 'toggle' ? 'toggle' : 'set';
                if (place({ kind: 'switch', ...base, flag, mode }, from))
                    flags[flag] = false;
            }
            else if (kind === 'guard') {
                const f = str(p.get('facing'));
                const guardFacing = f !== undefined && DIRECTIONS.includes(f) ? f : 'down';
                let route = null;
                if (object.polygon !== undefined && object.polygon.length >= 2)
                    route = expandPath(pathCells(object, object.polygon), true);
                else if (object.polyline !== undefined && object.polyline.length >= 2)
                    route = expandPath(pathCells(object, object.polyline), false);
                if (route !== null && route.length >= 2) {
                    const first = route[0];
                    const last = route[route.length - 1];
                    const loops = first !== undefined && last !== undefined && Math.abs(first.x - last.x) + Math.abs(first.y - last.y) === 1;
                    const unique = new Set(route.map(keyOf)).size === route.length;
                    if (!loops || !unique || route.length > 16 || !route.every(inside)) {
                        warnings.push('守卫“' + from + '”的巡逻路径不是首尾相邻的横竖闭环（或超过 16 格），已改为原地两格往返。');
                        route = null;
                    }
                }
                else if (route === null && (object.polygon !== undefined || object.polyline !== undefined)) {
                    warnings.push('守卫“' + from + '”的巡逻路径含斜线，已改为原地两格往返。');
                }
                const start = route?.[0] ?? cell;
                if (route === null) {
                    const neighbour = [
                        { x: start.x + 1, y: start.y },
                        { x: start.x - 1, y: start.y },
                        { x: start.x, y: start.y + 1 },
                        { x: start.x, y: start.y - 1 },
                    ].find((point) => inside(point) && grid[point.y]?.[point.x] === '.');
                    route = [start, neighbour ?? { x: start.x + 1, y: start.y }];
                }
                for (const point of route)
                    floorAt(point, '守卫“' + from + '”的巡逻点');
                place({ kind: 'guard', ...base, x: start.x, y: start.y, facing: guardFacing, route, clock: { basis: 'successful_move', every: int(p.get('every'), 1, 1, 3) } }, from);
            }
        }
    }
    const switchFlags = Object.keys(flags);
    for (const gate of pendingGates) {
        const from = (gate.object.name ?? 'gate') || 'gate';
        let flag = safeId(str(gate.p.get('flag')));
        if (flag === undefined && switchFlags.length === 1) {
            flag = switchFlags[0];
            warnings.push('机关门“' + from + '”没有 flag 属性，已绑定到唯一的开关 ' + String(flag) + '。');
        }
        if (flag === undefined) {
            warnings.push('机关门“' + from + '”没有 flag 属性且无法推断对应开关，已忽略。');
            continue;
        }
        flags[flag] ??= false;
        const id = makeId('gate', gate.object, gate.p);
        const lbl = label(gate.object);
        place({ kind: 'gate', id, x: gate.cell.x, y: gate.cell.y, openWhen: { type: 'flag_is', flag, value: true }, ...(lbl === undefined ? {} : { label: lbl }) }, from);
    }
    if (spawn === null)
        throw new TiledImportError('地图里没有玩家起点：请在对象层放一个 class/type 或名称为 player（或 spawn）的对象。');
    const spawnCell = spawn;
    if (occupied.has(keyOf(spawnCell)))
        throw new TiledImportError('玩家起点与对象 ' + String(occupied.get(keyOf(spawnCell))) + ' 重叠。');
    if (!entities.some((entity) => entity.kind === 'exit'))
        throw new TiledImportError('地图里没有出口：请在对象层放一个 class/type 或名称为 exit 的对象。');
    if (entities.length > 64)
        throw new TiledImportError('对象太多（' + entities.length + ' 个），最多支持 64 个。');
    if (entities.filter((entity) => entity.kind === 'guard').length > 4)
        throw new TiledImportError('守卫超过 4 个，当前内核最多支持 4 个。');
    const mapProps = props(map.properties);
    const hasGuard = entities.some((entity) => entity.kind === 'guard');
    const packId = str(mapProps.get('pack')) === 'stealth' || hasGuard ? 'stealth' : 'puzzle';
    const name = (options.name?.trim() || str(mapProps.get('name')) || options.fallbackName?.trim() || 'Tiled 导入关卡').slice(0, 60);
    const base = starterGrid(packId, name, '');
    const background = map.backgroundcolor !== undefined && /^#[0-9a-fA-F]{6}$/.test(map.backgroundcolor) ? map.backgroundcolor : undefined;
    const recipe = {
        ...base,
        meta: { ...base.meta, description: (str(mapProps.get('description')) ?? '从 Tiled 地图导入的关卡（' + W + '×' + H + '）。').slice(0, 800) },
        board: { width: BW, height: BH, rows: grid.map((row) => row.join('')) },
        player: { spawn: spawnCell, facing },
        entities,
        flags,
        rules: [],
        goal: { type: 'at_exit' },
        presentation: background === undefined ? base.presentation : { ...base.presentation, theme: { ...base.presentation.theme, background } },
        generation: { method: 'handwritten', note: '从 Tiled JSON 导入' },
    };
    const issues = validateRecipe(recipe);
    if (issues.length > 0) {
        throw new TiledImportError('转换后的配方未通过结构校验：' + issues.slice(0, 4).map((issue) => issue.path + ' ' + issue.message).join('；'));
    }
    const wallCells = grid.reduce((sum, row) => sum + row.filter((char) => char === '#').length, 0);
    return {
        recipe,
        report: { source: 'tiled', mapSize: { width: W, height: H }, boardSize: { width: BW, height: BH }, wallCells, mapped, warnings },
    };
}

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.map': 'application/json; charset=utf-8',
};
function cspFor(nonce, frameAncestors) {
    return [
        "default-src 'self'",
        "script-src 'self' 'nonce-" + nonce + "'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "connect-src 'self'",
        "font-src 'self' data:",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors " + frameAncestors,
    ].join('; ');
}
// 本地默认禁止被任何页面内嵌；创空间预览是 iframe 嵌的，只放行魔搭域名。
const ANCESTORS_LOCAL = "'none'";
const ANCESTORS_STUDIO = [
    "'self'",
    'https://modelscope.cn',
    'https://*.modelscope.cn',
    'https://ms.show',
    'https://*.ms.show',
    'https://*.fcapp.run',
].join(' ');
function sendIndex(reply, token, html, frameAncestors = ANCESTORS_LOCAL) {
    const nonce = randomBytes(16).toString('base64');
    // 子路径反代兜底：若页面被挂在 /xxx/yyy 这类无结尾斜杠的路径下，
    // 相对资源会解析错目录，这里补一个斜杠再重新加载。只用字符串方法，不写正则以避开转义坑。
    const bootstrap = [
        'window.__ZAOWAN_TOKEN__=' + JSON.stringify(token) + ';',
        'var pp=location.pathname;',
        'var lastSlash=pp.lastIndexOf(String.fromCharCode(47));',
        'var dot=pp.indexOf(String.fromCharCode(46),lastSlash+1);',
        'if(lastSlash<pp.length-1&&dot<0){location.replace(pp+String.fromCharCode(47)+location.search+location.hash);}',
    ].join('');
    const body = html.replace('<!--ZAOWAN_TOKEN-->', '<script nonce="' + nonce + '">' + bootstrap + '</script>');
    return reply
        .header('content-type', 'text/html; charset=utf-8')
        .header('content-security-policy', cspFor(nonce, frameAncestors))
        .header('cache-control', 'no-store')
        .send(body);
}
function statusFor(code) {
    switch (code) {
        case 'NOT_FOUND':
        case 'ISSUE_NOT_FOUND':
            return 404;
        case 'ISSUE_DISMISSED':
            return 409;
        case 'RECIPE_INVALID':
        case 'INVALID_ARGUMENT':
        case 'IMPORT_INVALID':
        case 'MODEL_AUTH_FAILED':
            return 400;
        case 'VERSION_CONFLICT':
        case 'CONTRACT_VIOLATION':
        case 'CONFLICT':
        case 'ACTIVE_RUN':
            return 409;
        case 'BUDGET_EXCEEDED':
            return 429;
        case 'BROWSER_UNAVAILABLE':
            return 503;
        default:
            return 500;
    }
}
function fail(reply, code, message, extra = {}) {
    return reply.code(statusFor(code)).send({ ok: false, error: { code, message, ...extra } });
}
const AssetBody = z.strictObject({
    filename: z.string().min(1).max(200),
    dataBase64: z.string().min(16),
    mime: z.string().max(80).optional(),
    license: z.string().max(120).optional(),
    author: z.string().max(120).optional(),
});
const ProjectBody = z.strictObject({
    name: z.string().max(60).optional(),
    packId: z.enum(['puzzle', 'stealth', 'quiz', 'card', 'dialogue']).optional(),
    sample: z.string().max(40).optional(),
    idea: z.string().max(2000).optional(),
    // 仅测试/演示用：不配置模型也能触发首次生成。健康响应与 UI 都不暴露这个开关。
    autoGenerate: z.literal('demo').optional(),
});
const TiledImportBody = z.strictObject({
    name: z.string().max(60).optional(),
    fallbackName: z.string().max(60).optional(),
    map: z.record(z.string(), z.unknown()),
});
const TaskKindSchema = z.enum(['initial_generation', 'modify', 'repair', 'explain']);
const TaskBriefPreviewBody = z.strictObject({
    instruction: z.string().min(1).max(4000),
    kind: TaskKindSchema.optional(),
    issueId: z.string().min(1).max(80).optional(),
    baseVersionId: z.string().min(1).max(40).optional(),
    goal: z.string().max(400).optional(),
    userConstraints: z.array(z.string().max(200)).max(8).optional(),
    targetRefs: z.array(z.string().max(120)).max(16).optional(),
});
const StartRunBody = z.strictObject({
    instruction: z.string().min(1).max(4000),
    mode: z.enum(['demo', 'model']).optional(),
    kind: TaskKindSchema.optional(),
    issueId: z.string().min(1).max(80).optional(),
    threadId: z.string().min(1).max(80).optional(),
    parentRunId: z.string().min(1).max(80).optional(),
    goal: z.string().max(400).optional(),
    userConstraints: z.array(z.string().max(200)).max(8).optional(),
    targetRefs: z.array(z.string().max(120)).max(16).optional(),
});
const IssueBody = z.strictObject({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    versionId: z.string().min(1).max(40).optional(),
    userSteps: z.string().max(2000).optional(),
    recentActions: z.array(z.unknown()).max(50).optional(),
    consoleErrors: z.array(z.string().max(500)).max(50).optional(),
    checkIds: z.array(z.string().min(1).max(120)).max(20).optional(),
});
const IssueConfirmBody = z.strictObject({
    resolved: z.boolean(),
    note: z.string().max(500).optional(),
});
const VersionBody = z.strictObject({
    baseVersionId: z.string().min(1),
    recipe: z.unknown(),
    note: z.string().max(300).optional(),
});
const GuidanceBody = z.strictObject({
    text: z.string().min(1).max(1000),
    pauseBeforeNextTool: z.boolean().optional(),
});
/** 契约会被持久化并参与每次验证，必须在写入前校验完整结构与参数，不能只校验「是对象」。 */
const ContractEntryBody = z.strictObject({
    id: z.string().min(1).max(64),
    kind: z.enum(CONTRACT_KINDS),
    description: z.string().max(500),
    origin: z.enum(['user', 'ai_suggested_accepted', 'sample']),
    pack: z.array(z.enum(PACK_IDS)).max(8),
    verificationMode: z.enum(['auto', 'manual']),
    params: z.record(z.string(), z.unknown()),
});
const ConfirmBody = z.strictObject({
    entries: z.array(ContractEntryBody).max(32),
});
const ModelBody = z.strictObject({
    baseUrl: z.string().min(1).max(500),
    model: z.string().min(1).max(200),
    apiKey: z.string().min(1).max(500),
    timeoutMs: z.number().int().min(1000).max(300000).optional(),
    maxRequests: z.number().int().min(1).max(50).optional(),
});
function threadTitle(text) {
    const clean = text.replace(/\s+/g, ' ').trim();
    const chars = Array.from(clean);
    return chars.length <= 40 ? clean : chars.slice(0, 40).join('');
}
/** 列表页只返回摘要：events 仍然只在 GET /api/runs/:id 返回。 */
function runSummary(run) {
    const extended = run;
    return {
        id: run.id,
        projectId: run.projectId,
        threadId: extended.threadId ?? run.id,
        parentRunId: extended.parentRunId ?? null,
        kind: extended.kind ?? 'modify',
        issueId: extended.issueId ?? null,
        instruction: run.instruction,
        mode: run.mode,
        status: run.status,
        baseVersionId: run.baseVersionId,
        candidateVersionId: run.candidateVersionId,
        demo: run.mode === 'demo',
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        error: run.error,
        concerns: run.concerns,
        guidanceCount: run.guidance.length,
        interrupted: extended.interrupted === true,
    };
}
/** 线程列表由 runs 派生，按最近活动倒序（契约 §3.4）。 */
function threadSummaries(runs) {
    const groups = new Map();
    for (const run of runs) {
        const summary = runSummary(run);
        const list = groups.get(summary.threadId) ?? [];
        list.push(summary);
        groups.set(summary.threadId, list);
    }
    const threads = [];
    for (const [id, list] of groups) {
        const ordered = [...list].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
        const first = ordered[0];
        const latest = ordered[ordered.length - 1];
        const linkedIssue = [...ordered].reverse().find((item) => item.issueId !== null);
        threads.push({
            id,
            title: threadTitle(first.instruction),
            latestRunId: latest.id,
            latestStatus: latest.status,
            latestAt: latest.updatedAt,
            runIds: ordered.map((item) => item.id),
            issueId: linkedIssue === undefined ? null : linkedIssue.issueId,
            candidateVersionId: latest.candidateVersionId,
            demo: latest.demo,
        });
    }
    return threads.sort((a, b) => (a.latestAt < b.latestAt ? 1 : -1));
}
/** 最近可玩版本：优先最近一次真实通过验证的版本，否则回退到已采纳版本。 */
function latestPlayableVersionId(project) {
    const adopted = project.versions.find((version) => version.id === project.adoptedVersionId);
    if (adopted !== undefined && adopted.verified?.status === 'passed')
        return adopted.id;
    const lastVerified = project.versions.find((version) => version.id === project.lastVerifiedVersionId);
    if (lastVerified !== undefined && lastVerified.verified?.status === 'passed')
        return lastVerified.id;
    return project.adoptedVersionId;
}
async function lastVerificationOf(storage, projectId, versionId) {
    const project = await storage.getProject(projectId);
    const version = project?.versions.find((item) => item.id === versionId);
    const verificationId = version?.verified?.verificationId;
    if (verificationId === undefined)
        return null;
    const report = (await storage.getReport(projectId, verificationId));
    if (report === null)
        return null;
    return {
        verificationId: report.verificationId,
        checks: report.checks.map((check) => ({ id: check.id, status: check.status, detail: check.detail })),
    };
}
/**
 * 服务端重新计算任务卡的可信字段（契约 §3.1/§3.2）：
 * packId、baseVersionId、保护底线、evidenceRefs、acceptance、allowedOps 都由服务端决定，
 * 客户端只能改 goal / userConstraints / targetRefs。
 */
async function compileBriefFor(storage, project, input) {
    const compile = {
        rawText: input.instruction,
        kind: input.kind,
        packId: project.packId,
        baseVersionId: input.baseVersionId,
        issue: input.issue,
        lastVerification: await lastVerificationOf(storage, project.id, input.baseVersionId),
        contracts: project.contracts,
        threadId: input.threadId,
        parentRunId: input.parentRunId,
        goal: input.goal,
        userConstraints: input.userConstraints,
        targetRefs: input.targetRefs,
    };
    return compileTaskBrief(compile);
}
async function createServer(options) {
    const { storage, token } = options;
    const allowExternalHosts = options.allowExternalHosts === true;
    const ancestors = allowExternalHosts ? ANCESTORS_STUDIO : ANCESTORS_LOCAL;
    const config = new ModelConfigStore();
    if (allowExternalHosts) {
        // 公共实例上 Key 持久化到数据卷，重启不丢；API 依旧只回 configured/baseUrl/model，绝不回显 Key 本身。
        await config.attach(join(options.storage.dataRoot, 'model-config.json'));
    }
    // 外部（容器）模式：在 HTTP 层剥掉子路径前缀（/proxy/7860/api/x → /api/x）。
    // 必须在 serverFactory 里做——路由匹配发生在任何 onRequest 钩子之前。
    const fastifyOptions = { logger: false, bodyLimit: 12 * 1024 * 1024 };
    if (allowExternalHosts) {
        Object.assign(fastifyOptions, {
            serverFactory: (handler) => createServer$1((req, res) => {
                const url = req.url ?? '/';
                const idx = url.indexOf('/api/');
                if (idx > 0)
                    req.url = url.slice(idx);
                handler(req, res);
            }),
        });
    }
    const fastify = Fastify(fastifyOptions);
    let baseUrl = '';
    const runs = new RunManager(storage, config, () => baseUrl);
    // 重启恢复：从磁盘重建运行摘要，未结束的任务标为 cancelled/interrupted（不重放工具）。
    await runs.hydrate();
    const assetsRoot = options.webDist;
    fastify.addHook('onRequest', async (request, reply) => {
        const host = request.headers.host ?? '';
        const hostName = host.includes(':') ? host.slice(0, host.lastIndexOf(':')) : host;
        if (!allowExternalHosts && !/^(127\.0\.0\.1|localhost|\[::1\])$/.test(hostName)) {
            return reply.code(403).send({ ok: false, error: { code: 'FORBIDDEN_HOST', message: '只接受回环地址访问' } });
        }
        const origin = request.headers.origin;
        if (origin !== undefined) {
            let originHost = '';
            try {
                originHost = new URL(origin).hostname;
            }
            catch {
                originHost = '';
            }
            if (allowExternalHosts) {
                // 魔搭 Docker 创空间的实际访问域不止 modelscope.cn（创空间页面是 *.ms.show，
                // 网关把 Host 重写成 *.fcapp.run，module script 必带 Origin）。域名族无法穷举可靠猜测，
                // 因此外部模式对陌生 Origin 只记录不拦截：写操作的真正防线是随机会话令牌
                // （第三方页面无法读取，且 CSP 限制可嵌入域），与本地发行版的严格拒绝保持一致目标。
                const sameHost = originHost === hostName;
                const trusted = ['modelscope.cn', 'ms.show', 'fcapp.run'].some((suffix) => originHost === suffix || originHost.endsWith('.' + suffix));
                if (!sameHost && !trusted)
                    console.log('SOFT-ORIGIN origin=' + origin + ' host=' + host);
            }
            else {
                const port = host.includes(':') ? host.slice(host.lastIndexOf(':') + 1) : '80';
                const allowed = new Set([
                    'http://' + host,
                    'http://localhost:' + port,
                    'http://127.0.0.1:' + port,
                    'http://[::1]:' + port,
                ]);
                if (!allowed.has(origin)) {
                    return reply.code(403).send({ ok: false, error: { code: 'FORBIDDEN_ORIGIN', message: '拒绝跨站来源：' + origin } });
                }
            }
        }
        if (request.url.startsWith('/api/')) {
            if (request.url === '/api/health' || request.url.startsWith('/api/health?'))
                return;
            // 魔搭 Docker 创空间占用了 Authorization 头，平台会把请求代理进容器；
            // 因此本地继续接受 Authorization: Bearer，另外无条件接受自定义头 X-Zaowan-Session。
            const auth = request.headers.authorization ?? '';
            const custom = request.headers['x-zaowan-session'] ?? '';
            if (auth !== 'Bearer ' + token && custom !== token) {
                return reply.code(401).send({ ok: false, error: { code: 'UNAUTHORIZED', message: '缺少或错误的会话令牌' } });
            }
        }
        return undefined;
    });
    if (allowExternalHosts) {
        fastify.addHook('onResponse', (request, reply, done) => {
            console.log('REQ ' + request.method + ' ' + (request.url ?? '').slice(0, 120) + ' -> ' + reply.statusCode +
                ' host=' + (request.headers.host ?? '-') + ' origin=' + (request.headers.origin ?? '-'));
            done();
        });
    }
    // review / playtest / export / quick-fix 不创建 RunRecord，但会长时间占用并写回工程目录。
    // 用一个在途计数让删除项目也能看见它们，避免把工程移进回收站后再被这些任务重建出幽灵目录。
    const LONG_TASK_ROUTE = /^\/api\/projects\/([^/?]+)\/(?:review|playtest|export|quick-fix)(?:\?|$)/;
    const longTasks = new Map();
    const longTaskProject = (url) => {
        const match = LONG_TASK_ROUTE.exec(url);
        return match === null ? null : decodeURIComponent(match[1]);
    };
    fastify.addHook('onRequest', (request, _reply, done) => {
        const id = longTaskProject(request.url);
        if (id !== null)
            longTasks.set(id, (longTasks.get(id) ?? 0) + 1);
        done();
    });
    fastify.addHook('onResponse', (request, _reply, done) => {
        const id = longTaskProject(request.url);
        if (id !== null) {
            const remaining = (longTasks.get(id) ?? 1) - 1;
            if (remaining <= 0)
                longTasks.delete(id);
            else
                longTasks.set(id, remaining);
        }
        done();
    });
    fastify.get('/api/health', async () => ({
        ok: true,
        version: options.version,
        packs: ['puzzle', 'stealth', 'quiz', 'card', 'dialogue'],
        browser: { mode: process.env.ZAOWAN_CDP_URL !== undefined ? 'cdp' : 'launch' },
        model: { configured: config.configured(), shared: allowExternalHosts },
    }));
    fastify.get('/api/projects', async () => ({ ok: true, projects: await storage.listProjects() }));
    fastify.post('/api/projects', async (request, reply) => {
        const parsed = ProjectBody.safeParse(request.body);
        if (!parsed.success)
            return fail(reply, 'INVALID_ARGUMENT', '参数不合法', { issues: zodIssues(parsed.error) });
        let project;
        try {
            project = await storage.createProject(parsed.data);
        }
        catch (error) {
            const code = error.code ?? 'INTERNAL_ERROR';
            return fail(reply, code, error instanceof Error ? error.message : String(error));
        }
        const idea = parsed.data.idea === undefined ? '' : parsed.data.idea.trim();
        const demoRequested = parsed.data.autoGenerate === 'demo';
        const wantsGeneration = idea.length > 0;
        // 模板/示例创建不自动生成；autoGenerate='demo' 是仅供测试/演示的显式开关。
        if ((!wantsGeneration && !demoRequested) || (parsed.data.sample !== undefined && !demoRequested)) {
            return { ok: true, project };
        }
        const mode = demoRequested ? 'demo' : 'model';
        if (mode === 'model' && !config.configured()) {
            const generation = {
                requested: wantsGeneration,
                started: false,
                mode: 'model',
                reason: 'MODEL_NOT_CONFIGURED',
                message: '还没有配置模型服务：项目已创建，但还没有生成你的游戏。可以先去连接 AI、手动编辑，或改用可玩模板。',
            };
            return { ok: true, project, generation };
        }
        const threadId = 'thread-' + randomBytes(4).toString('hex');
        const instruction = idea.length > 0 ? idea : '生成一个可玩的第一版';
        try {
            const brief = await compileBriefFor(storage, project, {
                instruction,
                kind: 'initial_generation',
                baseVersionId: project.currentVersionId,
                issue: null,
                threadId,
                parentRunId: null,
            });
            const run = await runs.start(project.id, instruction, mode, {
                brief,
                kind: 'initial_generation',
                issueId: null,
                threadId,
                parentRunId: null,
            });
            const generation = { requested: wantsGeneration, started: true, runId: run.id, mode };
            return { ok: true, project, generation };
        }
        catch (error) {
            const generation = {
                requested: wantsGeneration,
                started: false,
                mode,
                reason: 'MODEL_START_FAILED',
                message: error instanceof Error ? error.message : String(error),
            };
            return { ok: true, project, generation };
        }
    });
    fastify.post('/api/import/tiled', async (request, reply) => {
        const parsed = TiledImportBody.safeParse(request.body);
        if (!parsed.success)
            return fail(reply, 'INVALID_ARGUMENT', '参数不合法', { issues: zodIssues(parsed.error) });
        let converted;
        try {
            converted = importTiledMap(parsed.data.map, { name: parsed.data.name, fallbackName: parsed.data.fallbackName });
        }
        catch (error) {
            if (error instanceof TiledImportError)
                return fail(reply, error.code, error.message);
            throw error;
        }
        const lint = lintRecipe(converted.recipe);
        try {
            const project = await storage.createProject({
                name: converted.recipe.meta.name,
                imported: {
                    recipe: converted.recipe,
                    note: '从 Tiled 地图导入（' + converted.report.mapped.length + ' 个对象，' + converted.report.warnings.length + ' 条提示）',
                    origin: { source: 'tiled', importedAt: new Date().toISOString(), warnings: converted.report.warnings, mapped: converted.report.mapped },
                },
            });
            return { ok: true, project, report: converted.report, lint };
        }
        catch (error) {
            const code = error.code ?? 'INTERNAL_ERROR';
            return fail(reply, code, error instanceof Error ? error.message : String(error));
        }
    });
    fastify.get('/api/projects/:id', async (request, reply) => {
        const params = request.params;
        const project = await storage.getProject(params.id);
        if (project === null)
            return fail(reply, 'NOT_FOUND', '项目不存在');
        const recipe = await storage.getRecipe(params.id, project.currentVersionId);
        return {
            ok: true,
            project,
            recipe,
            assets: await storage.listAssets(params.id),
            runs: runs.listRuns(params.id).slice(0, 20).map((run) => runSummary(run)),
            issues: await listIssues(storage, params.id),
        };
    });
    fastify.get('/api/projects/:id/versions/:versionId', async (request, reply) => {
        const params = request.params;
        const recipe = await storage.getRecipe(params.id, params.versionId);
        if (recipe === null)
            return fail(reply, 'NOT_FOUND', '版本不存在');
        const meta = await storage.getVersionMeta(params.id, params.versionId);
        return { ok: true, recipe, meta };
    });
    fastify.post('/api/projects/:id/versions', async (request, reply) => {
        const params = request.params;
        const parsed = VersionBody.safeParse(request.body);
        if (!parsed.success)
            return fail(reply, 'INVALID_ARGUMENT', '参数不合法', { issues: zodIssues(parsed.error) });
        const project = await storage.getProject(params.id);
        if (project === null)
            return fail(reply, 'NOT_FOUND', '项目不存在');
        if (project.currentVersionId !== parsed.data.baseVersionId) {
            return fail(reply, 'VERSION_CONFLICT', '当前版本已变化，请刷新后再保存');
        }
        const recipe = parseRecipe(parsed.data.recipe);
        if (!recipe.ok)
            return fail(reply, 'RECIPE_INVALID', '配方结构不合法', { issues: recipe.issues });
        const issues = validateRecipe(recipe.value);
        if (issues.length > 0)
            return fail(reply, 'RECIPE_INVALID', '配方语义不合法', { issues });
        const created = await storage.addVersion(params.id, {
            recipe: recipe.value,
            note: parsed.data.note ?? '手动编辑',
            source: 'user',
            parentId: parsed.data.baseVersionId,
            status: 'candidate',
            expectedCurrentVersionId: parsed.data.baseVersionId,
        });
        return { ok: true, version: created.version, project: created.project };
    });
    fastify.post('/api/projects/:id/contracts/confirm', async (request, reply) => {
        const params = request.params;
        const parsed = ConfirmBody.safeParse(request.body);
        if (!parsed.success)
            return fail(reply, 'INVALID_ARGUMENT', '参数不合法', { issues: zodIssues(parsed.error) });
        const project = await storage.getProject(params.id);
        if (project === null)
            return fail(reply, 'NOT_FOUND', '项目不存在');
        const entries = parsed.data.entries;
        const problems = entries.flatMap((entry, index) => validateContractEntry(entry).map((problem) => 'entries[' + index + '] ' + problem));
        if (problems.length > 0)
            return fail(reply, 'INVALID_ARGUMENT', '契约参数不合法', { issues: problems });
        const contracts = await storage.confirmContracts(params.id, entries, 'local-user');
        return { ok: true, contracts };
    });
    fastify.post('/api/projects/:id/verify', async (request, reply) => {
        const params = request.params;
        const body = (request.body ?? {});
        const project = await storage.getProject(params.id);
        if (project === null)
            return fail(reply, 'NOT_FOUND', '项目不存在');
        const versionId = body.versionId ?? project.currentVersionId;
        try {
            const outcome = await verifyVersion(storage, params.id, versionId);
            // 契约 §3.3：验证失败后自动 upsert 问题单（同一 versionId + buildId + checkId 不重复）。
            const triggeredIssues = await upsertIssuesFromVerification(storage, params.id, versionId, outcome.report);
            return { ok: true, runId: outcome.runId, report: outcome.report, issues: triggeredIssues };
        }
        catch (error) {
            const code = error.code ?? 'INTERNAL_ERROR';
            return fail(reply, code, error instanceof Error ? error.message : String(error));
        }
    });
    const lintFor = async (projectId, versionId) => {
        const recipe = await storage.getRecipe(projectId, versionId);
        if (recipe === null)
            return null;
        const assets = await storage.listAssets(projectId);
        return lintRecipe(recipe, { assetIds: assets.map((asset) => asset.id) });
    };
    fastify.get('/api/projects/:id/lint', async (request, reply) => {
        const params = request.params;
        const query = request.query;
        const project = await storage.getProject(params.id);
        if (project === null)
            return fail(reply, 'NOT_FOUND', '项目不存在');
        const versionId = query.versionId ?? project.currentVersionId;
        const findings = await lintFor(params.id, versionId);
        if (findings === null)
            return fail(reply, 'NOT_FOUND', '版本不存在');
        return { ok: true, versionId, findings };
    });
    fastify.post('/api/projects/:id/quick-fix', async (request, reply) => {
        const params = request.params;
        const body = (request.body ?? {});
        const project = await storage.getProject(params.id);
        if (project === null)
            return fail(reply, 'NOT_FOUND', '项目不存在');
        const versionId = body.versionId ?? project.currentVersionId;
        const findings = await lintFor(params.id, versionId);
        if (findings === null)
            return fail(reply, 'NOT_FOUND', '版本不存在');
        const targets = JSON.stringify(body.targets ?? []);
        const finding = findings.find((item) => item.ruleId === body.ruleId && JSON.stringify(item.targets) === targets && item.quickFix !== undefined);
        if (finding === undefined || finding.quickFix === undefined)
            return fail(reply, 'NOT_FOUND', '这个问题已不存在或没有算法修复');
        const runId = 'quickfix-' + Date.now().toString(36);
        const ctx = {
            storage,
            projectId: params.id,
            runId,
            baseUrl,
            baseVersionId: versionId,
            candidateVersionId: null,
            contracts: project.contracts,
            baselineRecipe: await storage.getRecipe(params.id, project.adoptedVersionId),
            lastVerification: null,
            lastPlaytest: null,
            emit: () => undefined,
            setCandidate: (id) => {
                ctx.candidateVersionId = id;
            },
            versionSource: 'algorithm',
        };
        const patched = await executeTool(ctx, 'apply_recipe_patch', JSON.stringify({ ops: finding.quickFix.ops, versionId, note: '算法修复（未调用 AI）：' + finding.quickFix.label }));
        if (!patched.ok || ctx.candidateVersionId === null) {
            return fail(reply, patched.code, '算法修复被拒绝', { detail: patched.data });
        }
        const outcome = await verifyVersion(storage, params.id, ctx.candidateVersionId);
        for (const issue of await listIssues(storage, params.id)) {
            if (issue.versionId !== versionId || issue.status === 'resolved' || issue.status === 'dismissed')
                continue;
            await evaluateIssueAfterRun(storage, issue.id, { id: runId, projectId: params.id, status: 'ready_for_review', candidateVersionId: ctx.candidateVersionId });
        }
        const after = await lintFor(params.id, ctx.candidateVersionId);
        return { ok: true, versionId: ctx.candidateVersionId, fix: finding.quickFix, report: outcome.report, findings: after ?? [], modelCalls: 0 };
    });
    const reviewFor = async (projectId, versionId, mode) => {
        const project = await storage.getProject(projectId);
        const recipe = await storage.getRecipe(projectId, versionId);
        if (project === null || recipe === null)
            return null;
        const local = (await lintFor(projectId, versionId)) ?? [];
        let ai = skippedReview(mode === 'local' ? '本地规则审查：没有调用云端模型。' : '还没有连接 AI，云端审查没有运行。');
        if (mode !== 'local') {
            const providerConfig = config.get();
            if (providerConfig === null) {
                ai = skippedReview('还没有连接 AI，云端审查没有运行。');
            }
            else {
                const provider = options.aiReviewProvider?.(providerConfig) ?? new OpenAICompatibleProvider(providerConfig);
                ai = await reviewRecipeWithModel({
                    recipe,
                    entries: project.contracts.entries,
                    local,
                    provider,
                    model: providerConfig.model,
                    timeoutMs: providerConfig.timeoutMs,
                });
            }
        }
        const runId = 'review-' + Date.now().toString(36);
        // 云端结论与本地结论分开落盘：审查证据可核对模型名、调用次数与 token，不混进机器检查报告。
        await storage.writeRunFile(projectId, runId, 'review.json', JSON.stringify({ runId, kind: 'recipe-review', projectId, versionId, mode, local, ai }, null, 2));
        await storage.writeRunFile(projectId, runId, 'model-usage.json', JSON.stringify({ mode, requests: ai.usage.requests, model: ai.model, status: ai.status, tokens: ai.usage, promptChars: ai.promptChars }, null, 2));
        // 云端档失败/跳过时回退显示本地体检结论：不能因为一次模型失败就把可查出的问题藏起来。
        const aiOk = ai.status === 'ok';
        const findings = mode === 'ai' && aiOk ? ai.findings : [...local, ...ai.findings];
        return { local, ai, findings, runId };
    };
    fastify.put('/api/projects/:id/review-mode', async (request, reply) => {
        const params = request.params;
        const body = (request.body ?? {});
        if (!isReviewMode(body.mode))
            return fail(reply, 'INVALID_ARGUMENT', '审查方式只能是 local、ai 或 both');
        try {
            const project = await storage.setReviewMode(params.id, body.mode);
            return { ok: true, reviewMode: project.reviewMode };
        }
        catch (error) {
            const code = error.code ?? 'INTERNAL_ERROR';
            return fail(reply, code, error instanceof Error ? error.message : String(error));
        }
    });
    fastify.post('/api/projects/:id/review', async (request, reply) => {
        const params = request.params;
        const body = (request.body ?? {});
        const project = await storage.getProject(params.id);
        if (project === null)
            return fail(reply, 'NOT_FOUND', '项目不存在');
        const mode = isReviewMode(body.mode) ? body.mode : project.reviewMode ?? 'local';
        const versionId = body.versionId ?? project.currentVersionId;
        const result = await reviewFor(params.id, versionId, mode);
        if (result === null)
            return fail(reply, 'NOT_FOUND', '版本不存在');
        if (mode !== 'local' && project.reviewMode !== mode)
            await storage.setReviewMode(params.id, mode);
        return { ok: true, mode, versionId, ...result };
    });
    const deleteProjectRoute = async (request, reply) => {
        const params = request.params;
        const body = (request.body ?? {});
        if (body.confirm !== true)
            return fail(reply, 'INVALID_ARGUMENT', '删除项目需要显式确认');
        const project = await storage.getProject(params.id);
        if (project === null)
            return fail(reply, 'NOT_FOUND', '项目不存在');
        const terminal = ['completed', 'failed', 'cancelled', 'ready_for_review', 'blocked'];
        const active = runs.listRuns(params.id).filter((run) => !terminal.includes(run.status));
        if (active.length > 0 || (longTasks.get(params.id) ?? 0) > 0) {
            return fail(reply, 'ACTIVE_RUN', '这个项目还有任务在运行，请先停止任务');
        }
        try {
            const trash = await storage.moveToTrash(params.id);
            return { ok: true, trash };
        }
        catch (error) {
            const code = error.code ?? 'INTERNAL_ERROR';
            return fail(reply, code, error instanceof Error ? error.message : String(error));
        }
    };
    // 部分平台的网关会拦掉 DELETE 方法（创空间实测 403），因此删除同时提供 POST 别名；
    // 两个方法共用同一个处理函数，权限与确认要求完全一致。
    fastify.delete('/api/projects/:id', deleteProjectRoute);
    fastify.post('/api/projects/:id/delete', deleteProjectRoute);
    fastify.get('/api/trash', async () => ({ ok: true, trash: await storage.listTrash() }));
    fastify.post('/api/trash/:id/restore', async (request, reply) => {
        const params = request.params;
        try {
            const project = await storage.restoreFromTrash(params.id);
            return { ok: true, project };
        }
        catch (error) {
            const code = error.code ?? 'INTERNAL_ERROR';
            return fail(reply, code, error instanceof Error ? error.message : String(error));
        }
    });
    const purgeTrashRoute = async (request, reply) => {
        const params = request.params;
        const body = (request.body ?? {});
        if (body.confirm !== true)
            return fail(reply, 'INVALID_ARGUMENT', '永久删除需要显式确认');
        const known = await storage.listTrash();
        if (!known.some((entry) => entry.id === params.id))
            return fail(reply, 'NOT_FOUND', '回收站里没有这个项目');
        await storage.purgeTrash(params.id);
        return { ok: true };
    };
    fastify.delete('/api/trash/:id', purgeTrashRoute);
    fastify.post('/api/trash/:id/delete', purgeTrashRoute);
    fastify.post('/api/projects/:id/playtest', async (request, reply) => {
        const params = request.params;
        const body = (request.body ?? {});
        const project = await storage.getProject(params.id);
        if (project === null)
            return fail(reply, 'NOT_FOUND', '项目不存在');
        const versionId = body.versionId ?? project.currentVersionId;
        const runId = 'playtest-' + Date.now().toString(36);
        const ctx = {
            storage,
            projectId: params.id,
            runId,
            baseUrl,
            baseVersionId: versionId,
            candidateVersionId: null,
            contracts: project.contracts,
            baselineRecipe: null,
            lastVerification: null,
            lastPlaytest: null,
            emit: () => undefined,
            setCandidate: () => undefined,
        };
        const result = await executeTool(ctx, 'run_browser_playtest', JSON.stringify({ versionId }));
        const outcome = await verifyVersion(storage, params.id, versionId);
        return { ok: true, playtest: { ok: result.ok, code: result.code, data: result.data }, report: outcome.report };
    });
    fastify.get('/api/projects/:id/verification/:verificationId', async (request, reply) => {
        const params = request.params;
        const report = await storage.getReport(params.id, params.verificationId);
        if (report === null)
            return fail(reply, 'NOT_FOUND', '验证报告不存在');
        return { ok: true, report };
    });
    fastify.post('/api/projects/:id/adopt', async (request, reply) => {
        const params = request.params;
        const body = (request.body ?? {});
        try {
            const project = await storage.adopt(params.id, body.versionId ?? '', body.bump === 'major' ? 'major' : 'minor');
            return { ok: true, project };
        }
        catch (error) {
            const code = error.code ?? 'INTERNAL_ERROR';
            return fail(reply, code, error instanceof Error ? error.message : String(error));
        }
    });
    fastify.post('/api/projects/:id/rollback', async (request, reply) => {
        const params = request.params;
        const body = (request.body ?? {});
        try {
            const project = await storage.adopt(params.id, body.versionId ?? '');
            return { ok: true, project };
        }
        catch (error) {
            const code = error.code ?? 'INTERNAL_ERROR';
            return fail(reply, code, error instanceof Error ? error.message : String(error));
        }
    });
    fastify.post('/api/projects/:id/export', async (request, reply) => {
        const params = request.params;
        const body = (request.body ?? {});
        const project = await storage.getProject(params.id);
        if (project === null)
            return fail(reply, 'NOT_FOUND', '项目不存在');
        const versionId = body.versionId ?? project.currentVersionId;
        const recipe = await storage.getRecipe(params.id, versionId);
        if (recipe === null)
            return fail(reply, 'NOT_FOUND', '版本不存在');
        const unreviewed = storage.quizUnreviewed(recipe);
        if (unreviewed > 0 && body.confirmUnreviewed !== true) {
            return fail(reply, 'CONTRACT_VIOLATION', '还有 ' + unreviewed + ' 道题未审核，请先确认再导出', { unreviewed });
        }
        const playerDistOk = await stat(join(options.playerDist, 'index.html')).catch(() => null);
        if (playerDistOk === null) {
            return fail(reply, 'RUNTIME_ERROR', '播放器构建产物缺失，请先运行构建命令');
        }
        const meta = project.versions.find((version) => version.id === versionId);
        const verification = project.versions.find((version) => version.id === versionId)?.verified ?? null;
        const exportId = 'export-' + Date.now().toString(36);
        const outFile = join(storage.projectDir(params.id), 'exports', exportId + '.zip');
        const verificationReport = verification === null ? null : (await storage.getReport(params.id, verification.verificationId));
        const projectAssets = await storage.listAssets(params.id);
        const exportAssets = [];
        for (const asset of projectAssets) {
            const ext = asset.mime.split('/')[1] ?? 'bin';
            const file = join(storage.projectDir(params.id), 'assets', asset.contentHash + '.' + ext);
            const data = await readFile(file).catch(() => null);
            if (data !== null)
                exportAssets.push({ id: asset.id, ext, data });
        }
        const result = await buildGameExport({
            recipe,
            contracts: project.contracts,
            assets: exportAssets,
            projectName: project.name,
            versionId,
            buildId: meta?.buildId ?? '',
            verificationSummary: verificationReport === null ? undefined : {
                status: verificationReport.status,
                checks: verificationReport.checks.map((check) => ({ id: check.id, status: check.status, detail: check.detail })),
            },
            playerDistDir: options.playerDist,
            sourceRoot: options.repoRoot,
            outFile,
            nodeRuntime: body.includeNode === true ? process.execPath : undefined,
        });
        return {
            ok: true,
            exportId,
            path: result.file,
            filename: exportId + '.zip',
            bytes: result.bytes,
            entries: result.entries,
            includeNode: body.includeNode === true,
            warnings: unreviewed > 0 ? ['题库中仍有未审核题目，导出包已按你的确认生成'] : [],
        };
    });
    fastify.get('/api/projects/:id/exports/:name', async (request, reply) => {
        const params = request.params;
        if (!/^export-[a-z0-9]+\.zip$/.test(params.name))
            return fail(reply, 'INVALID_ARGUMENT', '文件名不合法');
        const file = join(storage.projectDir(params.id), 'exports', params.name);
        try {
            const info = await stat(file);
            if (!info.isFile())
                return fail(reply, 'NOT_FOUND', '导出包不存在');
            const data = await readFile(file);
            return reply.header('content-type', 'application/zip').header('content-disposition', 'attachment; filename="' + params.name + '"').send(data);
        }
        catch {
            return fail(reply, 'NOT_FOUND', '导出包不存在');
        }
    });
    fastify.post('/api/projects/:id/assets', async (request, reply) => {
        const params = request.params;
        const parsed = AssetBody.safeParse(request.body);
        if (!parsed.success)
            return fail(reply, 'INVALID_ARGUMENT', '参数不合法', { issues: zodIssues(parsed.error) });
        const buffer = Buffer.from(parsed.data.dataBase64, 'base64');
        const mime = parsed.data.mime ?? '';
        const safeName = (fallback) => (parsed.data.filename.split(/[\\/]/).pop() ?? fallback)
            .replace(/[^a-zA-Z0-9._-]/g, '_')
            .replace(/^\.+/, '')
            .slice(0, 120) || fallback;
        const audioMime = { 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav' };
        if (audioMime[mime] !== undefined) {
            if (buffer.length > 12 * 1024 * 1024)
                return fail(reply, 'INVALID_ARGUMENT', '音频不能超过 12 MiB');
            const head = buffer.subarray(0, 12);
            const isMp3 = head.subarray(0, 3).toString('ascii') === 'ID3' || (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0);
            const isOgg = head.subarray(0, 4).toString('ascii') === 'OggS';
            const isWav = head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WAVE';
            const ok = (mime === 'audio/mpeg' && isMp3) || (mime === 'audio/ogg' && isOgg) || (mime === 'audio/wav' && isWav);
            if (!ok)
                return fail(reply, 'INVALID_ARGUMENT', '音频文件头与声明的 MIME 不匹配');
            const contentHash = createHash('sha256').update(buffer).digest('hex');
            const assets = await storage.addAsset(params.id, {
                id: 'asset-' + contentHash.slice(0, 10),
                contentHash,
                name: safeName('audio.' + audioMime[mime]),
                mime,
                bytes: buffer.length,
                license: parsed.data.license ?? 'unknown',
                licenseStatus: parsed.data.license === undefined ? 'unknown' : 'known',
                createdAt: new Date().toISOString(),
            }, buffer);
            return { ok: true, assets };
        }
        if (buffer.length > 4 * 1024 * 1024)
            return fail(reply, 'INVALID_ARGUMENT', '单张图片不能超过 4 MiB');
        try {
            const metadata = await sharp(buffer).metadata();
            if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '')) {
                return fail(reply, 'INVALID_ARGUMENT', '只支持 PNG / JPEG / WebP 图片，或 MP3 / OGG / WAV 音频');
            }
            if ((metadata.width ?? 0) > 2048 || (metadata.height ?? 0) > 2048) {
                return fail(reply, 'INVALID_ARGUMENT', '解码尺寸不能超过 2048x2048');
            }
            const normalized = await sharp(buffer).png().toBuffer();
            const contentHash = createHash('sha256').update(normalized).digest('hex');
            const assets = await storage.addAsset(params.id, {
                id: 'asset-' + contentHash.slice(0, 10),
                contentHash,
                name: safeName('image.png'),
                mime: 'image/png',
                bytes: normalized.length,
                license: parsed.data.license ?? 'unknown',
                licenseStatus: parsed.data.license === undefined ? 'unknown' : 'known',
                createdAt: new Date().toISOString(),
            }, normalized);
            return { ok: true, assets };
        }
        catch (error) {
            return fail(reply, 'INVALID_ARGUMENT', '图片无法解码：' + (error instanceof Error ? error.message : String(error)));
        }
    });
    fastify.get('/api/projects/:id/assets/:assetId', async (request, reply) => {
        const params = request.params;
        if (!/^asset-[a-z0-9]{6,20}$/.test(params.assetId))
            return fail(reply, 'INVALID_ARGUMENT', '素材标识不合法');
        const assets = await storage.listAssets(params.id);
        const asset = assets.find((item) => item.id === params.assetId);
        if (asset === undefined)
            return fail(reply, 'NOT_FOUND', '素材不存在');
        const ext = asset.mime.split('/')[1] ?? 'bin';
        const file = join(storage.projectDir(params.id), 'assets', asset.contentHash + '.' + ext);
        try {
            const data = await readFile(file);
            return reply
                .header('content-type', asset.mime)
                .header('cache-control', 'private, max-age=3600')
                .header('content-length', data.length)
                .send(data);
        }
        catch {
            return fail(reply, 'NOT_FOUND', '素材文件缺失');
        }
    });
    fastify.get('/api/projects/:id/runs', async (request, reply) => {
        const params = request.params;
        const project = await storage.getProject(params.id);
        if (project === null)
            return fail(reply, 'NOT_FOUND', '项目不存在');
        return { ok: true, runs: runs.listRuns(params.id) };
    });
    fastify.post('/api/projects/:id/runs', async (request, reply) => {
        const params = request.params;
        const parsed = StartRunBody.safeParse(request.body ?? {});
        if (!parsed.success)
            return fail(reply, 'INVALID_ARGUMENT', '参数不合法', { issues: zodIssues(parsed.error) });
        const body = parsed.data;
        const instruction = body.instruction.slice(0, 4000);
        if (instruction.trim().length === 0)
            return fail(reply, 'INVALID_ARGUMENT', '请填写创作或修改要求');
        const project = await storage.getProject(params.id);
        if (project === null)
            return fail(reply, 'NOT_FOUND', '项目不存在');
        let issue = null;
        if (body.issueId !== undefined) {
            issue = await getIssue(storage, params.id, body.issueId);
            if (issue === null)
                return fail(reply, 'ISSUE_NOT_FOUND', '问题不存在：' + body.issueId);
        }
        // kind 由入口决定：有 issueId 默认 repair，否则 modify（契约 §3.2）。
        const kind = body.kind ?? (issue === null ? 'modify' : 'repair');
        // 修复任务必须基于问题发生的版本，否则任务卡与 runs.start 实际执行的基础版本会不一致。
        const baseVersionId = issue !== null && project.versions.some((version) => version.id === issue.versionId)
            ? issue.versionId
            : project.currentVersionId;
        const threadId = body.threadId ?? 'thread-' + randomBytes(4).toString('hex');
        const parentRunId = body.parentRunId ?? null;
        const mode = body.mode === 'model' ? 'model' : 'demo';
        // 先把问题标成 fixing：任务可能很快失败并在终态调用 evaluateIssueAfterRun，
        // 若等 runs.start 返回后再改状态，两边会互相覆盖，问题可能卡在 fixing。
        const previousIssueStatus = issue === null ? null : issue.status;
        if (issue !== null) {
            await updateIssue(storage, params.id, issue.id, { status: 'fixing' });
        }
        try {
            const brief = await compileBriefFor(storage, project, {
                instruction,
                kind,
                baseVersionId,
                issue,
                threadId,
                parentRunId,
                goal: body.goal,
                userConstraints: body.userConstraints,
                targetRefs: body.targetRefs,
            });
            const run = await runs.start(params.id, instruction, mode, {
                brief,
                kind,
                baseVersionId,
                issueId: issue === null ? null : issue.id,
                threadId,
                parentRunId,
            });
            if (issue !== null) {
                // 只补关联 run，不重写状态：run 可能已经终结并由 evaluateIssueAfterRun 落了终态，
                // 用启动前的 stale 快照把 status 强行改回 fixing 会让问题永久卡住。
                const current = await getIssue(storage, params.id, issue.id);
                const existing = current?.linkedRunIds ?? issue.linkedRunIds;
                await updateIssue(storage, params.id, issue.id, {
                    linkedRunIds: existing.includes(run.id) ? existing : [...existing, run.id],
                });
            }
            return { ok: true, run };
        }
        catch (error) {
            if (issue !== null && previousIssueStatus !== null) {
                await updateIssue(storage, params.id, issue.id, { status: previousIssueStatus }).catch(() => undefined);
            }
            const code = error.code ?? 'INTERNAL_ERROR';
            return fail(reply, code, error instanceof Error ? error.message : String(error));
        }
    });
    fastify.post('/api/projects/:id/task-briefs/preview', async (request, reply) => {
        const params = request.params;
        const parsed = TaskBriefPreviewBody.safeParse(request.body ?? {});
        if (!parsed.success)
            return fail(reply, 'INVALID_ARGUMENT', '参数不合法', { issues: zodIssues(parsed.error) });
        const project = await storage.getProject(params.id);
        if (project === null)
            return fail(reply, 'NOT_FOUND', '项目不存在');
        const body = parsed.data;
        let issue = null;
        if (body.issueId !== undefined) {
            issue = await getIssue(storage, params.id, body.issueId);
            if (issue === null)
                return fail(reply, 'ISSUE_NOT_FOUND', '问题不存在：' + body.issueId);
        }
        // 与 runs.start 一致：修复任务默认基于问题发生的版本，其次才回退到当前版本。
        const issueVersionId = issue !== null && project.versions.some((version) => version.id === issue.versionId) ? issue.versionId : null;
        const baseVersionId = body.baseVersionId ?? issueVersionId ?? project.currentVersionId;
        if (!project.versions.some((version) => version.id === baseVersionId)) {
            return fail(reply, 'INVALID_ARGUMENT', '基础版本不存在：' + baseVersionId);
        }
        const kind = body.kind ?? (issue === null ? 'modify' : 'repair');
        try {
            const brief = await compileBriefFor(storage, project, {
                instruction: body.instruction,
                kind,
                baseVersionId,
                issue,
                threadId: null,
                parentRunId: null,
                goal: body.goal,
                userConstraints: body.userConstraints,
                targetRefs: body.targetRefs,
            });
            return { ok: true, brief };
        }
        catch (error) {
            const code = error.code ?? 'INTERNAL_ERROR';
            return fail(reply, code, error instanceof Error ? error.message : String(error));
        }
    });
    fastify.get('/api/projects/:id/threads', async (request, reply) => {
        const params = request.params;
        const project = await storage.getProject(params.id);
        if (project === null)
            return fail(reply, 'NOT_FOUND', '项目不存在');
        return { ok: true, threads: threadSummaries(runs.listRuns(params.id)) };
    });
    const deleteThreadRoute = async (request, reply) => {
        const params = request.params;
        const body = (request.body ?? {});
        if (body.confirm !== true)
            return fail(reply, 'INVALID_ARGUMENT', '删除会话需要显式确认');
        const project = await storage.getProject(params.id);
        if (project === null)
            return fail(reply, 'NOT_FOUND', '项目不存在');
        const terminal = ['completed', 'failed', 'cancelled', 'ready_for_review', 'blocked'];
        const inThread = runs.listRuns(params.id).filter((run) => run.threadId === params.threadId);
        if (inThread.length === 0)
            return fail(reply, 'NOT_FOUND', '这个会话没有可删除的记录');
        if (inThread.some((run) => !terminal.includes(run.status))) {
            return fail(reply, 'ACTIVE_RUN', '这个会话还有任务在运行，请先停止任务');
        }
        const removed = await storage.deleteThreadRuns(params.id, params.threadId);
        runs.dropRuns(inThread.map((run) => run.id));
        return { ok: true, removed: removed.length };
    };
    fastify.delete('/api/projects/:id/threads/:threadId', deleteThreadRoute);
    fastify.post('/api/projects/:id/threads/:threadId/delete', deleteThreadRoute);
    fastify.get('/api/projects/:id/issues', async (request, reply) => {
        const params = request.params;
        const project = await storage.getProject(params.id);
        if (project === null)
            return fail(reply, 'NOT_FOUND', '项目不存在');
        return {
            ok: true,
            issues: await listIssues(storage, params.id),
            latestPlayableVersionId: latestPlayableVersionId(project),
        };
    });
    fastify.post('/api/projects/:id/issues', async (request, reply) => {
        const params = request.params;
        const parsed = IssueBody.safeParse(request.body ?? {});
        if (!parsed.success)
            return fail(reply, 'INVALID_ARGUMENT', '问题描述不合法', { issues: zodIssues(parsed.error) });
        const project = await storage.getProject(params.id);
        if (project === null)
            return fail(reply, 'NOT_FOUND', '项目不存在');
        const body = parsed.data;
        if (body.versionId !== undefined && !project.versions.some((version) => version.id === body.versionId)) {
            return fail(reply, 'INVALID_ARGUMENT', '版本不存在：' + body.versionId);
        }
        const versionId = body.versionId ?? project.currentVersionId;
        let verifiedCheckIds;
        if (body.checkIds !== undefined && body.checkIds.length > 0) {
            // 信任边界：客户端提交的 checkIds 必须能在服务端验证报告里找到，否则不当作已复现。
            const version = project.versions.find((item) => item.id === versionId);
            const verificationId = version?.verified?.verificationId;
            const report = verificationId === undefined
                ? null
                : (await storage.getReport(params.id, verificationId));
            const known = new Set((report?.checks ?? []).map((check) => check.id));
            verifiedCheckIds = body.checkIds.filter((id) => known.has(id));
        }
        try {
            const issue = await createIssue(storage, params.id, {
                ...body,
                versionId,
                checkIds: verifiedCheckIds ?? body.checkIds,
            });
            return { ok: true, issue };
        }
        catch (error) {
            const code = error.code ?? 'INTERNAL_ERROR';
            return fail(reply, code, error instanceof Error ? error.message : String(error));
        }
    });
    fastify.post('/api/projects/:id/issues/:issueId/dismiss', async (request, reply) => {
        const params = request.params;
        try {
            const issue = await dismissIssue(storage, params.id, params.issueId);
            return { ok: true, issue };
        }
        catch (error) {
            const code = error.code ?? 'INTERNAL_ERROR';
            return fail(reply, code, error instanceof Error ? error.message : String(error));
        }
    });
    fastify.post('/api/projects/:id/issues/:issueId/confirm', async (request, reply) => {
        const params = request.params;
        const parsed = IssueConfirmBody.safeParse(request.body ?? {});
        if (!parsed.success)
            return fail(reply, 'INVALID_ARGUMENT', '确认参数不合法', { issues: zodIssues(parsed.error) });
        try {
            const issue = await confirmIssue(storage, params.id, params.issueId, parsed.data);
            return { ok: true, issue };
        }
        catch (error) {
            const code = error.code ?? 'INTERNAL_ERROR';
            return fail(reply, code, error instanceof Error ? error.message : String(error));
        }
    });
    fastify.get('/api/runs/:id', async (request, reply) => {
        const params = request.params;
        const run = runs.get(params.id);
        if (run === null)
            return fail(reply, 'NOT_FOUND', '任务不存在');
        return { ok: true, run };
    });
    fastify.get('/api/runs/:id/events', async (request, reply) => {
        const params = request.params;
        const run = runs.get(params.id);
        if (run === null)
            return fail(reply, 'NOT_FOUND', '任务不存在');
        const since = Number(request.query.since ?? '0');
        reply.raw.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
        });
        const write = (event) => {
            reply.raw.write('data: ' + JSON.stringify(event) + '\n\n');
        };
        for (const event of run.events) {
            if (event.seq > since)
                write(event);
        }
        const unsubscribe = runs.subscribe(params.id, (event) => {
            if (event.seq > since)
                write(event);
        });
        const heartbeat = setInterval(() => reply.raw.write(': keep-alive\n\n'), 15000);
        request.raw.on('close', () => {
            clearInterval(heartbeat);
            unsubscribe();
            reply.raw.end();
        });
        return reply;
    });
    fastify.post('/api/runs/:id/cancel', async (request, reply) => {
        const params = request.params;
        const cancelled = runs.cancel(params.id);
        if (!cancelled)
            return fail(reply, 'NOT_FOUND', '任务不存在或已经结束');
        return { ok: true };
    });
    fastify.post('/api/runs/:id/guidance', async (request, reply) => {
        const params = request.params;
        const parsed = GuidanceBody.safeParse(request.body);
        if (!parsed.success)
            return fail(reply, 'INVALID_ARGUMENT', '插话内容不合法', { issues: zodIssues(parsed.error) });
        const result = await runs.guidance(params.id, parsed.data.text, parsed.data.pauseBeforeNextTool === true);
        if (result.ok)
            return { ok: true };
        const code = result.code ?? 'INTERNAL_ERROR';
        const status = code === 'NOT_FOUND' ? 404 : 409;
        return reply.code(status).send({ ok: false, error: { code, message: result.message ?? '' } });
    });
    fastify.post('/api/runs/:id/resume', async (request, reply) => {
        const params = request.params;
        const result = runs.resume(params.id);
        if (result.ok)
            return { ok: true };
        const code = result.code ?? 'INTERNAL_ERROR';
        const status = code === 'NOT_FOUND' ? 404 : 409;
        return reply.code(status).send({ ok: false, error: { code, message: result.message ?? '' } });
    });
    fastify.get('/api/model/session-config', async () => {
        return { ok: true, shared: allowExternalHosts, ...config.publicView() };
    });
    fastify.put('/api/model/session-config', async (request, reply) => {
        const parsed = ModelBody.safeParse(request.body);
        if (!parsed.success)
            return fail(reply, 'INVALID_ARGUMENT', '参数不合法', { issues: zodIssues(parsed.error) });
        const url = validateBaseUrl(parsed.data.baseUrl);
        if (!url.ok)
            return fail(reply, 'INVALID_ARGUMENT', url.message);
        const configValue = {
            baseUrl: url.url,
            model: parsed.data.model,
            apiKey: parsed.data.apiKey,
            timeoutMs: parsed.data.timeoutMs ?? 60000,
            maxRequests: parsed.data.maxRequests ?? 12,
        };
        config.set(configValue);
        return { ok: true, configured: true, baseUrl: url.url, model: parsed.data.model };
    });
    const clearModelConfig = async () => {
        config.clear();
        return { ok: true, configured: false };
    };
    fastify.delete('/api/model/session-config', clearModelConfig);
    fastify.post('/api/model/session-config/clear', clearModelConfig);
    fastify.post('/api/model/test', async (_request, reply) => {
        const current = config.get();
        if (current === null)
            return fail(reply, 'MODEL_AUTH_FAILED', '还没有配置模型服务');
        const provider = new OpenAICompatibleProvider(current);
        const result = await provider.testConnection();
        return { ok: result.ok, toolCalling: result.toolCalling, detail: result.detail };
    });
    const resolveStatic = async (pathname) => {
        // 外部模式逐段剥前缀：/proxy/7860/assets/app.js → assets/app.js（平台保留子路径时兜底）
        const trimmed = pathname.replace(/^\/+/, '');
        const candidates = [trimmed];
        if (allowExternalHosts) {
            let cut = trimmed.indexOf('/');
            while (cut >= 0 && candidates.length <= 6) {
                candidates.push(trimmed.slice(cut + 1));
                cut = trimmed.indexOf('/', cut + 1);
            }
        }
        for (const rel of candidates) {
            const target = normalize$1(join(assetsRoot, rel === '' ? 'index.html' : rel));
            if (!target.startsWith(normalize$1(assetsRoot) + sep))
                continue;
            const info = await stat(target).catch(() => null);
            if (info !== null && info.isFile())
                return target;
        }
        return null;
    };
    fastify.setNotFoundHandler(async (request, reply) => {
        if (request.url.startsWith('/api/'))
            return fail(reply, 'NOT_FOUND', '接口不存在');
        const target = await resolveStatic(request.url.split('?')[0] ?? '/');
        if (target !== null)
            return reply.header('cache-control', 'no-store').send(await readFile(target));
        const indexHtml = join(assetsRoot, 'index.html');
        const info = await stat(indexHtml).catch(() => null);
        if (info === null) {
            return reply.code(503).type('text/html; charset=utf-8').send('<h1>工作台尚未构建</h1><p>请先运行构建命令生成 apps/web/dist。</p>');
        }
        const html = await readFile(indexHtml, 'utf8');
        return sendIndex(reply, token, html, ancestors);
    });
    fastify.get('/', async (_request, reply) => {
        const indexHtml = join(assetsRoot, 'index.html');
        const info = await stat(indexHtml).catch(() => null);
        if (info === null) {
            return reply.code(503).type('text/html; charset=utf-8').send('<h1>工作台尚未构建</h1><p>请先运行构建命令生成 apps/web/dist。</p>');
        }
        const html = await readFile(indexHtml, 'utf8');
        return sendIndex(reply, token, html, ancestors);
    });
    fastify.get('/*', async (request, reply) => {
        const pathname = (request.url.split('?')[0] ?? '/');
        if (pathname.startsWith('/api/'))
            return fail(reply, 'NOT_FOUND', '接口不存在');
        const target = await resolveStatic(pathname);
        if (target !== null) {
            // 剥前缀兜底可能把 /proxy/7860/ 直接解析到 index.html：入口页必须走注入分支，不能原样发文件。
            if (target.replace(/\\/g, '/').endsWith('/index.html')) {
                return sendIndex(reply, token, await readFile(target, 'utf8'), ancestors);
            }
            const data = await readFile(target);
            return reply
                .header('content-type', MIME[extname(target)] ?? 'application/octet-stream')
                .header('cache-control', 'no-store')
                .send(data);
        }
        const indexHtml = join(assetsRoot, 'index.html');
        const info = await stat(indexHtml).catch(() => null);
        if (info === null)
            return reply.code(503).type('text/html; charset=utf-8').send('<h1>工作台尚未构建</h1>');
        const html = await readFile(indexHtml, 'utf8');
        return sendIndex(reply, token, html, ancestors);
    });
    fastify.setErrorHandler((error, _request, reply) => {
        const code = error.code ?? 'INTERNAL_ERROR';
        return fail(reply, code, error.message, {});
    });
    fastify.addHook('onListen', async () => {
        const address = fastify.server.address();
        const port = typeof address === 'object' && address !== null ? address.port : 0;
        baseUrl = 'http://127.0.0.1:' + port;
    });
    return fastify;
}

const VERSION = '0.1.2-studio';
async function ensureWritable(path) {
    try {
        await mkdir(path, { recursive: true });
        const probe = join(path, '.write-test-' + randomBytes(4).toString('hex'));
        await writeFile(probe, 'ok', 'utf8');
        await rm(probe, { force: true });
        return true;
    }
    catch {
        return false;
    }
}
async function pickDataRoot() {
    const candidates = [];
    const fromEnv = process.env.ZAOWAN_DATA_DIR;
    if (fromEnv !== undefined && fromEnv.length > 0)
        candidates.push(resolve(fromEnv));
    const local = process.env.LOCALAPPDATA;
    if (local !== undefined && local.length > 0)
        candidates.push(join(local, 'ZaowanWorkshop'));
    const roaming = process.env.APPDATA;
    if (roaming !== undefined && roaming.length > 0)
        candidates.push(join(roaming, 'ZaowanWorkshop'));
    candidates.push(join(homedir(), '.zaowan-workshop'));
    candidates.push(join(tmpdir(), 'ZaowanWorkshop'));
    candidates.push(join(process.cwd(), 'zaowan-data'));
    for (const candidate of candidates) {
        if (await ensureWritable(candidate))
            return candidate;
    }
    throw new Error('找不到可写的数据目录。请设置 ZAOWAN_DATA_DIR 指向一个可写目录后重试。已尝试：' + candidates.join(', '));
}
async function main() {
    const repoRoot = process.cwd();
    const root = await pickDataRoot();
    const storage = new Storage({ dataRoot: root, repoRoot });
    await storage.init();
    const recovered = await storage.markInterruptedRuns();
    if (recovered > 0) {
        console.log('已把 ' + recovered + ' 个重启前未结束的任务标记为 cancelled（不会自动重发模型请求）。');
    }
    const token = randomBytes(24).toString('hex');
    const port = Number(process.env.ZAOWAN_PORT ?? '0');
    // 默认只听回环；只有在容器等隔离环境里显式设置 ZAOWAN_HOST=0.0.0.0 才对外网卡开放。
    const host = process.env.ZAOWAN_HOST ?? '127.0.0.1';
    const external = host !== '127.0.0.1' && host !== 'localhost';
    const server = await createServer({
        storage,
        token,
        repoRoot,
        webDist: join(repoRoot, 'apps', 'web', 'dist'),
        playerDist: join(repoRoot, 'apps', 'player', 'dist'),
        version: VERSION,
        allowExternalHosts: external,
    });
    await server.listen({ port: Number.isFinite(port) ? port : 0, host });
    const address = server.server.address();
    const actualPort = typeof address === 'object' && address !== null ? address.port : 0;
    const url = 'http://127.0.0.1:' + actualPort + '/';
    console.log('造玩工坊工作台已启动，监听 ' + host + ':' + actualPort + (host === '0.0.0.0' ? '（对外，含 ' + url + '）' : '：' + url));
    console.log('数据目录：' + root);
    if (process.env.ZAOWAN_QUIET !== '1') {
        console.log('会话令牌只在本进程内存中；重启后会变化。');
    }
    if (process.env.ZAOWAN_OPEN === '1') {
        try {
            const { spawn } = await import('node:child_process');
            spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
        }
        catch {
            console.log('无法自动打开浏览器，请手动访问上面的地址。');
        }
    }
    const shutdown = async () => {
        await server.close().catch(() => undefined);
        process.exit(0);
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
}
main().catch((error) => {
    console.error('启动失败：' + (error instanceof Error ? error.message : String(error)));
    process.exit(1);
});
