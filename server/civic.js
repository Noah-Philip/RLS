const OPENSTATES_GEO_BASE_URL = 'https://v3.openstates.org/people.geo';
const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';

export class ApiError extends Error {
  constructor(code, message, status = 500, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new ApiError(
      'MISSING_API_KEYS',
      `Missing required environment variable: ${name}`,
      500,
      'Set API keys in your environment before starting the server.',
    );
  }
  return value;
}

function ensureNotRateLimited(response, providerName) {
  if (response.status === 429) {
    throw new ApiError('RATE_LIMITED', `${providerName} API rate limit reached.`, 429);
  }
}

async function fetchJson(url, options = {}, providerName = 'Upstream') {
  const response = await fetch(url, options);
  ensureNotRateLimited(response, providerName);

  if (!response.ok) {
    const payload = await response.text();
    throw new ApiError('UPSTREAM_API_ERROR', `${providerName} request failed.`, 502, payload);
  }

  return response.json();
}

function nominatimHeaders() {
  return {
    'User-Agent': 'RLS-Legislator-Lookup/1.0',
    Accept: 'application/json',
  };
}

function normalizeAddress({ displayName, latitude, longitude }) {
  return {
    formattedAddress: displayName,
    latitude,
    longitude,
  };
}

export async function geocodeAddress({ street, city, state, zip }) {
  if (!street || !city || !state || !zip) {
    throw new ApiError('INVALID_ADDRESS', 'Street, city, state, and ZIP are required.', 400);
  }

  const query = `${street}, ${city}, ${state} ${zip}, USA`;
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '1',
    addressdetails: '1',
    countrycodes: 'us',
  });

  const payload = await fetchJson(`${NOMINATIM_SEARCH_URL}?${params.toString()}`, {
    headers: nominatimHeaders(),
  }, 'Nominatim');

  if (!Array.isArray(payload) || payload.length === 0) {
    throw new ApiError('INVALID_ADDRESS', 'Address could not be validated. Please check and try again.', 400);
  }

  const best = payload[0];
  const latitude = Number(best.lat);
  const longitude = Number(best.lon);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new ApiError('INVALID_ADDRESS', 'Address is missing geolocation coordinates.', 400);
  }

  return normalizeAddress({
    displayName: best.display_name || query,
    latitude,
    longitude,
  });
}

export async function reverseGeocode(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new ApiError('INVALID_ADDRESS', 'Latitude and longitude must be valid numbers.', 400);
  }

  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    format: 'jsonv2',
    zoom: '18',
    addressdetails: '1',
  });

  const payload = await fetchJson(`${NOMINATIM_REVERSE_URL}?${params.toString()}`, {
    headers: nominatimHeaders(),
  }, 'Nominatim');

  if (!payload?.display_name) {
    throw new ApiError('INVALID_ADDRESS', 'Could not convert your location into a street address.', 400);
  }

  return normalizeAddress({
    displayName: payload.display_name,
    latitude,
    longitude,
  });
}

function normalizeOpenStatesResult(item) {
  const role = item.current_role || {};
  const jurisdiction = role.jurisdiction || {};
  const district = role.district ? String(role.district) : undefined;
  const stateCode = role.org_classification === 'upper' || role.org_classification === 'lower'
    ? role.division_id?.match(/state:([a-z]{2})/i)?.[1]?.toUpperCase()
    : undefined;

  return {
    fullName: item.name || 'Unknown legislator',
    officeTitle: role.title || 'State Legislator',
    party: item.party || 'Unknown',
    district,
    state: stateCode || jurisdiction.name,
    photo: item.image,
    website: item.links?.find((link) => link.note?.toLowerCase().includes('homepage'))?.url || item.links?.[0]?.url,
    phone: item.offices?.find((office) => office.voice)?.voice,
    emailOrContactPage:
      item.links?.find((link) => link.url?.toLowerCase().includes('contact'))?.url || item.email,
    officeAddress: item.offices?.find((office) => office.address)?.address,
    source: 'openstates',
  };
}

export async function lookupOpenStates(latitude, longitude) {
  const openstatesKey = requireEnv('OPENSTATES_API_KEY');

  const params = new URLSearchParams({
    lat: String(latitude),
    lng: String(longitude),
    include: 'offices',
  });

  const payload = await fetchJson(`${OPENSTATES_GEO_BASE_URL}?${params.toString()}`, {
    headers: {
      'X-API-KEY': openstatesKey,
    },
  }, 'OpenStates');

  const results = Array.isArray(payload?.results) ? payload.results : [];
  return results.map(normalizeOpenStatesResult);
}
