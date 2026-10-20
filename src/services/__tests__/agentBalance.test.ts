import { expect, it } from 'vitest';
import { balanceDayCounts, clusterByProximity, distributeFoodPlaces, reviseClusters, type ScoredAttraction } from '../agent';

const places = (n: number): ScoredAttraction[] => Array.from({ length: n }, (_, i) => ({
  name: `Place ${i}`, category: i % 3 === 0 ? 'restaurant' : 'Architecture',
  description: '', typical_visit_duration_minutes: 60,
  lat: 41.9 + Math.floor(i / 5) * 0.01, lon: 12.49 + (i % 5) * 0.001,
}));
const check = (days: ScoredAttraction[][], input: ScoredAttraction[]) => {
  const counts = days.map(d => d.length);
  expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  expect(days.flat().map(p => p.name).sort()).toEqual(input.map(p => p.name).sort());
};
it('balances a 10/1/2 split without dropping or duplicating picks', () => {
  const p = places(13);
  check(balanceDayCounts([p.slice(0, 10), p.slice(10, 11), p.slice(11)]), p);
});
it.each(['relaxed', 'balanced', 'packed'] as const)('keeps the full pipeline balanced at %s pace', pace => {
  const p = places(23);
  const initial = clusterByProximity(p, 3, pace, 41.9, 12.49);
  check(initial, p);
  const result = reviseClusters(distributeFoodPlaces(initial, 3), 41.9, 12.49, pace).clusters;
  check(result, p);
});
it('keeps distinct equally sized neighborhoods together', () => {
  const p = places(12).map((p, i) => ({ ...p, lat: 41 + Math.floor(i / 4) * 0.1, lon: 12 + (i % 4) * 0.001 }));
  const days = clusterByProximity(p, 3, 'balanced', 41, 12);
  check(days, p);
  for (const day of days) expect(new Set(day.map(p => p.lat)).size).toBe(1);
});
it('handles empty days and fewer places than days deterministically', () => {
  const p = places(2);
  const input = [p, [], [], []];
  check(balanceDayCounts(input), p);
  expect(balanceDayCounts(input)).toEqual(balanceDayCounts(input));
  expect(input[0]).toHaveLength(2);
  expect(balanceDayCounts([])).toEqual([]);
});
