import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// Header-Slot: erlaubt einer Seite, einen Inhalt in die globale Topbar einzuklinken
// (z. B. der Analysis-Ticket-Switcher), ohne die Topbar für alle Seiten umzubauen.
// Die Topbar liest den aktuellen Slot-Inhalt; eine Seite setzt ihn per useHeaderSlot.

interface HeaderSlotValue {
  node: ReactNode;
  setNode: (n: ReactNode) => void;
}

const HeaderSlotContext = createContext<HeaderSlotValue>({ node: null, setNode: () => {} });

export function HeaderSlotProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<ReactNode>(null);
  return <HeaderSlotContext.Provider value={{ node, setNode }}>{children}</HeaderSlotContext.Provider>;
}

/** Topbar: liest den aktuell eingeklinkten Slot-Inhalt. */
export function useHeaderSlotNode(): ReactNode {
  return useContext(HeaderSlotContext).node;
}

/** Seite: klinkt `node` für die Lebensdauer der Seite in den Header ein (stabiler Node nötig). */
export function useHeaderSlot(node: ReactNode): void {
  const { setNode } = useContext(HeaderSlotContext);
  useEffect(() => {
    setNode(node);
    return () => setNode(null);
  }, [node, setNode]);
}
