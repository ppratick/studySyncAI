// No browser, network, real API keys, or external packages required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const helpers = source.slice(source.indexOf('function escapeHtml('), source.indexOf('async function loadDeletedAssignments('));
const card = source.slice(source.indexOf('function createAssignmentCard('), source.indexOf('function toggleAssignmentDeleted('));
const decode = text => text.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
const sandbox = { DOMParser: class {parseFromString(s) {return {body: {textContent: s.replace(/<[^>]*>/g, '')}}}} };
vm.createContext(sandbox);
vm.runInContext(helpers + '\n' + card, sandbox);
for (const text of ["audit');globalThis.auditMarker=1;//", '" onmouseover="globalThis.auditMarker=1', "O'Reilly \\ course & \"quotes\" <img src=x>", 'line\nnext\u2028end']) {
    sandbox.input = {assignment_id: text, title: 'Dummy', deleted: 0, ai_confidence: text, ai_confidence_explanation: text};
    const html = vm.runInContext('createAssignmentCard(input)', sandbox);
    const attribute = html.match(/onchange="([^"]*)"/)[1];
    const context = { event: {stopPropagation() {}}, auditMarker: 0, received: null, toggleAssignmentDeleted(id) {context.received = id;} };
    vm.createContext(context);
    vm.runInContext(decode(attribute), context);
    assert.equal(context.auditMarker, 0);
    assert.equal(context.received, text);
    assert(!html.includes(' onmouseover="globalThis.auditMarker'));
    sandbox.value = text;
    const encoded = vm.runInContext('inlineArg(value)', sandbox);
    assert.equal(JSON.parse(decode(encoded)), text);
}
// Token is attached only to this app's API, never to unrelated origins.
const calls = [];
const fetchContext = {
    URL, Headers, Request,
    document: {querySelector: () => ({content: 'dummy-page-token'})},
    window: {location: {href: 'http://127.0.0.1:5001/', origin: 'http://127.0.0.1:5001'}, fetch: (resource, options) => calls.push({resource, options})},
};
vm.createContext(fetchContext);
vm.runInContext(source.slice(0, source.indexOf('/**')), fetchContext);
vm.runInContext("apiFetch('/api/settings', {method: 'POST', headers: {'Content-Type': 'application/json'}}); apiFetch('https://untrusted.invalid/api/settings');", fetchContext);
assert.equal(calls[0].options.headers.get('X-StudySync-Token'), 'dummy-page-token');
assert.equal(calls[0].options.headers.get('Content-Type'), 'application/json');
assert.equal(calls[1].options.headers.get('X-StudySync-Token'), null);
console.log('PASS: hostile IDs stay data, quote handling round-trips, API tokens stay same-origin.');
