import https from 'https';

export interface ShipStationLabelAddress {
  name?: string;
  company?: string;
  street1?: string;
  street2?: string;
  street3?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  residential?: boolean;
}

export interface ShipStationLabelWeight {
  value: number;
  units: string;
}

export interface ShipStationLabelDimensions {
  length: number;
  width: number;
  height: number;
  units: string;
}

export interface CreateLabelPayload {
  carrierCode: string;
  serviceCode: string;
  packageCode: string;
  shipDate: string;
  weight: ShipStationLabelWeight;
  dimensions: ShipStationLabelDimensions;
  shipFrom: ShipStationLabelAddress;
  shipTo: ShipStationLabelAddress;
  insuranceOptions: {
    provider: string;
    insureShipment: boolean;
    insuredValue: number;
  };
  testLabel?: boolean;
  [key: string]: unknown;
}

export interface CreateLabelResponse {
  shipmentId?: number;
  shipmentCost?: number;
  insuranceCost?: number;
  trackingNumber?: string;
  labelData?: string;
  formData?: unknown;
  [key: string]: unknown;
}

function getAuthHeader(): string {
  const apiKey = process.env.SHIPSTATION_API_KEY;
  const apiSecret = process.env.SHIPSTATION_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error('SHIPSTATION_API_KEY and SHIPSTATION_API_SECRET must be set');
  }

  return `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`;
}

/**
 * Calls ShipStation POST /shipments/createlabel.
 * Resolves with the parsed label response, rejects with a descriptive error
 * (including ShipStation's error message body when available).
 */
export function createShipStationLabel(payload: CreateLabelPayload): Promise<CreateLabelResponse> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);

    const options: https.RequestOptions = {
      hostname: 'ssapi.shipstation.com',
      path: '/shipments/createlabel',
      method: 'POST',
      headers: {
        Authorization: getAuthHeader(),
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk: Buffer) => {
        raw += chunk.toString();
      });
      res.on('end', () => {
        const status = res.statusCode || 0;

        if (status === 429) {
          const retryAfter = parseInt((res.headers['retry-after'] as string) || '60', 10);
          setTimeout(() => {
            createShipStationLabel(payload).then(resolve).catch(reject);
          }, retryAfter * 1000);
          return;
        }

        let parsed: unknown;
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch {
          reject(new Error(`ShipStation returned an unparseable response (HTTP ${status})`));
          return;
        }

        if (status >= 200 && status < 300) {
          resolve(parsed as CreateLabelResponse);
          return;
        }

        const message =
          (parsed as { ExceptionMessage?: string; Message?: string; message?: string })?.ExceptionMessage ||
          (parsed as { Message?: string })?.Message ||
          (parsed as { message?: string })?.message ||
          `ShipStation createlabel failed (HTTP ${status})`;
        reject(new Error(message));
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
