// Pure Logik für Checklisten-Serialisierung (☑/☐ je Zeile) — eine String-Quelle
// fürs Backend. Aus ChecklistField extrahiert, damit unit-testbar.

export interface ChecklistItem { checked: boolean; text: string; }

export function parseChecklist(value: string): ChecklistItem[] {
  if (!value) return [];
  return value
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => ({
      checked: l.startsWith('☑'),
      text: l.replace(/^[☑☐]\s?/, ''),
    }));
}

export function serializeChecklist(items: ChecklistItem[]): string {
  return items.map((i) => `${i.checked ? '☑' : '☐'} ${i.text}`).join('\n');
}
