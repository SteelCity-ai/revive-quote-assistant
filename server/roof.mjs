const M2_TO_FT2 = 10.7639104167;
const clean = value => (typeof value === 'string' ? value.trim().slice(0, 300) : '');

export function createRoofMeasurer({ fetcher = fetch, apiKey = '' } = {}) {
  if (!apiKey) return null;
  return async function measureRoof(address, timeoutMs = 20000) {
    const query = clean(address);
    if (!query) return { available: false, reason: 'Enter the job address before requesting a measurement.' };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const geocodeUrl = new URL('https://maps.googleapis.com/maps/api/geocode/json');
      geocodeUrl.searchParams.set('address', query);
      geocodeUrl.searchParams.set('key', apiKey);
      const geoRes = await fetcher(geocodeUrl, { signal: controller.signal });
      if (!geoRes.ok) return { available: false, reason: 'The address lookup service is unavailable. Measure manually instead.' };
      const geo = await geoRes.json();
      if (geo.status !== 'OK' || !geo.results?.[0]?.geometry?.location) {
        return { available: false, reason: 'That address could not be located. Check the address or measure manually.' };
      }
      const { lat, lng } = geo.results[0].geometry.location;
      const formatted = clean(geo.results[0].formatted_address || '');
      const solarUrl = new URL('https://solar.googleapis.com/v1/buildingInsights:findClosest');
      solarUrl.searchParams.set('location.latitude', String(lat));
      solarUrl.searchParams.set('location.longitude', String(lng));
      solarUrl.searchParams.set('requiredQuality', 'MEDIUM');
      solarUrl.searchParams.set('key', apiKey);
      const solarRes = await fetcher(solarUrl, { signal: controller.signal });
      if (solarRes.status === 404) return { available: false, reason: 'No building was found for this address in Google imagery. Measure manually instead.' };
      if (!solarRes.ok) return { available: false, reason: 'Roof imagery for this address is unavailable right now. Measure manually instead.' };
      const solar = await solarRes.json();
      // Verified response structure (2026-09-21, live API): solarPotential.wholeRoofStats.areaMeters2
      // is the measured sloped roof area (tilt already applied — never apply pitch again);
      // wholeRoofStats.groundAreaMeters2 is the ground area Google actually covered;
      // buildingStats.groundAreaMeters2 is the building's ground footprint. Google may exclude
      // portions of a building from wholeRoofStats, so coverage is reported explicitly and a
      // partial area is never presented as the complete roof.
      const areaM2 = solar.solarPotential?.wholeRoofStats?.areaMeters2;
      const roofAreaSqFt = Number.isFinite(areaM2) && areaM2 > 0 ? Math.round(areaM2 * M2_TO_FT2) : null;
      if (!roofAreaSqFt) return { available: false, reason: 'Google imagery covers this address but could not measure the roof. Measure manually instead.' };
      const footprintM2 = solar.solarPotential?.buildingStats?.groundAreaMeters2;
      const coveredM2 = solar.solarPotential?.wholeRoofStats?.groundAreaMeters2;
      const footprintSqFt = Number.isFinite(footprintM2) && footprintM2 > 0 ? Math.round(footprintM2 * M2_TO_FT2) : null;
      const coveredSqFt = Number.isFinite(coveredM2) && coveredM2 > 0 ? Math.round(coveredM2 * M2_TO_FT2) : null;
      let coveragePercent = null;
      if (footprintSqFt && coveredSqFt) coveragePercent = Math.round((coveredSqFt / footprintSqFt) * 100);
      const partial = coveragePercent !== null && coveragePercent < 95;
      const imageryDate = solar.imageryDate ? `${solar.imageryDate.year}-${String(solar.imageryDate.month).padStart(2, '0')}${solar.imageryDate.day ? '-' + String(solar.imageryDate.day).padStart(2, '0') : ''}` : null;
      const note = partial
        ? `Google may have measured only part of the building (coverage ${coveragePercent}% of the ground footprint). Confirm the correct building was matched and that every roof section you are quoting is included — measure manually any sections that are missing.`
        : 'Confirm the matched address is the correct building and that the measured roof covers the sections you are quoting.';
      return {
        available: true,
        formattedAddress: formatted,
        roofAreaSqFt,
        footprintSqFt,
        coveredSqFt,
        coveragePercent,
        partial,
        note,
        imageryDate,
        imageryQuality: clean(solar.imageryQuality || ''),
        latitude: Number.isFinite(lat) ? lat : null,
        longitude: Number.isFinite(lng) ? lng : null,
        name: clean(solar.name || ''),
      };
    } catch {
      return { available: false, reason: controller.signal.aborted ? 'The measurement took too long. Measure manually or retry.' : 'The measurement could not be completed. Measure manually instead.' };
    } finally {
      clearTimeout(timeout);
    }
  };
}
