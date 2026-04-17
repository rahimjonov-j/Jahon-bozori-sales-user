import { isShopLabel, normalizeShopLabel } from './shopLabel';

const LABEL_PATTERN = /[A-Z]-\d+-\d+/g;

export function extractShopLabelsFromSvg(svgMarkup) {
  const labels = new Set();

  for (const match of svgMarkup.matchAll(LABEL_PATTERN)) {
    const label = normalizeShopLabel(match[0]);

    if (isShopLabel(label)) {
      labels.add(label);
    }
  }

  return Array.from(labels);
}
