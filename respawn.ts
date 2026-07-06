// ── Respawn + Death Screen — gamemode-owned ───────────────────────────────────
//
// On death the engine ragdolls the player and respawns them after `spawnDelay`
// at their `spawnPoint`. This system:
//   • points that spawn point at the nearest temple INTERIOR, at 1 HP, and
//     starts a slow "injured" recovery (default outcome);
//   • shows the death-screen widget with a countdown + 3 confirm-gated choices:
//       permadeath  → character locked as a corpse, unplayable
//       resurrect   → full health in place (logged; re-death to same killer = permadeath)
//       temple      → nearest temple at full health, no return to death spot for 1h
//
// Works with the SHIPPING engine: onDeath / onRespawn hooks + spawnPoint /
// spawnDelay / respawnPercentages / locationalData / percentages / isDead.
// (The engine ALSO has a native nearest-temple fallback, but a spawn point set
// here always wins over it — see MpActor::GetRespawnPosition.)
//
// Coordinates are measured in-game (VGR_Locations survey), not ESM-derived.
//
// Wiring (gamemode entry init):  respawn.init(mp, store, bus);

import { safeGet, safeSet } from '../mpUtil';

// ── Tuning ────────────────────────────────────────────────────────────────────
const BLEEDOUT_SECONDS = 60;
const WAKE_HEALTH = 0.01;               // ~1 HP
const FULL_HEALTH = 1.0;
const REGEN_INTERVAL_MS = 8 * 60 * 60 * 1000; // 8 hours
const REGEN_NATURAL = 0.01;             // ~1 HP / 8h (fraction of max)
const REGEN_HEALER = 0.05;              // ~5 HP / 8h with a healer
const NO_RETURN_MS = 60 * 60 * 1000;    // 1 hour
const NO_RETURN_RADIUS = 6000;          // units around the death spot
const NEVER_RESPAWN = 1e12;             // spawnDelay for a permadead corpse
const TICK_MS = 30 * 1000;

interface Loc { cellOrWorldDesc: string; pos: [number, number, number]; rot: [number, number, number]; }

// ── Temple interiors (measured in-game) ───────────────────────────────────────
const SOLITUDE: Loc  = { cellOrWorldDesc: '16a02:Skyrim.esm', pos: [1676.93, 1571.19, 0],     rot: [0, 0, 15.75] };  // Temple of the Divines
const MARKARTH: Loc  = { cellOrWorldDesc: '16df3:Skyrim.esm', pos: [-1870.36, 356.02, 156.24], rot: [0, 0, 279.5] }; // Temple of Dibella
const FALKREATH: Loc = { cellOrWorldDesc: '13a71:Skyrim.esm', pos: [-1728, -391, 0],          rot: [0, 0, 180] };    // Hall of the Dead
const WHITERUN: Loc  = { cellOrWorldDesc: '165a7:Skyrim.esm', pos: [223.24, 248.85, 54],      rot: [0, 0, 0] };      // Temple of Kynareth
const WINDHELM: Loc  = { cellOrWorldDesc: '16785:Skyrim.esm', pos: [0, -2800, 64.35],         rot: [0, 0, 0] };      // Temple of Talos
const RIFTEN: Loc    = { cellOrWorldDesc: '16bd7:Skyrim.esm', pos: [-1414.34, 208.64, 64],    rot: [0, 0, 15.75] };  // Temple of Mara

// ── Anchors: measured Tamriel positions used to pick the nearest temple ───────
// Hold capitals route to their own temple; temple-less holds to a neighbour
// (Winterhold & Dawnstar → Windhelm, Morthal → Solitude); settlements to their
// hold's temple so villages don't route to whichever capital is closest as the
// crow flies.
const ANCHORS = [
  { name: 'Solitude',        x: -68173.96,  y: 103311.75, dest: SOLITUDE },
  { name: 'Markarth',        x: -169535.31, y: 5386.96,   dest: MARKARTH },
  { name: 'Falkreath',       x: -34020.39,  y: -89435.80, dest: FALKREATH },
  { name: 'Whiterun',        x: 16476.68,   y: -9595.68,  dest: WHITERUN },
  { name: 'Windhelm',        x: 135019.44,  y: 33731.66,  dest: WINDHELM },
  { name: 'Riften',          x: 174274.64,  y: -91459.67, dest: RIFTEN },
  { name: 'Winterhold',      x: 114050.01,  y: 94006.28,  dest: WINDHELM },
  { name: 'Dawnstar',        x: 26328.23,   y: 101092.58, dest: WINDHELM },
  { name: 'Morthal',         x: -39547.51,  y: 70770.92,  dest: SOLITUDE },
  { name: 'Riverwood',       x: 19233.25,   y: -46721.73, dest: WHITERUN },
  { name: 'Rorikstead',      x: -78931.07,  y: 2789.23,   dest: WHITERUN },
  { name: 'Ivarstead',       x: 78291.95,   y: -67062.64, dest: RIFTEN },
  { name: "Dragon's Bridge", x: -100811.45, y: 80907.16,  dest: SOLITUDE },
  { name: 'High Hrothgar',   x: 56897.66,   y: -31974.11, dest: WHITERUN },
];

// Deaths outside the Tamriel worldspace can't use X/Y distance (coordinates
// are in a different space). Route them by where their region connects back
// to Skyrim: Solstheim/Apocrypha → Windhelm (the boat), Forgotten Vale →
// Markarth (Darkfall Cave in the Reach), Soul Cairn → Solitude (Volkihar).
const WORLDSPACE_OVERRIDES: Array<{ match: (desc: string) => boolean; name: string; dest: Loc }> = [
  { match: (d) => d.endsWith(':Dragonborn.esm'), name: 'Windhelm', dest: WINDHELM },
  { match: (d) => d === 'bb5:Dawnguard.esm', name: 'Markarth', dest: MARKARTH },
  { match: (d) => d === '1408:Dawnguard.esm', name: 'Solitude', dest: SOLITUDE },
];

export function nearestTemple(pos: number[] | null): { name: string; dest: Loc } {
  const px = Array.isArray(pos) ? pos[0] : 0;
  const py = Array.isArray(pos) ? pos[1] : 0;
  let best = ANCHORS[0], bestSq = Infinity;
  for (const t of ANCHORS) {
    const dx = t.x - px, dy = t.y - py, sq = dx * dx + dy * dy;
    if (sq < bestSq) { bestSq = sq; best = t; }
  }
  return best;
}

export function pickTemple(worldDesc: string | null, pos: number[] | null): { name: string; dest: Loc } {
  if (typeof worldDesc === 'string') {
    for (const o of WORLDSPACE_OVERRIDES) {
      if (o.match(worldDesc)) return o;
    }
  }
  return nearestTemple(pos);
}

// ── helpers ────────────────────────────────────────────────────────────────────
function isPlayer(store: any, actorId: number): boolean {
  return store.getAll().some((p: any) => p.actorId === actorId);
}
function send(mp: any, actorId: number, payload: object): void {
  try { mp.sendCustomPacket(actorId, JSON.stringify(payload)); } catch (e) { /* not ready */ }
}
function showDeathScreen(mp: any, actorId: number, seconds: number): void {
  send(mp, actorId, { customPacketType: 'deathScreen', show: true, seconds });
}
function hideDeathScreen(mp: any, actorId: number): void {
  send(mp, actorId, { customPacketType: 'deathScreen', hide: true });
}
function setHealth(mp: any, actorId: number, health: number): void {
  safeSet(mp, actorId, 'percentages', { health, magicka: 1, stamina: 1 });
}

// ── Death ────────────────────────────────────────────────────────────────────
function onPlayerDeath(mp: any, store: any, dyingActorId: number, killerId: number): void {
  if (!isPlayer(store, dyingActorId)) return;

  // Abuse rule: if they resurrected (anti-glitch) and then died AGAIN to the
  // same player, force permadeath instead of offering the screen.
  const armed = safeGet(mp, dyingActorId, 'private.resurrectArmedKiller', 0);
  if (killerId && armed === killerId) {
    console.log('[respawn] ' + dyingActorId.toString(16) + ' died again to armed killer ' + killerId.toString(16) + ' — forcing permadeath');
    doPermaDeath(mp, dyingActorId, 'died again to the same player after a resurrect');
    return;
  }

  const pos = safeGet(mp, dyingActorId, 'pos', null);
  const world = safeGet(mp, dyingActorId, 'worldOrCellDesc', null);
  const temple = pickTemple(world, pos);

  // Default outcome: wake at the nearest temple interior, at 1 HP, injured.
  safeSet(mp, dyingActorId, 'spawnPoint', temple.dest);
  safeSet(mp, dyingActorId, 'spawnDelay', BLEEDOUT_SECONDS);
  safeSet(mp, dyingActorId, 'respawnPercentages', { health: WAKE_HEALTH, magicka: 1, stamina: 1 });

  // Record death context (for the choices) + start the slow recovery clock.
  safeSet(mp, dyingActorId, 'private.deathKiller', killerId || 0);
  safeSet(mp, dyingActorId, 'private.deathPos', Array.isArray(pos) ? pos : [0, 0, 0]);
  safeSet(mp, dyingActorId, 'private.deathWorld', typeof world === 'string' ? world : '');
  safeSet(mp, dyingActorId, 'private.injured', true);
  safeSet(mp, dyingActorId, 'private.regenLastMs', Date.now());
  safeSet(mp, dyingActorId, 'private.regenRate', REGEN_NATURAL);

  showDeathScreen(mp, dyingActorId, BLEEDOUT_SECONDS);
  console.log('[respawn] ' + dyingActorId.toString(16) + ' down — death screen shown, will wake at ' + temple.name + ' (1 HP)');
}

function onPlayerRespawn(mp: any, store: any, actorId: number): void {
  if (!isPlayer(store, actorId)) return;
  // A permadead character must never come back: re-down it so the body stays.
  if (safeGet(mp, actorId, 'private.permaDead', false) === true) {
    safeSet(mp, actorId, 'spawnDelay', NEVER_RESPAWN);
    safeSet(mp, actorId, 'isDead', true);
  }
  hideDeathScreen(mp, actorId);
}

// ── Choices ────────────────────────────────────────────────────────────────────
function onDeathChoice(mp: any, store: any, userId: number, choice: string): void {
  const actorId = mp.getUserActor(userId);
  if (!actorId || !isPlayer(store, actorId)) return;

  if (choice === 'permadeath') {
    doPermaDeath(mp, actorId, 'chose permanent death');
  } else if (choice === 'resurrect') {
    doResurrectHere(mp, store, actorId);
  } else if (choice === 'temple') {
    doTempleFullHealth(mp, actorId);
  }
}

function doPermaDeath(mp: any, actorId: number, reason: string): void {
  safeSet(mp, actorId, 'private.permaDead', true);
  safeSet(mp, actorId, 'private.injured', false);
  safeSet(mp, actorId, 'spawnDelay', NEVER_RESPAWN); // don't auto-respawn — stay a corpse
  safeSet(mp, actorId, 'isDead', true);              // ensure downed
  hideDeathScreen(mp, actorId);
  console.log('[respawn] PERMADEATH ' + actorId.toString(16) + ' — ' + reason + ' (slot locked, body remains)');
}

function doResurrectHere(mp: any, store: any, actorId: number): void {
  const killer = safeGet(mp, actorId, 'private.deathKiller', 0);
  const count = safeGet(mp, actorId, 'private.resurrectCount', 0) + 1;
  safeSet(mp, actorId, 'isDead', false);   // revive in place (no teleport)
  setHealth(mp, actorId, FULL_HEALTH);
  safeSet(mp, actorId, 'private.injured', false);
  safeSet(mp, actorId, 'private.resurrectCount', count);
  safeSet(mp, actorId, 'private.resurrectArmedKiller', killer); // re-death to them = permadeath
  hideDeathScreen(mp, actorId);
  const name = (store.getAll().find((p: any) => p.actorId === actorId) || {}).name || actorId.toString(16);
  console.log('[respawn][AUDIT] RESURRECT-HERE by ' + name + ' (' + actorId.toString(16) + '), use #' + count + ', armed vs killer ' + (killer ? killer.toString(16) : 'none'));
}

function doTempleFullHealth(mp: any, actorId: number): void {
  const deathPos = safeGet(mp, actorId, 'private.deathPos', null);
  const deathWorld = safeGet(mp, actorId, 'private.deathWorld', null);
  const temple = pickTemple(deathWorld, deathPos);
  safeSet(mp, actorId, 'isDead', false);                      // revive
  safeSet(mp, actorId, 'locationalData', temple.dest);        // move to temple now
  setHealth(mp, actorId, FULL_HEALTH);                        // skip the recovery system
  safeSet(mp, actorId, 'private.injured', false);
  // Can't return to the death spot for an hour.
  safeSet(mp, actorId, 'private.noReturnPos', Array.isArray(deathPos) ? deathPos : [0, 0, 0]);
  safeSet(mp, actorId, 'private.noReturnWorld', typeof deathWorld === 'string' ? deathWorld : '');
  safeSet(mp, actorId, 'private.noReturnUntilMs', Date.now() + NO_RETURN_MS);
  hideDeathScreen(mp, actorId);
  console.log('[respawn] ' + actorId.toString(16) + ' chose Temple w/ Full Health -> ' + temple.name + ' (no-return 1h)');
}

// ── Periodic tick: slow recovery + no-return enforcement ──────────────────────
function tick(mp: any, store: any): void {
  const now = Date.now();
  for (const p of store.getAll()) {
    const actorId = p.actorId;
    if (!actorId) continue;

    // Slow recovery (offline-aware: based on the persisted timestamp).
    if (safeGet(mp, actorId, 'private.injured', false) === true) {
      const last = safeGet(mp, actorId, 'private.regenLastMs', now);
      const intervals = Math.floor((now - last) / REGEN_INTERVAL_MS);
      if (intervals > 0) {
        const rate = safeGet(mp, actorId, 'private.regenRate', REGEN_NATURAL);
        const cur = (safeGet(mp, actorId, 'percentages', { health: WAKE_HEALTH }) as any).health || WAKE_HEALTH;
        const next = Math.min(FULL_HEALTH, cur + intervals * rate);
        setHealth(mp, actorId, next);
        safeSet(mp, actorId, 'private.regenLastMs', last + intervals * REGEN_INTERVAL_MS);
        if (next >= FULL_HEALTH) safeSet(mp, actorId, 'private.injured', false);
      }
    }

    // No-return zone after a "temple w/ full health" choice. Only enforced in
    // the same worldspace as the death — X/Y from different spaces don't
    // compare.
    const until = safeGet(mp, actorId, 'private.noReturnUntilMs', 0);
    if (until && now < until) {
      const zone = safeGet(mp, actorId, 'private.noReturnPos', null);
      const zoneWorld = safeGet(mp, actorId, 'private.noReturnWorld', '');
      const pos = safeGet(mp, actorId, 'pos', null);
      const world = safeGet(mp, actorId, 'worldOrCellDesc', '');
      if (Array.isArray(zone) && Array.isArray(pos) && world === zoneWorld) {
        const dx = zone[0] - pos[0], dy = zone[1] - pos[1];
        if (Math.sqrt(dx * dx + dy * dy) < NO_RETURN_RADIUS) {
          const temple = pickTemple(zoneWorld, zone);
          safeSet(mp, actorId, 'locationalData', temple.dest);
          send(mp, actorId, { customPacketType: 'notification', text: 'You cannot return here yet.' });
        }
      }
    } else if (until) {
      safeSet(mp, actorId, 'private.noReturnUntilMs', 0);
    }
  }
}

// Call when a healer tends a downed/injured player to bump recovery to 5/8h.
export function applyHealerBoost(mp: any, actorId: number): void {
  safeSet(mp, actorId, 'private.regenRate', REGEN_HEALER);
}

// ── Init ─────────────────────────────────────────────────────────────────────
export function init(mp: any, store: any, bus: any): void {
  console.log('[respawn] Initializing');

  mp.onDeath = (dyingActorId: number, killerId: number) => {
    try { onPlayerDeath(mp, store, dyingActorId, killerId || 0); }
    catch (err: any) { console.error('[respawn] onDeath error: ' + (err && err.message)); }
  };
  mp.onRespawn = (actorId: number) => {
    try { onPlayerRespawn(mp, store, actorId); }
    catch (err: any) { console.error('[respawn] onRespawn error: ' + (err && err.message)); }
  };

  // Death-screen button choices come back as a custom packet.
  mp.on('customPacket', (userId: number, content: string) => {
    let c: any; try { c = JSON.parse(content); } catch (e) { return; }
    if (c && c.customPacketType === 'deathChoice') {
      try { onDeathChoice(mp, store, userId, String(c.choice)); }
      catch (err: any) { console.error('[respawn] deathChoice error: ' + (err && err.message)); }
    }
  });

  const loop = () => { setTimeout(() => { try { tick(mp, store); } catch (e) { /* keep ticking */ } loop(); }, TICK_MS); };
  loop();

  console.log('[respawn] Started');
}
