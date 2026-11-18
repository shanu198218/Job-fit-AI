import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { crc32 } from 'node:zlib';
import { chromium, type BrowserContext } from 'playwright';
import { localServer } from '../apps/local-api/src/http.ts';
import { interpretLocally } from '../packages/matching-engine/src/index.ts';

function pdfFixture() {
  const text = 'BT /F1 12 Tf 20 150 Td (Built React projects) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 250 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + text.length + ' >>\nstream\n' + text + '\nendstream',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const offset = pdf.length;
    pdf += (i + 1) + ' 0 obj\n' + object + '\nendobj\n';
    return String(offset).padStart(10, '0') + ' 00000 n \n';
  });
  return Buffer.from(pdf + 'xref\n0 6\n0000000000 65535 f \n' + offsets.join('') +
    'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + pdf.length + '\n%%EOF\n');
}

function zip(files: Record<string, string>) {
  const entries: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [path, text] of Object.entries(files)) {
    const name = Buffer.from(path);
    const data = Buffer.from(text);
    const check = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(check, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(check, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    offset += local.length + name.length + data.length;
    entries.push(local, name, data);
    directory.push(central, name);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(directory.length / 2, 8);
  end.writeUInt16LE(directory.length / 2, 10);
  end.writeUInt32LE(Buffer.concat(directory).length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...entries, ...directory, end]);
}

function docxFixture() {
  return zip({
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Built React projects</w:t></w:r></w:p></w:body></w:document>',
  });
}

test('Chrome parses PDF and DOCX, pairs, analyzes locally and with mock Gemini, and clears session on restart', { timeout: 65_000 }, async t => {
  const folder = await mkdtemp(join(tmpdir(), 'jobfit-browser-'));
  const path = resolve('apps/extension/.output/chrome-mv3');
  let context: BrowserContext | undefined;
  t.after(async () => { await context?.close(); await rm(folder, { recursive: true, force: true, maxRetries: 5 }); });
  const launch = () => chromium.launchPersistentContext(folder, {
    channel: 'chromium', executablePath: process.env.JOBFIT_TEST_CHROME, headless: false,
    viewport: null,
    args: ['--enable-unsafe-extension-debugging', '--remote-debugging-port=0', '--disable-extensions-except=' + path, '--load-extension=' + path],
    timeout: 15_000,
  });
  context = await launch();
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 8000 });
  const origin = new URL(worker.url()).origin === 'null' ? worker.url().split('/').slice(0, 3).join('/') : new URL(worker.url()).origin;
  const token = 'a'.repeat(64);
  let saved: string | undefined;
  const server = localServer({ origin, token, host: '127.0.0.1', credentials: {
    async read() { return saved; },
    async save(_name, key) { saved = key; },
    async remove() { saved = undefined; },
  }, ai: {
    async test() {},
    async analyze(_key, _profile, job) { return interpretLocally(job); },
    async coverLetter(_key, input) {
      assert.deepEqual(input.evidence, ['Built React projects']);
      return 'I have built React projects.';
    },
  } });
  await new Promise<void>((accept, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', accept); });
  t.after(() => { server.close(); server.closeAllConnections(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  async function routeApi(browser: BrowserContext) {
    await browser.route('http://127.0.0.1:8787/**', async route => {
      const url = new URL(route.request().url());
      url.port = String(address.port);
      const response = await route.fetch({
        url: url.href, headers: { ...await route.request().allHeaders(), host: '127.0.0.1' },
      });
      await route.fulfill({ response });
    });
  }
  await routeApi(context);

  async function openPopup() {
    const popup = await context!.newPage();
    await popup.goto(origin + '/popup.html');
    popup.setDefaultTimeout(7000);
    return popup;
  }
  let popup = await openPopup();
  const navigate = (name: string) => popup.getByRole('navigation').getByRole('button', { name, exact: true }).click();
  await navigate('CV Profile');
  for (const [name, mimeType, buffer] of [
    ['cv.pdf', 'application/pdf', pdfFixture()],
    ['cv.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docxFixture()],
  ] as const) {
    await popup.getByLabel('Upload CV').setInputFiles({ name, mimeType, buffer });
    await popup.getByText('CV ready · 1 recognized skills').waitFor();
    await popup.getByRole('button', { name: 'Clear CV' }).click();
    await popup.getByText('PDF or DOCX · up to 8 MB').waitFor();
  }
  await popup.getByLabel('Upload CV').setInputFiles({ name: 'cv.pdf', mimeType: 'application/pdf', buffer: pdfFixture() });
  await popup.getByText('CV ready · 1 recognized skills').waitFor();
  await popup.close();
  popup = await openPopup();
  await navigate('CV Profile');
  await popup.getByText('CV ready · 1 recognized skills').waitFor();
  await popup.getByLabel('Country of residence').fill('Sri Lanka');
  await popup.getByLabel('Countries where you can work').fill('Sri Lanka');
  await popup.getByLabel('Relevant years of experience').fill('3');
  await popup.getByRole('button', { name: 'Save details' }).click();
  await popup.getByText('Candidate details saved.').waitFor();
  await navigate('Job Analysis');
  await popup.getByText('Enter job description manually').click();
  await popup.getByLabel('Job description').fill('Work Mode: Hybrid\nWorking hours: 09:00–17:00 UTC+05:30\nEmployment type: Full-time contract\nNo visa sponsorship available.\nRequirements\nReact\nPreferred\nTypeScript');
  await popup.getByRole('button', { name: 'Analyze pasted job' }).click();
  await popup.getByText('Local Basic Analysis', { exact: true }).waitFor();
  await popup.getByRole('heading', { name: 'Can I Apply from Sri Lanka?' }).waitFor();
  await popup.getByText('Built React projects', { exact: true }).waitFor();
  await popup.getByRole('heading', { name: 'Key qualifications' }).waitFor();
  await popup.getByText('Hybrid', { exact: true }).waitFor();
  await popup.getByText(/09:00–17:00 UTC\+05:30/).first().waitFor();
  await popup.getByText('Not Available', { exact: false }).first().waitFor();
  await popup.getByText(/Full-time contract/).waitFor();

  await popup.getByRole('button', { name: 'AI Settings' }).click();
  await popup.getByRole('button', { name: 'Refresh status' }).click();
  await popup.getByLabel('Pairing token').fill(token);
  await popup.getByRole('button', { name: 'Pair extension' }).click();
  await popup.getByText('Paired.', { exact: false }).waitFor();
  await popup.getByLabel('New API key').fill('test-key-for-mocked-provider');
  await popup.getByRole('button', { name: 'Save or replace key' }).click();
  await popup.getByText('Gemini · Configured', { exact: true }).waitFor();
  await popup.getByRole('button', { name: 'Test connection' }).click();
  await popup.getByText('Gemini · Connected', { exact: true }).waitFor();
  await navigate('Job Analysis');
  await popup.getByRole('checkbox').check();
  await popup.getByText('Enter job description manually').click();
  await popup.getByRole('button', { name: 'Analyze pasted job' }).click();
  await popup.getByText('Gemini-Assisted Analysis', { exact: true }).waitFor();
  await popup.getByRole('checkbox', { name: /matching CV excerpts/ }).check();
  await popup.getByRole('button', { name: 'Generate Cover Letter' }).click();
  await popup.getByText('Draft ready.', { exact: false }).waitFor();
  await popup.getByLabel('Editable preview').fill('Edited draft');
  await popup.bringToFront();
  await popup.evaluate(() => {
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async value => {
      await write(value);
      document.documentElement.dataset.copiedDraft = value;
    };
  });
  await popup.getByRole('button', { name: 'Copy to clipboard' }).click();
  await popup.getByText('Cover letter copied.').waitFor();
  assert.equal(await popup.locator('html').getAttribute('data-copied-draft'), 'Edited draft');
  await context.route('http://127.0.0.1:8787/analyze', route => route.fulfill({
    status: 502, json: { error: 'GEMINI_REQUEST_REJECTED' },
  }), { times: 1 });
  await navigate('Job Analysis');
  await popup.getByText('Enter job description manually').click();
  await popup.getByRole('button', { name: 'Analyze pasted job' }).click();
  await popup.getByText('Local Basic Analysis', { exact: true }).waitFor();
  await popup.getByRole('alert').getByText('Showing local analysis.', { exact: false }).waitFor();
  await popup.getByRole('alert').getByText('Gemini rejected the request.', { exact: false }).waitFor();
  await context.route('http://127.0.0.1:8787/cover-letter', route => route.abort(), { times: 1 });
  await popup.getByRole('checkbox', { name: /matching CV excerpts/ }).check();
  await popup.getByRole('button', { name: 'Generate Cover Letter' }).click();
  await popup.getByRole('alert').getByText('Cover-letter generation requires a working Gemini connection.', { exact: false }).waitFor();
  assert.equal(await popup.getByLabel('Editable preview').count(), 0);
  await navigate('AI Settings');
  await popup.getByRole('button', { name: 'Remove key' }).click();
  await popup.getByText('Gemini key removed.').waitFor();
  await popup.getByLabel('New API key').fill('test-key-for-mocked-provider');
  await popup.getByRole('button', { name: 'Save or replace key' }).click();
  await popup.getByText('Gemini key saved.').waitFor();
  await popup.close();
  await context.route('https://jobs.example.test/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<main><h1>Frontend Developer</h1><article><h2>Requirements</h2><p>React and TypeScript required.</p><p>Build and maintain accessible frontend features with the product engineering team.</p></article></main>',
  }));
  const vacancy = await context.newPage();
  const [port] = (await readFile(join(folder, 'DevToolsActivePort'), 'utf8')).split('\n');
  const connection = await chromium.connectOverCDP('http://127.0.0.1:' + port);
  const browserCdp = await connection.newBrowserCDPSession();
  const inspector = await openPopup();
  for (const slug of ['one', 'two']) {
    await vacancy.goto('https://jobs.example.test/' + slug);
    await vacancy.bringToFront();

    const { targetInfos } = await browserCdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
    const target = targetInfos.find(item => item.url === vacancy.url());
    assert.ok(target, JSON.stringify(targetInfos));
    await browserCdp.send('Extensions.triggerAction', { id: new URL(worker.url()).hostname, targetId: target.targetId });
    // Chrome exposes toolbar popups as extension views, outside Playwright's tab list.
    await inspector.waitForFunction(() => chrome.extension.getViews({ type: 'popup' }).some(view =>
      view.document.querySelector('main h2')?.textContent === 'Analyze a vacancy'
      && !view.document.querySelector<HTMLButtonElement>('main button.primary')?.disabled), undefined, { polling: 50 });
    for (const [page, heading] of [
      ['CV Profile', 'Candidate profile'], ['Results', 'Results'], ['AI Settings', 'Local pairing'],
      ['Job Analysis', 'Analyze a vacancy'],
    ]) {
      await inspector.evaluate(name => {
        const [view] = chrome.extension.getViews({ type: 'popup' });
        const button = [...view.document.querySelectorAll('nav button')].find(button => button.textContent === name);
        (button as HTMLButtonElement).click();
      }, page);
      await inspector.waitForFunction(title => {
        const [view] = chrome.extension.getViews({ type: 'popup' });
        return view?.document.querySelector('main h2')?.textContent === title;
      }, heading, { polling: 50 }).catch(async error => {
        const current = await inspector.evaluate(() => {
          const [view] = chrome.extension.getViews({ type: 'popup' });
          return view?.document.querySelector('main')?.textContent;
        });
        throw new Error(`Toolbar navigation to ${page} left content: ${current}`, { cause: error });
      });
      const layout = await inspector.evaluate(() => {
        const [view] = chrome.extension.getViews({ type: 'popup' });
        const { document } = view;
        const main = document.querySelector('main')!;
        return {
          width: view.innerWidth, height: view.innerHeight, contentWidth: main.clientWidth,
          overflow: Math.max(document.documentElement.scrollWidth - view.innerWidth, main.scrollWidth - main.clientWidth),
          rows: new Set([...document.querySelectorAll('nav button')].map(button => button.getBoundingClientRect().top)).size,
        };
      });
      assert.ok(layout.width >= 478 && layout.width <= 482, JSON.stringify(layout));
      assert.ok(layout.height <= 580 && layout.contentWidth >= 450, JSON.stringify(layout));
      assert.equal(layout.overflow, 0);
      assert.equal(layout.rows, 1);
    }
    await inspector.evaluate(() => {
      const [view] = chrome.extension.getViews({ type: 'popup' });
      (view.document.querySelector('main button.primary') as HTMLButtonElement).click();
    });
    await inspector.waitForFunction(() => {
      const [view] = chrome.extension.getViews({ type: 'popup' });
      return view?.document.querySelector('main h2')?.textContent === 'Frontend Developer';
    }, undefined, { polling: 50 });
    const reportLayout = await inspector.evaluate(() => {
      const [view] = chrome.extension.getViews({ type: 'popup' });
      const { document } = view;
      const main = document.querySelector('main')!;
      const nav = document.querySelector('nav')!;
      const before = nav.getBoundingClientRect().top;
      main.scrollTop = main.scrollHeight;
      return {
        height: view.innerHeight, top: main.scrollTop, navShift: nav.getBoundingClientRect().top - before,
        overflow: main.scrollWidth - main.clientWidth,
        headings: [...main.querySelectorAll('h2')].map(heading => heading.textContent),
      };
    });
    assert.ok(reportLayout.height >= 560 && reportLayout.height <= 580);
    assert.ok(reportLayout.top > 0);
    assert.equal(reportLayout.navShift, 0);
    assert.equal(reportLayout.overflow, 0);
    for (const heading of ['Can I Apply from Sri Lanka?', 'Job conditions', 'Key qualifications', 'Quick recommendation', 'Cover letter']) {
      assert.ok(reportLayout.headings.includes(heading));
    }
    await inspector.evaluate(() => chrome.extension.getViews({ type: 'popup' })[0].close());
    await inspector.waitForFunction(() => chrome.extension.getViews({ type: 'popup' }).length === 0, undefined, { polling: 50 });
  }
  await context.close();
  context = await launch();
  await routeApi(context);
  popup = await openPopup();
  await navigate('CV Profile');
  await popup.getByText('PDF or DOCX · up to 8 MB').waitFor();
  await popup.getByRole('button', { name: 'AI Settings' }).click();
  await popup.getByText('Unpaired.', { exact: false }).waitFor();
  assert.equal(saved, 'test-key-for-mocked-provider');
});
