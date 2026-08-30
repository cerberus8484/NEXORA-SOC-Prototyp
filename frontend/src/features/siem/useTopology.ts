import { useState, useEffect } from 'react';
import { DEFAULT_TOPOLOGY, loadTopology, type TopologyConfig } from './topologyConfig';

// Lädt die Operator-Override-Topologie EINMAL und teilt das Ergebnis über alle Panels
// (module-weiter Cache + geteilter In-Flight-Fetch). Bis der Fetch zurück ist, wird der
// eingebaute Default gezeigt — das Dashboard rendert also immer sofort.

let cache: TopologyConfig | null = null;
let inflight: Promise<TopologyConfig> | null = null;

export function useTopology(): TopologyConfig {
  const [cfg, setCfg] = useState<TopologyConfig>(cache ?? DEFAULT_TOPOLOGY);

  useEffect(() => {
    if (cache) return;
    let alive = true;
    inflight = inflight ?? loadTopology();
    inflight.then((t) => {
      cache = t;
      if (alive) setCfg(t);
    });
    return () => { alive = false; };
  }, []);

  return cfg;
}
