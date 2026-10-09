/**
 * spsEdi.service.ts
 *
 * Parses SPS Commerce EDI files (X12 text format or XML-wrapped)
 * to extract the structured transaction metadata that the Fulfillment
 * Monitor UI shows — doc type, document number, PO number, sender/receiver
 * names, and date — all from the raw file content returned by the
 * Transaction API v5.
 */

/* ─────────────────────────────────── Types ── */

export interface SpsTransaction {
  /** Filename of the source EDI file, e.g. "PO584615-1-v7.7-BulkImport.xml" */
  filename: string;
  /** Full download URL for the raw file */
  downloadUrl: string;
  /** EDI transaction set code: "810", "856", "850", "855", "997", etc. */
  transactionSet: string;
  /** Human-readable label, e.g. "Invoice (810)" */
  transactionLabel: string;
  /** Primary document number: invoice #, ASN #, or PO # */
  documentNumber: string;
  /** Purchase order number */
  poNumber: string;
  /** Trading partner / vendor name (from N1 segments or EDI header) */
  senderName: string;
  /** EDI interchange sender ID (ISA06) */
  senderId: string;
  /** Receiver / buyer name */
  receiverName: string;
  /** Document date as YYYY-MM-DD string */
  documentDate: string;
  /** File size in bytes (when provided by the directory listing) */
  size?: number;
  /** ISO timestamp when the file appeared in the Transaction API queue */
  createdAt?: string;
  /** Raw parse error, if any — the record is still returned with best-effort fields */
  parseError?: string;
}

/* ─────────────────────────── Transaction set labels ── */

const TX_LABELS: Record<string, string> = {
  '810': 'Invoice',
  '812': 'Credit/Debit Adjustment',
  '820': 'Payment Order',
  '824': 'Application Advice',
  '830': 'Planning Schedule',
  '832': 'Price/Sales Catalog',
  '840': 'Request for Quote',
  '843': 'Quote Response',
  '846': 'Inventory Inquiry',
  '850': 'Purchase Order',
  '855': 'PO Acknowledgment',
  '856': 'Ship Notice / ASN',
  '860': 'PO Change Request',
  '865': 'PO Change Ack',
  '867': 'Product Transfer',
  '870': 'Order Status Report',
  '997': 'Functional Acknowledgment',
  '999': 'Implementation Acknowledgment',
};

function txLabel(set: string): string {
  const name = TX_LABELS[set];
  if (!set) return 'Unknown';
  return name ? `${name} (${set})` : set;
}

/* ─────────────────────────────────── Date parser ── */

/** Converts EDI date strings (YYMMDD or YYYYMMDD) to ISO YYYY-MM-DD. */
function ediDate(raw: string): string {
  const s = raw?.replace(/\D/g, '') ?? '';
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (s.length === 6) {
    const yy = parseInt(s.slice(0, 2), 10);
    const century = yy > 50 ? '19' : '20';
    return `${century}${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
  }
  return raw ?? '';
}

/* ─────────────────────────────── X12 EDI parser ── */

/**
 * Parses a raw X12 EDI interchange and returns the extracted fields.
 *
 * Handles ISA/GS/ST envelopes plus the key transaction-set segments:
 *   810 invoice → BIG (invoice#, PO#, date)
 *   856 ASN     → BSN (shipment ID, date)
 *   850 PO      → BEG (PO#, date)
 *   855 PO ack  → BAK (PO#, date)
 * Party names are extracted from N1 segments.
 */
function parseX12(content: string): Pick<SpsTransaction,
  'transactionSet' | 'transactionLabel' | 'documentNumber' | 'poNumber' |
  'senderName' | 'senderId' | 'receiverName' | 'documentDate'
> {
  // ISA is always 106 chars: 3 (ISA) + 103 data + segment terminator.
  // Character at index 3 = field separator, index 105 = segment terminator.
  const fieldSep = content.length >= 4  ? content[3]   : '*';
  const segSep   = content.length >= 106 ? content[105] : '~';

  const segments = content
    .split(segSep)
    .map(s => s.replace(/\r?\n|\r/g, '').trim())
    .filter(Boolean)
    .map(s => s.split(fieldSep));

  let transactionSet = '';
  let documentNumber = '';
  let poNumber = '';
  let senderName = '';
  let senderId = '';
  let receiverName = '';
  let documentDate = '';

  for (const seg of segments) {
    const id = (seg[0] ?? '').toUpperCase();

    switch (id) {
      case 'ISA':
        // ISA05=sender qualifier, ISA06=sender ID, ISA09=date (1-based, seg[0]=ISA)
        senderId = (seg[6] ?? '').trim();
        if (!documentDate && seg[9]) documentDate = ediDate(seg[9]);
        break;

      case 'GS':
        // GS04 = date (YYYYMMDD)
        if (seg[4]) documentDate = ediDate(seg[4]);
        break;

      case 'ST':
        // ST01 = transaction set identifier
        transactionSet = (seg[1] ?? '').trim();
        break;

      case 'BIG':
        // 810 Invoice: BIG01=invoice date, BIG02=invoice#, BIG04=PO#
        if (seg[1]) documentDate  = ediDate(seg[1]);
        if (seg[2]) documentNumber = seg[2].trim();
        if (seg[4]) poNumber       = seg[4].trim();
        break;

      case 'BSN':
        // 856 ASN: BSN02=shipment ID (ASN#), BSN03=date
        if (seg[2]) documentNumber = seg[2].trim();
        if (seg[3]) documentDate   = ediDate(seg[3]);
        break;

      case 'BEG':
        // 850 PO: BEG03=PO#, BEG05=date
        if (seg[3]) { poNumber = seg[3].trim(); documentNumber = seg[3].trim(); }
        if (seg[5]) documentDate = ediDate(seg[5]);
        break;

      case 'BAK':
        // 855 PO Ack: BAK03=PO#, BAK04=date
        if (seg[3]) { poNumber = seg[3].trim(); documentNumber = seg[3].trim(); }
        if (seg[4]) documentDate = ediDate(seg[4]);
        break;

      case 'BCT':
        // 812 Credit/Debit: BCT02=credit#, BCT04=PO#
        if (seg[2]) documentNumber = seg[2].trim();
        if (seg[4]) poNumber       = seg[4].trim();
        break;

      case 'N1': {
        // N1*EntityCode*Name
        const code = (seg[1] ?? '').toUpperCase().trim();
        const name = (seg[2] ?? '').trim();
        if (!name) break;
        // Seller / vendor / ship-from = the trading partner (sender)
        if (['SF', 'VN', 'SE', 'SU', 'MF', '14'].includes(code) && !senderName) {
          senderName = name;
        }
        // Buyer / bill-to / ship-to = our side (receiver)
        if (['BY', 'BT', 'ST', '1', 'RE', 'CN'].includes(code) && !receiverName) {
          receiverName = name;
        }
        break;
      }
    }
  }

  // Fall back to ISA sender ID if no N1 name was found
  if (!senderName && senderId) senderName = senderId;

  return {
    transactionSet,
    transactionLabel: txLabel(transactionSet),
    documentNumber,
    poNumber,
    senderName,
    senderId,
    receiverName,
    documentDate,
  };
}

/* ─────────────────────────────────── XML parser ── */

/** Very small tag-value extractor — no need for a full DOM parser for these small files. */
function tagValue(xml: string, ...tags: string[]): string {
  for (const tag of tags) {
    const re = new RegExp(`<${tag}[^>]*>\\s*([^<]+?)\\s*<\\/${tag}>`, 'i');
    const m  = xml.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return '';
}

/** Extract the root element name from an XML document, e.g. "Invoice", "Order". */
function rootElement(xml: string): string {
  const m = xml.match(/<([A-Za-z][A-Za-z0-9_-]*)[^>]*>/);
  // Skip the XML declaration
  if (m && m[1].toLowerCase() !== 'xml' && m[1] !== '?xml') return m[1];
  // Try again past the declaration
  const m2 = xml.replace(/<\?xml[^?]*\?>\s*/i, '').match(/<([A-Za-z][A-Za-z0-9_-]*)[^>]*>/);
  return m2?.[1] ?? '';
}

/**
 * SPS Commerce XML format mapping.
 *
 * Root element → transaction set code:
 *   Order       → 850 Purchase Order
 *   Invoice     → 810 Invoice
 *   ASN         → 856 Ship Notice / ASN
 *   OrderAck    → 855 PO Acknowledgment
 *   PriceChange → 832 Price/Sales Catalog
 *   (etc.)
 *
 * Header fields differ by document type.
 */
const SPS_XML_TX: Record<string, string> = {
  Order:        '850',
  Invoice:      '810',
  ASN:          '856',
  ShipNotice:   '856',
  OrderAck:     '855',
  Acknowledgment: '997',
  PriceChange:  '832',
  PaymentOrder: '820',
  PlanningSchedule: '830',
};

function parseXml(content: string): Pick<SpsTransaction,
  'transactionSet' | 'transactionLabel' | 'documentNumber' | 'poNumber' |
  'senderName' | 'senderId' | 'receiverName' | 'documentDate'
> {
  const root = rootElement(content);

  // Derive transaction set from root element name or embedded numeric code.
  // NOTE: TsetPurposeCode is a DIFFERENT concept (00=Original, 01=Cancel, etc.)
  //       and must NOT be used here — it looks like a tx set code but isn't.
  const transactionSet =
    SPS_XML_TX[root] ||
    SPS_XML_TX[root.replace(/^SPS/i, '')] ||
    tagValue(content, 'TransactionSetIdentifier', 'TransactionType') ||
    // Only fall back to embedded digit search if nothing else matched
    (content.match(/<TransactionSetCode>(\d{3})<\/TransactionSetCode>/i)?.[1] ?? '');

  // TradingPartnerId is the SPS account's trading partner identifier (the sender in SPS XML)
  const senderId = tagValue(content, 'TradingPartnerId', 'TradingPartnerID', 'PartnerID');

  // Primary document number by type
  const documentNumber = tagValue(
    content,
    'InvoiceNumber',       // 810
    'ShipmentID',          // 856 ASN
    'ASNNumber',           // 856 alt
    'PurchaseOrderAcknowledgementNumber', // 855
    'PurchaseOrderNumber', // 850 (fallback)
    'DocumentNumber',
  );

  // PO number always extracted as a cross-reference
  const poNumber = tagValue(
    content,
    'PurchaseOrderNumber',
    'PONumber',
    'VendorOrderNumber',
    'RetailerOrderNumber',
  );

  // Primary date by type
  const rawDate = tagValue(
    content,
    'InvoiceDate',         // 810
    'ShipDate',            // 856
    'PurchaseOrderDate',   // 850
    'AcknowledgementDate', // 855
    'DocumentDate',
    'Date',
  );
  const documentDate = rawDate
    ? (rawDate.includes('-') ? rawDate.slice(0, 10) : ediDate(rawDate))
    : '';

  // Sender / vendor name — SPS XML uses "Vendor" as a vendor code, Name fields elsewhere
  const senderName =
    tagValue(content, 'VendorName', 'SellerName', 'SupplierName', 'ShipFromName', 'FromName') ||
    // Fall back to the Vendor code element if no name available
    tagValue(content, 'Vendor');

  const receiverName =
    tagValue(content, 'BuyerName', 'BillToName', 'ShipToName', 'RetailerName', 'ToName', 'ReceiverName');

  return {
    transactionSet,
    transactionLabel: txLabel(transactionSet),
    documentNumber,
    poNumber,
    senderName,
    senderId,
    receiverName,
    documentDate,
  };
}

/* ────────────────────────────────── Filename heuristics ── */

/**
 * Many SPS filenames encode the PO number, e.g.:
 *   "PO584615-1-v7.7-BulkImport.xml"  → 584615
 *   "810-INV20001-PO12345.edi"         → 12345
 *
 * Returns the best guess, or '' if nothing found.
 */
function poFromFilename(filename: string): string {
  // Explicit PO prefix in filename
  const m = filename.match(/\bPO[-_]?(\d{4,})/i);
  if (m) return m[1];
  // Long number embedded (likely a PO)
  const nums = filename.match(/\b(\d{5,})\b/g);
  if (nums && nums.length === 1) return nums[0];
  return '';
}

/** Infer transaction set from the SPS folder/doc-type abbreviation. */
function txFromDocType(docType: string): string {
  const upper = docType.toUpperCase();
  const MAP: Record<string, string> = {
    // SPS folder names → EDI transaction set
    PO: '850',   // Purchase Order
    IN: '810',   // Invoice
    SN: '856',   // Ship Notice (ASN)
    SH: '856',   // Ship Notice alt
    ASN: '856',
    PA: '855',   // PO Acknowledgment
    CA: '812',   // Credit/Debit Adjustment
    IB: '846',   // Inventory Balance
    PC: '832',   // Price Catalog
    PR: '820',   // Payment Remittance
    PRC: '832',
    // Numeric codes pass through
    '810': '810', '820': '820', '830': '830', '832': '832',
    '840': '840', '843': '843', '846': '846', '850': '850',
    '855': '855', '856': '856', '860': '860', '865': '865',
    '997': '997',
  };
  return MAP[upper] ?? '';
}

/* ────────────────────────────────── Public API ── */

export interface ParseInput {
  content: string;
  filename: string;
  downloadUrl: string;
  /** Document-type folder the file came from (e.g. "PO", "IN") — used as fallback */
  docTypeFolderHint?: string;
  size?: number;
  createdAt?: string;
}

/**
 * Parse a single SPS EDI/XML file and return a structured SpsTransaction.
 * Never throws — returns best-effort fields plus a `parseError` if parsing failed.
 */
export function parseSpsFile(input: ParseInput): SpsTransaction {
  const { content, filename, downloadUrl, docTypeFolderHint, size, createdAt } = input;

  const base: SpsTransaction = {
    filename, downloadUrl, size, createdAt,
    transactionSet: '', transactionLabel: '', documentNumber: '',
    poNumber: '', senderName: '', senderId: '', receiverName: '', documentDate: '',
  };

  try {
    const trimmed = content.trim();
    const isXml   = trimmed.startsWith('<') || trimmed.startsWith('<?');

    const parsed = isXml ? parseXml(content) : parseX12(content);

    // Fill in anything the file didn't tell us
    const transactionSet  = parsed.transactionSet  || txFromDocType(docTypeFolderHint ?? '');
    const poNumber        = parsed.poNumber        || poFromFilename(filename);

    return {
      ...base,
      ...parsed,
      transactionSet,
      transactionLabel: txLabel(transactionSet),
      poNumber,
    };
  } catch (err) {
    return {
      ...base,
      transactionSet:  txFromDocType(docTypeFolderHint ?? ''),
      transactionLabel: txLabel(txFromDocType(docTypeFolderHint ?? '')),
      poNumber: poFromFilename(filename),
      parseError: err instanceof Error ? err.message : String(err),
    };
  }
}
