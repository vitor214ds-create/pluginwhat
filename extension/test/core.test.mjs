import test from 'node:test';
import assert from 'node:assert/strict';
import { parseContacts, normalizePhone, validateConfig, createCampaign, completeContact,
  pauseCampaign, resumeCampaign, resolveContact, jobUrl, matchesJob } from '../core.js';

const config = { contacts: ['5511912345678', '5521912345678', '5531912345678', '5541912345678', '5551912345678', '5561912345678', '5571912345678'],
  messages: ['Olá 1!\nTudo bem?', 'Olá 2! 🌱', 'Olá 3!'], intervalSeconds: 90 };

test('TXT normalizes Brazilian numbers, international prefixes, BOM and duplicate formats', () => {
  const parsed = parseContacts('\uFEFF(11) 91234-5678\r\n+55 11 91234-5678\n005521912345678\n+1 (202) 555-0100\n\n');
  assert.deepEqual(parsed.contacts, ['5511912345678', '5521912345678', '12025550100']);
  assert.equal(parsed.duplicates, 1); assert.equal(parsed.invalid.length, 0);
});
test('TXT rejects names, comma-separated rows, invalid length and unsafe content', () => {
  const parsed = parseContacts('abc\n11912345678,21912345678\n123\n<script>alert(1)</script>\n+5511\n');
  assert.equal(parsed.contacts.length, 0); assert.deepEqual(parsed.invalid.map(row => row.line), [1, 2, 3, 4, 5]);
  assert.equal(normalizePhone('+5511912345678'), '5511912345678');
  assert.equal(normalizePhone('+442079460000', ''), '442079460000');
});
test('configuration rejects duplicates, empty templates, oversized text and invalid intervals', () => {
  for (const change of [{ contacts: [] }, { contacts: [config.contacts[0], config.contacts[0]] },
    { messages: ['a', '', 'c'] }, { messages: ['a', 'b', 'x'.repeat(3001)] },
    { intervalSeconds: 0 }, { intervalSeconds: NaN }, { intervalSeconds: 86401 }]) {
    assert.throws(() => validateConfig({ ...config, ...change }));
  }
  assert.equal(validateConfig(config).intervalSeconds, 90);
});
test('seven distinct contacts receive 1,2,3,1,2,3,1 with a full interval after each ack', () => {
  const campaign = createCampaign(config, 10, 1000);
  assert.deepEqual(campaign.queue.map(row => row.template), [0, 1, 2, 0, 1, 2, 0]);
  const phones = new Set();
  for (let i = 0; i < 7; i++) {
    phones.add(campaign.queue[campaign.cursor].phone);
    completeContact(campaign, 2000 + i * 100000);
    assert.equal(campaign.cursor, i + 1);
    assert.equal(campaign.queue[i].status, 'sent');
    if (i < 6) assert.equal(campaign.nextAt, 92000 + i * 100000);
  }
  assert.equal(phones.size, 7); assert.equal(campaign.status, 'completed'); assert.equal(campaign.nextAt, null);
});
test('an interrupted click is never automatically retried, even after storage round trip', () => {
  let campaign = createCampaign(config, 10);
  campaign.job = { phase: 'sending' }; pauseCampaign(campaign, 'closed');
  campaign = JSON.parse(JSON.stringify(campaign));
  assert.equal(campaign.queue[0].status, 'uncertain');
  assert.throws(() => resumeCampaign(campaign), /Confira/);
  resolveContact(campaign, 'sent'); resumeCampaign(campaign, 1000);
  assert.equal(campaign.cursor, 1); assert.equal(campaign.queue[0].status, 'sent');
});
test('pausing before a click keeps the current contact; skipping preserves the template cycle', () => {
  const campaign = createCampaign(config, 10);
  campaign.job = { phase: 'preparing' }; pauseCampaign(campaign, 'pause');
  assert.equal(campaign.queue[0].status, 'pending'); resumeCampaign(campaign);
  pauseCampaign(campaign, 'invalid'); resolveContact(campaign, 'skipped'); resumeCampaign(campaign);
  assert.equal(campaign.cursor, 1); assert.equal(campaign.queue[1].template, 1);
});
test('resume cannot shorten the configured delay since a send attempt', () => {
  const campaign = createCampaign(config, 10, 1000);
  campaign.lastAttemptAt = 5000; pauseCampaign(campaign, 'pause'); resumeCampaign(campaign, 6000);
  assert.equal(campaign.nextAt, 95000);
});
test('pausing the waiting period preserves the full interval after the acknowledgement', () => {
  const campaign = createCampaign(config, 10, 1000);
  campaign.lastAttemptAt = 5000; completeContact(campaign, 25000);
  pauseCampaign(campaign, 'pause'); resumeCampaign(campaign, 26000);
  assert.equal(campaign.nextAt, 115000);
});
test('deep links preserve multiline Unicode and require matching destination, token and text', () => {
  const job = { id: 'token', phone: config.contacts[0], message: 'Olá & tudo bem?\nOferta: 50% 🌱' };
  const url = jobUrl(job); assert.equal(matchesJob(url, job), true);
  assert.equal(matchesJob(url.replace('pw_job=token', 'pw_job=stale'), job), false);
  assert.equal(matchesJob(url.replace('web.whatsapp.com', 'example.com'), job), false);
  assert.equal(matchesJob(url.replace(config.contacts[0], config.contacts[1]), job), false);
});
