import { haversineKm } from './geo';

export interface RouteResult {
  distanceKm: number;
  durationSeconds: number;
  usedFallback: boolean;
}

export async function routeDistance(
  lonA: number,
  latA: number,
  lonB: number,
  latB: number,
): Promise<{ result: RouteResult; latencyMs: number }> {
  const started = performance.now();
  const url = `https://router.project-osrm.org/route/v1/driving/${lonA},${latA};${lonB},${latB}?overview=false`;

  try {
    const response = await fetch(url);
    const latencyMs = Math.round(performance.now() - started);
    if (!response.ok) {
      return {
        result: haversineFallback(latA, lonA, latB, lonB),
        latencyMs,
      };
    }
    const data = (await response.json()) as {
      routes?: Array<{ distance: number; duration: number }>;
    };
    if (!data.routes?.length) {
      return {
        result: haversineFallback(latA, lonA, latB, lonB),
        latencyMs,
      };
    }
    return {
      result: {
        distanceKm: data.routes[0].distance / 1000,
        durationSeconds: data.routes[0].duration,
        usedFallback: false,
      },
      latencyMs,
    };
  } catch {
    return {
      result: haversineFallback(latA, lonA, latB, lonB),
      latencyMs: Math.round(performance.now() - started),
    };
  }
}

function haversineFallback(
  latA: number,
  lonA: number,
  latB: number,
  lonB: number,
): RouteResult {
  const distanceKm = haversineKm(latA, lonA, latB, lonB);
  return {
    distanceKm,
    durationSeconds: (distanceKm / 25) * 3600,
    usedFallback: true,
  };
}
