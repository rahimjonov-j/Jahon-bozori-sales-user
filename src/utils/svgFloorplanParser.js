import { highlightDebug } from '../mocks/shopStatuses';
import { inferShopMeta, isShopLabel, normalizeShopLabel } from './shopLabel';

const SHAPE_SELECTOR = 'path, rect, polygon, polyline, line, ellipse, circle';
const GRID_SIZE = 96;
const LINE_THICKNESS_LIMIT = 14;

const highlightVisuals = {
  sold: {
    stroke: '#d4263b',
    fill: 'rgba(212, 38, 59, 0.18)',
    strokeWidth: 3.2,
  },
  booked: {
    stroke: '#ea7a20',
    fill: 'rgba(234, 122, 32, 0.22)',
    strokeWidth: 3.2,
  },
};

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
    svgRoot && typeof svgRoot.getScreenCTM === 'function' ? svgRoot.getScreenCTM() : null;
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
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
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

  const entries = Array.from(svgRoot.querySelectorAll(SHAPE_SELECTOR))
    .filter((element) => !element.closest('defs'))
    .map((element) => ({
      element,
      box: getBBoxSafe(element),
    }))
    .filter((entry) => {
      if (!entry.box) {
        return false;
      }

      const area = getArea(entry.box);

      return area > 4 && area < maxArea;
    });

  const lineEntries = entries.filter(
    (entry) =>
      (entry.box.width <= LINE_THICKNESS_LIMIT && entry.box.height >= 18) ||
      (entry.box.height <= LINE_THICKNESS_LIMIT && entry.box.width >= 18),
  );

  return {
    entries,
    lineEntries,
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
      return {
        method: 'parent-group-match',
        box: sortCandidatesByAreaAndDistance(candidates, textCenter)[0].box,
      };
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

  return {
    method: 'direct-shape-match',
    box: sortCandidatesByAreaAndDistance(candidates, textCenter)[0].box,
  };
}

function findNearestBoundary(entryList, predicate, sorter) {
  const candidates = entryList.filter(predicate).sort(sorter);
  return candidates[0] || null;
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

  return {
    method: 'inferred-overlay-rectangle',
    box: inferredBox,
  };
}

function resolveShopBounds(textElement, textBox, svgRoot, geometry) {
  return (
    resolveFromParentGroups(textElement, textBox, svgRoot) ||
    resolveFromDirectShapes(textBox, geometry) ||
    resolveFromBoundaryLines(textBox, geometry) || {
      method: 'text-bounds-fallback',
      box: expandBox(textBox, 24, 18),
    }
  );
}

function collectShopTextEntries(svgRoot) {
  return Array.from(svgRoot.querySelectorAll('text'))
    .map((textElement) => ({
      textElement,
      label: normalizeShopLabel(textElement.textContent || ''),
      textBox: getTransformedBBoxSafe(textElement, svgRoot),
    }))
    .filter((entry) => entry.textBox && isShopLabel(entry.label))
    .map((entry) => ({
      ...entry,
      center: getCenter(entry.textBox),
    }));
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

function resolveFromLabelGrid(match, labelEntries) {
  const rowTolerance = Math.max(match.textBox.height * 0.7, 4);
  const columnTolerance = Math.max(match.textBox.width * 0.55, 10);
  const rowPeers = labelEntries
    .filter(
      (entry) =>
        entry.label !== match.label &&
        Math.abs(entry.center.y - match.center.y) <= rowTolerance,
    )
    .map((entry) => ({
      entry,
      value: entry.center.x,
    }));
  const columnPeers = labelEntries
    .filter(
      (entry) =>
        entry.label !== match.label &&
        Math.abs(entry.center.x - match.center.x) <= columnTolerance,
    )
    .map((entry) => ({
      entry,
      value: entry.center.y,
    }));

  if (rowPeers.length === 0 || columnPeers.length === 0) {
    return null;
  }

  const horizontal = inferAxisBounds(
    rowPeers,
    match.center.x,
    Math.max(match.textBox.width * 2.2, 40),
  );
  const vertical = inferAxisBounds(
    columnPeers,
    match.center.y,
    Math.max(match.textBox.height * 6.5, 48),
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

  return {
    method: 'label-grid-fit',
    box: fittedBox,
  };
}

function createCustomBounds(textBox, overlayPadding) {
  return {
    x: textBox.x - overlayPadding.left,
    y: textBox.y - overlayPadding.top,
    width: textBox.width + overlayPadding.left + overlayPadding.right,
    height: textBox.height + overlayPadding.top + overlayPadding.bottom,
  };
}

function createRect(svgRoot, className, box, attrs = {}) {
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', `${box.x}`);
  rect.setAttribute('y', `${box.y}`);
  rect.setAttribute('width', `${Math.max(box.width, 1)}`);
  rect.setAttribute('height', `${Math.max(box.height, 1)}`);
  rect.setAttribute('class', className);

  Object.entries(attrs).forEach(([name, value]) => {
    rect.setAttribute(name, value);
  });

  svgRoot.appendChild(rect);
  return rect;
}

function insertRectBefore(svgRoot, referenceNode, className, box, attrs = {}) {
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  const strokeWidth = Number(attrs['stroke-width'] || 0);
  const inset = strokeWidth / 2;
  rect.setAttribute('x', `${box.x + inset}`);
  rect.setAttribute('y', `${box.y + inset}`);
  rect.setAttribute('width', `${Math.max(box.width - strokeWidth, 1)}`);
  rect.setAttribute('height', `${Math.max(box.height - strokeWidth, 1)}`);
  rect.setAttribute('class', className);

  Object.entries(attrs).forEach(([name, value]) => {
    rect.setAttribute(name, value);
  });

  if (
    referenceNode &&
    referenceNode.parentNode === svgRoot
  ) {
    svgRoot.insertBefore(rect, referenceNode);
  } else {
    svgRoot.appendChild(rect);
  }

  return rect;
}

function drawDebugVisuals(svgRoot, match, resolution) {
  const debugNodes = [];

  if (highlightDebug.showMatchedTextBounds) {
    debugNodes.push(
      createRect(svgRoot, 'shop-debug-text', match.textBox, {
        fill: 'none',
        stroke: '#2563eb',
        'stroke-width': '2',
        'stroke-dasharray': '6 4',
        'vector-effect': 'non-scaling-stroke',
      }),
    );
  }

  if (highlightDebug.showResolvedShopBounds) {
    debugNodes.push(
      createRect(svgRoot, 'shop-debug-box', resolution.box, {
        fill: 'none',
        stroke: '#0f766e',
        'stroke-width': '2',
        'stroke-dasharray': '10 6',
        'vector-effect': 'non-scaling-stroke',
      }),
    );
  }

  return debugNodes;
}

function logDebug(match, resolution) {
  if (!highlightDebug.enabled || !highlightDebug.logToConsole) {
    return;
  }

  console.info('[shop-highlight-debug]', {
    label: match.label,
    textBox: match.textBox,
    resolvedBox: resolution.box,
    strategy: resolution.method,
  });
}

function findRequestedText(svgRoot, label) {
  const matches = collectShopTextEntries(svgRoot).filter((entry) => entry.label === label);

  if (matches.length === 0) {
    return null;
  }

  return matches.sort((matchA, matchB) => getArea(matchA.textBox) - getArea(matchB.textBox))[0];
}

function snapBoxToLabelRow(svgRoot, label, box) {
  const allLabels = Array.from(svgRoot.querySelectorAll('text'))
    .map((textElement) => ({
      textElement,
      label: normalizeShopLabel(textElement.textContent || ''),
      textBox: getBBoxSafe(textElement),
    }))
    .filter((entry) => entry.textBox && isShopLabel(entry.label));

  const target = allLabels.find((entry) => entry.label === label);

  if (!target) {
    return box;
  }

  const targetCenterX = target.textBox.x + target.textBox.width / 2;
  const targetCenterY = target.textBox.y + target.textBox.height / 2;
  const sameRowLabels = allLabels
    .filter((entry) => {
      const centerY = entry.textBox.y + entry.textBox.height / 2;
      return Math.abs(centerY - targetCenterY) <= 4;
    })
    .sort(
      (entryA, entryB) =>
        entryA.textBox.x + entryA.textBox.width / 2 - (entryB.textBox.x + entryB.textBox.width / 2),
    );

  const targetIndex = sameRowLabels.findIndex((entry) => entry.label === label);

  if (targetIndex === -1) {
    return box;
  }

  const previous = sameRowLabels[targetIndex - 1] || null;
  const next = sameRowLabels[targetIndex + 1] || null;
  const previousCenterX = previous
    ? previous.textBox.x + previous.textBox.width / 2
    : null;
  const nextCenterX = next ? next.textBox.x + next.textBox.width / 2 : null;

  let left = box.x;
  let right = box.x + box.width;

  if (previousCenterX !== null) {
    left = (previousCenterX + targetCenterX) / 2;
  } else if (nextCenterX !== null) {
    left = targetCenterX - (nextCenterX - targetCenterX) / 2;
  }

  if (nextCenterX !== null) {
    right = (targetCenterX + nextCenterX) / 2;
  } else if (previousCenterX !== null) {
    right = targetCenterX + (targetCenterX - previousCenterX) / 2;
  }

  return {
    ...box,
    x: left,
    width: Math.max(right - left, 1),
  };
}

export function decorateSvgFloorplan({
  container,
  activeBlock,
  activeFloorPlan,
  shopStatusMap,
  onShopSelect,
}) {
  const svgRoot = container.querySelector('svg');

  if (!svgRoot) {
    return {
      cleanup() {},
      detectedShops: [],
    };
  }

  svgRoot.classList.add('floorplan-svg');
  svgRoot.removeAttribute('width');
  svgRoot.removeAttribute('height');
  svgRoot.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const geometry = collectGeometry(svgRoot);
  const labelEntries = collectShopTextEntries(svgRoot);
  const requestedShops = Object.values(shopStatusMap).filter(
    (shop) => shop.planId === activeFloorPlan.id,
  );
  const debugNodes = [];
  const overlayNodes = [];
  const detectedShops = [];
  const overlayLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  overlayLayer.setAttribute('class', 'shop-overlay-layer');
  svgRoot.appendChild(overlayLayer);
  overlayNodes.push(overlayLayer);

  requestedShops.forEach((shop) => {
    const match = labelEntries.find(
      (entry) => entry.label === normalizeShopLabel(shop.label),
    ) || null;

    if (shop.absoluteBox) {
      const snappedBox = shop.snapToLabelRow
        ? snapBoxToLabelRow(svgRoot, normalizeShopLabel(shop.label), shop.absoluteBox)
        : shop.absoluteBox;

      const detectedShop = {
        ...inferShopMeta(shop.label),
        ...shop,
        blockName: activeBlock.name,
        roomBox: snappedBox,
        resolutionMethod: 'absolute-box-override',
      };

      if (highlightDebug.enabled && highlightDebug.logToConsole) {
        console.info('[shop-highlight-debug]', {
          label: shop.label,
          resolvedBox: snappedBox,
          strategy: 'absolute-box-override',
        });
      }

      if (match?.textElement) {
        match.textElement.dataset.shopId = `${shop.planId}:${shop.label}`;
        match.textElement.classList.add('shop-label');
      }

      const overlayVisual = {
        ...highlightVisuals[shop.status],
        ...shop.overlayVisual,
      };

      overlayNodes.push(
        createRect(overlayLayer, `shop-overlay status-${shop.status}`, snappedBox, {
          fill: overlayVisual.fill,
          stroke: overlayVisual.stroke,
          'stroke-width': `${overlayVisual.strokeWidth}`,
          'vector-effect': 'non-scaling-stroke',
          'pointer-events': 'all',
          'data-shop-id': `${shop.planId}:${shop.label}`,
        }),
      );

      detectedShops.push(detectedShop);
      return;
    }

    if (shop.fitMode === 'label-cell' && match) {
      const fittedResolution = resolveFromLabelGrid(match, labelEntries);

      if (fittedResolution) {
        const detectedShop = {
          ...inferShopMeta(shop.label),
          ...shop,
          blockName: activeBlock.name,
          roomBox: fittedResolution.box,
          resolutionMethod: fittedResolution.method,
        };

        match.textElement.dataset.shopId = `${shop.planId}:${shop.label}`;
        match.textElement.classList.add('shop-label');

        const overlayVisual = {
          ...highlightVisuals[shop.status],
          ...shop.overlayVisual,
        };

        overlayNodes.push(
          createRect(overlayLayer, `shop-overlay status-${shop.status}`, fittedResolution.box, {
            fill: overlayVisual.fill,
            stroke: overlayVisual.stroke,
            'stroke-width': `${overlayVisual.strokeWidth}`,
            'vector-effect': 'non-scaling-stroke',
            'pointer-events': 'all',
            'data-shop-id': `${shop.planId}:${shop.label}`,
          }),
        );

        logDebug(match, fittedResolution);
        detectedShops.push(detectedShop);
        return;
      }
    }

    if (!match) {
      if (highlightDebug.enabled && highlightDebug.logToConsole) {
        console.warn('[shop-highlight-debug] text not found', shop.label);
      }

      return;
    }

    const resolution = resolveShopBounds(
      match.textElement,
      match.textBox,
      svgRoot,
      geometry,
    );
    const resolvedBox =
      shop.overlayMode === 'custom-box' && shop.overlayPadding
        ? createCustomBounds(match.textBox, shop.overlayPadding)
        : resolution.box;
    const resolutionMethod =
      shop.overlayMode === 'custom-box'
        ? 'custom-overlay-rectangle'
        : resolution.method;

    const detectedShop = {
      ...inferShopMeta(shop.label),
      ...shop,
      blockName: activeBlock.name,
      roomBox: resolvedBox,
      resolutionMethod: resolutionMethod,
    };

    match.textElement.dataset.shopId = `${shop.planId}:${shop.label}`;
    match.textElement.classList.add('shop-label');

    const overlayVisual = {
      ...highlightVisuals[shop.status],
      ...shop.overlayVisual,
    };

    overlayNodes.push(
      createRect(overlayLayer, `shop-overlay status-${shop.status}`, resolvedBox, {
        fill: overlayVisual.fill,
        stroke: overlayVisual.stroke,
        'stroke-width': `${overlayVisual.strokeWidth}`,
        'vector-effect': 'non-scaling-stroke',
        'pointer-events': 'all',
        'data-shop-id': `${shop.planId}:${shop.label}`,
      }),
    );

    logDebug(match, {
      ...resolution,
      box: resolvedBox,
      method: resolutionMethod,
    });

    if (highlightDebug.enabled) {
      debugNodes.push(
        ...drawDebugVisuals(svgRoot, match, {
          ...resolution,
          box: resolvedBox,
          method: resolutionMethod,
        }),
      );
    }

    detectedShops.push(detectedShop);
  });

  const detectedShopMap = new Map(
    detectedShops.map((shop) => [`${shop.planId}:${shop.label}`, shop]),
  );

  const handleClick = (event) => {
    const target = event.target;

    if (!(target instanceof Element)) {
      return;
    }

    const clickableElement = target.closest('[data-shop-id]');
    const shopKey = clickableElement?.getAttribute('data-shop-id');

    if (!shopKey) {
      return;
    }

    const shop = detectedShopMap.get(shopKey);

    if (shop) {
      onShopSelect(shop);
    }
  };

  container.addEventListener('click', handleClick);

  return {
    detectedShops,
    cleanup() {
      overlayNodes.forEach((node) => node.remove());
      debugNodes.forEach((node) => node.remove());
      container.removeEventListener('click', handleClick);
    },
  };
}
