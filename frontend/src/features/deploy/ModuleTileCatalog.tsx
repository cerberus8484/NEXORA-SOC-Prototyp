// ModuleTileCatalog — präsentierte Kachel-Auswahl des Deployment Centers.
//
// Reine Präsentation: bekommt fertig abgeleitete Gruppen (deriveModuleTiles)
// und meldet Klicks auf verfügbare Kacheln nach oben. Enthält keine API-/Deploy-
// Logik. Verfügbare Kacheln sind klickbar; „Geplant"-Kacheln sind gedämpft und
// nicht klickbar (keine Fake-Verfügbarkeit).

import type { CSSProperties } from 'react';
import { CheckCircle2, Clock } from 'lucide-react';
import type { GroupedModuleTiles, ModuleTile } from './deployModuleTiles';
import { brandIconFor } from './brandIcons';

const s: Record<string, CSSProperties> = {
  group:      { marginBottom: 20 },
  groupHead:  { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 },
  groupTitle: { margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text)' },
  groupCount: { fontSize: 11.5, color: 'var(--text-dim)' },
  grid:       { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 },
  tileBase:   {
    position: 'relative', display: 'flex', flexDirection: 'column', gap: 10,
    aspectRatio: '1 / 1', padding: 14, textAlign: 'left',
    border: '1px solid var(--border)', borderRadius: 'var(--radius)',
    background: 'linear-gradient(180deg, var(--bg-card), var(--bg-card-soft))',
    transition: 'transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease',
  },
  tileBadge:  {
    position: 'absolute', top: 10, right: 10, display: 'inline-flex', alignItems: 'center', gap: 4,
    fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 'var(--radius-pill)',
  },
  tileLabel:  { fontSize: 13.5, fontWeight: 700, color: 'var(--text)', lineHeight: 1.25 },
  tileVendor: { fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.3 },
  spacer:     { flex: 1 },
};

interface TileButtonProps {
  tile: ModuleTile;
  onSelect: (tile: ModuleTile) => void;
}

function Tile({ tile, onSelect }: TileButtonProps) {
  const Icon = brandIconFor(tile.productKey);
  const available = tile.available;

  const style: CSSProperties = {
    ...s.tileBase,
    cursor: available ? 'pointer' : 'default',
    opacity: available ? 1 : 0.72,
    boxShadow: available ? 'var(--shadow-card)' : 'none',
  };

  const badge: CSSProperties = {
    ...s.tileBadge,
    background: available ? 'var(--success-soft)' : 'var(--bg-card-soft)',
    color: available ? 'var(--success)' : 'var(--text-dim)',
    border: available ? '1px solid transparent' : '1px solid var(--border-soft)',
  };

  return (
    <button
      type="button"
      disabled={!available}
      aria-disabled={!available}
      onClick={available ? () => onSelect(tile) : undefined}
      style={style}
      onMouseEnter={(e) => {
        if (!available) return;
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = 'var(--shadow-raised)';
        e.currentTarget.style.borderColor = 'var(--accent)';
      }}
      onMouseLeave={(e) => {
        if (!available) return;
        e.currentTarget.style.transform = 'none';
        e.currentTarget.style.boxShadow = 'var(--shadow-card)';
        e.currentTarget.style.borderColor = 'var(--border)';
      }}
      onFocus={(e) => {
        if (!available) return;
        e.currentTarget.style.borderColor = 'var(--accent)';
        e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-soft)';
      }}
      onBlur={(e) => {
        if (!available) return;
        e.currentTarget.style.boxShadow = 'var(--shadow-card)';
        e.currentTarget.style.borderColor = 'var(--border)';
      }}
    >
      <span style={badge}>
        {available
          ? <><CheckCircle2 size={11} /> Verfügbar</>
          : <><Clock size={11} /> Geplant</>}
      </span>
      <Icon size={44} muted={!available} />
      <span style={s.spacer} />
      <span style={s.tileLabel}>{tile.label}</span>
      <span style={s.tileVendor}>{tile.vendor}</span>
    </button>
  );
}

interface ModuleTileCatalogProps {
  groups: GroupedModuleTiles[];
  onSelect: (tile: ModuleTile) => void;
}

export function ModuleTileCatalog({ groups, onSelect }: ModuleTileCatalogProps) {
  return (
    <div>
      {groups.map((group) => {
        const availableCount = group.tiles.filter((t) => t.available).length;
        return (
          <section key={group.id} style={s.group} aria-label={group.label}>
            <div style={s.groupHead}>
              <h3 style={s.groupTitle}>{group.label}</h3>
              <span style={s.groupCount}>{availableCount} von {group.tiles.length} verfügbar</span>
            </div>
            <div style={s.grid}>
              {group.tiles.map((tile) => (
                <Tile key={tile.productKey} tile={tile} onSelect={onSelect} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
