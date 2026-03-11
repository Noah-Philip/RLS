const form = document.querySelector('.finder');
const results = document.getElementById('finder-results');
const useLocationButton = document.getElementById('use-location');

const errorMessages = {
  INVALID_ADDRESS: 'Please enter a valid U.S. address and try again.',
  GEOLOCATION_DENIED: 'Location access was denied. Please enter your address manually.',
  NO_DISTRICT_MATCH: 'We could not find legislators for that location.',
  RATE_LIMITED: 'Lookup service is temporarily rate-limited. Please try again shortly.',
  MISSING_API_KEYS: 'Service is not configured. Please contact the site administrator.',
  UPSTREAM_API_ERROR: 'We could not reach legislator data providers. Please try again later.',
};

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderStatus(message, kind = 'info') {
  if (!results) return;
  results.innerHTML = `<p class="finder-status finder-status-${kind}">${escapeHtml(message)}</p>`;
}

function contactValue(legislator) {
  if (!legislator.emailOrContactPage) {
    return 'Not available';
  }
  if (legislator.emailOrContactPage.includes('@')) {
    const email = escapeHtml(legislator.emailOrContactPage);
    return `<a href="mailto:${email}">${email}</a>`;
  }
  const url = escapeHtml(legislator.emailOrContactPage);
  return `<a href="${url}" target="_blank" rel="noopener">Contact</a>`;
}

function renderLegislators(payload) {
  if (!results) return;
  if (!payload.legislators?.length) {
    renderStatus('No legislators found for this address.', 'empty');
    return;
  }

  const cards = payload.legislators
    .map(
      (item) => `
      <article class="legislator-card">
        <div class="legislator-head">
          ${item.photo ? `<img src="${escapeHtml(item.photo)}" alt="${escapeHtml(item.fullName)}" class="legislator-photo" />` : '<div class="legislator-photo-placeholder" aria-hidden="true"></div>'}
          <div>
            <h3>${escapeHtml(item.fullName)}</h3>
            <p class="legislator-title">${escapeHtml(item.officeTitle)}</p>
            <p class="legislator-meta">${escapeHtml(item.party || 'Party unavailable')} • ${escapeHtml(item.state || 'State unavailable')} ${item.district ? `• District ${escapeHtml(item.district)}` : ''}</p>
          </div>
        </div>
        <div class="legislator-details">
          <p><strong>Phone:</strong> ${item.phone ? escapeHtml(item.phone) : 'Not available'}</p>
          <p><strong>Website:</strong> ${item.website ? `<a href="${escapeHtml(item.website)}" target="_blank" rel="noopener">Visit website</a>` : 'Not available'}</p>
          <p><strong>Email / Contact:</strong> ${contactValue(item)}</p>
          <p><strong>Office:</strong> ${item.officeAddress ? escapeHtml(item.officeAddress) : 'Not available'}</p>
        </div>
      </article>
    `,
    )
    .join('');

  results.innerHTML = `
    <p class="finder-normalized"><strong>Address:</strong> ${escapeHtml(payload.normalizedAddress.formattedAddress)}</p>
    <div class="legislator-grid">${cards}</div>
  `;
}

async function postLookup(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    const code = payload?.error?.code;
    const message = errorMessages[code] || payload?.error?.message || 'Lookup failed.';
    throw new Error(message);
  }

  return payload;
}

function normalizeFormData(formData) {
  return {
    street: String(formData.get('street') || '').trim(),
    city: String(formData.get('city') || '').trim(),
    state: String(formData.get('state') || '').trim().toUpperCase(),
    zip: String(formData.get('zip') || '').trim(),
  };
}

if (form && results) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const address = normalizeFormData(new FormData(form));
    renderStatus('Looking up your elected officials…', 'loading');

    try {
      const payload = await postLookup('/api/legislators/by-address', address);
      renderLegislators(payload);
    } catch (error) {
      renderStatus(error.message, 'error');
    }
  });
}

if (useLocationButton && results) {
  useLocationButton.addEventListener('click', async () => {
    if (!navigator.geolocation) {
      renderStatus('Geolocation is not supported by your browser. Please enter your address manually.', 'error');
      return;
    }

    renderStatus('Accessing your location…', 'loading');
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          renderStatus('Finding your address and legislators…', 'loading');
          const payload = await postLookup('/api/legislators/by-location', {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
          renderLegislators(payload);
        } catch (error) {
          renderStatus(error.message, 'error');
        }
      },
      (geoError) => {
        if (geoError.code === geoError.PERMISSION_DENIED) {
          renderStatus(errorMessages.GEOLOCATION_DENIED, 'error');
          return;
        }
        renderStatus('Unable to determine your location. Please enter your address manually.', 'error');
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
      },
    );
  });
}

const accordionTriggers = document.querySelectorAll('.accordion-trigger');
if (accordionTriggers.length > 0) {
  accordionTriggers.forEach((trigger) => {
    trigger.addEventListener('click', () => {
      const isExpanded = trigger.getAttribute('aria-expanded') === 'true';
      accordionTriggers.forEach((item) => {
        const panel = document.getElementById(item.getAttribute('aria-controls'));
        item.setAttribute('aria-expanded', 'false');
        panel.hidden = true;
      });
      if (!isExpanded) {
        const panel = document.getElementById(trigger.getAttribute('aria-controls'));
        trigger.setAttribute('aria-expanded', 'true');
        panel.hidden = false;
      }
    });
  });
}
