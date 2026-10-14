import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { AdminSelfServiceSync } from '../src/components/AdminSelfServiceSync';
const dom = new JSDOM('<div id="root"></div>', {
  url: 'https://planner.example.invalid/admin.html',
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
});
let approved = false,
  triggered = 0,
  fail = false;
dom.window.confirm = () => approved;
let status: any = {
  runs: [],
  hasMore: false,
  lastSuccess: null,
  lastAttempt: null,
  active: null,
  capability: { enabled: true, reason: null },
  deliveries: [],
  snapshots: [],
  emailMode: 'disabled',
};
globalThis.fetch = async (_input, init) => {
  if (init?.method === 'POST') {
    triggered++;
    const body = JSON.parse(String(init.body));
    assert.equal(body.action, 'sync_start');
    assert.equal(body.confirmed, true);
    assert.equal(body.url, undefined);
    if (fail)
      return new Response(
        JSON.stringify({ error: 'WORKFLOW_DISPATCH_FAILED_OR_UNCERTAIN' }),
        { status: 503 }
      );
    status = {
      ...status,
      active: { id: 'synthetic-job', status: 'queued' },
      runs: [
        {
          id: 'synthetic-job',
          source: 'self-service',
          status: 'queued',
          created_at: '2026-10-14T00:00:00Z',
          summary: {},
          diagnostics: [],
        },
      ],
    };
    return new Response(
      JSON.stringify({ id: 'synthetic-job', status: 'queued' }),
      { status: 202 }
    );
  }
  return new Response(JSON.stringify(status), { status: 200 });
};
const { createRoot } = await import('react-dom/client');
const root = createRoot(dom.window.document.getElementById('root')!);
await act(async () => {
  root.render(<AdminSelfServiceSync />);
});
const button = (label: string) =>
  [...dom.window.document.querySelectorAll('button')].find(
    (b) => b.textContent === label
  )!;
assert(button('Sync Self-Service'));
await act(async () => button('Sync Self-Service').click());
assert.equal(triggered, 0);
approved = true;
await act(async () => button('Sync Self-Service').click());
assert.equal(triggered, 1);
assert(button('Sync Self-Service').disabled);
assert(dom.window.document.body.textContent?.includes('Queued'));
assert(!dom.window.document.body.textContent?.includes('100%'));
await act(async () => root.unmount());
const nextRoot = createRoot(dom.window.document.getElementById('root')!);
status = { ...status, active: null, runs: [] };
fail = true;
await act(async () => {
  nextRoot.render(<AdminSelfServiceSync />);
});
await act(async () => button('Sync Self-Service').click());
assert(
  dom.window.document
    .querySelector('[role="alert"]')
    ?.textContent?.includes('WORKFLOW_DISPATCH_FAILED_OR_UNCERTAIN')
);
assert(
  !dom.window.document.body.textContent?.includes('Publication committed')
);
await act(async () => nextRoot.unmount());
console.log(
  'Admin sync UI: confirmation, protected request shape, real queued state, duplicate-button guard and honest failure states passed'
);
