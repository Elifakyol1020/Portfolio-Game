import kaboom from "kaboom";
import interactionsData from "./assets/data/interactions.json";
import textsData from "./assets/data/texts.json";

import defaultMapUrl from "./assets/maps/portfolio.tmj?url";

const TILE_PNG_ASSETS = import.meta.glob("./assets/tilesets/**/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

const TILE_TSX_RAW = import.meta.glob("./assets/tilesets/**/*.tsx", {
  eager: true,
  query: "?raw",
  import: "default",
});

let _ctx = null;
let _stop = null;
export async function startGame(options = {}) {
  if (_stop) return _stop;

  const {
    mapUrl = defaultMapUrl,
    spawnName = null,
    root = document.body,
    debug = false,
    scale = 1,
    zoom = 2.4,
    playerSpeed = 110,
    language = "tr",
    onPortal = null,
    onError = null,
  } = options;

  const rootWidth =
    root?.clientWidth || root?.getBoundingClientRect?.().width || window.innerWidth;
  const rootHeight =
    root?.clientHeight || root?.getBoundingClientRect?.().height || window.innerHeight;

  const k = kaboom({
    width: Math.max(320, Math.floor(rootWidth)),
    height: Math.max(180, Math.floor(rootHeight)),
    scale,
    crisp: true,
    debug,
    root,
    stretch: true,
    letterbox: false,
    background: [12, 14, 18],
    global: false,
  });

  if (onError) {
    k.onError((err) => {
      try {
        onError(err);
      } catch {
      }
    });
  }

  _ctx = k;
  _stop = () => {
    try {
      _ctx?.quit();
    } finally {
      _ctx = null;
      _stop = null;
    }
  };
  k.onCleanup(() => {
    _ctx = null;
    _stop = null;
  });

  const {
    add,
    anchor,
    area,
    body,
    camPos,
    color,
    fixed,
    opacity,
    outline,
    pos,
    rect,
    setGravity,
    text,
    vec2,
    z,
    loadSprite,
    onKeyPress,
  } = k;

  setGravity(0);


  const pngUrlByBasename = new Map();
  for (const [path, url] of Object.entries(TILE_PNG_ASSETS)) {
    pngUrlByBasename.set(path.split("/").pop(), url);
  }

  const tsxTextByBasename = new Map();
  for (const [path, text] of Object.entries(TILE_TSX_RAW)) {
    tsxTextByBasename.set(path.split("/").pop(), text);
  }

  const tiledMap = await fetchJson(mapUrl);
  const mapPixelWidth = tiledMap.width * tiledMap.tilewidth;
  const mapPixelHeight = tiledMap.height * tiledMap.tileheight;
  const minCoverZoom = Math.max(
    k.width() / Math.max(1, mapPixelWidth),
    k.height() / Math.max(1, mapPixelHeight),
  );
  const cameraZoom = Math.max(zoom, minCoverZoom);

  k.camScale(cameraZoom);

  const tilesets = await loadTilesetsForMap({
    tiledMap,
    pngUrlByBasename,
    tsxTextByBasename,
    loadSprite,
  });

  const TILE = 16;
  const STRIDE = 32;
  const IMG_W = 192;
  const IMG_H = 96;
  const playerFrames = [];
  const walkDown = [];
  const walkUp = [];
  const walkSide = [];

  const pushTile = (x, y) => {
    playerFrames.push({
      x: x / IMG_W,
      y: y / IMG_H,
      w: TILE / IMG_W,
      h: TILE / IMG_H,
    });
    return playerFrames.length - 1;
  };

  const buildQuads = (baseY, target) => {
    for (let i = 0; i < 5; i++) {
      const baseX = STRIDE * i;
      target.push([
        pushTile(baseX + 0, baseY + 0),
        pushTile(baseX + 16, baseY + 0),
        pushTile(baseX + 0, baseY + 16),
        pushTile(baseX + 16, baseY + 16),
      ]);
    }
  };

  buildQuads(0, walkDown);
  buildQuads(32, walkUp);
  buildQuads(64, walkSide);

  await loadSprite("player", "assets/sprites/player.png", { frames: playerFrames });

  const tileLayers = tiledMap.layers.filter((l) => l.type === "tilelayer");
  const drawBatches = tileLayers.map((layer, idx) =>
    buildDrawBatchForTileLayer({
      layer,
      layerZ: idx,
      mapWidth: tiledMap.width,
      tileWidth: tiledMap.tilewidth,
      tileHeight: tiledMap.tileheight,
      tilesets,
      vec2,
    }),
  );

  let elapsed = 0;
  k.onUpdate(() => {
    elapsed += k.dt();
  });

  add([
    z(-1),
    {
      draw() {
        const nowMs = elapsed * 1000;
        for (const batch of drawBatches) {
          for (const t of batch.tiles) {
            const frame = t.animation
              ? getAnimatedFrame(t.animation, nowMs)
              : t.frame;
            k.drawSprite({
              sprite: t.spriteName,
              frame,
              pos: t.pos,
              anchor: t.anchor,
              angle: t.angle,
              flipX: t.flipX,
              flipY: t.flipY,
            });
          }
        }
      },
      renderArea() {
        return new k.Rect(k.vec2(0, 0), mapPixelWidth, mapPixelHeight);
      },
    },
  ]);


  const collisionLayer = findObjectLayerAny(tiledMap, ["collision", "collisions"]);
  if (collisionLayer) {
    for (const obj of collisionLayer.objects ?? []) {
      const shapes = tiledObjectToKaboomShapes(k, obj);
      if (!shapes.length) continue;

      for (const shape of shapes) {
        add([
          pos(obj.x, obj.y),
          area({ shape }),
          body({ isStatic: true }),
          "wall",
        ]);
      }
    }
  }


  const interactionLayer = findObjectLayerAny(tiledMap, ["interaction", "interactions"]);
  const interactions =
    interactionLayer?.objects?.map((obj) =>
      tiledInteractionToRuntime(obj, {
        interactionsData,
        textsData,
        language,
      }),
    ) ?? [];


  const spawnLayer = findObjectLayerAny(tiledMap, ["spawn", "player_spawn", "spawns"]);

  const spawnCandidates = spawnLayer?.objects ?? [];
  const namedSpawn =
    spawnName
      ? spawnCandidates.find((obj) => obj.name === spawnName || obj.type === spawnName)
      : null;
  const spawn =
    namedSpawn ??
    spawnCandidates[0] ?? {
      x: tiledMap.tilewidth,
      y: tiledMap.tileheight,
    };

  const player = add([
    pos(spawn.x, spawn.y),
    anchor("center"),
    area({ shape: new k.Rect(k.vec2(-5, -5), 10, 10) }),
    body({ gravityScale: 0 }),
    z(2000),
    "player",
    {
      renderArea() {
        return new k.Rect(k.vec2(-8, -8), 16, 16);
      },
    },
  ]);


  let collisionCooldown = 0;
  player.onCollide("wall", (_wall, col) => {
    if (!col) return;
    player.pos = player.pos.add(col.displacement);
    mouseTarget = null;
    collisionCooldown = 0.12;
  });

  player.onUpdate(() => {
    const halfW = k.width() / (2 * cameraZoom);
    const halfH = k.height() / (2 * cameraZoom);
    const cx = clampCamAxis(player.pos.x, halfW, mapPixelWidth);
    const cy = clampCamAxis(player.pos.y, halfH, mapPixelHeight);
    camPos(vec2(cx, cy));
  });


  let mouseTarget = null;
  let mouseDown = false;
  let pressWorld = null;
  const DRAG_START_PX = 10;
  const getMouseWorld = () =>
    typeof k.toWorld === "function" ? k.toWorld(k.mousePos()) : k.mousePos();

  const cursor = add([
    pos(0, 0),
    rect(10, 10),
    color(255, 255, 255),
    outline(2, k.rgb(0, 0, 0)),
    opacity(0),
    anchor("center"),
    z(999),
  ]);

  if (root && root.style) {
    root.style.cursor = "crosshair";
  }

  k.onMouseDown(() => {
    mouseDown = true;
    pressWorld = getMouseWorld();
    mouseTarget = pressWorld;
  });

  k.onMouseRelease(() => {
    mouseDown = false;
    mouseTarget = null;
  });

  k.onMouseMove(() => {
    if (mouseDown) {
      const world = getMouseWorld();
      if (pressWorld && world.dist(pressWorld) >= DRAG_START_PX) {
        if (!mouseTarget || world.dist(mouseTarget) > 2) {
          mouseTarget = world;
        }
      }
    }
  });

  let lastDir = "down";
  let lastFlipX = false;
  let animTime = 0;
  const animSpeed = 8;
  player.onUpdate(() => {
    if (collisionCooldown > 0) {
      collisionCooldown -= k.dt();
      return;
    }
    const cw = getMouseWorld();
    cursor.pos = cw;

    const dir = vec2(0, 0);
    if (k.isKeyDown("left") || k.isKeyDown("a")) dir.x -= 1;
    if (k.isKeyDown("right") || k.isKeyDown("d")) dir.x += 1;
    if (k.isKeyDown("up") || k.isKeyDown("w")) dir.y -= 1;
    if (k.isKeyDown("down") || k.isKeyDown("s")) dir.y += 1;

    if (dir.len() > 0) {
      player.move(dir.unit().scale(playerSpeed));
      mouseTarget = null;
      if (Math.abs(dir.x) > Math.abs(dir.y)) {
        if (dir.x > 0) {
          lastDir = "right";
          lastFlipX = false;
        } else {
          lastDir = "right";
          lastFlipX = true;
        }
      } else {
        lastDir = dir.y > 0 ? "down" : "up";
      }
      animTime += k.dt();
    } else if (mouseTarget) {
      const delta = mouseTarget.sub(player.pos);
      if (delta.len() > 2) {
        player.move(delta.unit().scale(playerSpeed));
        if (Math.abs(delta.x) > Math.abs(delta.y)) {
          if (delta.x > 0) {
            lastDir = "right";
            lastFlipX = false;
          } else {
            lastDir = "right";
            lastFlipX = true;
          }
        } else {
          lastDir = delta.y > 0 ? "down" : "up";
        }
        animTime += k.dt();
      } else {
        mouseTarget = null;
        animTime = 0;
      }
    } else {
      animTime = 0;
    }

    const px = clamp(player.pos.x, 6, mapPixelWidth - 6);
    const py = clamp(player.pos.y, 6, mapPixelHeight - 6);
    player.pos = vec2(px, py);
  });


  const dialogHeight = 96;
  const dialogWidth = k.width() - 24;
  const dialogX = 12;
  const dialogY = k.height() - dialogHeight - 12;

  const dialogBg = add([
    rect(dialogWidth, dialogHeight),
    pos(dialogX, dialogY),
    color(12, 16, 24),
    opacity(0.9),
    outline(2, k.rgb(255, 255, 255)),
    fixed(),
    z(1000),
  ]);

  const dialogAccent = add([
    rect(dialogWidth, 6),
    pos(dialogX, dialogY),
    color(96, 180, 255),
    fixed(),
    z(1001),
  ]);

  const dialogTitle = add([
    text("", { size: 14, width: dialogWidth - 24 }),
    pos(dialogX + 12, dialogY + 12),
    color(255, 255, 255),
    fixed(),
    z(1002),
  ]);

  const dialogText = add([
    text("", { size: 12, width: dialogWidth - 24 }),
    pos(dialogX + 12, dialogY + 32),
    color(220, 230, 245),
    fixed(),
    z(1002),
  ]);

  const dialogHint = add([
    text("", { size: 11 }),
    pos(dialogX + 12, dialogY + dialogHeight - 18),
    color(160, 180, 200),
    fixed(),
    z(1002),
  ]);

  function setDialogVisible(visible) {
    dialogBg.hidden = !visible;
    dialogAccent.hidden = !visible;
    dialogTitle.hidden = !visible;
    dialogText.hidden = !visible;
    dialogHint.hidden = !visible;
  }

  setDialogVisible(false);

  let activeInteraction = null;
  let lastPortalKey = null;
  let lastPortalAt = 0;
  const INTERACTION_TRIGGER_DISTANCE = 2;

  player.onUpdate(() => {
    const p = player.pos;
    let best = null;
    let bestDist = INTERACTION_TRIGGER_DISTANCE;

    for (const it of interactions) {
      const d = distanceToBounds(p, it.bounds);
      if (d <= bestDist) {
        best = it;
        bestDist = d;
      }
    }

    activeInteraction = best;

    if (!activeInteraction) {
      lastPortalKey = null;
      setDialogVisible(false);
      return;
    }

    if (activeInteraction.type === "portal" && typeof onPortal === "function") {
      const portalDistance = distanceToBounds(p, activeInteraction.bounds);
      if (portalDistance > INTERACTION_TRIGGER_DISTANCE) return;
      setDialogVisible(false);
      const now = Date.now();
      const portalKey = `${activeInteraction.id}:${activeInteraction.targetMap}:${activeInteraction.targetSpawn ?? ""}`;
      if (portalKey !== lastPortalKey || now - lastPortalAt > 500) {
        lastPortalKey = portalKey;
        lastPortalAt = now;
        onPortal({
          targetMap: activeInteraction.targetMap,
          targetSpawn: activeInteraction.targetSpawn ?? null,
        });
      }
      return;
    }

    setDialogVisible(true);
    const { title, body } = splitMessage(activeInteraction.message ?? "");
    dialogTitle.text = title ?? "";
    dialogText.text = body ?? "";
    dialogHint.text = activeInteraction.url
      ? "ENTER: link"
      : "Walk away to close";
  });

  onKeyPress("enter", () => {
    if (!activeInteraction?.url) return;
    window.open(activeInteraction.url, "_blank", "noopener,noreferrer");
  });

  k.onDraw(() => {
    const DRAW_SCALE = 0.90;
    const DRAW_TILE = TILE * DRAW_SCALE;
    const HALF_SIZE = DRAW_TILE;
    const idx =
      animTime > 0
        ? Math.floor(animTime * animSpeed)
        : 0;
    const seq =
      lastDir === "down" ? walkDown :
      lastDir === "up" ? walkUp :
      walkSide;
    const quad = seq[idx % seq.length];
    const base = player.pos.sub(HALF_SIZE, HALF_SIZE);
    const offsets = [
      k.vec2(0, 0),
      k.vec2(DRAW_TILE, 0),
      k.vec2(0, DRAW_TILE),
      k.vec2(DRAW_TILE, DRAW_TILE),
    ];
    for (let i = 0; i < 4; i++) {
      const off = lastFlipX
        ? k.vec2(DRAW_TILE * 2 - offsets[i].x - DRAW_TILE, offsets[i].y)
        : offsets[i];
      k.drawSprite({
        sprite: "player",
        frame: quad[i],
        pos: base.add(off),
        anchor: "topleft",
        flipX: lastFlipX,
        scale: k.vec2(DRAW_SCALE, DRAW_SCALE),
      });
    }
  });

  return _stop;
}


async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch JSON: ${url} (${res.status})`);
  }
  return res.json();
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function clampCamAxis(value, halfView, mapSize) {
  if (mapSize <= halfView * 2) return mapSize / 2;
  return clamp(value, halfView, mapSize - halfView);
}

function findObjectLayer(tiledMap, layerName) {
  return tiledMap.layers.find(
    (l) => l.type === "objectgroup" && l.name === layerName,
  );
}

function findObjectLayerAny(tiledMap, layerNames) {
  for (const name of layerNames) {
    const layer = findObjectLayer(tiledMap, name);
    if (layer) return layer;
  }
  return null;
}

function tiledObjectToKaboomShapes(k, obj) {
  const { vec2, Rect, Polygon } = k;

  if (obj.width > 0 && obj.height > 0) {
    return [new Rect(vec2(0, 0), obj.width, obj.height)];
  }

  if (Array.isArray(obj.polygon) && obj.polygon.length >= 3) {
    const pts = obj.polygon.map((p) => vec2(p.x, p.y));
    const polys = isConvexPolygon(pts) ? [pts] : triangulatePolygon(pts);
    return polys.map((poly) => new Polygon(poly));
  }

  return [];
}

function isConvexPolygon(pts) {
  if (pts.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const c = pts[(i + 2) % pts.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function polygonSignedArea(pts) {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function triangulatePolygon(pts) {
  if (pts.length < 3) return [];

  const ccw = polygonSignedArea(pts) > 0;
  const poly = ccw ? [...pts] : [...pts].reverse();

  const idx = poly.map((_, i) => i);
  const triangles = [];

  const maxIters = 10000;
  let iters = 0;

  while (idx.length > 3 && iters++ < maxIters) {
    let earFound = false;

    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i - 1 + idx.length) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];

      const a = poly[i0];
      const b = poly[i1];
      const c = poly[i2];

      if (!isConvexCorner(a, b, c)) continue;

      let hasPointInside = false;
      for (let j = 0; j < idx.length; j++) {
        const ij = idx[j];
        if (ij === i0 || ij === i1 || ij === i2) continue;
        if (pointInTriangle(poly[ij], a, b, c)) {
          hasPointInside = true;
          break;
        }
      }
      if (hasPointInside) continue;

      triangles.push([a, b, c]);
      idx.splice(i, 1);
      earFound = true;
      break;
    }

    if (!earFound) break;
  }

  if (idx.length === 3) {
    triangles.push([poly[idx[0]], poly[idx[1]], poly[idx[2]]]);
  }

  return triangles;
}

function isConvexCorner(a, b, c) {
  const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  return cross > 0;
}

function pointInTriangle(p, a, b, c) {
  const v0x = c.x - a.x;
  const v0y = c.y - a.y;
  const v1x = b.x - a.x;
  const v1y = b.y - a.y;
  const v2x = p.x - a.x;
  const v2y = p.y - a.y;

  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;

  const denom = dot00 * dot11 - dot01 * dot01;
  if (denom === 0) return false;
  const invDenom = 1 / denom;
  const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
  const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
  return u >= 0 && v >= 0 && u + v <= 1;
}

function tiledInteractionToRuntime(obj, { interactionsData, textsData, language }) {
  const area = obj.name || obj.type || "";
  const mapping =
    interactionsData?.interactions?.find((i) => i.area === area) ?? null;
  const textKey = mapping?.textKey ?? null;
  const type = mapping?.type ?? "hint";
  const targetMap =
    mapping?.targetMap ??
    getTiledProp(obj, "targetMap") ??
    null;
  const targetSpawn =
    mapping?.targetSpawn ??
    getTiledProp(obj, "targetSpawn") ??
    null;

  const message =
    resolveText(textsData, textKey, language) ??
    getTiledProp(obj, "message") ??
    "";
  const url = getTiledProp(obj, "url") ?? null;

  const bounds = getTiledObjectBounds(obj);
  const { center } = bounds;

  return { id: obj.id, message, url, center, bounds, type, targetMap, targetSpawn };
}

function distanceToBounds(p, bounds) {
  const dx = Math.max(bounds.minX - p.x, 0, p.x - bounds.maxX);
  const dy = Math.max(bounds.minY - p.y, 0, p.y - bounds.maxY);
  return Math.hypot(dx, dy);
}

function splitMessage(message) {
  const raw = (message ?? "").trim();
  if (!raw) return { title: "", body: "" };
  const lines = raw.split("\n");
  if (lines.length === 1) return { title: "", body: raw };
  const title = lines.shift()?.trim() ?? "";
  const body = lines.join("\n").trim();
  return { title, body };
}

function resolveText(textsData, textKey, language) {
  if (!textKey) return null;
  const entry = textsData?.[textKey];
  if (!entry) return null;
  const preferred = entry[language] ?? entry.tr ?? entry.en ?? null;
  if (!preferred) return null;
  const title = preferred.title?.trim();
  const text = preferred.text?.trim();
  if (title && text) return `${title}\n${text}`;
  return title || text || null;
}

function getTiledProp(obj, name) {
  const props = obj.properties ?? [];
  const p = props.find((x) => x.name === name);
  return p?.value ?? null;
}

function getTiledObjectBounds(obj) {
  const pts = [];

  if (Array.isArray(obj.polygon) && obj.polygon.length) {
    for (const p of obj.polygon) {
      pts.push({ x: obj.x + p.x, y: obj.y + p.y });
    }
  } else if (obj.width > 0 && obj.height > 0) {
    pts.push(
      { x: obj.x, y: obj.y },
      { x: obj.x + obj.width, y: obj.y },
      { x: obj.x + obj.width, y: obj.y + obj.height },
      { x: obj.x, y: obj.y + obj.height },
    );
  } else {
    pts.push({ x: obj.x, y: obj.y });
  }

  let minX = pts[0].x;
  let minY = pts[0].y;
  let maxX = pts[0].x;
  let maxY = pts[0].y;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
  };
}

async function loadTilesetsForMap({
  tiledMap,
  pngUrlByBasename,
  tsxTextByBasename,
  loadSprite,
}) {
  const tilesets = [];

  for (let i = 0; i < tiledMap.tilesets.length; i++) {
    const tsRef = tiledMap.tilesets[i];
    const next = tiledMap.tilesets[i + 1];

    const tsxBasename = tsRef.source.split("/").pop() ?? "";
    const tsxText = tsxTextByBasename.get(tsxBasename);
    if (!tsxText) {
      throw new Error(
        `Missing TSX file "${tsxBasename}" in src/assets/tilesets/. (Tip: keep TSX next to PNG)`,
      );
    }

    const tsx = parseTsx(tsxText);
    const pngBasename = tsx.imageSource.split("/").pop() || "";

    const pngUrl = pngUrlByBasename.get(pngBasename);
    if (!pngUrl) {
      throw new Error(
        `Missing PNG "${pngBasename}" for tileset "${tsx.name}" in src/assets/tilesets/.`,
      );
    }

    const spriteName = `tileset:${tsx.name}`;
    const rows = Math.ceil(tsx.tilecount / tsx.columns);
    await loadSprite(spriteName, pngUrl, {
      sliceX: tsx.columns,
      sliceY: rows,
    });

    tilesets.push({
      name: tsx.name,
      firstgid: tsRef.firstgid,
      lastgidExclusive: next ? next.firstgid : Infinity,
      tilecount: tsx.tilecount,
      columns: tsx.columns,
      spriteName,
      animations: tsx.animations,
    });
  }

  return tilesets;
}

function parseTsx(tsxText) {
  const doc = new DOMParser().parseFromString(tsxText, "text/xml");
  const tileset = doc.querySelector("tileset");
  if (!tileset) throw new Error("Invalid TSX: missing <tileset>");

  const image = doc.querySelector("tileset > image");
  if (!image) throw new Error("Invalid TSX: missing <image>");

  const animations = {};
  const tileNodes = doc.querySelectorAll("tileset > tile");
  for (const tile of tileNodes) {
    const tileId = Number(tile.getAttribute("id") ?? "-1");
    if (Number.isNaN(tileId) || tileId < 0) continue;
    const frameNodes = tile.querySelectorAll("animation > frame");
    if (!frameNodes.length) continue;

    let total = 0;
    const frames = [];
    for (const f of frameNodes) {
      const frameId = Number(f.getAttribute("tileid") ?? "-1");
      const duration = Number(f.getAttribute("duration") ?? "0");
      if (frameId < 0 || duration <= 0) continue;
      total += duration;
      frames.push({ frame: frameId, duration, end: total });
    }
    if (frames.length) {
      animations[tileId] = { total, frames };
    }
  }

  return {
    name: tileset.getAttribute("name") ?? "tileset",
    tilecount: Number(tileset.getAttribute("tilecount") ?? "0"),
    columns: Number(tileset.getAttribute("columns") ?? "1"),
    tilewidth: Number(tileset.getAttribute("tilewidth") ?? "16"),
    tileheight: Number(tileset.getAttribute("tileheight") ?? "16"),
    imageSource: image.getAttribute("source") ?? "",
    animations,
  };
}

function decodeTiledGid(rawGid) {
  const FLIPPED_HORIZONTALLY_FLAG = 0x80000000;
  const FLIPPED_VERTICALLY_FLAG = 0x40000000;
  const FLIPPED_DIAGONALLY_FLAG = 0x20000000;
  const ROTATED_HEX_120_FLAG = 0x10000000;

  const h = (rawGid & FLIPPED_HORIZONTALLY_FLAG) !== 0;
  const v = (rawGid & FLIPPED_VERTICALLY_FLAG) !== 0;
  const d = (rawGid & FLIPPED_DIAGONALLY_FLAG) !== 0;

  const gid =
    rawGid &
    ~(FLIPPED_HORIZONTALLY_FLAG |
      FLIPPED_VERTICALLY_FLAG |
      FLIPPED_DIAGONALLY_FLAG |
      ROTATED_HEX_120_FLAG);

  const { angle, flipX, flipY } = tiledFlagsToKaboomTransform({ h, v, d });

  return { gid, angle, flipX, flipY };
}

function tiledFlagsToKaboomTransform({ h, v, d }) {

  let m = [
    [1, 0],
    [0, 1],
  ];

  if (d) {
    m = mul2x2(
      [
        [0, 1],
        [1, 0],
      ],
      m,
    );
  }

  if (h) {
    m = mul2x2(
      [
        [-1, 0],
        [0, 1],
      ],
      m,
    );
  }

  if (v) {
    m = mul2x2(
      [
        [1, 0],
        [0, -1],
      ],
      m,
    );
  }

  const angles = [0, 90, 180, 270];
  const flips = [
    { flipX: false, flipY: false },
    { flipX: true, flipY: false },
    { flipX: false, flipY: true },
    { flipX: true, flipY: true },
  ];

  for (const angle of angles) {
    for (const f of flips) {
      const cand = kaboomMatrix(angle, f.flipX, f.flipY);
      if (matEq(m, cand)) return { angle, flipX: f.flipX, flipY: f.flipY };
    }
  }

  return { angle: 0, flipX: h, flipY: v };
}

function mul2x2(a, b) {
  return [
    [a[0][0] * b[0][0] + a[0][1] * b[1][0], a[0][0] * b[0][1] + a[0][1] * b[1][1]],
    [a[1][0] * b[0][0] + a[1][1] * b[1][0], a[1][0] * b[0][1] + a[1][1] * b[1][1]],
  ];
}

function matEq(a, b) {
  return (
    a[0][0] === b[0][0] &&
    a[0][1] === b[0][1] &&
    a[1][0] === b[1][0] &&
    a[1][1] === b[1][1]
  );
}

function kaboomMatrix(angleDeg, flipX, flipY) {
  const fx = flipX ? -1 : 1;
  const fy = flipY ? -1 : 1;

  const a = ((angleDeg % 360) + 360) % 360;

  const r =
    a === 0
      ? [
          [1, 0],
          [0, 1],
        ]
      : a === 90
        ? [
            [0, -1],
            [1, 0],
          ]
        : a === 180
          ? [
              [-1, 0],
              [0, -1],
            ]
          : [
              [0, 1],
              [-1, 0],
            ];

  const f = [
    [fx, 0],
    [0, fy],
  ];

  return mul2x2(r, f);
}

function findTilesetForGid(tilesets, gid) {
  return tilesets.find((ts) => gid >= ts.firstgid && gid < ts.lastgidExclusive);
}

function buildDrawBatchForTileLayer({
  layer,
  layerZ,
  mapWidth,
  tileWidth,
  tileHeight,
  tilesets,
  vec2,
}) {
  const tiles = [];
  const data = layer.data ?? [];

  for (let i = 0; i < data.length; i++) {
    const raw = data[i];
    if (!raw) continue;

    const d = decodeTiledGid(raw);
    if (!d.gid) continue;

    const ts = findTilesetForGid(tilesets, d.gid);
    if (!ts) continue;

    const frame = d.gid - ts.firstgid;
    const x = (i % mapWidth) * tileWidth;
    const y = Math.floor(i / mapWidth) * tileHeight;

    const needsCenterAnchor = d.angle !== 0;

    tiles.push({
      spriteName: ts.spriteName,
      frame,
      pos: needsCenterAnchor ? vec2(x + tileWidth / 2, y + tileHeight / 2) : vec2(x, y),
      anchor: needsCenterAnchor ? "center" : "topleft",
      angle: d.angle,
      flipX: d.flipX,
      flipY: d.flipY,
      z: layerZ,
      animation: ts.animations?.[frame] ?? null,
    });
  }

  return { name: layer.name, tiles };
}

function getAnimatedFrame(animation, nowMs) {
  const total = animation.total;
  if (!total) return animation.frames[0]?.frame ?? 0;
  const t = nowMs % total;
  for (const f of animation.frames) {
    if (t < f.end) return f.frame;
  }
  return animation.frames[animation.frames.length - 1]?.frame ?? 0;
}
