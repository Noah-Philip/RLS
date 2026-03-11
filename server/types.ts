export type LookupErrorCode =
  | 'INVALID_ADDRESS'
  | 'GEOLOCATION_DENIED'
  | 'NO_DISTRICT_MATCH'
  | 'RATE_LIMITED'
  | 'MISSING_API_KEYS'
  | 'UPSTREAM_API_ERROR';

export interface Legislator {
  fullName: string;
  officeTitle: string;
  party?: string;
  district?: string;
  state?: string;
  photo?: string;
  website?: string;
  phone?: string;
  emailOrContactPage?: string;
  officeAddress?: string;
  source: 'google-civic' | 'openstates';
}

export interface AddressPayload {
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface NormalizedAddress {
  formattedAddress: string;
  latitude: number;
  longitude: number;
  placeId?: string;
}

export interface LookupSuccessResponse {
  ok: true;
  normalizedAddress: NormalizedAddress;
  legislators: Legislator[];
  metadata: {
    civicOfficialsCount: number;
    openStatesOfficialsCount: number;
  };
}

export interface LookupErrorResponse {
  ok: false;
  error: {
    code: LookupErrorCode;
    message: string;
    details?: string;
  };
}

export type LookupResponse = LookupSuccessResponse | LookupErrorResponse;
