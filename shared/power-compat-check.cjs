'use strict';
const assert = require('node:assert/strict');
require('./core.js');
const C = globalThis.LIGCore;
function csvRows(value) {
  return value.replace(/^\uFEFF/, '').trimEnd().split('\r\n').map(line =>
    Array.from(line.matchAll(/"((?:""|[^"])*)"(?:,|$)/g), match => match[1].replace(/""/g, '"')));
}
const fields = {
  power: 0.12, speed: 100, frequency: 100, spacing: 25,
  date: '2026-10-30', name: '旧条件名', parentSheet: 'PI-OLD-01',
  calibrationId: 'CAL-OLD-01', notes: '保留旧备注', measuredPowerW: 0.0025
};
const old = C.createGroup(fields, []);
old.electrical[0].values = ['100'];
assert.equal(old.powerMode, 'watts');
assert.equal(old.power, 0.12);
assert.equal(old.measuredPowerW, 0.0025);
assert.equal(old.legacyPowerW, null);

// Missing historical metadata migrates to null; an old power entry never
// becomes a measurement just because the display unit or UI has changed.
const oldWithoutMeasurement = { ...old }; delete oldWithoutMeasurement.measuredPowerW; delete oldWithoutMeasurement.legacyPowerW;
const migrated = C.validateState({ version: 3, groups: [oldWithoutMeasurement], selectedId: old.id });
assert.equal(migrated.groups[0].power, 0.12);
assert.equal(migrated.groups[0].measuredPowerW, null);
assert.equal(migrated.groups[0].legacyPowerW, null);
assert.equal(oldWithoutMeasurement.legacyPowerW, undefined);

// An explicit percent edit keeps old W input, independent measured W, and
// experimental metadata/readings. Normalization and JSON never rescale W.
const converted = { ...old, powerMode: 'percent', power: 3, arrayPercent: 100, legacyPowerW: old.power };
let state = { version: 3, groups: [converted], selectedId: converted.id };
for (let pass = 0; pass < 5; pass++) state = C.validateState(JSON.parse(JSON.stringify(state)));
const saved = state.groups[0];
assert.equal(saved.power, 3); assert.equal(saved.arrayPercent, 100);
assert.equal(saved.legacyPowerW, 0.12); assert.equal(saved.measuredPowerW, 0.0025);
for (const key of ['name', 'date', 'parentSheet', 'calibrationId', 'notes']) assert.equal(saved[key], old[key]);
assert.deepEqual(saved.electrical, old.electrical);
assert.deepEqual(saved.characterization, old.characterization);
const repeatedEdit = C.createGroup({ ...saved, speed: 120 }, []);
assert.equal(repeatedEdit.legacyPowerW, 0.12); assert.equal(repeatedEdit.measuredPowerW, 0.0025);

for (const [exporter, label] of [[C.exportCSV, 'legacy_power_w'], [C.exportWideCSV, '旧功率录入(W)']]) {
  const rows = csvRows(exporter(state)), index = rows[0].indexOf(label);
  assert.ok(index >= 0); assert.equal(rows[1][index], '0.12');
}
const raw = csvRows(C.exportCSV(state));
assert.equal(raw[1][raw[0].indexOf('power_w')], '');
assert.equal(raw[1][raw[0].indexOf('measured_power_w')], '0.0025');
const mean = csvRows(C.exportMeanCSV(state));
assert.equal(mean[1][3], '2.5');
assert.equal(saved.measuredPowerW, 0.0025);
const unknownMeasurement = { ...saved, measuredPowerW: null };
assert.equal(csvRows(C.exportMeanCSV({ groups: [unknownMeasurement] }))[1][3], '');
assert.equal(C.createGroup({ ...fields, legacyPowerW: '0.003' }, []).legacyPowerW, 0.003);
for (const invalid of ['', ' ', 0, -1, NaN, Infinity, 'NaN', 'Infinity', false, true, {}, [], '0x10']) {
  assert.throws(() => C.createGroup({ ...fields, legacyPowerW: invalid }, []), /旧功率录入/);
  assert.throws(() => C.validateState({ ...state, groups: [{ ...saved, legacyPowerW: invalid }] }), /旧功率录入/);
}
for (const absent of [undefined, null]) assert.equal(C.createGroup({ ...fields, legacyPowerW: absent }, []).legacyPowerW, null);
console.log('PASS: legacy W remains distinct from measured W, optional historical field validation, percent conversion/JSON retain raw data and metadata, raw CSV preserves legacy W, repeated validation never rescales W and mean export converts measured W to mW once.');
