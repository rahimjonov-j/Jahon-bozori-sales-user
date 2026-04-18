import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { floorPlans } from '../shared/floor-plans.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const DEFAULT_LAYER_ALLOWLIST = [
  'A-WALL',
  'A-WALL-CURT',
  'A-WALL-SHEA',
  'A-COLU-CONC',
  'A-DOOR',
  'A-WINDOW',
  'A-FLOR-RAIL',
  'A-FLOR-STRS',
];

function resolveAssetPath(assetFile) {
  return path.resolve(repoRoot, assetFile);
}

function createOutputPath(assetFile) {
  const sourcePath = resolveAssetPath(assetFile);
  const extension = path.extname(sourcePath);
  return sourcePath.replace(new RegExp(`${extension}$`), '.geometry.json');
}

async function readSvg(assetFile) {
  return fs.readFile(resolveAssetPath(assetFile), 'utf8');
}

function createPageMarkup(svgMarkup) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
      }

      body {
        display: flex;
        align-items: flex-start;
        justify-content: flex-start;
      }
    </style>
  </head>
  <body>${svgMarkup}</body>
</html>`;
}

async function exportFloorPlan(page, floorPlan) {
  const svgMarkup = await readSvg(floorPlan.assetFile);
  await page.setContent(createPageMarkup(svgMarkup));

  return page.evaluate(
    ({ floorPlanId, sourceAsset, layerAllowlist }) => {
      const SHOP_ID_PATTERN = /^[A-Z]-\d+-\d+$/;
      const SHAPE_SELECTOR = 'path, rect, polygon, polyline, line, ellipse, circle';
      const GRID_SIZE = 96;
      const LINE_THICKNESS_LIMIT = 14;
      const ORIENTATION_TOLERANCE = 8;
      const SEGMENT_ALIGNMENT_TOLERANCE = 4;
      const SEGMENT_GAP_TOLERANCE = 18;
      const BOUNDARY_SEARCH_PADDING = 260;
      const STRIP_CANDIDATE_LIMIT = 4;
      const STRIP_OFFSET_CLUSTER_TOLERANCE = 4;

      function normalizeShopId(value = '') {
        return value.replace(/\s+/g, '').trim().toUpperCase();
      }

      function isValidShopId(value = '') {
        return SHOP_ID_PATTERN.test(normalizeShopId(value));
      }

      function round(value) {
        return Number(value.toFixed(2));
      }

      function roundBox(box) {
        return {
          x: round(box.x),
          y: round(box.y),
          width: round(box.width),
          height: round(box.height),
        };
      }

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

      function getTransformedPoint(element, svgRoot, point) {
        const elementMatrix =
          typeof element.getScreenCTM === 'function' ? element.getScreenCTM() : null;
        const rootMatrix =
          typeof svgRoot?.getScreenCTM === 'function' ? svgRoot.getScreenCTM() : null;
        const rootInverse = rootMatrix ? invertMatrix(rootMatrix) : null;

        if (!elementMatrix || !rootInverse) {
          return point;
        }

        return transformPoint(transformPoint(point, elementMatrix), rootInverse);
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

      function getBoxCorners(box) {
        return [
          { x: box.x, y: box.y },
          { x: box.x + box.width, y: box.y },
          { x: box.x + box.width, y: box.y + box.height },
          { x: box.x, y: box.y + box.height },
        ];
      }

      function dot(vectorA, vectorB) {
        return vectorA.x * vectorB.x + vectorA.y * vectorB.y;
      }

      function getCanonicalOrientation(angle) {
        let normalized = ((angle % 180) + 180) % 180;
        let best = null;
        let bestDiff = Infinity;

        [0, 45, 90, 135].forEach((candidate) => {
          const diff = Math.min(
            Math.abs(normalized - candidate),
            Math.abs(normalized - candidate + 180),
            Math.abs(normalized - candidate - 180),
          );

          if (diff < bestDiff) {
            bestDiff = diff;
            best = candidate;
          }
        });

        return bestDiff <= ORIENTATION_TOLERANCE ? best : null;
      }

      function createUnitVectors(angle) {
        const radians = (angle * Math.PI) / 180;

        return {
          tangent: {
            x: Math.cos(radians),
            y: Math.sin(radians),
          },
          normal: {
            x: -Math.sin(radians),
            y: Math.cos(radians),
          },
        };
      }

      function lineIntersection(lineA, lineB) {
        const determinant =
          lineA.normal.x * lineB.normal.y - lineB.normal.x * lineA.normal.y;

        if (Math.abs(determinant) < 1e-6) {
          return null;
        }

        return {
          x:
            (lineA.offset * lineB.normal.y - lineB.offset * lineA.normal.y) /
            determinant,
          y:
            (lineA.normal.x * lineB.offset - lineB.normal.x * lineA.offset) /
            determinant,
        };
      }

      function polygonArea(points) {
        if (points.length < 3) {
          return 0;
        }

        let sum = 0;

        for (let index = 0; index < points.length; index += 1) {
          const pointA = points[index];
          const pointB = points[(index + 1) % points.length];
          sum += pointA.x * pointB.y - pointB.x * pointA.y;
        }

        return sum / 2;
      }

      function sortPolygonPoints(points) {
        const center = points.reduce(
          (accumulator, point) => ({
            x: accumulator.x + point.x / points.length,
            y: accumulator.y + point.y / points.length,
          }),
          { x: 0, y: 0 },
        );

        return [...points].sort((pointA, pointB) => {
          const angleA = Math.atan2(pointA.y - center.y, pointA.x - center.x);
          const angleB = Math.atan2(pointB.y - center.y, pointB.x - center.x);
          return angleA - angleB;
        });
      }

      function getPolygonBounds(points) {
        const xs = points.map((point) => point.x);
        const ys = points.map((point) => point.y);

        return {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        };
      }

      function pointInPolygon(point, polygon) {
        let isInside = false;

        for (
          let indexA = 0, indexB = polygon.length - 1;
          indexA < polygon.length;
          indexB = indexA, indexA += 1
        ) {
          const pointA = polygon[indexA];
          const pointB = polygon[indexB];
          const intersects =
            pointA.y > point.y !== pointB.y > point.y &&
            point.x <
              ((pointB.x - pointA.x) * (point.y - pointA.y)) /
                (pointB.y - pointA.y) +
                pointA.x;

          if (intersects) {
            isInside = !isInside;
          }
        }

        return isInside;
      }

      function roundPoint(point) {
        return {
          x: round(point.x),
          y: round(point.y),
        };
      }

      function expandBox(box, paddingX, paddingY = paddingX) {
        return {
          x: box.x - paddingX,
          y: box.y - paddingY,
          width: box.width + paddingX * 2,
          height: box.height + paddingY * 2,
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

      function getLayerLabels(element) {
        const labels = [];
        let node = element.parentElement;

        while (node) {
          if (node.tagName?.toLowerCase() !== 'g') {
            node = node.parentElement;
            continue;
          }

          const label =
            node.getAttribute('inkscape:label') ||
            node.getAttribute('label') ||
            node.getAttribute('data-name');

          if (label) {
            labels.push(label);
          }

          node = node.parentElement;
        }

        return labels;
      }

      function isAllowedArchitectureShape(element) {
        return getLayerLabels(element).some((label) => layerAllowlist.includes(label));
      }

      function collectGeometry(svgRoot) {
        const svgBox = getBBoxSafe(svgRoot);
        const maxArea = svgBox ? getArea(svgBox) * 0.22 : Infinity;

        const rawEntries = Array.from(svgRoot.querySelectorAll(SHAPE_SELECTOR))
          .filter((element) => !element.closest('defs'))
          .filter(isAllowedArchitectureShape)
          .map((element) => ({
            element,
            box: getTransformedBBoxSafe(element, svgRoot),
            layers: getLayerLabels(element),
            boundarySegment: extractStraightBoundarySegment(element, svgRoot),
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
          entries,
          lineEntries,
          spatialIndex: createSpatialIndex(entries),
          lineIndex: createSpatialIndex(lineEntries),
        };
      }

      function extractStraightBoundarySegment(element, svgRoot) {
        if (typeof element.getTotalLength !== 'function') {
          return null;
        }

        const perimeter = element.getTotalLength();

        if (!Number.isFinite(perimeter) || perimeter < 24) {
          return null;
        }

        const sampleCount = Math.min(24, Math.max(8, Math.ceil(perimeter / 24)));
        const samples = [];

        for (let index = 0; index < sampleCount; index += 1) {
          const point = element.getPointAtLength((perimeter * index) / sampleCount);
          samples.push(getTransformedPoint(element, svgRoot, point));
        }

        const mean = samples.reduce(
          (accumulator, point) => ({
            x: accumulator.x + point.x / samples.length,
            y: accumulator.y + point.y / samples.length,
          }),
          { x: 0, y: 0 },
        );
        let sxx = 0;
        let syy = 0;
        let sxy = 0;

        samples.forEach((point) => {
          const deltaX = point.x - mean.x;
          const deltaY = point.y - mean.y;

          sxx += deltaX * deltaX;
          syy += deltaY * deltaY;
          sxy += deltaX * deltaY;
        });

        const trace = sxx + syy;
        const delta = Math.sqrt(Math.max(0, (sxx - syy) ** 2 + 4 * sxy * sxy));
        const lambda1 = (trace + delta) / 2;
        let axis = { x: 1, y: 0 };

        if (Math.abs(sxy) > 1e-6 || Math.abs(lambda1 - sxx) > 1e-6) {
          axis = {
            x: sxy,
            y: lambda1 - sxx,
          };
          const norm = Math.hypot(axis.x, axis.y) || 1;
          axis = {
            x: axis.x / norm,
            y: axis.y / norm,
          };
        }

        if (axis.x < 0 || (Math.abs(axis.x) < 1e-6 && axis.y < 0)) {
          axis = {
            x: -axis.x,
            y: -axis.y,
          };
        }

        const normal = {
          x: -axis.y,
          y: axis.x,
        };
        let minMajor = Infinity;
        let maxMajor = -Infinity;
        let minMinor = Infinity;
        let maxMinor = -Infinity;

        samples.forEach((point) => {
          const relative = {
            x: point.x - mean.x,
            y: point.y - mean.y,
          };
          const major = dot(relative, axis);
          const minor = dot(relative, normal);

          if (major < minMajor) {
            minMajor = major;
          }

          if (major > maxMajor) {
            maxMajor = major;
          }

          if (minor < minMinor) {
            minMinor = minor;
          }

          if (minor > maxMinor) {
            maxMinor = minor;
          }
        });

        const majorSpan = maxMajor - minMajor;
        const minorSpan = maxMinor - minMinor;

        if (majorSpan < 20 || majorSpan < minorSpan * 2 || minorSpan > 18) {
          return null;
        }

        const start = {
          x: mean.x + axis.x * minMajor,
          y: mean.y + axis.y * minMajor,
        };
        const end = {
          x: mean.x + axis.x * maxMajor,
          y: mean.y + axis.y * maxMajor,
        };
        const angle = (Math.atan2(axis.y, axis.x) * 180) / Math.PI;
        const canonicalAngle = getCanonicalOrientation(angle);

        if (canonicalAngle === null) {
          return null;
        }

        return {
          canonicalAngle,
          angle,
          majorSpan,
          minorSpan,
          start,
          end,
          box: getPolygonBounds([start, end]),
        };
      }

      function collectBoundarySegments(svgRoot) {
        return Array.from(svgRoot.querySelectorAll(SHAPE_SELECTOR))
          .filter((element) => !element.closest('defs'))
          .filter(isAllowedArchitectureShape)
          .map((element) => {
            const segment = extractStraightBoundarySegment(element, svgRoot);

            if (!segment) {
              return null;
            }

            return {
              ...segment,
              layers: getLayerLabels(element),
            };
          })
          .filter(Boolean);
      }

      function boxContainsPoint(box, point, padding = 0) {
        return (
          point.x >= box.x - padding &&
          point.x <= box.x + box.width + padding &&
          point.y >= box.y - padding &&
          point.y <= box.y + box.height + padding
        );
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
            .filter(isAllowedArchitectureShape)
            .map((element) => ({
              element,
              box: getTransformedBBoxSafe(element, svgRoot),
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
              confidence: 'high',
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
              !entry.boundarySegment &&
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
          confidence: 'high',
          box: sortCandidatesByAreaAndDistance(candidates, textCenter)[0].box,
        };
      }

      function createHorizontalSegments(lineEntries) {
        return lineEntries
          .filter((entry) => entry.box.height <= LINE_THICKNESS_LIMIT)
          .map((entry) => ({
            y: entry.box.y + entry.box.height / 2,
            start: entry.box.x,
            end: entry.box.x + entry.box.width,
            thickness: Math.max(entry.box.height, 1),
            layers: entry.layers,
          }));
      }

      function createVerticalSegments(lineEntries) {
        return lineEntries
          .filter((entry) => entry.box.width <= LINE_THICKNESS_LIMIT)
          .map((entry) => ({
            x: entry.box.x + entry.box.width / 2,
            start: entry.box.y,
            end: entry.box.y + entry.box.height,
            thickness: Math.max(entry.box.width, 1),
            layers: entry.layers,
          }));
      }

      function mergeHorizontalSegments(segments) {
        const rows = [];

        segments
          .sort((segmentA, segmentB) => segmentA.y - segmentB.y || segmentA.start - segmentB.start)
          .forEach((segment) => {
            const row = rows.find(
              (candidate) => Math.abs(candidate.y - segment.y) <= SEGMENT_ALIGNMENT_TOLERANCE,
            );

            if (!row) {
              rows.push({
                y: segment.y,
                items: [segment],
              });
              return;
            }

            row.items.push(segment);
            row.y = (row.y * (row.items.length - 1) + segment.y) / row.items.length;
          });

        return rows.flatMap((row) => {
          const merged = [];

          row.items
            .sort((segmentA, segmentB) => segmentA.start - segmentB.start)
            .forEach((segment) => {
              const current = merged[merged.length - 1];

              if (!current || segment.start > current.end + SEGMENT_GAP_TOLERANCE) {
                merged.push({
                  y: row.y,
                  start: segment.start,
                  end: segment.end,
                  thickness: segment.thickness,
                  layers: [...segment.layers],
                });
                return;
              }

              current.end = Math.max(current.end, segment.end);
              current.thickness = Math.max(current.thickness, segment.thickness);
              current.layers.push(...segment.layers);
            });

          return merged.map((segment) => ({
            orientation: 'horizontal',
            box: {
              x: segment.start,
              y: segment.y - segment.thickness / 2,
              width: Math.max(segment.end - segment.start, 1),
              height: segment.thickness,
            },
            layers: [...new Set(segment.layers)],
          }));
        });
      }

      function mergeVerticalSegments(segments) {
        const columns = [];

        segments
          .sort((segmentA, segmentB) => segmentA.x - segmentB.x || segmentA.start - segmentB.start)
          .forEach((segment) => {
            const column = columns.find(
              (candidate) => Math.abs(candidate.x - segment.x) <= SEGMENT_ALIGNMENT_TOLERANCE,
            );

            if (!column) {
              columns.push({
                x: segment.x,
                items: [segment],
              });
              return;
            }

            column.items.push(segment);
            column.x = (column.x * (column.items.length - 1) + segment.x) / column.items.length;
          });

        return columns.flatMap((column) => {
          const merged = [];

          column.items
            .sort((segmentA, segmentB) => segmentA.start - segmentB.start)
            .forEach((segment) => {
              const current = merged[merged.length - 1];

              if (!current || segment.start > current.end + SEGMENT_GAP_TOLERANCE) {
                merged.push({
                  x: column.x,
                  start: segment.start,
                  end: segment.end,
                  thickness: segment.thickness,
                  layers: [...segment.layers],
                });
                return;
              }

              current.end = Math.max(current.end, segment.end);
              current.thickness = Math.max(current.thickness, segment.thickness);
              current.layers.push(...segment.layers);
            });

          return merged.map((segment) => ({
            orientation: 'vertical',
            box: {
              x: segment.x - segment.thickness / 2,
              y: segment.start,
              width: segment.thickness,
              height: Math.max(segment.end - segment.start, 1),
            },
            layers: [...new Set(segment.layers)],
          }));
        });
      }

      function resolveFromBoundarySegments(textBox, mergedSegments) {
        function getOverlapLength(rangeStartA, rangeEndA, rangeStartB, rangeEndB) {
          return Math.max(0, Math.min(rangeEndA, rangeEndB) - Math.max(rangeStartA, rangeStartB));
        }

        function createHorizontalRowGroups(entries) {
          const rows = [];

          [...entries]
            .sort((entryA, entryB) => entryA.box.y - entryB.box.y || entryA.box.x - entryB.box.x)
            .forEach((entry) => {
              const centerY = entry.box.y + entry.box.height / 2;
              const row = rows.find(
                (candidate) =>
                  Math.abs(candidate.centerY - centerY) <= SEGMENT_ALIGNMENT_TOLERANCE,
              );

              if (!row) {
                rows.push({
                  centerY,
                  items: [entry],
                });
                return;
              }

              row.items.push(entry);
              row.centerY =
                (row.centerY * (row.items.length - 1) + centerY) / row.items.length;
            });

          return rows.map((row) => {
            const minX = Math.min(...row.items.map((entry) => entry.box.x));
            const maxX = Math.max(...row.items.map((entry) => entry.box.x + entry.box.width));
            const thickness = Math.max(...row.items.map((entry) => entry.box.height));

            return {
              box: {
                x: minX,
                y: row.centerY - thickness / 2,
                width: Math.max(maxX - minX, 1),
                height: thickness,
              },
              items: row.items,
              segmentCount: row.items.length,
            };
          });
        }

        const textCenter = getCenter(textBox);
        const searchBox = expandBox(textBox, 140, 140);
        const segmentCandidates = mergedSegments.filter((entry) =>
          boxesOverlap(entry.box, searchBox, 8),
        );

        const verticalCandidates = segmentCandidates.filter(
          (entry) =>
            entry.orientation === 'vertical' &&
            entry.box.height >= Math.max(textBox.height * 2.4, 24) &&
            entry.box.y <= textCenter.y + textBox.height &&
            entry.box.y + entry.box.height >= textCenter.y - textBox.height,
        );

        const left = [...verticalCandidates]
          .filter((entry) => entry.box.x + entry.box.width <= textCenter.x)
          .sort((entryA, entryB) => entryB.box.x - entryA.box.x)[0];
        const right = [...verticalCandidates]
          .filter((entry) => entry.box.x >= textCenter.x)
          .sort((entryA, entryB) => entryA.box.x - entryB.box.x)[0];

        if (!left || !right) {
          return null;
        }

        const innerLeft = left.box.x + left.box.width;
        const innerRight = right.box.x;
        const expectedSpan = innerRight - innerLeft;
        const horizontalRows = createHorizontalRowGroups(
          segmentCandidates.filter((entry) => entry.orientation === 'horizontal'),
        )
          .map((row) => {
            const coverage = row.items.reduce((total, entry) => {
              return (
                total +
                getOverlapLength(
                  entry.box.x,
                  entry.box.x + entry.box.width,
                  innerLeft,
                  innerRight,
                )
              );
            }, 0);

            return {
              ...row,
              coverage,
              coverageRatio: expectedSpan > 0 ? coverage / expectedSpan : 0,
              spansCenter:
                row.box.x <= textCenter.x + 6 &&
                row.box.x + row.box.width >= textCenter.x - 6,
            };
          })
          .filter(
            (row) =>
              row.spansCenter &&
              (row.coverageRatio >= 0.24 ||
                row.segmentCount >= 3 ||
                row.box.width >= Math.max(expectedSpan * 0.55, textBox.width * 1.15, 24)),
          );

        const top = [...horizontalRows]
          .filter((row) => row.box.y + row.box.height <= textCenter.y)
          .sort((rowA, rowB) => rowB.box.y - rowA.box.y)[0];
        const bottom = [...horizontalRows]
          .filter((row) => row.box.y >= textCenter.y)
          .sort((rowA, rowB) => rowA.box.y - rowB.box.y)[0];

        if (!top || !bottom) {
          return null;
        }

        const inferredBox = insetBox(
          {
            x: innerLeft,
            y: top.box.y + top.box.height,
            width: innerRight - innerLeft,
            height: bottom.box.y - (top.box.y + top.box.height),
          },
          2,
          2,
        );

        if (
          inferredBox.width <= textBox.width * 1.35 ||
          inferredBox.height <= textBox.height * 1.35
        ) {
          return null;
        }

        return {
          method: 'boundary-segment-fit',
          confidence: 'medium',
          box: inferredBox,
          boundaries: {
            left: roundBox(left.box),
            right: roundBox(right.box),
            top: roundBox(top.box),
            bottom: roundBox(bottom.box),
          },
        };
      }

      function createStripFamily(textBox, boundarySegments, canonicalAngle) {
        const searchBox = expandBox(textBox, BOUNDARY_SEARCH_PADDING, BOUNDARY_SEARCH_PADDING);
        const center = getCenter(textBox);
        const { tangent, normal } = createUnitVectors(canonicalAngle);
        const pointT = dot(center, tangent);
        const pointN = dot(center, normal);
        const pointSpanOnNormal = Math.max(
          ...getBoxCorners(textBox).map((corner) =>
            Math.abs(dot(corner, normal) - pointN),
          ),
        );
        const candidates = boundarySegments
          .filter(
            (segment) =>
              segment.canonicalAngle === canonicalAngle &&
              boxesOverlap(segment.box, searchBox, 8),
          )
          .map((segment) => {
            const startT = dot(segment.start, tangent);
            const endT = dot(segment.end, tangent);
            const minT = Math.min(startT, endT);
            const maxT = Math.max(startT, endT);
            const offset = (dot(segment.start, normal) + dot(segment.end, normal)) / 2;
            const tangentMargin = Math.max(textBox.width, textBox.height) * 2 + 24;

            return {
              ...segment,
              minT,
              maxT,
              offset,
              coversPoint:
                pointT >= minT - tangentMargin && pointT <= maxT + tangentMargin,
            };
          })
          .filter((segment) => segment.coversPoint);

        function clusterStripCandidates(sideCandidates, direction) {
          const clusters = [];

          [...sideCandidates]
            .sort((segmentA, segmentB) =>
              direction === 'lower'
                ? segmentB.offset - segmentA.offset
                : segmentA.offset - segmentB.offset,
            )
            .forEach((segment) => {
              const currentCluster = clusters[clusters.length - 1];

              if (
                !currentCluster ||
                Math.abs(currentCluster.anchorOffset - segment.offset) >
                  STRIP_OFFSET_CLUSTER_TOLERANCE
              ) {
                clusters.push({
                  anchorOffset: segment.offset,
                  items: [segment],
                });
                return;
              }

              currentCluster.items.push(segment);
              currentCluster.anchorOffset =
                currentCluster.items.reduce(
                  (total, candidate) => total + candidate.offset,
                  0,
                ) / currentCluster.items.length;
            });

          return clusters
            .map((cluster) =>
              [...cluster.items].sort(
                (segmentA, segmentB) =>
                  segmentB.majorSpan - segmentA.majorSpan ||
                  Math.abs(segmentA.offset - pointN) - Math.abs(segmentB.offset - pointN),
              )[0],
            )
            .slice(0, STRIP_CANDIDATE_LIMIT);
        }

        const lowerCandidates = clusterStripCandidates(
          candidates.filter((segment) => segment.offset < pointN),
          'lower',
        );
        const upperCandidates = clusterStripCandidates(
          candidates.filter((segment) => segment.offset > pointN),
          'upper',
        );
        const lower = lowerCandidates[0];
        const upper = upperCandidates[0];

        if (!lower || !upper) {
          return null;
        }

        const minStripSpan = pointSpanOnNormal * 2.2;
        const viablePairs = lowerCandidates
          .flatMap((lowerCandidate) =>
            upperCandidates.map((upperCandidate) => ({
              lower: lowerCandidate,
              upper: upperCandidate,
              stripSpan: upperCandidate.offset - lowerCandidate.offset,
            })),
          )
          .filter((pair) => pair.stripSpan > minStripSpan);

        if (viablePairs.length === 0) {
          return null;
        }

        const stripPair = viablePairs.sort((pairA, pairB) => {
          const balanceA = Math.abs(
            (pointN - pairA.lower.offset) - (pairA.upper.offset - pointN),
          );
          const balanceB = Math.abs(
            (pointN - pairB.lower.offset) - (pairB.upper.offset - pointN),
          );

          return pairA.stripSpan - pairB.stripSpan || balanceA - balanceB;
        })[0];

        return {
          canonicalAngle,
          tangent,
          normal,
          pointN,
          pointSpanOnNormal,
          lower: {
            offset: stripPair.lower.offset,
            segment: stripPair.lower,
          },
          upper: {
            offset: stripPair.upper.offset,
            segment: stripPair.upper,
          },
          lowerCandidates: lowerCandidates.map((candidate) => ({
            offset: candidate.offset,
            segment: candidate,
          })),
          upperCandidates: upperCandidates.map((candidate) => ({
            offset: candidate.offset,
            segment: candidate,
          })),
          stripSpan: stripPair.stripSpan,
        };
      }

      function createPolygonFromStripPair(familyA, familyB) {
        const rawPoints = [
          lineIntersection(
            { normal: familyA.normal, offset: familyA.lower.offset },
            { normal: familyB.normal, offset: familyB.lower.offset },
          ),
          lineIntersection(
            { normal: familyA.normal, offset: familyA.upper.offset },
            { normal: familyB.normal, offset: familyB.lower.offset },
          ),
          lineIntersection(
            { normal: familyA.normal, offset: familyA.upper.offset },
            { normal: familyB.normal, offset: familyB.upper.offset },
          ),
          lineIntersection(
            { normal: familyA.normal, offset: familyA.lower.offset },
            { normal: familyB.normal, offset: familyB.upper.offset },
          ),
        ].filter(Boolean);

        if (rawPoints.length < 4) {
          return null;
        }

        const polygon = sortPolygonPoints(rawPoints);

        if (polygonArea(polygon) < 0) {
          polygon.reverse();
        }

        return polygon;
      }

      function resolveFromCanonicalStripPairs(entry, boundarySegments, shopEntries) {
        const center = entry.center;
        const primaryAnglePairs = [
          [0, 90],
          [45, 135],
        ];
        const fallbackAnglePairs = [
          [0, 45],
          [0, 135],
          [45, 90],
          [90, 135],
        ];

        function createStripVariants(family) {
          const variants = [];

          family.lowerCandidates.forEach((lower) => {
            family.upperCandidates.forEach((upper) => {
              const stripSpan = upper.offset - lower.offset;

              if (stripSpan <= family.pointSpanOnNormal * 2.2) {
                return;
              }

              variants.push({
                ...family,
                lower,
                upper,
                stripSpan,
              });
            });
          });

          return variants;
        }

        function getCenteringScore(family) {
          const lowerGap = family.pointN - family.lower.offset;
          const upperGap = family.upper.offset - family.pointN;
          const stripSpan = family.stripSpan || upperGap + lowerGap;
          const balanceScore =
            Math.min(lowerGap, upperGap) / Math.max(lowerGap, upperGap, 1);
          const paddingScore = Math.min(
            Math.min(lowerGap, upperGap) / Math.max(family.pointSpanOnNormal, 1),
            1,
          );

          return balanceScore * 0.7 + paddingScore * 0.3;
        }

        function getCoverageScore(familyA, familyB) {
          const spanA = Math.max(familyA.stripSpan, 1);
          const spanB = Math.max(familyB.stripSpan, 1);
          const ratios = [
            familyA.lower.segment.majorSpan / spanB,
            familyA.upper.segment.majorSpan / spanB,
            familyB.lower.segment.majorSpan / spanA,
            familyB.upper.segment.majorSpan / spanA,
          ];

          return ratios.reduce((total, ratio) => total + Math.min(ratio, 1.35), 0) / ratios.length;
        }

        function countOtherShopCenters(polygon) {
          return shopEntries.reduce((total, shop) => {
            if (shop.shopId === entry.shopId) {
              return total;
            }

            return total + (pointInPolygon(shop.center, polygon) ? 1 : 0);
          }, 0);
        }

        const familyMap = new Map(
          [0, 45, 90, 135]
            .map((angle) => [angle, createStripFamily(entry.textBox, boundarySegments, angle)])
            .filter(([, family]) => family),
        );

        function collectPairCandidates(anglePairs) {
          return anglePairs
            .flatMap(([firstAngle, secondAngle]) => {
              const familyA = familyMap.get(firstAngle);
              const familyB = familyMap.get(secondAngle);

              if (!familyA || !familyB) {
                return [];
              }

              return createStripVariants(familyA)
                .flatMap((variantA) =>
                  createStripVariants(familyB).map((variantB) => {
                    const polygon = createPolygonFromStripPair(variantA, variantB);

                    if (!polygon || !pointInPolygon(center, polygon)) {
                      return null;
                    }

                    const box = getPolygonBounds(polygon);
                    const area = Math.abs(polygonArea(polygon));

                    if (
                      area <= getArea(entry.textBox) * 4 ||
                      box.width <= entry.textBox.width * 1.3 ||
                      box.height <= entry.textBox.height * 1.3
                    ) {
                      return null;
                    }

                    const centeringScore =
                      (getCenteringScore(variantA) + getCenteringScore(variantB)) / 2;
                    const shapeBalanceScore =
                      Math.min(variantA.stripSpan, variantB.stripSpan) /
                      Math.max(variantA.stripSpan, variantB.stripSpan, 1);
                    const coverageScore = getCoverageScore(variantA, variantB);

                    return {
                      polygon,
                      box,
                      area,
                      angles: [firstAngle, secondAngle],
                      otherShopCount: countOtherShopCenters(polygon),
                      geometryScore:
                        coverageScore * 0.45 +
                        centeringScore * 0.35 +
                        shapeBalanceScore * 0.2,
                    };
                  }),
                )
                .filter(Boolean);
            })
            .sort(
              (candidateA, candidateB) =>
                candidateA.otherShopCount - candidateB.otherShopCount ||
                candidateB.geometryScore - candidateA.geometryScore ||
                candidateB.area - candidateA.area,
            );
        }

        const primaryCandidates = collectPairCandidates(primaryAnglePairs);
        const pairCandidates =
          primaryCandidates.length > 0
            ? primaryCandidates
            : collectPairCandidates(fallbackAnglePairs);

        if (pairCandidates.length === 0) {
          return null;
        }

        const best = pairCandidates[0];

        return {
          method: 'canonical-strip-polygon',
          confidence:
            primaryCandidates.length > 0 && best.angles.includes(45) ? 'high' : 'medium',
          box: best.box,
          roomPolygon: best.polygon,
          stripAngles: best.angles,
        };
      }

      function median(values) {
        if (values.length === 0) {
          return null;
        }

        const sorted = [...values].sort((valueA, valueB) => valueA - valueB);
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

        return {
          method: 'label-grid-fit',
          confidence: 'low',
          box: fittedBox,
        };
      }

      function collectStripSideCandidates(entry, boundarySegments) {
        function clusterSideCandidates(sideCandidates, pointN) {
          const clusters = [];

          [...sideCandidates]
            .sort(
              (segmentA, segmentB) =>
                Math.abs(segmentA.offset - pointN) - Math.abs(segmentB.offset - pointN),
            )
            .forEach((segment) => {
              const existingCluster = clusters.find(
                (cluster) =>
                  Math.abs(cluster.anchorOffset - segment.offset) <=
                  STRIP_OFFSET_CLUSTER_TOLERANCE,
              );

              if (!existingCluster) {
                clusters.push({
                  anchorOffset: segment.offset,
                  items: [segment],
                });
                return;
              }

              existingCluster.items.push(segment);
              existingCluster.anchorOffset =
                existingCluster.items.reduce(
                  (total, candidate) => total + candidate.offset,
                  0,
                ) / existingCluster.items.length;
            });

          return clusters
            .map((cluster) =>
              [...cluster.items].sort(
                (segmentA, segmentB) =>
                  segmentB.majorSpan - segmentA.majorSpan ||
                  Math.abs(segmentA.offset - pointN) - Math.abs(segmentB.offset - pointN),
              )[0],
            )
            .slice(0, STRIP_CANDIDATE_LIMIT);
        }

        return [0, 45, 90, 135].flatMap((canonicalAngle) => {
          const searchBox = expandBox(
            entry.textBox,
            BOUNDARY_SEARCH_PADDING,
            BOUNDARY_SEARCH_PADDING,
          );
          const { tangent, normal } = createUnitVectors(canonicalAngle);
          const pointT = dot(entry.center, tangent);
          const pointN = dot(entry.center, normal);
          const tangentMargin = Math.max(entry.textBox.width, entry.textBox.height) * 2 + 24;
          const candidates = boundarySegments
            .filter(
              (segment) =>
                segment.canonicalAngle === canonicalAngle &&
                boxesOverlap(segment.box, searchBox, 8),
            )
            .map((segment) => {
              const startT = dot(segment.start, tangent);
              const endT = dot(segment.end, tangent);
              const minT = Math.min(startT, endT);
              const maxT = Math.max(startT, endT);
              const offset = (dot(segment.start, normal) + dot(segment.end, normal)) / 2;

              return {
                ...segment,
                canonicalAngle,
                tangent,
                normal,
                offset,
                minT,
                maxT,
                coversPoint:
                  pointT >= minT - tangentMargin && pointT <= maxT + tangentMargin,
              };
            })
            .filter((segment) => segment.coversPoint);

          return ['lower', 'upper']
            .map((side) => {
              const sideCandidates = clusterSideCandidates(
                candidates.filter((segment) =>
                  side === 'lower' ? segment.offset < pointN : segment.offset > pointN,
                ),
                pointN,
              );

              if (sideCandidates.length === 0) {
                return null;
              }

              return {
                canonicalAngle,
                side,
                sideKey: `${canonicalAngle}-${side}`,
                pointN,
                candidates: sideCandidates.map((segment) => ({
                  ...segment,
                  group: `${canonicalAngle}-${side}`,
                  keepLessOrEqual: pointN <= segment.offset,
                })),
              };
            })
            .filter(Boolean);
        });
      }

      function clipPolygonWithBoundary(polygon, boundary) {
        const output = [];

        for (let index = 0; index < polygon.length; index += 1) {
          const current = polygon[index];
          const next = polygon[(index + 1) % polygon.length];
          const currentValue = dot(boundary.normal, current) - boundary.offset;
          const nextValue = dot(boundary.normal, next) - boundary.offset;
          const currentInside = boundary.keepLessOrEqual
            ? currentValue <= 1e-6
            : currentValue >= -1e-6;
          const nextInside = boundary.keepLessOrEqual
            ? nextValue <= 1e-6
            : nextValue >= -1e-6;

          if (currentInside && nextInside) {
            output.push(next);
            continue;
          }

          if (currentInside !== nextInside) {
            const delta = {
              x: next.x - current.x,
              y: next.y - current.y,
            };
            const denominator = dot(boundary.normal, delta);

            if (Math.abs(denominator) > 1e-6) {
              const t = (boundary.offset - dot(boundary.normal, current)) / denominator;
              output.push({
                x: current.x + delta.x * t,
                y: current.y + delta.y * t,
              });
            }

            if (!currentInside && nextInside) {
              output.push(next);
            }
          }
        }

        return output;
      }

      function resolveFromConvexBoundaryHull(
        entry,
        boundarySegments,
        mergedSegments,
        shopEntries,
        resolvedGuideShops,
      ) {
        function closenessToGuides(value, guides, tolerance = 8) {
          if (guides.length === 0) {
            return 0;
          }

          const nearest = Math.min(
            ...guides.map((guideValue) => Math.abs(guideValue - value)),
          );

          return Math.max(0, 1 - nearest / tolerance);
        }

        function polygonFromBoundaries(lines) {
          const searchBounds = expandBox(
            entry.textBox,
            BOUNDARY_SEARCH_PADDING,
            BOUNDARY_SEARCH_PADDING,
          );
          let polygon = [
            { x: searchBounds.x, y: searchBounds.y },
            { x: searchBounds.x + searchBounds.width, y: searchBounds.y },
            {
              x: searchBounds.x + searchBounds.width,
              y: searchBounds.y + searchBounds.height,
            },
            { x: searchBounds.x, y: searchBounds.y + searchBounds.height },
          ];

          for (const line of lines) {
            polygon = clipPolygonWithBoundary(polygon, line);

            if (polygon.length < 3) {
              return null;
            }
          }

          return polygon;
        }

        const sideGroups = collectStripSideCandidates(entry, boundarySegments);
        const candidatePool = sideGroups.flatMap((group) => group.candidates.slice(0, 2));

        if (candidatePool.length < 3) {
          return null;
        }

        const nearbyResolved = resolvedGuideShops.filter(
          (shop) =>
            shop.shopId !== entry.shopId &&
            Math.hypot(shop.center.x - entry.center.x, shop.center.y - entry.center.y) < 240,
        );
        const nearbyMergedSegments = mergedSegments.filter((segment) =>
          boxesOverlap(segment.box, expandBox(entry.textBox, 180, 180), 8),
        );
        const verticalGuides = [
          ...nearbyResolved.flatMap((shop) => [
            shop.roomBox.x,
            shop.roomBox.x + shop.roomBox.width,
          ]),
          ...nearbyMergedSegments
            .filter((segment) => segment.orientation === 'vertical')
            .map((segment) => segment.box.x + segment.box.width / 2),
        ];
        const horizontalGuides = [
          ...nearbyResolved.flatMap((shop) => [
            shop.roomBox.y,
            shop.roomBox.y + shop.roomBox.height,
          ]),
          ...nearbyMergedSegments
            .filter((segment) => segment.orientation === 'horizontal')
            .map((segment) => segment.box.y + segment.box.height / 2),
        ];
        const nearbyWidths = nearbyResolved.map((shop) => shop.roomBox.width);
        const nearbyHeights = nearbyResolved.map((shop) => shop.roomBox.height);
        const maxNearbyWidth = nearbyWidths.length > 0 ? Math.max(...nearbyWidths) : null;
        const maxNearbyHeight = nearbyHeights.length > 0 ? Math.max(...nearbyHeights) : null;
        const candidates = [];
        const seen = new Set();

        function walk(startIndex, chosenLines) {
          if (chosenLines.length >= 3 && chosenLines.length <= 4) {
            const key = chosenLines
              .map((line) => `${line.group}:${Math.round(line.offset)}`)
              .sort()
              .join('|');

            if (seen.has(key)) {
              return;
            }

            seen.add(key);

            const polygon = polygonFromBoundaries(chosenLines);

            if (!polygon || !pointInPolygon(entry.center, polygon)) {
              return;
            }

            const box = getPolygonBounds(polygon);
            const area = Math.abs(polygonArea(polygon));

            if (
              area <= getArea(entry.textBox) * 5 ||
              box.width <= entry.textBox.width * 1.4 ||
              box.height <= entry.textBox.height * 1.4
            ) {
              return;
            }

            if (
              (maxNearbyWidth && box.width > maxNearbyWidth * 1.32) ||
              (maxNearbyHeight && box.height > maxNearbyHeight * 1.75)
            ) {
              return;
            }

            const otherShopCount = shopEntries.reduce((total, shop) => {
              if (shop.shopId === entry.shopId) {
                return total;
              }

              return total + (pointInPolygon(shop.center, polygon) ? 1 : 0);
            }, 0);
            const edgeAlignment =
              [
                closenessToGuides(box.x, verticalGuides),
                closenessToGuides(box.x + box.width, verticalGuides),
                closenessToGuides(box.y, horizontalGuides),
                closenessToGuides(box.y + box.height, horizontalGuides),
              ].reduce((total, score) => total + score, 0) / 4;
            const diagonalBonus = chosenLines.some(
              (line) => line.canonicalAngle === 45 || line.canonicalAngle === 135,
            )
              ? 0.08
              : 0;

            candidates.push({
              polygon,
              box,
              area,
              otherShopCount,
              score: edgeAlignment * 1.15 + diagonalBonus - area / 40000,
            });
          }

          if (chosenLines.length === 4) {
            return;
          }

          for (let index = startIndex; index < candidatePool.length; index += 1) {
            const candidate = candidatePool[index];

            if (chosenLines.some((line) => line.group === candidate.group)) {
              continue;
            }

            walk(index + 1, [...chosenLines, candidate]);
          }
        }

        walk(0, []);

        if (candidates.length === 0) {
          return null;
        }

        const best = [...candidates].sort(
          (candidateA, candidateB) =>
            candidateA.otherShopCount - candidateB.otherShopCount ||
            candidateB.score - candidateA.score ||
            candidateA.area - candidateB.area,
        )[0];

        return {
          method: 'boundary-hull-fit',
          confidence: best.otherShopCount === 0 ? 'medium' : 'low',
          box: best.box,
          roomPolygon: best.polygon,
        };
      }

      function collectShopTextEntries(svgRoot) {
        return Array.from(svgRoot.querySelectorAll('text'))
          .map((textElement) => ({
            textElement,
            shopId: normalizeShopId(textElement.textContent || ''),
            textBox: getTransformedBBoxSafe(textElement, svgRoot),
          }))
          .filter((entry) => entry.textBox && isValidShopId(entry.shopId))
          .map((entry) => ({
            ...entry,
            center: getCenter(entry.textBox),
          }));
      }

      const svgRoot = document.querySelector('svg');

      if (!svgRoot) {
        return {
          floorPlanId,
          sourceAsset,
          error: 'SVG root not found',
        };
      }

      const viewBox = svgRoot.getAttribute('viewBox');
      const geometry = collectGeometry(svgRoot);
      const boundarySegments = collectBoundarySegments(svgRoot);
      const mergedSegments = [
        ...mergeHorizontalSegments(createHorizontalSegments(geometry.lineEntries)),
        ...mergeVerticalSegments(createVerticalSegments(geometry.lineEntries)),
      ];
      const shopEntries = collectShopTextEntries(svgRoot);
      const initialResolutions = shopEntries.map((entry) => ({
        entry,
        resolution:
          resolveFromParentGroups(entry.textElement, entry.textBox, svgRoot) ||
          resolveFromCanonicalStripPairs(entry, boundarySegments, shopEntries) ||
          resolveFromDirectShapes(entry.textBox, geometry) ||
          resolveFromBoundarySegments(entry.textBox, mergedSegments) ||
          resolveFromLabelGrid(entry, shopEntries) || {
            method: 'text-bounds-fallback',
            confidence: 'low',
            box: expandBox(entry.textBox, 24, 18),
          },
      }));
      const resolvedGuideShops = initialResolutions
        .filter(({ resolution }) => resolution.confidence !== 'low')
        .map(({ entry, resolution }) => ({
          shopId: entry.shopId,
          center: getCenter(resolution.box),
          roomBox: resolution.box,
          roomPolygon: resolution.roomPolygon || null,
        }));
      const exportedShops = [];

      initialResolutions.forEach(({ entry, resolution }) => {
        const improvedResolution =
          resolution.confidence === 'low'
            ? resolveFromConvexBoundaryHull(
                entry,
                boundarySegments,
                mergedSegments,
                shopEntries,
                resolvedGuideShops,
              ) || resolution
            : resolution;

        if (
          resolution.confidence === 'low' &&
          improvedResolution.confidence !== 'low'
        ) {
          resolvedGuideShops.push({
            shopId: entry.shopId,
            center: getCenter(improvedResolution.box),
            roomBox: improvedResolution.box,
            roomPolygon: improvedResolution.roomPolygon || null,
          });
        }

        exportedShops.push({
          shopId: entry.shopId,
          textBox: roundBox(entry.textBox),
          roomBox: roundBox(improvedResolution.box),
          roomPolygon: improvedResolution.roomPolygon?.map(roundPoint) || null,
          method: improvedResolution.method,
          confidence: improvedResolution.confidence,
          boundaries: improvedResolution.boundaries || null,
        });
      });

      const byConfidence = exportedShops.reduce(
        (accumulator, shop) => {
          accumulator[shop.confidence] = (accumulator[shop.confidence] || 0) + 1;
          return accumulator;
        },
        { high: 0, medium: 0, low: 0 },
      );

      const unresolved = exportedShops
        .filter((shop) => shop.confidence === 'low')
        .map((shop) => shop.shopId);

      return {
        version: 1,
        floorPlanId,
        sourceAsset,
        viewBox,
        layerAllowlist,
        stats: {
          shopCount: exportedShops.length,
          geometryShapeCount: geometry.entries.length,
          lineShapeCount: geometry.lineEntries.length,
          boundarySegmentCount: boundarySegments.length,
          mergedSegmentCount: mergedSegments.length,
          confidence: byConfidence,
          unresolvedCount: unresolved.length,
        },
        unresolved,
        shops: exportedShops.sort((shopA, shopB) => shopA.shopId.localeCompare(shopB.shopId)),
      };
    },
    {
      floorPlanId: floorPlan.id,
      sourceAsset: floorPlan.assetPath,
      layerAllowlist: DEFAULT_LAYER_ALLOWLIST,
    },
  );
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 3600, height: 2600 } });

  try {
    for (const floorPlan of floorPlans) {
      const exported = await exportFloorPlan(page, floorPlan);
      const outputPath = createOutputPath(floorPlan.assetFile);
      await fs.writeFile(outputPath, `${JSON.stringify(exported, null, 2)}\n`, 'utf8');

      console.log(
        [
          `${floorPlan.id}: ${path.relative(repoRoot, outputPath)}`,
          `shops=${exported.stats?.shopCount ?? 0}`,
          `high=${exported.stats?.confidence?.high ?? 0}`,
          `medium=${exported.stats?.confidence?.medium ?? 0}`,
          `low=${exported.stats?.confidence?.low ?? 0}`,
        ].join(' | '),
      );
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
