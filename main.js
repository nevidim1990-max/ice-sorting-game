(() => {
  'use strict';

  const pack = window.GAME_PACKAGE;
  const $ = id => document.getElementById(id);
  const allEntities = Object.values(pack.entities.entities).flat();
  const definitions = new Map(allEntities.map(entity => [entity.id, entity]));
  const assetByRef = new Map(pack.assetSpec.map(asset => [asset.reference_id, asset]));
  const storageKey = 'ice-sorting-save-v2';
  const defaults = { unlocked: 0, cleared: {}, best: {}, currency: 0, muted: false, introSeen: false, tutorialSeen: false };
  let save;
  try {
    const stored = localStorage.getItem(storageKey) ?? localStorage.getItem('ice-sorting-save-v1') ?? '{}';
    save = { ...defaults, ...JSON.parse(stored) };
  }
  catch { save = { ...defaults }; }
  const persist = () => {
    try {
      if (state && activeLevel && ['playing', 'paused'].includes(screen) && !state.finished) {
        save.run = {
          levelId: activeLevel.id, player: { ...state.player }, boxes: state.boxes.map(box => ({ ...box })),
          items: state.items.map(item => ({ ...item })), cracks: [...state.cracks], moves: state.moves,
          pushes: state.pushes, undos: state.undos, bonusUndos: state.bonusUndos, collected: state.collected
        };
      } else if (screen === 'result') save.run = null;
      localStorage.setItem(storageKey, JSON.stringify(save));
    } catch {}
  };
  const getAsset = id => assetByRef.get(id);

  function parseLevel(macro, index) {
    const micro = macro.level_package?.micro_levels?.[0];
    if (!micro) return { index, id: macro.macro_level_id, title: macro.macro_level_id, error: 'Нет данных участка' };
    const entries = (micro.micro_space?.zones || []).flatMap(zone => zone.entities_in_zone || []);
    const playerDef = id => definitions.get(id)?.type === 'player';
    const boxDef = id => definitions.get(id)?.type === 'pushable';
    const itemDef = id => definitions.get(id)?.type === 'resource';
    const playerEntry = entries.find(entry => playerDef(entry.entity_id));
    const boxEntries = entries.filter(entry => boxDef(entry.entity_id));
    const itemEntries = entries.filter(entry => itemDef(entry.entity_id));
    const tileMap = micro.tile_map;
    const sourceGrid = tileMap?.grid || [];
    const legend = tileMap?.legend || {};
    const targetCount = sourceGrid.flatMap(row => [...row]).filter(symbol => symbol === 'T').length;
    const needsLayoutRepair = index === 2 || index >= 5 || !boxEntries.length || boxEntries.length !== targetCount || boxEntries.some(entry => (entry.instance_count || 1) > 1);
    let grid = sourceGrid;
    let player = playerEntry && { row: playerEntry.row, col: playerEntry.col };
    let boxPlacements = boxEntries.map(entry => ({ id: entry.entity_id, row: entry.row, col: entry.col }));
    let itemPlacements = itemEntries.map(entry => ({ id: entry.entity_id, row: entry.row, col: entry.col }));
    if (needsLayoutRepair && tileMap && targetCount) {
      const rows = tileMap.rows || sourceGrid.length;
      const cols = tileMap.cols || sourceGrid[0]?.length || 0;
      const count = Math.min(targetCount, cols - 2, rows - 4);
      const floorSymbol = legend.C ? 'C' : Object.keys(legend).find(symbol => legend[symbol] !== 'empty' && symbol !== 'O' && symbol !== 'T') || 'C';
      const startCol = Math.max(1, Math.floor((cols - count) / 2));
      grid = Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) =>
        row === 0 || col === 0 || row === rows - 1 || col === cols - 1 ? 'O' : floorSymbol));
      for (let i = 0; i < count; i++) {
        grid[1][startCol + i] = 'T';
        boxPlacements[i] = { id: boxEntries[0]?.entity_id || (index === 6 || index === 7 ? 'entity_003' : 'entity_002'), row: 2, col: startCol + i };
      }
      boxPlacements.length = count;
      player = { row: 3, col: startCol };
      itemPlacements = itemEntries.map((entry, i) => ({
        id: entry.entity_id, row: rows - 2, col: cols - 2 - i
      })).filter(entry => entry.col > 0 && entry.col < cols - 1 && entry.col !== player.col);
    }
    const cells = grid.map(row => [...row].map(symbol => ({
      symbol,
      asset: legend[symbol] === 'empty' ? null : legend[symbol],
      wall: symbol === 'O',
      goal: symbol === 'T'
    })));
    const boxes = boxPlacements;
    const items = itemPlacements.map(entry => ({ ...entry, collected: false }));
    let error = '';
    if (!tileMap || !cells.length) error = 'Нет карты клеток';
    else if (!player) error = 'Не задан сортировщик';
    else if (!boxes.length) error = 'В данных нет посылок';
    else if (!cells.some(row => row.some(cell => cell.goal))) error = 'На карте нет ячеек';
    else if (boxes.length !== cells.flat().filter(cell => cell.goal).length) error = 'Число посылок не совпадает с числом ячеек';
    else if ([player, ...boxes].some(pos => !cells[pos.row]?.[pos.col] || cells[pos.row][pos.col].wall)) error = 'Игровой объект поставлен в стену';
    const refs = new Set([
      ...Object.values(legend).filter(id => id !== 'empty'),
      ...entries.map(entry => entry.entity_id),
      ...boxes.map(box => box.id),
      ...(micro.parallax_layers || []).map(entry => entry.entity_id),
      ...(micro.decorative_layout || []).map(entry => entry.entity_id)
    ]);
    const missing = [...refs].filter(ref => definitions.get(ref)?.has_visual && !getAsset(ref));
    if (!error && missing.length) error = `Нет записи ассета: ${missing[0]}`;
    return {
      index, id: macro.macro_level_id, title: micro.title || macro.macro_level_id,
      micro, cells, rows: cells.length, cols: cells[0]?.length || 0,
      player, boxes, items, moveLimit: micro.resource_limits?.move_limit || 999,
      undoLimit: micro.resource_limits?.undo_limit || 0,
      targetCount: cells.flat().filter(cell => cell.goal).length, refs: [...refs], error,
      repaired: needsLayoutRepair
    };
  }

  const levels = pack.progression.map(parseLevel);
  const initialText = pack.theme.onboarding_text || pack.theme.core_concept || '';
  $('onboarding').textContent = initialText;
  $('lore-intro').textContent = pack.lore.world_context.world_premise.concept;
  $('mute').textContent = save.muted ? '×' : '♫';

  let scene;
  let screen = 'menu';
  let activeLevel = null;
  let state = null;
  let history = [];
  let gameActive = false;
  let toastTimer;
  let audio;

  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1900);
  }

  function sound(name) {
    if (save.muted) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const now = audio.currentTime;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = name === 'push' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(name === 'win' ? 640 : name === 'push' ? 260 : 440, now);
      gain.gain.setValueAtTime(0.035, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + (name === 'win' ? 0.22 : 0.08));
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(now);
      oscillator.stop(now + (name === 'win' ? 0.22 : 0.08));
    } catch {}
  }

  function showOverlay(id) {
    document.querySelectorAll('.overlay').forEach(node => node.classList.toggle('active', node.id === id));
  }

  function fitGameCanvas(attempt = 0) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (scene?.fitCanvas()) return;
      if (attempt < 3) fitGameCanvas(attempt + 1);
    }));
  }

  function showMenu() {
    screen = 'menu';
    gameActive = false;
    $('app').classList.remove('in-game');
    fitGameCanvas();
    showOverlay(null);
    $('intro-copy').hidden = false;
    $('game-side').hidden = true;
    $('hud').classList.remove('active');
    $('tools').classList.remove('active');
    $('station-state').textContent = 'Станция готова';
    $('station-code').textContent = 'NORTH / 01';
    $('continue').hidden = !save.run;
    persist();
    scene?.preview();
  }

  function openLevels() {
    screen = 'levels';
    renderLevelList();
    showOverlay('levels');
  }

  function renderLevelList() {
    const list = $('level-list');
    list.replaceChildren();
    levels.forEach((level, index) => {
      const card = document.createElement('button');
      const locked = index > save.unlocked;
      card.className = `level-card${locked ? ' locked' : ''}${level.error ? ' broken' : ''}${save.cleared[level.id] ? ' cleared' : ''}`;
      const heading = document.createElement('strong');
      heading.textContent = `${String(index + 1).padStart(2, '0')} · ${level.title}`;
      const detail = document.createElement('small');
      detail.textContent = level.error ? `Данные требуют исправления: ${level.error}` : save.cleared[level.id] ? 'Участок пройден' : locked ? 'Сначала завершите предыдущий' : `${level.boxes.length} посылки · ${level.targetCount} ячейки`;
      card.append(heading, detail);
      card.disabled = locked || Boolean(level.error);
      card.onclick = () => startLevel(index);
      list.append(card);
    });
  }

  function startLevel(index) {
    const level = levels[index];
    if (!level || level.error) { toast(level?.error || 'Участок недоступен'); return; }
    activeLevel = level;
    screen = 'playing';
    gameActive = true;
    $('app').classList.add('in-game');
    fitGameCanvas();
    history = [];
    state = {
      player: { ...level.player }, boxes: level.boxes.map(box => ({ ...box })),
      items: level.items.map(item => ({ ...item })), cracks: new Set(),
      moves: 0, pushes: 0, undos: 0, bonusUndos: 0, collected: 0, finished: false
    };
    $('intro-copy').hidden = true;
    $('game-side').hidden = false;
    $('level-kicker').textContent = `Участок ${String(index + 1).padStart(2, '0')} · Смена`;
    $('level-title').textContent = level.title;
    $('station-title').textContent = level.title;
    $('level-objective').textContent = 'Поставьте каждую посылку на светящуюся ячейку-цель.';
    $('station-state').textContent = 'Сортировка идёт';
    $('station-code').textContent = `NORTH / ${String(index + 1).padStart(2, '0')}`;
    $('status-line').textContent = level.index >= 2 ? 'Осторожно: тонкий лёд запоминает толчки' : 'Поставьте каждую посылку в ячейку';
    showOverlay(null);
    $('hud').classList.add('active');
    $('tools').classList.add('active');
    scene.loadLevel(level, state).then(updateHud).catch(error => {
      screen = 'levels'; gameActive = false; showOverlay('levels');
      toast(`Не удалось загрузить ассет: ${error.message}`);
    });
    updateHud();
    persist();
    if (index === 0 && !save.tutorialSeen) {
      gameActive = false;
      screen = 'tutorial';
      showOverlay('tutorial-screen');
    }
  }

  function resumeGame() {
    const run = save.run;
    const level = levels.find(entry => entry.id === run?.levelId);
    if (!run || !level || level.error) { save.run = null; showMenu(); return; }
    activeLevel = level;
    state = {
      player: { ...(run.player || level.player) },
      boxes: (run.boxes || level.boxes).map(box => ({ ...box })),
      items: (run.items || level.items).map(item => ({ ...item })), cracks: new Set(run.cracks || []),
      moves: run.moves || 0, pushes: run.pushes || 0, undos: run.undos || 0,
      bonusUndos: run.bonusUndos || 0, collected: run.collected || 0, finished: false
    };
    screen = 'playing'; gameActive = true; history = [];
    $('app').classList.add('in-game');
    fitGameCanvas();
    $('intro-copy').hidden = true; $('game-side').hidden = false;
    $('level-kicker').textContent = `Участок ${String(level.index + 1).padStart(2, '0')} · Смена`;
    $('level-title').textContent = level.title;
    $('station-title').textContent = level.title;
    $('level-objective').textContent = 'Поставьте каждую посылку на светящуюся ячейку-цель.';
    $('station-state').textContent = 'Сортировка идёт';
    $('station-code').textContent = `NORTH / ${String(level.index + 1).padStart(2, '0')}`;
    showOverlay(null); $('hud').classList.add('active'); $('tools').classList.add('active');
    scene.loadLevel(level, state).then(updateHud).catch(error => toast(`Не удалось открыть поле: ${error.message}`));
    updateHud();
  }

  function snapshot() {
    return {
      player: { ...state.player }, boxes: state.boxes.map(box => ({ ...box })),
      items: state.items.map(item => ({ ...item })), cracks: new Set(state.cracks),
      moves: state.moves, pushes: state.pushes, collected: state.collected, bonusUndos: state.bonusUndos
    };
  }

  function restore(snap) {
    Object.assign(state, snap);
    state.undos++;
    scene.updateActors(state, true);
    updateHud();
    persist();
    sound('click');
  }

  function cellAt(row, col) { return activeLevel?.cells[row]?.[col]; }
  function boxAt(row, col) { return state?.boxes.findIndex(box => box.row === row && box.col === col) ?? -1; }
  function isBlocked(row, col) {
    const cell = cellAt(row, col);
    return !cell || cell.wall || state.cracks.has(`${row},${col}`);
  }

  function attemptMove(direction) {
    if (!gameActive || screen !== 'playing' || !state || state.finished) return;
    sound('click');
    const delta = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] }[direction];
    if (!delta) return;
    const [dr, dc] = delta;
    const { row, col } = state.player;
    const nr = row + dr, nc = col + dc;
    if (isBlocked(nr, nc)) return;
    const boxIndex = boxAt(nr, nc);
    let finalBox = null;
    if (boxIndex >= 0) {
      let br = nr + dr, bc = nc + dc;
      if (isBlocked(br, bc) || boxAt(br, bc) >= 0) return;
      finalBox = { row: br, col: bc };
      if (state.boxes[boxIndex].id === 'entity_003') {
        while (!isBlocked(finalBox.row + dr, finalBox.col + dc) && boxAt(finalBox.row + dr, finalBox.col + dc) < 0) {
          finalBox.row += dr; finalBox.col += dc;
        }
      }
    }
    history.push(snapshot());
    if (history.length > 100) history.shift();
    if (boxIndex >= 0) {
      state.boxes[boxIndex] = { ...state.boxes[boxIndex], ...finalBox };
      state.pushes++;
      if (activeLevel.index >= 2) state.cracks.add(`${nr},${nc}`);
      sound('push');
    }
    state.player = { row: nr, col: nc };
    state.moves++;
    const item = state.items.find(entry => !entry.collected && entry.row === nr && entry.col === nc);
    if (item) {
      item.collected = true;
      if (item.id === 'entity_007' || item.id === 'resource_001') state.bonusUndos++;
      else { state.collected++; save.currency += 1; }
      sound('collect');
      toast(definitions.get(item.id)?.name || 'Награда получена');
      persist();
    }
    scene.updateActors(state, false);
    updateHud();
    persist();
    const goalCount = activeLevel.targetCount;
    if (state.boxes.length === goalCount && state.boxes.every(box => cellAt(box.row, box.col)?.goal)) finishLevel(true);
    else if (state.moves >= activeLevel.moveLimit) finishLevel(false);
  }

  function undoMove() {
    if (!gameActive || screen !== 'playing') return;
    if (!history.length) { toast('Пока нечего отогревать'); return; }
    if (state.undos >= activeLevel.undoLimit + state.bonusUndos) { toast('Горячие жетоны закончились'); return; }
    restore(history.pop());
    toast('Последний ход отогрет');
  }

  function updateHud() {
    if (!state || !activeLevel) return;
    $('hud-level').textContent = String(activeLevel.index + 1).padStart(2, '0');
    $('hud-moves').textContent = `${state.moves}/${activeLevel.moveLimit}`;
    $('hud-pushes').textContent = state.pushes;
    $('hud-undo').textContent = `${Math.max(0, activeLevel.undoLimit + state.bonusUndos - state.undos)}`;
    const placed = state.boxes.filter(box => cellAt(box.row, box.col)?.goal).length;
    $('progress').style.width = `${Math.round(100 * placed / Math.max(1, state.boxes.length))}%`;
    $('undo').disabled = !history.length || state.undos >= activeLevel.undoLimit + state.bonusUndos;
  }

  function finishLevel(won) {
    if (state.finished) return;
    state.finished = true;
    gameActive = false;
    screen = 'result';
    save.run = null;
    sound(won ? 'win' : 'fail');
    $('result-kicker').textContent = won ? 'Участок разобран' : 'Проход замёрз';
    $('result-title').textContent = won ? 'Посылки на месте.' : 'Лимит толчков исчерпан.';
    if (won) {
      save.cleared[activeLevel.id] = true;
      save.unlocked = Math.max(save.unlocked, Math.min(levels.length - 1, activeLevel.index + 1));
      save.best[activeLevel.id] = Math.min(save.best[activeLevel.id] || Infinity, state.moves);
      if (activeLevel.index === levels.length - 1) save.campaignComplete = true;
      const lastTwo = state.pushes % 100, last = state.pushes % 10;
      const pushWord = last === 1 && lastTwo !== 11 ? 'толчок' : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'толчка' : 'толчков';
      $('result-body').textContent = `Участок ${activeLevel.index + 1} закрыт за ${state.moves} ходов и ${state.pushes} ${pushWord}. Ледяных искр: ${save.currency}.`;
    } else {
      $('result-body').textContent = 'Можно отогреть последний ход или начать участок заново. Карта останется прежней.';
    }
    $('next').textContent = activeLevel.index === levels.length - 1 ? 'Завершить смену' : 'Следующий участок';
    $('next').disabled = !won;
    $('station-state').textContent = won ? 'Участок разобран' : 'Нужен новый план';
    $('hud').classList.remove('active'); $('tools').classList.remove('active');
    showOverlay('result-screen');
    persist();
  }

  function updateMute() {
    $('mute').textContent = save.muted ? '×' : '♫';
    $('mute').setAttribute('aria-label', save.muted ? 'Включить звук' : 'Выключить звук');
    $('settings-mute').textContent = save.muted ? 'Включить звук' : 'Выключить звук';
    persist();
  }

  class BoardScene extends Phaser.Scene {
    constructor() { super({ key: 'board' }); this.actorObjects = []; this.tileObjects = []; this.extraObjects = []; }
    create() {
      this.input.on('pointerdown', pointer => { this.touchStart = { x: pointer.x, y: pointer.y }; sound('click'); });
      this.input.on('pointerup', pointer => {
        if (!this.touchStart || !gameActive) return;
        const dx = pointer.x - this.touchStart.x, dy = pointer.y - this.touchStart.y;
        this.touchStart = null;
        if (Math.max(Math.abs(dx), Math.abs(dy)) > 22) attemptMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
        else this.tapCell(pointer.x, pointer.y);
      });
      this.scale.on('resize', () => { if (activeLevel) this.layoutBoard(); });
      if (activeLevel && state) this.loadLevel(activeLevel, state).catch(error => toast(`Не удалось открыть поле: ${error.message}`));
      else this.preview();
    }
    async texture(ref) {
      const key = `asset:${ref}`;
      if (this.textures.exists(key)) return key;
      const asset = getAsset(ref);
      if (!asset) throw new Error(ref);
      await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => { this.textures.addImage(key, image); resolve(); };
        image.onerror = () => reject(new Error(ref));
        image.src = `./assets/${asset.unique_asset_id}.png`;
      });
      return key;
    }
    async loadLevel(level, nextState) {
      activeLevel = level; state = nextState;
      await Promise.all(level.refs.map(ref => this.texture(ref)));
      this.fitCanvas();
      this.renderBoard();
    }
    fitCanvas() {
      if (!this.scale?.resize) return false;
      const { width, height } = $('game-canvas').getBoundingClientRect();
      if (width <= 0 || height <= 0) return false;
      const changed = this.scale.width !== width || this.scale.height !== height;
      if (changed) this.scale.resize(width, height);
      return changed;
    }
    clear() { this.children.removeAll(true); this.actorObjects = []; this.tileObjects = []; this.extraObjects = []; }
    preview() {
      if (!this.sys.isActive()) return;
      if (activeLevel && state) this.renderBoard();
    }
    layoutBoard() {
      if (activeLevel && state) this.renderBoard();
    }
    renderBoard() {
      this.clear();
      const width = this.scale.width, height = this.scale.height;
      this.add.rectangle(width / 2, height / 2, width, height, 0x081720, 0.2).setDepth(-120);
      const horizontalMargin = Math.min(80, Math.max(16, width * .04));
      const verticalMargin = Math.min(150, Math.max(64, height * .18));
      const cellSize = Math.floor(Math.min((width - horizontalMargin) / activeLevel.cols, (height - verticalMargin) / activeLevel.rows, 136));
      const boardW = cellSize * activeLevel.cols, boardH = cellSize * activeLevel.rows;
      this.origin = { x: (width - boardW) / 2, y: (height - boardH) / 2, cell: cellSize };
      this.add.rectangle(width / 2, height / 2, boardW + 30, boardH + 30, 0x0c2732, .82).setStrokeStyle(1, 0x85cedb, .24).setDepth(-4);
      for (let row = 0; row < activeLevel.rows; row++) for (let col = 0; col < activeLevel.cols; col++) {
        const cell = cellAt(row, col), x = this.origin.x + (col + .5) * cellSize, y = this.origin.y + (row + .5) * cellSize;
        const key = cell.asset && `asset:${cell.asset}`;
        this.add.rectangle(x, y, cellSize - 2, cellSize - 2, 0x09232d).setStrokeStyle(2, 0x79bac9, .8).setDepth(-1);
        if (key && this.textures.exists(key)) this.add.image(x, y, key).setDisplaySize(cellSize - 8, cellSize - 8).setDepth(0);
        else this.add.rectangle(x, y, cellSize - 8, cellSize - 8, cell.wall ? 0x243943 : cell.goal ? 0xd08037 : 0x39899a).setDepth(0);
        if (cell.wall) this.add.rectangle(x, y, cellSize - 8, cellSize - 8, 0x03121a, .58).setDepth(1);
        this.tileObjects.push({ x, y, row, col });
      }
      for (const deco of activeLevel.micro.decorative_layout || []) {
        const key = `asset:${deco.entity_id}`;
        if (!this.textures.exists(key)) continue;
        const x = this.origin.x + ((deco.col ?? 0) + .5) * cellSize;
        const y = this.origin.y + ((deco.row ?? 0) + .5) * cellSize;
        this.add.image(x, y, key).setDisplaySize(cellSize * .78, cellSize * .78).setAlpha(.18).setDepth(1);
      }
      const frame = this.add.graphics().setDepth(2);
      frame.lineStyle(2, 0x8dc5d1, .33).strokeRoundedRect(this.origin.x - 4, this.origin.y - 4, boardW + 8, boardH + 8, 11);
      this.updateActors(state, true);
    }
    point(row, col) { return { x: this.origin.x + (col + .5) * this.origin.cell, y: this.origin.y + (row + .5) * this.origin.cell }; }
    addActor(ref, row, col, size, depth, kind) {
      const pos = this.point(row, col), key = `asset:${ref}`;
      const shadow = this.add.ellipse(pos.x, pos.y + size * .25, size * .58, size * .18, 0x020b10, .24).setDepth(depth - 1);
      const actor = this.textures.exists(key) ? this.add.image(pos.x, pos.y, key) : this.add.rectangle(pos.x, pos.y, size * .7, size * .7, kind === 'player' ? 0xe6a15f : 0x6fc8df);
      actor.setDisplaySize(size, size).setDepth(depth);
      if (kind === 'player' || kind === 'box') this.tweens.add({ targets: actor, y: pos.y - (kind === 'player' ? 2 : 1), duration: kind === 'player' ? 1050 : 1550, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      const record = { actor, shadow, row, col, kind, itemId: ref };
      this.actorObjects.push(record);
      return record;
    }
    updateActors(nextState, instant) {
      if (!this.origin || !nextState) return;
      if (this.actorObjects.length) {
        this.actorObjects.forEach(({ actor, shadow }) => { actor.destroy(); shadow.destroy(); });
        this.actorObjects = [];
      }
      const cell = this.origin.cell;
      this.addActor('entity_001', nextState.player.row, nextState.player.col, cell * .76, 8, 'player');
      nextState.boxes.forEach(box => this.addActor(box.id, box.row, box.col, cell * .72, 7, 'box'));
      nextState.items.filter(item => !item.collected).forEach(item => this.addActor(item.id, item.row, item.col, cell * .43, 6, 'item'));
      this.drawCracks(nextState);
    }
    drawCracks(nextState) {
      if (this.crackGraphics) this.crackGraphics.destroy();
      this.crackGraphics = this.add.graphics().setDepth(5);
      for (const code of nextState.cracks) {
        const [row, col] = code.split(',').map(Number), p = this.point(row, col), s = this.origin.cell;
        this.crackGraphics.fillStyle(0x8be6ee, .16).fillRect(p.x - s / 2, p.y - s / 2, s, s);
        this.crackGraphics.lineStyle(2, 0xb7f4f5, .8).beginPath().moveTo(p.x - 10, p.y - 18).lineTo(p.x + 2, p.y - 2).lineTo(p.x - 5, p.y + 4).lineTo(p.x + 13, p.y + 19).strokePath();
      }
    }
    tapCell(x, y) {
      if (!state || !gameActive || !this.origin) return;
      const col = Math.floor((x - this.origin.x) / this.origin.cell), row = Math.floor((y - this.origin.y) / this.origin.cell);
      const dr = row - state.player.row, dc = col - state.player.col;
      if (Math.abs(dr) + Math.abs(dc) === 1) attemptMove(dr ? (dr < 0 ? 'up' : 'down') : (dc < 0 ? 'left' : 'right'));
    }
  }

  function bind() {
    $('play').onclick = () => save.introSeen ? openLevels() : showOverlay('intro');
    $('intro-go').onclick = $('intro-skip').onclick = () => { save.introSeen = true; persist(); openLevels(); };
    $('open-levels').onclick = openLevels;
    $('continue').onclick = resumeGame;
    $('levels-close').onclick = () => { showOverlay(null); screen = 'menu'; };
    $('mute').onclick = () => { save.muted = !save.muted; updateMute(); sound('click'); };
    $('settings-mute').onclick = () => { save.muted = !save.muted; updateMute(); };
    $('settings').onclick = () => showOverlay('settings-screen');
    $('about').onclick = () => showOverlay('about-screen');
    $('about-close').onclick = () => showOverlay(null);
    $('settings-close').onclick = () => showOverlay(null);
    $('tutorial-start').onclick = () => {
      save.tutorialSeen = true; screen = 'playing'; gameActive = true; showOverlay(null); persist();
    };
    $('undo').onclick = undoMove;
    $('restart').onclick = () => startLevel(activeLevel.index);
    $('pause').onclick = () => { screen = 'paused'; gameActive = false; persist(); showOverlay('pause-screen'); };
    $('resume').onclick = () => { screen = 'playing'; gameActive = true; persist(); showOverlay(null); };
    $('pause-mute').onclick = () => { save.muted = !save.muted; updateMute(); };
    $('pause-restart').onclick = () => startLevel(activeLevel.index);
    $('pause-menu').onclick = showMenu;
    $('back-menu').onclick = showMenu;
    $('retry').onclick = () => startLevel(activeLevel.index);
    $('result-menu').onclick = showMenu;
    $('next').onclick = () => {
      if (activeLevel.index < levels.length - 1) startLevel(activeLevel.index + 1);
      else { screen = 'postgame'; showOverlay('postgame-screen'); }
    };
    $('postgame-menu').onclick = showMenu;
    $('postgame-replay').onclick = () => startLevel(0);
    window.addEventListener('keydown', event => {
      const dir = { ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down', ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right' }[event.key];
      if (dir && gameActive) { event.preventDefault(); attemptMove(dir); }
      else if ((event.key === 'z' || event.key === 'Z' || event.key === 'Backspace') && gameActive) { event.preventDefault(); undoMove(); }
      else if ((event.key === 'r' || event.key === 'R') && gameActive) startLevel(activeLevel.index);
      else if (event.key === 'Escape') {
        if (screen === 'playing') { screen = 'paused'; gameActive = false; persist(); showOverlay('pause-screen'); }
        else if (screen === 'paused') { screen = 'playing'; gameActive = true; persist(); showOverlay(null); }
        else if (screen === 'levels') { showOverlay(null); screen = 'menu'; }
        else if (['intro', 'about-screen', 'settings-screen', 'tutorial-screen', 'postgame-screen'].includes(document.querySelector('.overlay.active')?.id)) { showOverlay(null); screen = 'menu'; }
      }
    });
  }

  function boot() {
    const first = levels.find(level => !level.error) || levels[0];
    activeLevel = first;
    state = first && !first.error ? {
      player: { ...first.player }, boxes: first.boxes.map(box => ({ ...box })),
      items: first.items.map(item => ({ ...item })), cracks: new Set(), moves: 0, pushes: 0,
      undos: 0, bonusUndos: 0, collected: 0, finished: false
    } : null;
    scene = new BoardScene();
    new Phaser.Game({
      type: Phaser.AUTO, parent: 'game-canvas', width: 1280, height: 720,
      backgroundColor: '#091720', transparent: true,
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
      render: { antialias: true, pixelArt: false, powerPreference: 'high-performance' },
      resolution: Math.min(2, window.devicePixelRatio || 1), scene: [scene]
    });
    bind();
    updateMute();
    showMenu();
    if (levels.some(level => level.error)) $('status-line').textContent = 'Некоторые участки скрыты: в исходных данных есть ошибки';
  }

  window.addEventListener('load', boot, { once: true });
})();
