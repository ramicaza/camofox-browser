import { describe, expect, test } from '@jest/globals';
import { randomCirclePoint, resolveGeolocation, KM_PER_DEG_LAT, KM_PER_DEG_LON_AT_EQUATOR } from '../../lib/geo.js';

const LA = { latitude: 34.0522, longitude: -118.2437 };

// Deterministic PRNG (mulberry32) so geometry assertions are reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('randomCirclePoint', () => {
  test('radius 0 collapses to the exact center', () => {
    const p = randomCirclePoint(LA, 0, mulberry32(1));
    expect(p.latitude).toBe(LA.latitude);
    expect(p.longitude).toBe(LA.longitude);
  });

  test('point always stays within radiusKm of the center (great-circle bound)', () => {
    // Coarse equirectangular distance in km (fine for a 15km radius).
    const dist = (a, b) => {
      const kmLat = (a.latitude - b.latitude) * KM_PER_DEG_LAT;
      const kmLon = (a.longitude - b.longitude) * KM_PER_DEG_LON_AT_EQUATOR * Math.cos((b.latitude * Math.PI) / 180);
      return Math.hypot(kmLat, kmLon);
    };
    for (let i = 0; i < 200; i++) {
      const p = randomCirclePoint(LA, 15, mulberry32(i + 1));
      expect(dist(p, LA)).toBeLessThanOrEqual(15.05); // small tolerance for the equirectangular approx
    }
  });

  test('produces varied points (not a single fixed coordinate)', () => {
    const seen = new Set();
    for (let i = 0; i < 50; i++) {
      const p = randomCirclePoint(LA, 15, mulberry32(i));
      seen.add(`${p.latitude},${p.longitude}`);
    }
    expect(seen.size).toBeGreaterThan(20); // distinct samples over 50 draws
  });

  test('throws on a non-numeric center', () => {
    expect(() => randomCirclePoint({ latitude: 'x' }, 15)).toThrow();
  });
});

describe('resolveGeolocation', () => {
  test('defaults: LA timezone, en-US locale, random point around real LA', () => {
    const g = resolveGeolocation({}, mulberry32(42));
    expect(g.timezoneId).toBe('America/Los_Angeles');
    expect(g.locale).toBe('en-US');
    expect(g.geolocation).toHaveProperty('latitude');
    expect(g.geolocation).toHaveProperty('longitude');
    expect(Math.abs(g.geolocation.latitude - LA.latitude)).toBeLessThan(0.3);
    expect(Math.abs(g.geolocation.longitude - LA.longitude)).toBeLessThan(0.3);
  });

  test('exact coords override the circle (radius ignored)', () => {
    const g = resolveGeolocation(
      { exact: { latitude: 37.7749, longitude: -122.4194 }, center: LA, radiusKm: 100 },
      mulberry32(1),
    );
    expect(g.geolocation.latitude).toBe(37.7749);
    expect(g.geolocation.longitude).toBe(-122.4194);
  });

  test('custom timezone and locale are honored', () => {
    const g = resolveGeolocation({ timezoneId: 'Europe/Paris', locale: 'fr-FR', exact: { latitude: 48.85, longitude: 2.35 } });
    expect(g.timezoneId).toBe('Europe/Paris');
    expect(g.locale).toBe('fr-FR');
  });

  test('empty/partial geo object falls back to defaults without throwing', () => {
    expect(() => resolveGeolocation(undefined)).not.toThrow();
    expect(() => resolveGeolocation(null)).not.toThrow();
    expect(resolveGeolocation({}).timezoneId).toBe('America/Los_Angeles');
  });
});
