export default function FloorPlanSwitcher({
  floorPlans,
  activeFloorPlanId,
  onChange,
}) {
  if (floorPlans.length <= 1) {
    return null;
  }

  return (
    <div className="floorplan-switcher" role="tablist" aria-label="Floor plan selector">
      {floorPlans.map((floorPlan) => (
        <button
          key={floorPlan.id}
          type="button"
          className={`floorplan-button ${
            floorPlan.id === activeFloorPlanId ? 'is-active' : ''
          }`}
          role="tab"
          aria-selected={floorPlan.id === activeFloorPlanId}
          onClick={() => onChange(floorPlan.id)}
        >
          {floorPlan.name}
        </button>
      ))}
    </div>
  );
}
