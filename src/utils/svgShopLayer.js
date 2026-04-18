import {
  isValidShopId,
  normalizeShopId,
  SHOP_STATUS_META,
} from '../../shared/shop-status.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SHAPE_SELECTOR = 'path, rect, polygon, polyline, line, ellipse, circle';
const GRID_SIZE = 96;
const LINE_THICKNESS_LIMIT = 14;

function getBBoxSafe(element) {
  try {
    return element.getBBox();
  } catch {
    return null;
  }
}

function transformPoint(point, matrix) {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

function invertMatrix(matrix) {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;

  if (!determinant) {
    return null;
  }

  return {
    a: matrix.d / determinant,
    b: -matrix.b / determinant,
    c: -matrix.c / determinant,
    d: matrix.a / determinant,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
  };
}

function getTransformedBBoxSafe(element, svgRoot) {
  const box = getBBoxSafe(element);
  const elementMatrix =
    typeof element.getScreenCTM === 'function' ? element.getScreenCTM() : null;
  const rootMatrix =
    typeof svgRoot?.getScreenCTM === 'function' ? svgRoot.getScreenCTM() : null;
  const rootInverse = rootMatrix ? invertMatrix(rootMatrix) : null;

  if (!box || !elementMatrix || !rootInverse) {
    return box;
  }

  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x, y: box.y + box.height },
    { x: box.x + box.width, y: box.y + box.height },
  ]
    .map((point) => transformPoint(point, elementMatrix))
    .map((point) => transformPoint(point, rootInverse));

  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);

  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

function getArea(box) {
  return box.width * box.height;
}

function getCenter(box) {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

function insetBox(box, insetX, insetY = insetX) {
  return {
    x: box.x + insetX,
    y: box.y + insetY,
    width: Math.max(box.width - insetX * 2, 1),
    height: Math.max(box.height - insetY * 2, 1),
  };
}

function boxesOverlap(boxA, boxB, padding = 0) {
  return !(
    boxA.x + boxA.width < boxB.x - padding ||
    boxB.x + boxB.width < boxA.x - padding ||
    boxA.y + boxA.height < boxB.y - padding ||
    boxB.y + boxB.height < boxA.y - padding
  );
}

function boxContainsPoint(box, point, padding = 0) {
  return (
    point.x >= box.x - padding &&
    point.x <= box.x + box.width + padding &&
    point.y >= box.y - padding &&
    point.y <= box.y + box.height + padding
  );
}

function expandBox(box, paddingX, paddingY = paddingX) {
  return {
    x: box.x - paddingX,
    y: box.y - paddingY,
    width: box.width + paddingX * 2,
    height: box.height + paddingY * 2,
  };
}

function createSpatialIndex(entries) {
  const grid = new Map();

  entries.forEach((entry) => {
    const startX = Math.floor(entry.box.x / GRID_SIZE);
    const endX = Math.floor((entry.box.x + entry.box.width) / GRID_SIZE);
    const startY = Math.floor(entry.box.y / GRID_SIZE);
    const endY = Math.floor((entry.box.y + entry.box.height) / GRID_SIZE);

    for (let x = startX; x <= endX; x += 1) {
      for (let y = startY; y <= endY; y += 1) {
        const key = `${x}:${y}`;

        if (!grid.has(key)) {
          grid.set(key, []);
        }

        grid.get(key).push(entry);
      }
    }
  });

  return {
    query(box) {
      const results = new Set();
      const startX = Math.floor(box.x / GRID_SIZE);
      const endX = Math.floor((box.x + box.width) / GRID_SIZE);
      const startY = Math.floor(box.y / GRID_SIZE);
      const endY = Math.floor((box.y + box.height) / GRID_SIZE);

      for (let x = startX; x <= endX; x += 1) {
        for (let y = startY; y <= endY; y += 1) {
          const bucket = grid.get(`${x}:${y}`);

          if (!bucket) {
            continue;
          }

          bucket.forEach((entry) => results.add(entry));
        }
      }

      return Array.from(results);
    },
  };
}

function collectGeometry(svgRoot) {
  const svgBox = getBBoxSafe(svgRoot);
  const maxArea = svgBox ? getArea(svgBox) * 0.22 : Infinity;

  const rawEntries = Array.from(svgRoot.querySelectorAll(SHAPE_SELECTOR))
    .filter((element) => !element.closest('defs'))
    .map((element) => ({
      element,
      box: getTransformedBBoxSafe(element, svgRoot),
    }))
    .filter((entry) => entry.box);

  const entries = rawEntries.filter(
    (entry) => getArea(entry.box) > 4 && getArea(entry.box) < maxArea,
  );

  const lineEntries = rawEntries.filter(
    (entry) =>
      (entry.box.width <= LINE_THICKNESS_LIMIT && entry.box.height >= 18) ||
      (entry.box.height <= LINE_THICKNESS_LIMIT && entry.box.width >= 18),
  );

  return {
    spatialIndex: createSpatialIndex(entries),
    lineIndex: createSpatialIndex(lineEntries),
  };
}

function sortCandidatesByAreaAndDistance(candidates, textCenter) {
  return [...candidates].sort((candidateA, candidateB) => {
    const areaDelta = getArea(candidateA.box) - getArea(candidateB.box);

    if (areaDelta !== 0) {
      return areaDelta;
    }

    const centerA = getCenter(candidateA.box);
    const centerB = getCenter(candidateB.box);
    const distanceA = Math.hypot(centerA.x - textCenter.x, centerA.y - textCenter.y);
    const distanceB = Math.hypot(centerB.x - textCenter.x, centerB.y - textCenter.y);

    return distanceA - distanceB;
  });
}

function resolveFromParentGroups(textElement, textBox, svgRoot) {
  const textCenter = getCenter(textBox);
  let node = textElement.parentElement;

  while (node && node !== svgRoot) {
    const candidates = Array.from(node.querySelectorAll(SHAPE_SELECTOR))
      .filter((shape) => !shape.closest('defs'))
      .map((element) => ({
        element,
        box: getBBoxSafe(element),
      }))
      .filter(
        (entry) =>
          entry.box &&
          boxContainsPoint(entry.box, textCenter, 4) &&
          getArea(entry.box) > getArea(textBox) * 4,
      );

    if (candidates.length > 0) {
      return sortCandidatesByAreaAndDistance(candidates, textCenter)[0].box;
    }

    node = node.parentElement;
  }

  return null;
}

function resolveFromDirectShapes(textBox, geometry) {
  const textCenter = getCenter(textBox);
  const searchBox = expandBox(textBox, 36, 28);
  const candidates = geometry.spatialIndex
    .query(searchBox)
    .filter(
      (entry) =>
        boxContainsPoint(entry.box, textCenter, 5) &&
        getArea(entry.box) > getArea(textBox) * 5 &&
        entry.box.width > textBox.width * 1.4 &&
        entry.box.height > textBox.height * 1.4,
    );

  if (candidates.length === 0) {
    return null;
  }

  return sortCandidatesByAreaAndDistance(candidates, textCenter)[0].box;
}

function findNearestBoundary(entryList, predicate, sorter) {
  return entryList.filter(predicate).sort(sorter)[0] || null;
}

function resolveFromBoundaryLines(textBox, geometry) {
  const textCenter = getCenter(textBox);
  const searchBox = expandBox(textBox, 120, 120);
  const candidates = geometry.lineIndex
    .query(searchBox)
    .filter((entry) => boxesOverlap(entry.box, searchBox, 8));

  if (candidates.length < 4) {
    return null;
  }

  const left = findNearestBoundary(
    candidates,
    (entry) =>
      entry.box.width <= LINE_THICKNESS_LIMIT &&
      entry.box.x + entry.box.width <= textCenter.x &&
      entry.box.y <= textCenter.y + textBox.height &&
      entry.box.y + entry.box.height >= textCenter.y - textBox.height,
    (entryA, entryB) =>
      textCenter.x - (entryA.box.x + entryA.box.width) -
      (textCenter.x - (entryB.box.x + entryB.box.width)),
  );

  const right = findNearestBoundary(
    candidates,
    (entry) =>
      entry.box.width <= LINE_THICKNESS_LIMIT &&
      entry.box.x >= textCenter.x &&
      entry.box.y <= textCenter.y + textBox.height &&
      entry.box.y + entry.box.height >= textCenter.y - textBox.height,
    (entryA, entryB) => entryA.box.x - entryB.box.x,
  );

  const top = findNearestBoundary(
    candidates,
    (entry) =>
      entry.box.height <= LINE_THICKNESS_LIMIT &&
      entry.box.y + entry.box.height <= textCenter.y &&
      entry.box.x <= textCenter.x + textBox.width &&
      entry.box.x + entry.box.width >= textCenter.x - textBox.width,
    (entryA, entryB) =>
      textCenter.y - (entryA.box.y + entryA.box.height) -
      (textCenter.y - (entryB.box.y + entryB.box.height)),
  );

  const bottom = findNearestBoundary(
    candidates,
    (entry) =>
      entry.box.height <= LINE_THICKNESS_LIMIT &&
      entry.box.y >= textCenter.y &&
      entry.box.x <= textCenter.x + textBox.width &&
      entry.box.x + entry.box.width >= textCenter.x - textBox.width,
    (entryA, entryB) => entryA.box.y - entryB.box.y,
  );

  if (!left || !right || !top || !bottom) {
    return null;
  }

  const inferredBox = {
    x: left.box.x + left.box.width,
    y: top.box.y + top.box.height,
    width: right.box.x - (left.box.x + left.box.width),
    height: bottom.box.y - (top.box.y + top.box.height),
  };

  if (
    inferredBox.width <= textBox.width * 1.35 ||
    inferredBox.height <= textBox.height * 1.35
  ) {
    return null;
  }

  return insetBox(inferredBox, 3, 3);
}

function median(values) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middleIndex = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middleIndex - 1] + sorted[middleIndex]) / 2;
  }

  return sorted[middleIndex];
}

function inferAxisBounds(peers, targetValue, fallbackSpan) {
  const sortedValues = peers
    .map((peer) => peer.value)
    .concat(targetValue)
    .sort((valueA, valueB) => valueA - valueB);
  const targetIndex = sortedValues.findIndex((value) => value === targetValue);
  const previous = targetIndex > 0 ? sortedValues[targetIndex - 1] : null;
  const next = targetIndex < sortedValues.length - 1 ? sortedValues[targetIndex + 1] : null;
  const peerGaps = [];

  for (let index = 1; index < sortedValues.length; index += 1) {
    peerGaps.push(sortedValues[index] - sortedValues[index - 1]);
  }

  const gapGuess =
    median(peerGaps) ||
    (previous !== null ? targetValue - previous : null) ||
    (next !== null ? next - targetValue : null) ||
    fallbackSpan;

  const left = previous !== null ? (previous + targetValue) / 2 : targetValue - gapGuess / 2;
  const right = next !== null ? (targetValue + next) / 2 : targetValue + gapGuess / 2;

  return {
    start: left,
    end: right,
  };
}

function resolveFromLabelGrid(entry, textEntries) {
  const rowTolerance = Math.max(entry.textBox.height * 0.7, 4);
  const columnTolerance = Math.max(entry.textBox.width * 0.55, 10);
  const rowPeers = textEntries
    .filter(
      (peer) =>
        peer.shopId !== entry.shopId &&
        Math.abs(peer.center.y - entry.center.y) <= rowTolerance,
    )
    .map((peer) => ({
      value: peer.center.x,
    }));
  const columnPeers = textEntries
    .filter(
      (peer) =>
        peer.shopId !== entry.shopId &&
        Math.abs(peer.center.x - entry.center.x) <= columnTolerance,
    )
    .map((peer) => ({
      value: peer.center.y,
    }));

  if (rowPeers.length === 0 || columnPeers.length === 0) {
    return null;
  }

  const horizontal = inferAxisBounds(
    rowPeers,
    entry.center.x,
    Math.max(entry.textBox.width * 2.2, 40),
  );
  const vertical = inferAxisBounds(
    columnPeers,
    entry.center.y,
    Math.max(entry.textBox.height * 6.5, 48),
  );

  const fittedBox = insetBox(
    {
      x: horizontal.start,
      y: vertical.start,
      width: horizontal.end - horizontal.start,
      height: vertical.end - vertical.start,
    },
    2,
    2,
  );

  if (
    fittedBox.width <= entry.textBox.width * 1.35 ||
    fittedBox.height <= entry.textBox.height * 1.7
  ) {
    return null;
  }

  return fittedBox;
}

function resolveShopBounds(entry, svgRoot, geometry, textEntries) {
  return expandBox(entry.textBox, 24, 18);
}

function collectShopTextEntries(svgRoot) {
  return Array.from(svgRoot.querySelectorAll('text'))
    .map((textElement) => ({
      textElement,
      shopId: normalizeShopId(textElement.textContent || ''),
      textBox: getTransformedBBoxSafe(textElement, svgRoot),
    }))
    .filter((entry) => entry.textBox && isValidShopId(entry.shopId));
}

function withCenters(textEntries) {
  return textEntries.map((entry) => ({
    ...entry,
    center: getCenter(entry.textBox),
  }));
}

function resolveTopLevelChild(svgRoot, element) {
  let current = element;

  while (current?.parentElement && current.parentElement !== svgRoot) {
    current = current.parentElement;
  }

  return current?.parentElement === svgRoot ? current : null;
}

function createOverlayLayer(svgRoot, textEntries) {
  const overlayLayer = document.createElementNS(SVG_NS, 'g');
  overlayLayer.setAttribute('class', 'shop-overlay-layer');
  const referenceNode = resolveTopLevelChild(svgRoot, textEntries[0]?.textElement || null);

  if (referenceNode) {
    svgRoot.insertBefore(overlayLayer, referenceNode);
  } else {
    svgRoot.appendChild(overlayLayer);
  }

  return overlayLayer;
}

function indexNativeShopElements(svgRoot) {
  const registry = new Map();

  Array.from(svgRoot.querySelectorAll('[id]')).forEach((element) => {
    const shopId = normalizeShopId(element.id);

    if (!isValidShopId(shopId) || registry.has(shopId)) {
      return;
    }

    const shapes = element.matches(SHAPE_SELECTOR)
      ? [element]
      : Array.from(element.querySelectorAll(SHAPE_SELECTOR));

    if (shapes.length === 0) {
      return;
    }

    element.dataset.shopId = shopId;
    registry.set(shopId, {
      root: element,
      shapes,
    });
  });

  return registry;
}

function createOverlayShop(overlayLayer, entry, box) {
  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('id', entry.shopId);
  group.setAttribute('data-shop-id', entry.shopId);
  group.setAttribute('class', 'shop-unit');

  const roomBox = box.roomBox || box;
  const roomPolygon = Array.isArray(box.roomPolygon) ? box.roomPolygon : null;
  const shape = roomPolygon?.length >= 3
    ? document.createElementNS(SVG_NS, 'polygon')
    : document.createElementNS(SVG_NS, 'rect');
  shape.setAttribute('class', 'shop-unit__shape');

  if (roomPolygon?.length >= 3) {
    shape.setAttribute(
      'points',
      roomPolygon.map((point) => `${point.x},${point.y}`).join(' '),
    );
  } else {
    shape.setAttribute('x', `${roomBox.x}`);
    shape.setAttribute('y', `${roomBox.y}`);
    shape.setAttribute('width', `${Math.max(roomBox.width, 1)}`);
    shape.setAttribute('height', `${Math.max(roomBox.height, 1)}`);
  }

  shape.setAttribute('fill', 'transparent');
  shape.setAttribute('stroke', 'transparent');
  shape.setAttribute('stroke-width', '0');
  shape.setAttribute('vector-effect', 'non-scaling-stroke');
  shape.setAttribute('pointer-events', 'all');
  group.appendChild(shape);
  overlayLayer.appendChild(group);

  if (entry.textElement) {
    entry.textElement.dataset.shopId = entry.shopId;
    entry.textElement.classList.add('shop-label');
  }

  return {
    root: group,
    shapes: [shape],
  };
}

function indexShopTextEntriesById(svgRoot) {
  return new Map(
    collectShopTextEntries(svgRoot).map((entry) => [entry.shopId, entry]),
  );
}

function buildOverlayRegistryFromGeometry(svgRoot, geometryShops) {
  const registry = new Map();
  const textEntriesById = indexShopTextEntriesById(svgRoot);
  const overlayLayer = createOverlayLayer(svgRoot, [...textEntriesById.values()]);

  geometryShops.forEach((geometryShop) => {
    if (!geometryShop?.shopId || !geometryShop.roomBox || registry.has(geometryShop.shopId)) {
      return;
    }

    registry.set(
      geometryShop.shopId,
      createOverlayShop(
        overlayLayer,
        textEntriesById.get(geometryShop.shopId) || geometryShop,
        geometryShop,
      ),
    );
  });

  return {
    registry,
    cleanup() {
      overlayLayer.remove();
    },
  };
}

function buildFallbackOverlayRegistry(svgRoot, geometryShops = []) {
  if (geometryShops.length > 0) {
    return buildOverlayRegistryFromGeometry(svgRoot, geometryShops);
  }

  const registry = new Map();
  const geometry = collectGeometry(svgRoot);
  const textEntries = withCenters(collectShopTextEntries(svgRoot));
  const overlayLayer = createOverlayLayer(svgRoot, textEntries);

  textEntries.forEach((entry) => {
    if (registry.has(entry.shopId)) {
      return;
    }

    const box = resolveShopBounds(entry, svgRoot, geometry, textEntries);
    registry.set(entry.shopId, createOverlayShop(overlayLayer, entry, box));
  });

  return {
    registry,
    cleanup() {
      overlayLayer.remove();
    },
  };
}

function setShopVisual(entry, status) {
  const style = SHOP_STATUS_META[status] || SHOP_STATUS_META.available;

  if (entry.root.dataset.status === status) {
    return;
  }

  entry.root.dataset.status = status;

  entry.shapes.forEach((shape) => {
    shape.setAttribute('fill', style.fill);
    shape.setAttribute('stroke', style.stroke);
    shape.setAttribute('stroke-width', `${style.strokeWidth}`);
  });
}

export function applyShopStatuses(registry, statusMap) {
  registry.forEach((entry, shopId) => {
    setShopVisual(entry, statusMap[shopId]?.status || 'available');
  });
}

export function syncSelectedShop(registry, selectedShopId) {
  registry.forEach((entry, shopId) => {
    entry.root.classList.toggle('is-selected', shopId === selectedShopId);
  });
}

export function initializeShopLayer({
  container,
  geometryShops = [],
  onHoverShopChange,
  onSelectShop,
}) {
  const svgRoot = container.querySelector('svg');

  if (!svgRoot) {
    return {
      registry: new Map(),
      cleanup() {},
    };
  }

  svgRoot.classList.add('floorplan-svg');
  svgRoot.removeAttribute('width');
  svgRoot.removeAttribute('height');
  svgRoot.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  let cleanupOverlay = () => {};
  let registry = indexNativeShopElements(svgRoot);

  if (registry.size === 0) {
    const overlaySession = buildFallbackOverlayRegistry(svgRoot, geometryShops);
    registry = overlaySession.registry;
    cleanupOverlay = overlaySession.cleanup;
  }

  const handlePointerOver = (event) => {
    const target = event.target;

    if (!(target instanceof Element)) {
      return;
    }

    const shopId = target.closest('[data-shop-id]')?.getAttribute('data-shop-id');
    onHoverShopChange(shopId || null);
  };

  const handlePointerLeave = () => {
    onHoverShopChange(null);
  };

  const handleClick = (event) => {
    const target = event.target;

    if (!(target instanceof Element)) {
      return;
    }

    const shopId = target.closest('[data-shop-id]')?.getAttribute('data-shop-id');

    if (shopId) {
      onSelectShop(shopId);
    }
  };

  container.addEventListener('pointerover', handlePointerOver);
  container.addEventListener('pointerleave', handlePointerLeave);
  container.addEventListener('click', handleClick);

  return {
    registry,
    cleanup() {
      cleanupOverlay();
      container.removeEventListener('pointerover', handlePointerOver);
      container.removeEventListener('pointerleave', handlePointerLeave);
      container.removeEventListener('click', handleClick);
    },
  };
}
