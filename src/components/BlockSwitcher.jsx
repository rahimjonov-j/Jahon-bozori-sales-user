export default function BlockSwitcher({ blocks, activeBlockId, onChange }) {
  if (blocks.length <= 1) {
    return null;
  }

  return (
    <div className="block-switcher" role="tablist" aria-label="Block selector">
      {blocks.map((block) => (
        <button
          key={block.id}
          type="button"
          className={`block-button ${
            block.id === activeBlockId ? 'is-active' : ''
          }`}
          role="tab"
          aria-selected={block.id === activeBlockId}
          onClick={() => onChange(block.id)}
        >
          <span className="block-button__title">{block.name}</span>
        </button>
      ))}
    </div>
  );
}
