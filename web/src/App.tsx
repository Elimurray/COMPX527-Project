import { RESOURCE_TYPES } from '@derf/shared';

/**
 * Placeholder shell. The map itself lands in M6 (Prasamsha) — the map library
 * choice is deliberately left open here rather than pre-empted.
 */
export function App() {
  return (
    <main className="app">
      <h1>Disaster &amp; Emergency Resource Finder</h1>
      <p className="subtitle">
        Community-reported emergency resources, overlaid on NOAA and FEMA disaster data.
      </p>

      <section>
        <h2>Resource types</h2>
        <ul className="resource-list">
          {RESOURCE_TYPES.map((type) => (
            <li key={type}>{type}</li>
          ))}
        </ul>
        <p className="note">
          Rendered from the shared types package — proof the workspace wiring holds end to
          end. The map replaces this in M6.
        </p>
      </section>
    </main>
  );
}
