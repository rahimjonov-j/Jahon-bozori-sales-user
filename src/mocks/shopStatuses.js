const sharedBookedVisual = {
  stroke: 'rgba(234, 122, 32, 0.72)',
  fill: 'rgba(234, 122, 32, 0.1)',
  strokeWidth: 2.8,
};

const sharedSoldVisual = {
  stroke: 'rgba(212, 38, 59, 0.72)',
  fill: 'rgba(212, 38, 59, 0.1)',
  strokeWidth: 2.8,
};

const shopStatuses = [
  {
    planId: 'A-1',
    label: 'A-2-101',
    status: 'sold',
    absoluteBox: {
      x: 1193,
      y: 264,
      width: 85,
      height: 127,
    },
    overlayVisual: sharedSoldVisual,
  },
  {
    planId: 'A-1',
    label: 'A-5-111',
    status: 'booked',
    absoluteBox: {
      x: 1660,
      y: 835,
      width: 80,
      height: 125,
    },
    overlayVisual: sharedBookedVisual,
  },
  {
    planId: 'A-1',
    label: 'A-7-112',
    status: 'booked',
    absoluteBox: {
      x: 1745,
      y: 1259,
      width: 81,
      height: 125,
    },
    overlayVisual: sharedBookedVisual,
  },
  {
    planId: 'A-1',
    label: 'A-8-115',
    status: 'booked',
    absoluteBox: {
      x: 330,
      y: 1661,
      width: 83,
      height: 82,
    },
    overlayVisual: sharedBookedVisual,
  },
];

export const highlightDebug = {
  enabled: false,
  showMatchedTextBounds: true,
  showResolvedShopBounds: true,
  logToConsole: true,
};

export default shopStatuses;
