import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const progression = JSON.parse(readFileSync(new URL('data/progression.json', root), 'utf8'));
const entityGroups = JSON.parse(readFileSync(new URL('data/entities.json', root), 'utf8')).entities;
const entityTypes = new Map(Object.values(entityGroups).flat().map(entity => [entity.id, entity.type]));
const directions = [['up', -1, 0], ['down', 1, 0], ['left', 0, -1], ['right', 0, 1]];

function prepare(macro, index) {
  const micro = macro.level_package.micro_levels[0];
  const entries = (micro.micro_space?.zones || []).flatMap(zone => zone.entities_in_zone || []);
  const tileMap = micro.tile_map;
  const sourceGrid = tileMap.grid;
  const legend = tileMap.legend;
  const targets = sourceGrid.flatMap(row => [...row]).filter(symbol => symbol === 'T').length;
  const boxEntries = entries.filter(entry => entityTypes.get(entry.entity_id) === 'pushable');
  let grid = sourceGrid.map(row => [...row]);
  let playerEntry = entries.find(entry => entityTypes.get(entry.entity_id) === 'player');
  let boxes = boxEntries.map(({ entity_id: id, row, col }) => ({ id, row, col }));

  if (index === 2 || index >= 5 || !boxes.length || boxes.length !== targets || boxEntries.some(entry => (entry.instance_count || 1) > 1)) {
    const rows = tileMap.rows || sourceGrid.length;
    const cols = tileMap.cols || sourceGrid[0].length;
    const count = Math.min(targets, cols - 2, rows - 4);
    const floor = legend.C ? 'C' : Object.keys(legend).find(symbol => legend[symbol] !== 'empty' && symbol !== 'O' && symbol !== 'T') || 'C';
    const startCol = Math.max(1, Math.floor((cols - count) / 2));
    grid = Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) =>
      row === 0 || col === 0 || row === rows - 1 || col === cols - 1 ? 'O' : floor));
    const boxId = boxEntries[0]?.entity_id || (index === 6 || index === 7 ? 'entity_003' : 'entity_002');
    boxes = Array.from({ length: count }, (_, i) => {
      grid[1][startCol + i] = 'T';
      return { id: boxId, row: 2, col: startCol + i };
    });
    playerEntry = { row: 3, col: startCol };
  }

  const walls = new Set();
  const goals = new Set();
  grid.forEach((row, r) => row.forEach((symbol, c) => {
    if (symbol === 'O') walls.add(`${r},${c}`);
    if (symbol === 'T') goals.add(`${r},${c}`);
  }));
  return {
    id: macro.macro_level_id,
    index,
    rows: grid.length,
    cols: grid[0].length,
    player: { row: playerEntry.row, col: playerEntry.col },
    boxes,
    walls,
    goals,
    moveLimit: micro.resource_limits?.move_limit || 999
  };
}

function solve(level) {
  const keyOf = state => `${state.player.row},${state.player.col}|${state.boxes.map(box => `${box.id}:${box.row},${box.col}`).sort().join(';')}|${[...state.cracks].sort().join(';')}`;
  const start = { player: level.player, boxes: level.boxes, cracks: new Set() };
  const startKey = keyOf(start);
  const queue = [start];
  const parents = new Map([[startKey, null]]);
  const isBlocked = (row, col, boxes, cracks) => row < 0 || row >= level.rows || col < 0 || col >= level.cols ||
    level.walls.has(`${row},${col}`) || cracks.has(`${row},${col}`);

  for (let cursor = 0; cursor < queue.length && cursor < 500_000; cursor++) {
    const state = queue[cursor];
    const stateKey = keyOf(state);
    if (state.boxes.length === level.goals.size && state.boxes.every(box => level.goals.has(`${box.row},${box.col}`))) {
      const path = [];
      let key = stateKey;
      while (parents.get(key)) {
        const [previous, direction] = parents.get(key);
        path.push(direction);
        key = previous;
      }
      return path.reverse();
    }

    for (const [direction, dr, dc] of directions) {
      const row = state.player.row + dr;
      const col = state.player.col + dc;
      if (isBlocked(row, col, state.boxes, state.cracks)) continue;
      const boxIndex = state.boxes.findIndex(box => box.row === row && box.col === col);
      let boxes = state.boxes;
      let cracks = state.cracks;
      if (boxIndex >= 0) {
        let boxRow = row + dr;
        let boxCol = col + dc;
        if (isBlocked(boxRow, boxCol, boxes, cracks) || boxes.some((box, i) => i !== boxIndex && box.row === boxRow && box.col === boxCol)) continue;
        if (boxes[boxIndex].id === 'entity_003') {
          while (!isBlocked(boxRow + dr, boxCol + dc, boxes, cracks) && !boxes.some((box, i) => i !== boxIndex && box.row === boxRow + dr && box.col === boxCol + dc)) {
            boxRow += dr;
            boxCol += dc;
          }
        }
        boxes = boxes.map((box, i) => i === boxIndex ? { ...box, row: boxRow, col: boxCol } : box);
        if (level.index >= 2) {
          cracks = new Set(cracks);
          cracks.add(`${row},${col}`);
        }
      }
      const next = { player: { row, col }, boxes, cracks };
      const nextKey = keyOf(next);
      if (!parents.has(nextKey)) {
        parents.set(nextKey, [stateKey, direction]);
        queue.push(next);
      }
    }
  }
  return null;
}

for (const [index, macro] of progression.entries()) {
  test(`${macro.macro_level_id} has a playable, solvable board`, () => {
    const level = prepare(macro, index);
    assert.equal(level.boxes.length, level.goals.size, 'each target needs exactly one parcel');
    assert.ok(level.boxes.every(box => !level.walls.has(`${box.row},${box.col}`)), 'no parcel starts in a wall');
    assert.ok(!level.walls.has(`${level.player.row},${level.player.col}`), 'player starts on a walkable cell');
    const solution = solve(level);
    assert.ok(solution, 'no winning route found');
    if (process.env.SHOW_SOLUTIONS === '1') console.log(`${level.id}: ${solution.join(',')}`);
    assert.ok(solution.length <= level.moveLimit, `solution exceeds the ${level.moveLimit}-move limit`);
  });
}
