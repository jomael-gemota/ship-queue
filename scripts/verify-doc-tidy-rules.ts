/** Temporary check of the rule -> Gmail query compiler and the local matcher. */
import { buildGmailQuery } from '../src/services/gmail.service';
import { messageMatchesRule } from '../src/services/docTidy.service';
import type { IDocTidyRule } from '../src/models/DocTidyRule';
import type { ParsedGmailMessage } from '../src/services/gmail.service';

const rule = (over: Partial<IDocTidyRule>) =>
  ({
    fromAddresses: [],
    toAddresses: [],
    subjectKeywords: [],
    bodyKeywords: [],
    excludeKeywords: [],
    matchMode: 'any',
    requireAttachment: false,
    attachmentExtensions: [],
    ...over,
  }) as IDocTidyRule;

console.log('--- query compiler ---');
console.log('any   :', buildGmailQuery(rule({
  fromAddresses: ['billing@acme.com', 'ap@globex.com'],
  subjectKeywords: ['invoice', 'past due'],
  bodyKeywords: ['purchase order'],
  excludeKeywords: ['draft'],
  requireAttachment: true,
  lookbackDays: 30,
})));

console.log('all   :', buildGmailQuery(rule({
  subjectKeywords: ['invoice'],
  bodyKeywords: ['net 30'],
  matchMode: 'all',
  requireAttachment: true,
})));

console.log('dates :', buildGmailQuery(rule({
  fromAddresses: ['a@b.com'],
  dateFrom: new Date('2026-01-01'),
  dateTo: new Date('2026-01-31'),
})));

console.log('empty :', JSON.stringify(buildGmailQuery(rule({}))));

console.log('group :', buildGmailQuery(rule({
  toAddresses: ['invoice@outdoorequipped.com'],
  fromAddresses: ['CustomerService@proforceequipment.com'],
  requireAttachment: true,
  lookbackDays: 5,
})));

const msg = (over: Partial<ParsedGmailMessage>): ParsedGmailMessage => ({
  gmailMessageId: 'x',
  from: 'billing@acme.com',
  to: ['invoice@outdoorequipped.com'],
  subject: 'January Invoice 1234',
  bodyText: 'Please remit payment. Net 30 terms apply.',
  sentAt: new Date(),
  attachments: [{ filename: 'invoice.pdf', mimeType: 'application/pdf', size: 100, attachmentId: 'a1' }],
  recipientsRaw: 'invoice@outdoorequipped.com',
  ...over,
})

/** A group message as it actually lands in a member's mailbox. */
const groupDelivered = msg({
  to: ['invoice@outdoorequipped.com'],
  recipientsRaw:
    'invoice@outdoorequipped.com jomael@outdoorequipped.com <invoice.outdoorequipped.com> ' +
    '<mailto:invoice@outdoorequipped.com>',
})

/** Unrelated personal mail in the same mailbox — must NOT match a group rule. */
const personalMail = msg({
  to: ['jomael@outdoorequipped.com'],
  recipientsRaw: 'jomael@outdoorequipped.com',
});

console.log('\n--- matcher ---');
const cases: [string, boolean][] = [
  ['subject hit (any)', messageMatchesRule(msg({}), rule({ subjectKeywords: ['invoice'] }))],
  ['subject miss', messageMatchesRule(msg({}), rule({ subjectKeywords: ['receipt'] }))],
  ['all: both present', messageMatchesRule(msg({}), rule({ subjectKeywords: ['invoice'], bodyKeywords: ['net 30'], matchMode: 'all' }))],
  ['all: one missing', messageMatchesRule(msg({}), rule({ subjectKeywords: ['invoice'], bodyKeywords: ['wire transfer'], matchMode: 'all' }))],
  ['exclude wins', messageMatchesRule(msg({}), rule({ subjectKeywords: ['invoice'], excludeKeywords: ['remit'] }))],
  ['sender match', messageMatchesRule(msg({}), rule({ fromAddresses: ['acme.com'] }))],
  ['sender mismatch', messageMatchesRule(msg({}), rule({ fromAddresses: ['globex.com'] }))],
  ['ext allow-list hit', messageMatchesRule(msg({}), rule({ requireAttachment: true, attachmentExtensions: ['pdf'] }))],
  ['ext allow-list miss', messageMatchesRule(msg({}), rule({ requireAttachment: true, attachmentExtensions: ['xlsx'] }))],
  ['requires attachment, none', messageMatchesRule(msg({ attachments: [] }), rule({ requireAttachment: true }))],
  ['no criteria = match all', messageMatchesRule(msg({}), rule({}))],

  // Google Group delivered to a member's mailbox.
  ['group: To header', messageMatchesRule(groupDelivered, rule({ toAddresses: ['invoice@outdoorequipped.com'] }))],
  [
    'group: only List-ID (dotted)',
    messageMatchesRule(
      msg({ to: ['jomael@outdoorequipped.com'], recipientsRaw: '<invoice.outdoorequipped.com>' }),
      rule({ toAddresses: ['invoice@outdoorequipped.com'] })
    ),
  ],
  [
    'group rule ignores personal mail',
    messageMatchesRule(personalMail, rule({ toAddresses: ['invoice@outdoorequipped.com'] })),
  ],
  [
    'group + sender combined',
    messageMatchesRule(
      groupDelivered,
      rule({ toAddresses: ['invoice@outdoorequipped.com'], fromAddresses: ['acme.com'] })
    ),
  ],
];

const expected = [
  true, false, true, false, false, true, false, true, false, false, true,
  true, true, false, true,
];
cases.forEach(([label, actual], i) => {
  const ok = actual === expected[i];
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} -> ${actual}`);
});
console.log(cases.every(([, a], i) => a === expected[i]) ? '\nAll matcher cases passed.' : '\nSOME CASES FAILED');
