import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { EmailNotifications } from '../src/components/EmailNotifications';
const dom = new JSDOM('<div id="root"></div>', {
  url: 'https://planner.example.invalid/#emailAction=unsubscribe&token=synthetic-capability',
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
});
let posts = 0;
globalThis.fetch = async (input, init) => {
  assert.equal(String(input), '/api/notifications');
  if (init?.method === 'POST') {
    posts++;
    assert.deepEqual(JSON.parse(String(init.body)), {
      action: 'unsubscribe',
      token: 'synthetic-capability',
    });
    return new Response(JSON.stringify({ status: 'unsubscribed' }), {
      status: 200,
    });
  }
  return new Response(
    JSON.stringify({ enabled: false, mode: 'disabled', manageEnabled: true }),
    { status: 200 }
  );
};
const { createRoot } = await import('react-dom/client');
const root = createRoot(dom.window.document.getElementById('root')!);
await act(async () => root.render(<EmailNotifications />));
assert.equal(dom.window.location.hash, '');
assert.equal(posts, 0);
assert(dom.window.document.body.textContent?.includes('Nothing changes until'));
assert.equal(dom.window.document.querySelector('form'), null);
const button = [...dom.window.document.querySelectorAll('button')].find(
  (b) => b.textContent === 'Unsubscribe'
)!;
assert(!button.disabled);
await act(async () => button.click());
assert.equal(posts, 1);
assert(
  dom.window.document
    .querySelector('[role="status"]')
    ?.textContent?.includes('unsubscribed')
);
await act(async () => root.unmount());
console.log(
  'Notification UI: fragment cleanup, explicit confirmation, no automatic POST and unsubscribe while delivery is disabled passed'
);
