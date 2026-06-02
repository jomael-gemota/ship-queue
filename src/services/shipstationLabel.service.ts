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
  advancedOptions?: {
    warehouseId?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Body for POST /orders/createlabelfororder. Buys a label *against an existing
 * ShipStation order* (referenced by its numeric orderId). This is required for
 * Amazon Buy Shipping (carrierCode "amazon_shipping"), which only works when the
 * label is tied to a real Amazon order — the standalone /shipments/createlabel
 * endpoint has no order context and Amazon rejects it.
 */
export interface CreateLabelForOrderPayload {
  orderId: number;
  carrierCode: string;
  serviceCode: string;
  packageCode: string;
  confirmation: string;
  shipDate: string;
  weight: ShipStationLabelWeight;
  dimensions: ShipStationLabelDimensions;
  insuranceOptions?: {
    provider: string;
    insureShipment: boolean;
    insuredValue: number;
  } | null;
  internationalOptions?: unknown | null;
  advancedOptions?: {
    warehouseId?: number;
    [key: string]: unknown;
  } | null;
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
 * Low-level POST helper for ShipStation label endpoints. Resolves with the
 * parsed response on 2xx, rejects with ShipStation's error message otherwise,
 * and transparently retries on 429 (rate limit) after the Retry-After delay.
 */
function postShipStationLabel<T>(
  path: string,
  payload: T,
  endpointLabel: string
): Promise<CreateLabelResponse> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);

    const options: https.RequestOptions = {
      hostname: 'ssapi.shipstation.com',
      path,
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
            postShipStationLabel(path, payload, endpointLabel).then(resolve).catch(reject);
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
          `ShipStation ${endpointLabel} failed (HTTP ${status})`;
        reject(new Error(message));
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Calls ShipStation POST /shipments/createlabel (standalone shipment, no order
 * context). Note: this cannot be used with Amazon Buy Shipping.
 */
export function createShipStationLabel(payload: CreateLabelPayload): Promise<CreateLabelResponse> {
  return postShipStationLabel('/shipments/createlabel', payload, 'createlabel');
}

/**
 * Calls ShipStation POST /orders/createlabelfororder — buys a label for an
 * existing order (required for Amazon Buy Shipping). This marks the order as
 * shipped in ShipStation and pushes tracking back to the order source (Amazon).
 */
export function createShipStationLabelForOrder(
  payload: CreateLabelForOrderPayload
): Promise<CreateLabelResponse> {
  return postShipStationLabel('/orders/createlabelfororder', payload, 'createlabelfororder');
}
