const geometryCache = new Map();

function toGeometryPath(assetPath) {
  return assetPath.replace(/\.svg$/i, '.geometry.json');
}

export async function fetchFloorPlanGeometry(assetPath) {
  const geometryPath = toGeometryPath(assetPath);

  if (geometryCache.has(geometryPath)) {
    return geometryCache.get(geometryPath);
  }

  const response = await fetch(geometryPath);

  if (!response.ok) {
    throw new Error(`Unable to load geometry asset at ${geometryPath}`);
  }

  const payload = await response.json();
  geometryCache.set(geometryPath, payload);
  return payload;
}
