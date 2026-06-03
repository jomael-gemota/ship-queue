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

export interface ShipStationInsuranceOptions {
  provider: string;
  insureShipment: boolean;
  insuredValue: number;
}

/**
 * Minimal shape of a ShipStation order as returned by GET /orders/{orderId}.
 * We treat it as an opaque bag of fields (re-submitted verbatim on upsert) and
 * only ever touch advancedOptions + insuranceOptions ourselves.
 */
export interface ShipStationOrderRecord {
  orderId?: number;
  orderKey?: string;
  orderNumber?: string;
  advancedOptions?: { warehouseId?: number; [key: string]: unknown } | null;
  insuranceOptions?: ShipStationInsuranceOptions | null;
  [key: string]: unknown;
}

/**
 * Generic ShipStation JSON request helper for the /orders endpoints. Mirrors the
 * retry/parse behaviour of postShipStationLabel but supports GET/POST and
 * returns the parsed body as the caller's type.
 */
function shipStationOrderRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  endpointLabel: string,
  payload?: unknown
): Promise<T> {
  return new Promise((resolve, reject) => {
    const body = payload !== undefined ? JSON.stringify(payload) : undefined;

    const headers: Record<string, string | number> = {
      Authorization: getAuthHeader(),
      'Content-Type': 'application/json',
    };
    if (body !== undefined) headers['Content-Length'] = Buffer.byteLength(body);

    const options: https.RequestOptions = {
      hostname: 'ssapi.shipstation.com',
      path,
      method,
      headers,
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
            shipStationOrderRequest<T>(method, path, endpointLabel, payload)
              .then(resolve)
              .catch(reject);
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
          resolve(parsed as T);
          return;
        }

        const message =
          (parsed as { ExceptionMessage?: string })?.ExceptionMessage ||
          (parsed as { Message?: string })?.Message ||
          (parsed as { message?: string })?.message ||
          `ShipStation ${endpointLabel} failed (HTTP ${status})`;
        reject(new Error(message));
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** Fetches a single order (full object) by its numeric orderId. */
export function getShipStationOrder(orderId: number): Promise<ShipStationOrderRecord> {
  return shipStationOrderRequest<ShipStationOrderRecord>(
    'GET',
    `/orders/${orderId}`,
    'getOrder'
  );
}

export interface ShipStationCarrier {
  name?: string;
  code?: string; // carrierCode (e.g. "stamps_com", "amazon_shipping")
  accountNumber?: string;
  requiresFundedAccount?: boolean;
  primary?: boolean;
  [key: string]: unknown;
}

export interface ShipStationCarrierService {
  carrierCode?: string;
  code?: string; // serviceCode (e.g. "usps_ground_advantage")
  name?: string;
  domestic?: boolean;
  international?: boolean;
  [key: string]: unknown;
}

/** Lists the carriers connected to the ShipStation account (GET /carriers). */
export function listShipStationCarriers(): Promise<ShipStationCarrier[]> {
  return shipStationOrderRequest<ShipStationCarrier[]>('GET', '/carriers', 'listCarriers');
}

/** Lists the services available for a given carrierCode (GET /carriers/listservices). */
export function listShipStationCarrierServices(
  carrierCode: string
): Promise<ShipStationCarrierService[]> {
  return shipStationOrderRequest<ShipStationCarrierService[]>(
    'GET',
    `/carriers/listservices?carrierCode=${encodeURIComponent(carrierCode)}`,
    'listServices'
  );
}

export interface TestLabelCarrierService {
  carrierCode: string;
  serviceCode: string;
}

function isUspsCarrier(name?: string, code?: string): boolean {
  const hay = `${name || ''} ${code || ''}`.toLowerCase();
  return hay.includes('usps') || hay.includes('stamps');
}

function pickDomesticService(services: ShipStationCarrierService[]): string | undefined {
  const domestic = services.filter((s) => s.domestic !== false && !s.international);
  const preferred = domestic.find((s) =>
    /ground_advantage|first|priority/i.test(`${s.code} ${s.name}`)
  );
  return (preferred || domestic[0] || services[0])?.code;
}

// Resolving the USPS carrier/service requires up to two extra API calls, so the
// successful result is cached for the lifetime of the process. A failure is not
// cached, so transient errors can be retried on the next label.
let cachedTestLabelCarrierService: TestLabelCarrierService | null = null;

/**
 * Resolves the carrier/service used to mint a non-billable *test label* for the
 * sole purpose of generating a ShipStation packing slip. ShipStation only allows
 * test labels for USPS, so we use a USPS service. Prefers explicit env values
 * (SHIPSTATION_TEST_CARRIER_CODE / SHIPSTATION_TEST_SERVICE_CODE), otherwise
 * auto-discovers a connected USPS carrier + domestic service. Returns null when
 * no USPS carrier is connected (caller should fall back to a generated slip).
 */
export async function resolveTestLabelCarrierService(): Promise<TestLabelCarrierService | null> {
  if (cachedTestLabelCarrierService) return cachedTestLabelCarrierService;

  const envCarrier = process.env.SHIPSTATION_TEST_CARRIER_CODE;
  const envService = process.env.SHIPSTATION_TEST_SERVICE_CODE;
  if (envCarrier && envService) {
    cachedTestLabelCarrierService = { carrierCode: envCarrier, serviceCode: envService };
    return cachedTestLabelCarrierService;
  }

  const carriers = await listShipStationCarriers();
  const usps = carriers.find((c) => isUspsCarrier(c.name, c.code));
  if (!usps?.code) return null;

  const services = await listShipStationCarrierServices(usps.code);
  const serviceCode = envService || pickDomesticService(services);
  if (!serviceCode) return null;

  cachedTestLabelCarrierService = { carrierCode: usps.code, serviceCode };
  return cachedTestLabelCarrierService;
}

/**
 * Upserts an order via POST /orders/createorder. ShipStation matches on
 * orderId/orderKey, so re-submitting a previously-fetched order updates it in
 * place rather than creating a duplicate.
 */
export function upsertShipStationOrder(
  order: ShipStationOrderRecord
): Promise<ShipStationOrderRecord> {
  return shipStationOrderRequest<ShipStationOrderRecord>(
    'POST',
    '/orders/createorder',
    'createorder',
    order
  );
}

/**
 * Forces an order's Ship From warehouse and insurance settings *before* buying
 * the label.
 *
 * Why this is required: POST /orders/createlabelfororder buys the label using
 * the order's own saved advancedOptions.warehouseId and insuranceOptions — it
 * ignores those fields when sent on the label request itself. Amazon orders
 * import with the account-default warehouse (e.g. "NC WH") and carrier insurance
 * equal to the order value, so without this step labels ship from the wrong
 * origin and get charged for insurance we don't want.
 *
 * We fetch the full order, override only warehouseId + insuranceOptions, and
 * re-upsert it so the subsequent label purchase uses the correct origin and no
 * insurance.
 */
export async function applyShipFromAndInsuranceToOrder(
  orderId: number,
  warehouseId: number | undefined,
  insuranceOptions: ShipStationInsuranceOptions
): Promise<void> {
  const order = await getShipStationOrder(orderId);

  const advancedOptions = { ...(order.advancedOptions || {}) };
  if (typeof warehouseId === 'number' && Number.isFinite(warehouseId)) {
    advancedOptions.warehouseId = warehouseId;
  }

  await upsertShipStationOrder({
    ...order,
    advancedOptions,
    insuranceOptions,
  });

  // Post-upsert verification: re-read the order and confirm the override
  // actually stuck before the caller buys the (billable, irreversible) label.
  // Throwing here means the row is recorded as failed rather than shipped from
  // the wrong origin or charged for unwanted insurance.
  const saved = await getShipStationOrder(orderId);

  const savedWarehouseId = saved.advancedOptions?.warehouseId;
  if (
    typeof warehouseId === 'number' &&
    Number.isFinite(warehouseId) &&
    savedWarehouseId !== warehouseId
  ) {
    throw new Error(
      `Ship From override did not apply: order ${orderId} is still on warehouse ` +
        `${savedWarehouseId ?? 'unknown'} (expected ${warehouseId}). Label not purchased.`
    );
  }

  const savedProvider = saved.insuranceOptions?.provider ?? 'none';
  const savedInsured = Boolean(saved.insuranceOptions?.insureShipment);
  if (savedProvider !== insuranceOptions.provider || savedInsured !== insuranceOptions.insureShipment) {
    throw new Error(
      `Insurance override did not apply: order ${orderId} still has provider ` +
        `"${savedProvider}" (insureShipment=${savedInsured}); expected "${insuranceOptions.provider}" ` +
        `(insureShipment=${insuranceOptions.insureShipment}). Label not purchased.`
    );
  }
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
