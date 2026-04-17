const svgCache = new Map();

export async function fetchSvgMarkup(svgPath) {
  if (svgCache.has(svgPath)) {
    return svgCache.get(svgPath);
  }

  const response = await fetch(svgPath);

  if (!response.ok) {
    throw new Error(`Unable to load SVG asset at ${svgPath}`);
  }

  const markup = await response.text();
  svgCache.set(svgPath, markup);
  return markup;
}
