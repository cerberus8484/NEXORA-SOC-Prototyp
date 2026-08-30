import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Palette } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { getPlatform, savePlatform } from './settingsApi';
import type { PlatformSettings } from './settingsApi';
import { isValidHexColor } from './brandingHelpers';
import { applyBranding, FONT_FAMILY_OPTIONS, FONT_STACKS, type FontFamilyKey } from './applyBranding';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import {
  Button, Card, CardBody, CardHeader, ErrorCard, Field, Input, Select, Spinner,
} from '../../components/ui';

// ── Defaults (spiegeln die :root-Tokens / Backend-Defaults) ─────────────────────

const DEFAULTS = {
  accentColor:     '#3b82f6',
  backgroundColor: '#f8fafd',
  sidebarColor:    '#0b1726',
  fontFamily:      'default' as FontFamilyKey,
};

const s: Record<string, CSSProperties> = {
  grid:      { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' },
  hexRow:    { display: 'flex', gap: '0.5rem', alignItems: 'center' },
  colorInput:{ width: 44, height: 36, padding: 2, borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', flexShrink: 0 },
  msg:       { fontSize: 12, marginTop: 4 },
  actions:   { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' },
  note:      { fontSize: 12, color: 'var(--text-dim)', marginTop: '0.5rem' },
};

// ── Wiederverwendbares Farb-Feld (Picker + Hex + Inline-Validierung) ────────────

interface ColorFieldProps {
  label: string;
  value: string;
  fallback: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

function ColorField({ label, value, fallback, disabled, onChange }: ColorFieldProps) {
  const { t: tr } = useTranslation();
  const invalid = value.length > 0 && !isValidHexColor(value);
  return (
    <Field label={label}>
      <div style={s.hexRow}>
        <input
          type="color"
          value={isValidHexColor(value) ? value : fallback}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          style={s.colorInput}
          aria-label={`${label} — Farbauswahl`}
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          maxLength={7}
          placeholder={fallback}
          mono
          style={{ flex: 1 }}
          aria-label={tr('settings.hexValueOf', { label })}
        />
      </div>
      <span style={{ ...s.msg, color: invalid ? 'var(--danger)' : 'var(--text-dim)' }} role={invalid ? 'alert' : undefined}>
        {invalid ? tr('settings.invalidHexValueRrggbb') : 'Format: #rrggbb'}
      </span>
    </Field>
  );
}

// ── Haupt-Panel ─────────────────────────────────────────────────────────────────

export function BrandingPanel() {
  const { t: tr } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [settings, setSettings]   = useState<PlatformSettings | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [platformName, setPlatformName]       = useState('');
  const [accentColor, setAccentColor]         = useState(DEFAULTS.accentColor);
  const [backgroundColor, setBackgroundColor] = useState(DEFAULTS.backgroundColor);
  const [sidebarColor, setSidebarColor]       = useState(DEFAULTS.sidebarColor);
  const [fontFamily, setFontFamily]           = useState<FontFamilyKey>(DEFAULTS.fontFamily);

  const successTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true); setError('');
      try {
        const data = await getPlatform();
        if (!active) return;
        setSettings(data);
        setPlatformName(data.platformName ?? '');
        setAccentColor(data.accentColor ?? DEFAULTS.accentColor);
        setBackgroundColor(data.backgroundColor ?? DEFAULTS.backgroundColor);
        setSidebarColor(data.sidebarColor ?? DEFAULTS.sidebarColor);
        setFontFamily((data.fontFamily as FontFamilyKey) ?? DEFAULTS.fontFamily);
        applyBranding(data); // Vorschau = Live-Zustand
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : i18n.t('text.loadingFailed2'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => () => { if (successTimeout.current) clearTimeout(successTimeout.current); }, []);

  // Live-Vorschau: eine gültige Änderung sofort auf :root anwenden.
  const setVar = (name: string, value: string) => document.documentElement.style.setProperty(name, value);
  const onAccent  = (v: string) => { setAccentColor(v);     if (isValidHexColor(v)) setVar('--accent', v); };
  const onBg      = (v: string) => { setBackgroundColor(v); if (isValidHexColor(v)) setVar('--bg', v); };
  const onSidebar = (v: string) => { setSidebarColor(v);    if (isValidHexColor(v)) setVar('--sidebar-bg', v); };
  const onFont    = (v: string) => { const k = v as FontFamilyKey; setFontFamily(k); setVar('--font-sans', FONT_STACKS[k]); };

  const anyInvalid = [accentColor, backgroundColor, sidebarColor].some((c) => !isValidHexColor(c));

  async function handleSave() {
    if (!settings || anyInvalid) return;
    setSaving(true); setSaveError(''); setSaveSuccess(false);
    try {
      const updated = await savePlatform({
        ...settings,
        platformName: platformName.trim() || settings.platformName,
        accentColor, backgroundColor, sidebarColor, fontFamily,
      });
      setSettings(updated);
      applyBranding(updated);
      setSaveSuccess(true);
      if (successTimeout.current) clearTimeout(successTimeout.current);
      successTimeout.current = setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : tr('common.savingFailed2'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <Card><CardBody style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Spinner /><span>{tr('settings.loadingBranding')}</span></CardBody></Card>;
  }
  if (error) return <ErrorCard message={error} />;

  const disabled = !isAdmin || saving;

  return (
    <Card>
      <CardHeader title={<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Palette size={16} /> Branding &amp; Thema</span>} />
      <CardBody>
        <div style={s.grid}>
          <Field label={tr('settings.platformNameLabel')}>
            <Input value={platformName} onChange={(e) => setPlatformName(e.target.value)} maxLength={200} disabled={disabled} placeholder="z.B. Nexora SOC Platform" />
          </Field>

          <Field label="Schriftart">
            <Select options={FONT_FAMILY_OPTIONS} value={fontFamily} onChange={(e) => onFont(e.target.value)} disabled={disabled} aria-label="Schriftart" />
            <span style={s.note}>{tr('settings.systemSafeStacksNoExternal')}</span>
          </Field>

          <ColorField label="Akzentfarbe"     value={accentColor}     fallback={DEFAULTS.accentColor}     disabled={disabled} onChange={onAccent} />
          <ColorField label="Hintergrundfarbe" value={backgroundColor} fallback={DEFAULTS.backgroundColor} disabled={disabled} onChange={onBg} />
          <ColorField label="Sidebar-Farbe"    value={sidebarColor}    fallback={DEFAULTS.sidebarColor}    disabled={disabled} onChange={onSidebar} />
        </div>

        {!isAdmin && <p style={s.note}>{tr('settings.onlyAdministratorsCanChangeBranding')}</p>}
        {saveError && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: '0.5rem' }} role="alert">{saveError}</p>}
        {saveSuccess && <p style={{ color: 'var(--success)', fontSize: 13, marginTop: '0.5rem' }} role="status">{tr('settings.brandingSettingsSaved')}</p>}

        {isAdmin && (
          <div style={s.actions}>
            <Button variant="primary" onClick={handleSave} disabled={saving || anyInvalid}>
              {saving ? 'Speichert…' : tr('common.save')}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
