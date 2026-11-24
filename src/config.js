/**
 * ──────────────────────────────────────────────────────────────────────────
 *  Cherry Blossom Proposal — every tunable lives in this one file.
 * ──────────────────────────────────────────────────────────────────────────
 *  Units are metres / seconds. +Y is up. The festival plaza at the end of the
 *  lane (fireworks, dance, proposal) is the world origin.
 */

/**
 * Asset manifest. The GLBs sit in the project root; Vite fingerprints them on
 * build. (Static `new URL()` literals, so Vite bundles exactly these files.)
 */
export const ASSETS = {
  man: { url: new URL('../main_man.glb', import.meta.url).href, height: 1.82 },
  girl: { url: new URL('../main_girl.glb', import.meta.url).href, height: 1.64 },
  cat: { url: new URL('../cat.glb', import.meta.url).href, height: 0.3 }, // shoulder-ish height of a house cat
  // dancer.lod.glb: dancer.glb decimated 530k → 39k triangles (gltf-transform simplify, ratio 0.06)
  dancer: { url: new URL('../dancer.lod.glb', import.meta.url).href, height: 1.7 },
  dragon: { url: new URL('../dragon.glb', import.meta.url).href, length: 14 }, // nose → tail along its longest axis
  scarf: { url: new URL('../scarf_rig.glb', import.meta.url).href },
  picnic: { url: new URL('../picnic.glb', import.meta.url).href, width: 2.3 }, // a neighbouring family's picnic by the couple's (turf + hedge stripped at load); longest side (m)
};

export const RENDER = {
  exposure: 1.0,
  maxPixelRatio: 2,
  minPixelRatio: 0.75,
  shadowMapSize: 2048,
  bloom: { strength: 0.62, radius: 0.55, threshold: 1.35 }, // only true light sources (lanterns, the ball, fireworks) bloom — never lit skin or white cloth
};

export const CAMERA = {
  fov: 42,
  near: 0.1,
  far: 900,
  // third-person follow camera (ported from infinity-castle)
  distance: 4.4,
  minDistance: 1.6,
  maxDistance: 9,
  pivotHeight: 1.45, // above his feet (shoulder height)
  shoulder: 0.38, // over-the-shoulder offset to the right
  pitch: 0.16, // initial pitch (rad, + looks down)
  minPitch: -0.45,
  maxPitch: 1.1,
  sensitivity: 0.0022,
  follow: 9, // pivot smoothing (1/s)
};

/** Third-person movement (explore mode). A romantic stroll, not a sprint. */
export const CONTROLLER = {
  walkSpeed: 1.5, // m/s
  runSpeed: 3.4, // Shift: a brisk walk
  accel: 6,
  friction: 4.5,
  turnRate: 8,
  radius: 0.32, // body radius vs tree trunks
};

/** Who follows whom (path-following, from infinity-castle's CompanionAI). */
export const FOLLOW = {
  her: { distance: 1.25, personalSpace: 0.7, side: -0.45 },
  catHim: { distance: 0.9, personalSpace: 0.5, side: 0.75 },
  catHer: { distance: 2.0, personalSpace: 0.5, side: -0.85 },
};

/**
 * Time of day. `night` runs 0 → 1: 0 = magenta dusk with the sun just under
 * the hills, 1 = deep night (Act IV snaps to 1).
 */
export const SKY = {
  startNight: 0.22,
  sunDir: [-0.82, 0.07, -0.56], // low in the west, behind the dragon stage
  moonDir: [0.45, 0.52, -0.72],
  fogDensity: { dusk: 0.0105, night: 0.0125 },
};

/** Wind shared by the trees (sway) and the petals (drift + gusts). */
export const WIND = {
  dir: [0.86, 0, 0.5],
  speed: 1.1, // m/s mean drift
  gustEvery: 9, // seconds between gust swells (± jitter)
  gustStrength: 2.4,
};

export const PETALS = {
  count: 9000,
  box: [64, 22, 64], // wrap volume (x, y, z) centred on the camera's focus
  size: [0.022, 0.034], // petal length range (m)
  fallSpeed: [0.3, 0.65], // m/s
  life: [9, 20], // seconds each petal is visible before it dissolves and re-spawns elsewhere
  nearFade: [0.8, 2.6], // petals thin out this close to the lens (m) so they never clutter a close-up
};

/**
 * Park layout — a long, winding cherry-blossom lane (~210 m) running from the
 * park gate in the south to the festival plaza at the world origin. The story
 * travels down it; each act has its own station, so nothing is cramped:
 *
 *   gate    u 0.00   the couple + cats set off (Act I stroll)
 *   catch   u 0.27   a scenic clearing off the lane's left side (Act I catch)
 *   picnic  u 0.50   a lawn just off the right side (Act II)
 *   stage   u 0.74   the dim festival corner off the left (Act III dragon + scarf)
 *   plaza   end      the lantern-ringed plaza (Act IV fireworks + dance, Act V)
 *
 * `u` is the fraction of the lane's length; `side` +1 = right of the direction
 * of travel, −1 = left; `offset` = metres from the lane's centre line.
 */
export const PARK = {
  seed: 2026,
  lane: [
    [14, 0, 190],
    [4, 0, 170],
    [-12, 0, 152],
    [-16, 0, 130],
    [-6, 0, 110],
    [10, 0, 92],
    [16, 0, 72],
    [8, 0, 54],
    [-4, 0, 38],
    [-5, 0, 24],
    [0, 0, 12],
  ],
  laneWidth: 3.4,
  stations: {
    gate: { u: 0.0, side: 0, offset: 0, radius: 4 },
    catch: { u: 0.27, side: -1, offset: 10, radius: 7.5 },
    picnic: { u: 0.5, side: 1, offset: 7, radius: 4.2 },
    stage: { u: 0.74, side: -1, offset: 14, radius: 10 },
    plaza: { center: [0, 0, 0], radius: 11 },
  },
  flatWidth: 26, // ground is flat this far from the lane / stations (layered hills beyond)
  forestWidth: 62, // trees are scattered up to this far from the lane
  avenueSpacing: 8.5, // the lane is lined on both sides by a tree every ~this many metres
  backdropTrees: 110,
  treeVariants: 5,
};

/** Paper lanterns (chōchin). Real point lights are limited; the rest glow via HDR + bloom. */
export const LANTERNS = {
  maxLights: 8, // real PointLights (fixed count → no shader recompiles); they hop to the strings nearest the couple
  lightIntensity: 7,
  lightRange: 13,
  red: [1.0, 0.16, 0.08],
  gold: [1.0, 0.62, 0.2],
  glow: 3.2, // HDR paper brightness at full night (bloom threshold ≈ 0.9)
};

/**
 * Music. Each phase streams from YouTube (hidden IFrame player, audio only);
 * if the embed is blocked/unavailable it falls back to the local file in
 * public/audio/ (supply your own copy), and if that's missing too the scene
 * just runs silently.
 *
 *  phase1 — Yiruma, "River Flows in You": loops 0:00 → 3:00, continuously, through the stroll down
 *           the lane, catch, picnic and the scarf knitting.
 *  phase2 — Bruno Mars, "Marry You": crossfades in at the instant night falls
 *           (Act IV fireworks + dance) and carries the proposal.
 */
export const AUDIO = {
  phase1: {
    // Yiruma – "River Flows in You": the walk, the catch, the picnic, the dragon and the scarf,
    // looping 0:00 → 3:00 however long the journey takes
    url: ['https://www.youtube.com/watch?v=NPBCbTZWnq0'],
    localSrc: '/audio/river-flows-in-you.mp3',
    start: 0,
    loopEnd: 180, // seconds — hard loop point (3:00) back to the start
    loop: true,
    volume: 0.6,
    fadeIn: 3.5,
  },
  // nightfall: the fireworks, MARRY ME and the group dance (Act IV), up to the proposal
  phase2: {
    url: 'https://youtu.be/dElRVQFqj-k', // Bruno Mars, "Marry You"
    localSrc: '/audio/marry-you.mp3',
    start: 0,
    loopEnd: null,
    loop: true,
    volume: 0.9,
    fadeIn: 0.6,
  },
  // the YES / NO question appears: Nezuko's Theme, looping while he decides (and through every NO)
  phase3: {
    url: 'https://music.youtube.com/watch?v=lgaPauANqZU', // Nezuko's Theme
    localSrc: '/audio/nezuko-theme.mp3',
    start: 0,
    loopEnd: null,
    loop: true,
    volume: 0.9,
    fadeIn: 0.8,
  },
  // he says YES: the climax — fireworks, the kiss, the fade to THE END — scored from exactly 2:21
  phase4: {
    url: 'https://music.youtube.com/watch?v=EVoWz321A7M', // Tanjiro's Theme
    localSrc: '/audio/tanjiro-theme.mp3',
    start: 141, // 2:21, strictly: it's cued (primed) there and seeks there again on YES
    loopEnd: null,
    loop: true, // (loops back to 2:21 if the ending is left running)
    volume: 1.0,
    fadeIn: 0.35,
  },
  crossfade: 1.2, // seconds for each hand-off: River Flows in You → Marry You (nightfall) → Nezuko (the question) → Tanjiro (YES)
};
