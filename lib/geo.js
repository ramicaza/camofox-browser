/**
 * Geolocation fingerprint helpers.
 *
 * Pure functions only — no process.env, no I/O. Environment values are read
 * in lib/config.js and passed in as a `geo` object (see resolveGeolocation).
 *
 * Background: when no proxy is configured, camoufox previously stamped every
 * context with a single hardcoded { lat, lon } + timezone. A fixed coordinate
 * is a strong anti-bot tell (many sessions resolving to the exact same fix),
 * so by default we now sample a uniformly-random point inside a circle around
 * a configurable center, while still allowing exact override when wanted.
 */

// Approximate mean km-per-degree (good enough for city-scale radii, <~100km).
const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON_AT_EQUATOR = 111.320;

/**
 * Uniformly pick a random point inside a circle of radius `radiusKm` around
 * `center`.
 *
 * Uses polar sampling with the square-root correction so the density is
 * uniform over AREA (a naive r = R * U piles points up in the center).
 * Returns { latitude, longitude } in decimal degrees.
 */
export function randomCirclePoint(center, radiusKm, rng = Math.random) {
  const lat = Number(center?.latitude);
  const lon = Number(center?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('randomCirclePoint: center must have numeric latitude/longitude');
  }
  const R = Math.max(0, Number(radiusKm) || 0);
  const u1 = rng();
  const u2 = rng();
  const r = R * Math.sqrt(u1);       // km from center, area-uniform
  const theta = 2 * Math.PI * u2;    // angle, uniform in [0, 2pi)
  const dx = r * Math.cos(theta);    // km east (+) / west (-)
  const dy = r * Math.sin(theta);    // km north (+) / south (-)
  const kmPerDegLon = KM_PER_DEG_LON_AT_EQUATOR * Math.cos((lat * Math.PI) / 180);
  return {
    latitude: +(lat + dy / KM_PER_DEG_LAT).toFixed(6),
    longitude: +(lon + (kmPerDegLon ? dx / kmPerDegLon : 0)).toFixed(6),
  };
}

/**
 * Resolve the { timezoneId, locale, geolocation } fingerprint for a context.
 *
 * `geo` shape (all optional; sane defaults when absent):
 *   timezoneId   string           default 'America/Los_Angeles'
 *   locale       string           default 'en-US'
 *   exact        {lat, lon} | null   if present, used verbatim (radius ignored)
 *   center       {lat, lon}         default real Los Angeles {34.0522,-118.2437}
 *   radiusKm     number           default 15
 *
 * @returns {{ timezoneId: string, locale: string, geolocation: {latitude:number, longitude:number}, warnings: string[] }}
 *
 * `warnings` is empty when the config is absent or internally consistent. It
 * surfaces a *partial* override — one half of the timezone/coordinates pair
 * set while the other half falls back to the LA default — because that
 * produces a contradictory fingerprint (e.g. Detroit coords + LA timezone) that
 * is itself a strong anti-bot tell. Callers should log each warning.
 */
export function resolveGeolocation(geo = {}, rng = Math.random) {
  const g = geo || {};
  const tzSet = Boolean(g.timezoneId && String(g.timezoneId).trim());
  const timezoneId = (g.timezoneId && String(g.timezoneId).trim()) || 'America/Los_Angeles';
  const locale = (g.locale && String(g.locale).trim()) || 'en-US';

  const exact = g.exact;
  const hasExact =
    exact && Number.isFinite(Number(exact.latitude)) && Number.isFinite(Number(exact.longitude));

  const center =
    (g.center && Number.isFinite(Number(g.center.latitude)) && Number.isFinite(Number(g.center.longitude)))
      ? { latitude: Number(g.center.latitude), longitude: Number(g.center.longitude) }
      : { latitude: 34.0522, longitude: -118.2437 }; // Los Angeles (matches the LA timezone)
  const centerSet = Boolean(
    g.center && Number.isFinite(Number(g.center.latitude)) && Number.isFinite(Number(g.center.longitude)),
  );

  const radiusKm = Number.isFinite(Number(g.radiusKm)) && Number(g.radiusKm) > 0
    ? Number(g.radiusKm)
    : 15;

  const geolocation = hasExact
    ? { latitude: +Number(exact.latitude).toFixed(6), longitude: +Number(exact.longitude).toFixed(6) }
    : randomCirclePoint(center, radiusKm, rng);

  // Coords are "user-supplied" when either an exact point or a non-default
  // center was provided — in either case the resulting latitude/longitude
  // will generally NOT be in LA.
  const coordsSet = hasExact || centerSet;

  const warnings = [];
  if (coordsSet && !tzSet) {
    warnings.push(
      `geo: coords overridden but CAMOFOX_TIMEZONE_ID unset — using non-LA coordinates with the default ` +
      `America/Los_Angeles timezone (inconsistent fingerprint). Set CAMOFOX_TIMEZONE_ID to match the coordinates.`,
    );
  } else if (tzSet && !coordsSet) {
    warnings.push(
      `geo: CAMOFOX_TIMEZONE_ID set to ${timezoneId} but no coordinates given — using a random ` +
      `Los Angeles point (default center) with a non-LA timezone (inconsistent fingerprint). ` +
      `Set CAMOFOX_GEO_CENTER_LAT/_LON (or _LAT/_LON) to match the timezone.`,
    );
  }

  return { timezoneId, locale, geolocation, warnings };
}

export { KM_PER_DEG_LAT, KM_PER_DEG_LON_AT_EQUATOR };
