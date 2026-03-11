import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ApiError, dedupeLegislators, geocodeAddress, lookupGoogleCivic, lookupOpenStates, reverseGeocode } from './server/civic.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function stripWrappingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

async function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');

  try {
    const raw = await fs.readFile(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const separator = trimmed.indexOf('=');
      if (separator <= 0) {
        continue;
      }

      const key = trimmed.slice(0, separator).trim();
      const value = stripWrappingQuotes(trimmed.slice(separator + 1).trim());
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Unable to read .env file:', error.message);
    }
  }
}

const port = Number(process.env.PORT || 3000);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function toErrorResponse(error) {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      ok: false,
      error: {
        code: 'UPSTREAM_API_ERROR',
        message: 'Unexpected server error.',
      },
    },
  };
}

async function parseJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function buildLookupResponse(normalizedAddress) {
  const civicLegislators = await lookupGoogleCivic(normalizedAddress.formattedAddress);
  const openstatesLegislators = await lookupOpenStates(normalizedAddress.latitude, normalizedAddress.longitude);
  const legislators = dedupeLegislators(civicLegislators, openstatesLegislators);

  if (legislators.length === 0) {
    throw new ApiError('NO_DISTRICT_MATCH', 'No legislators were found for this address.', 404);
  }

  return {
    ok: true,
    normalizedAddress,
    legislators,
    metadata: {
      civicOfficialsCount: civicLegislators.length,
      openStatesOfficialsCount: openstatesLegislators.length,
    },
  };
}

async function serveStatic(req, res) {
  const requestPath = req.url === '/' ? '/index.html' : req.url;
  const fullPath = path.join(__dirname, decodeURIComponent(requestPath.split('?')[0]));

  if (!fullPath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const file = await fs.readFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(file);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/legislators/by-address') {
      const body = await parseJsonBody(req);
      const normalizedAddress = await geocodeAddress(body || {});
      const payload = await buildLookupResponse(normalizedAddress);
      return sendJson(res, 200, payload);
    }

    if (req.method === 'POST' && req.url === '/api/legislators/by-location') {
      const body = await parseJsonBody(req);
      const normalizedAddress = await reverseGeocode(Number(body.latitude), Number(body.longitude));
      const payload = await buildLookupResponse(normalizedAddress);
      return sendJson(res, 200, payload);
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      return serveStatic(req, res);
    }

    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed');
  } catch (error) {
    const err = toErrorResponse(error);
    sendJson(res, err.status, err.body);
  }
});

await loadDotEnv();

server.listen(port, () => {
  console.log(`RLS site running on http://localhost:${port}`);
  console.log('Set GOOGLE_CIVIC_API_KEY and OPENSTATES_API_KEY in your environment or .env file.');
  console.log('Optional: set GOOGLE_GEOCODING_API_KEY for geocoding and reverse geocoding.');
});
