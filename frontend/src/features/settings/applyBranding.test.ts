import { describe, it, expect } from 'vitest';
import { brandingCssVars, applyBranding, FONT_STACKS } from './applyBranding';

describe('brandingCssVars — reine Ableitung der CSS-Variablen', () => {
  it('mappt gültige Farben + Font-Key auf die richtigen Variablen', () => {
    const vars = brandingCssVars({
      accentColor: '#2f6bed', backgroundColor: '#f8fafd', sidebarColor: '#0b1726', fontFamily: 'serif',
    });
    expect(vars['--accent']).toBe('#2f6bed');
    expect(vars['--bg']).toBe('#f8fafd');
    expect(vars['--sidebar-bg']).toBe('#0b1726');
    expect(vars['--font-sans']).toBe(FONT_STACKS.serif);
  });

  it('lässt ungültige Hex-Werte aus (setzt die Variable NICHT)', () => {
    const vars = brandingCssVars({ accentColor: 'nope', backgroundColor: '#abc', sidebarColor: '' });
    expect(vars['--accent']).toBeUndefined();
    expect(vars['--bg']).toBeUndefined();       // 3-stellig ungültig
    expect(vars['--sidebar-bg']).toBeUndefined();
  });

  it('lässt unbekannte fontFamily-Keys aus', () => {
    expect(brandingCssVars({ fontFamily: 'ComicSans' })['--font-sans']).toBeUndefined();
    expect(brandingCssVars({ fontFamily: 'mono' })['--font-sans']).toBe(FONT_STACKS.mono);
  });

  it('leeres Objekt → keine Variablen', () => {
    expect(Object.keys(brandingCssVars({}))).toHaveLength(0);
  });
});

describe('applyBranding — setzt die Variablen auf ein Ziel-Element', () => {
  it('schreibt nur die gültigen Variablen auf target.style', () => {
    const el = document.createElement('div');
    applyBranding({ accentColor: '#ff0000', backgroundColor: 'invalid', fontFamily: 'system' }, el);
    expect(el.style.getPropertyValue('--accent')).toBe('#ff0000');
    expect(el.style.getPropertyValue('--bg')).toBe('');            // ungültig → nicht gesetzt
    expect(el.style.getPropertyValue('--font-sans')).toBe(FONT_STACKS.system);
  });
});
