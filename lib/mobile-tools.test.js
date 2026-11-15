'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PHONE_TOOL_NAMES,
  normalizeMobileConfig,
  isPhoneMutatingTool,
  parseBounds,
  parseAndroidUiXml,
  parseAdbDevices,
  resolveSwipeCoordinates,
  findNodeMatch,
  buildPhoneApprovalSummary,
  getMobileStatus
} = require('./mobile-tools');

test('normalizeMobileConfig sanitizes mode and bridge URL', () => {
  const d = normalizeMobileConfig({});
  assert.equal(d.mobileMode, 'auto');
  assert.equal(d.mobileBridgeUrl, 'http://127.0.0.1:8765');
  assert.equal(d.autoPhone, false);

  const custom = normalizeMobileConfig({
    mobileMode: 'BRIDGE',
    mobileBridgeUrl: '192.168.1.45:8765///',
    mobileToken: ' secret-123 ',
    autoPhone: 1
  });
  assert.equal(custom.mobileMode, 'bridge');
  assert.equal(custom.mobileBridgeUrl, 'http://192.168.1.45:8765');
  assert.equal(custom.mobileToken, 'secret-123');
  assert.equal(custom.autoPhone, true);

  const invalidMode = normalizeMobileConfig({ mobileMode: 'unknown' });
  assert.equal(invalidMode.mobileMode, 'auto');
});

test('isPhoneMutatingTool separates read-only inspection from phone actions', () => {
  assert.equal(isPhoneMutatingTool('phone_screen', {}), false);
  assert.equal(isPhoneMutatingTool('phone_app', { action: 'list' }), false);
  assert.equal(isPhoneMutatingTool('phone_app', { action: 'device_info' }), false);
  assert.equal(isPhoneMutatingTool('phone_app', { action: 'open', app: 'com.whatsapp' }), true);
  assert.equal(isPhoneMutatingTool('phone_tap', { x: 100, y: 200 }), true);
  assert.equal(isPhoneMutatingTool('phone_type', { text: 'مرحبا' }), true);
  assert.equal(isPhoneMutatingTool('phone_key', { key: 'home' }), true);
  assert.equal(PHONE_TOOL_NAMES.size, 6);
});

test('parseBounds and parseAndroidUiXml extract UI nodes with center coordinates', () => {
  const b = parseBounds('[100,200][300,400]');
  assert.deepEqual(b, {
    left: 100,
    top: 200,
    right: 300,
    bottom: 400,
    centerX: 200,
    centerY: 300,
    width: 200,
    height: 200
  });

  const sampleXml = `
    <hierarchy rotation="0">
      <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example" bounds="[0,0][1080,2400]" clickable="false">
        <node index="0" text="إرسال &amp; حفظ" resource-id="com.example:id/send_btn" class="android.widget.Button" package="com.example" content-desc="" clickable="true" enabled="true" bounds="[800,2000][1000,2100]" />
        <node index="1" text="" resource-id="com.example:id/msg_input" class="android.widget.EditText" package="com.example" content-desc="Message box" clickable="true" focused="true" enabled="true" bounds="[40,2000][780,2100]" />
        <node index="2" text="" resource-id="" class="android.view.View" package="com.example" clickable="false" bounds="[0,0][0,0]" />
      </node>
    </hierarchy>
  `;

  const nodes = parseAndroidUiXml(sampleXml);
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].text, 'إرسال & حفظ');
  assert.equal(nodes[0].id, 'send_btn');
  assert.equal(nodes[0].x, 900);
  assert.equal(nodes[0].y, 2050);
  assert.equal(nodes[1].editable, true);
  assert.equal(nodes[1].focused, true);

  const matchByText = findNodeMatch(nodes, { text: 'إرسال' });
  assert.equal(matchByText.id, 'send_btn');
  const matchById = findNodeMatch(nodes, { id: 'msg_input' });
  assert.equal(matchById.desc, 'Message box');
});

test('parseAdbDevices parses connected and unauthorized devices', () => {
  const sample = [
    'List of devices attached',
    'emulator-5554          device product:sdk_gphone64 model:Pixel_8_Pro transport_id:1',
    '192.168.1.25:5555      unauthorized transport_id:2',
    ''
  ].join('\n');

  const devices = parseAdbDevices(sample);
  assert.equal(devices.length, 2);
  assert.deepEqual(devices[0], {
    serial: 'emulator-5554',
    state: 'device',
    ready: true,
    model: 'Pixel 8 Pro'
  });
  assert.equal(devices[1].ready, false);
});

test('resolveSwipeCoordinates calculates directional vectors and respects explicit coordinates', () => {
  const up = resolveSwipeCoordinates({ direction: 'up' }, { width: 1000, height: 2000 });
  assert.equal(up.x1, 500);
  assert.equal(up.y1 > up.y2, true);

  const custom = resolveSwipeCoordinates({ x1: 10, y1: 20, x2: 300, y2: 400, duration_ms: 500 });
  assert.deepEqual(custom, { x1: 10, y1: 20, x2: 300, y2: 400, durationMs: 500 });
});

test('buildPhoneApprovalSummary returns localized action labels', () => {
  const ar = buildPhoneApprovalSummary('phone_tap', { text: 'الإعدادات' }, 'ar');
  assert.match(ar.action, /الجوال/);
  assert.equal(ar.detail, '"الإعدادات"');

  const en = buildPhoneApprovalSummary('phone_app', { action: 'open', app: 'com.whatsapp' }, 'en');
  assert.equal(en.action, 'Open phone app');
  assert.equal(en.detail, 'com.whatsapp');
});

test('getMobileStatus reports disabled mode and clean connection refusal without AbortError', async () => {
  const off = await getMobileStatus({ mobileMode: 'off' }, 'en');
  assert.equal(off.ok, false);
  assert.equal(off.mode, 'off');
  assert.match(off.message, /disabled/i);

  const closedEn = await getMobileStatus({ mobileMode: 'bridge', mobileBridgeUrl: 'http://127.0.0.1:19876' }, 'en');
  assert.equal(closedEn.ok, false);
  assert.equal(closedEn.transport, 'bridge');
  assert.ok(typeof closedEn.error === 'string' && closedEn.error.length > 0);
  assert.doesNotMatch(closedEn.error, /aborted/i);
  assert.doesNotMatch(closedEn.error, /fetch failed/i);
});
