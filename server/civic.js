const GOOGLE_CIVIC_BASE_URL = 'https://www.googleapis.com/civicinfo/v2/representatives';
const GOOGLE_GEOCODE_BASE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const OPENSTATES_GEO_BASE_URL = 'https://v3.openstates.org/people.geo';

const OFFICE_LEVELS = new Set(['country', 'administrativeArea1']);

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

function extractOfficeAddress(address) {
  if (!address) {
    return undefined;
  }
  const lines = [address.line1, address.line2, address.line3].filter(Boolean);
  const cityStateZip = [address.city, address.state, address.zip].filter(Boolean).join(', ');
  if (cityStateZip) lines.push(cityStateZip);
  return lines.join(', ');
}

function primaryWebsite(channels = [], urls = []) {
  if (Array.isArray(urls) && urls.length > 0) {
    return urls[0];
  }
  const channel = channels.find((item) => item.type === 'Website');
  return channel?.id;
}

function emailOrContact(official) {
  if (official.emails?.length) {
    return official.emails[0];
  }
  const contactChannel = official.channels?.find((channel) => channel.type === 'ContactForm');
  return contactChannel?.id;
}

export async function geocodeAddress({ street, city, state, zip }) {
  if (!street || !city || !state || !zip) {
    throw new ApiError('INVALID_ADDRESS', 'Street, city, state, and ZIP are required.', 400);
  }

  const geocodingKey = process.env.GOOGLE_GEOCODING_API_KEY || requireEnv('GOOGLE_CIVIC_API_KEY');
  const address = `${street}, ${city}, ${state} ${zip}`;
  const params = new URLSearchParams({ address, key: geocodingKey });
  const payload = await fetchJson(`${GOOGLE_GEOCODE_BASE_URL}?${params.toString()}`, {}, 'Google Geocoding');

  if (payload.status === 'REQUEST_DENIED') {
    throw new ApiError('UPSTREAM_API_ERROR', 'Google Geocoding denied the request.', 502, payload.error_message);
  }
  if (payload.status === 'OVER_QUERY_LIMIT') {
    throw new ApiError('RATE_LIMITED', 'Google Geocoding API rate limit reached.', 429);
  }
  if (payload.status !== 'OK' || !payload.results?.length) {
    throw new ApiError('INVALID_ADDRESS', 'Address could not be validated. Please check and try again.', 400);
  }

  const best = payload.results[0];
  const location = best.geometry?.location;
  if (!location?.lat || !location?.lng) {
    throw new ApiError('INVALID_ADDRESS', 'Address is missing geolocation coordinates.', 400);
  }

  return {
    formattedAddress: best.formatted_address,
    latitude: location.lat,
    longitude: location.lng,
    placeId: best.place_id,
  };
}

export async function reverseGeocode(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new ApiError('INVALID_ADDRESS', 'Latitude and longitude must be valid numbers.', 400);
  }

  const geocodingKey = process.env.GOOGLE_GEOCODING_API_KEY || requireEnv('GOOGLE_CIVIC_API_KEY');
  const params = new URLSearchParams({ latlng: `${latitude},${longitude}`, key: geocodingKey });
  const payload = await fetchJson(`${GOOGLE_GEOCODE_BASE_URL}?${params.toString()}`, {}, 'Google Geocoding');

  if (payload.status === 'OVER_QUERY_LIMIT') {
    throw new ApiError('RATE_LIMITED', 'Google Geocoding API rate limit reached.', 429);
  }
  if (payload.status !== 'OK' || !payload.results?.length) {
    throw new ApiError('INVALID_ADDRESS', 'Could not convert your location into a street address.', 400);
  }

  const result = payload.results[0];
  return {
    formattedAddress: result.formatted_address,
    latitude,
    longitude,
    placeId: result.place_id,
  };
}

export async function lookupGoogleCivic(address) {
  const civicKey = requireEnv('GOOGLE_CIVIC_API_KEY');
  const params = new URLSearchParams({
    key: civicKey,
    address,
    includeOffices: 'true',
    levels: 'country,administrativeArea1',
    roles: 'legislatorUpperBody,legislatorLowerBody',
  });

  const payload = await fetchJson(`${GOOGLE_CIVIC_BASE_URL}?${params.toString()}`, {}, 'Google Civic');

  const offices = payload.offices || [];
  const officials = payload.officials || [];

  const legislators = offices
    .filter((office) => {
      const levels = office.levels || [];
      return levels.length === 0 || levels.some((level) => OFFICE_LEVELS.has(level));
    })
    .flatMap((office) =>
      (office.officialIndices || []).map((index) => {
        const official = officials[index];
        if (!official) {
          return null;
        }

        return {
          fullName: official.name,
          officeTitle: office.name,
          party: official.party,
          district: office.divisionId?.split('/').pop()?.replace('cd:', '').toUpperCase(),
          state: office.divisionId?.match(/state:([a-z]{2})/i)?.[1]?.toUpperCase(),
          photo: official.photoUrl,
          website: primaryWebsite(official.channels, official.urls),
          phone: official.phones?.[0],
          emailOrContactPage: emailOrContact(official),
          officeAddress: extractOfficeAddress(official.address?.[0]),
          source: 'google-civic',
        };
      }),
    )
    .filter(Boolean);

  return legislators;
}

export async function lookupOpenStates(latitude, longitude) {
  const openstatesKey = process.env.OPENSTATES_API_KEY;
  if (!openstatesKey) {
    return [];
  }

  const params = new URLSearchParams({ lat: String(latitude), lng: String(longitude), include: 'offices' });
  const payload = await fetchJson(`${OPENSTATES_GEO_BASE_URL}?${params.toString()}`, {
    headers: {
      'X-API-KEY': openstatesKey,
    },
  }, 'OpenStates');

  const results = payload.results || [];
  return results.map((item) => ({
    fullName: item.name,
    officeTitle: item.current_role?.title || 'State Legislator',
    party: item.party,
    district: item.current_role?.district,
    state: item.current_role?.jurisdiction?.name,
    photo: item.image,
    website: item.links?.find((link) => link.note?.toLowerCase().includes('homepage'))?.url || item.links?.[0]?.url,
    phone: item.offices?.find((office) => office.voice)?.voice,
    emailOrContactPage: item.links?.find((link) => link.url?.includes('contact'))?.url,
    officeAddress: item.offices?.find((office) => office.address)?.address,
    source: 'openstates',
  }));
}

export function dedupeLegislators(civicLegislators, openstatesLegislators) {
  const index = new Map();
  for (const person of [...civicLegislators, ...openstatesLegislators]) {
    const key = `${person.fullName}|${person.officeTitle}`.toLowerCase();
    if (!index.has(key)) {
      index.set(key, person);
    }
  }
  return [...index.values()];
}
