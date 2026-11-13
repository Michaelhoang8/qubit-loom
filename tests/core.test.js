import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validate,
  zero,
  matrix,
  apply,
  describe,
  sample,
  simulate,
  label,
  stateCSV,
  qasm,
  fixture,
} from '../core.js';
const near = (a, b, t = 1e-10) => assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);
const circuit = (gates) => ({ qubits: 2, gates, shots: 1000, seed: 19 });
test('computational basis and little-endian qubit indexing are explicit', () => {
  const r = simulate(circuit([{ kind: 'X', target: 1 }]));
  assert.equal(r.frames.at(-1).probabilities[2], 1);
  assert.equal(label(2, 2), '10');
  assert.deepEqual(r.counts, [0, 0, 1000, 0]);
});
test('Hadamard interference cancels amplitudes instead of adding probabilities', () => {
  const r = simulate(
    circuit([
      { kind: 'H', target: 0 },
      { kind: 'H', target: 0 },
    ]),
  );
  near(r.frames[1].probabilities[0], 0.5);
  near(r.frames[1].probabilities[1], 0.5);
  near(r.frames[2].probabilities[0], 1);
  near(r.frames[2].probabilities[1], 0);
});
test('Bell and GHZ states have the expected support and mixed single-qubit marginals', () => {
  for (const kind of ['bell', 'ghz']) {
    const r = simulate(fixture(kind)),
      f = r.frames.at(-1);
    near(f.probabilities[0], 0.5);
    near(f.probabilities.at(-1), 0.5);
    for (const q of f.reduced) {
      near(q.purity, 0.5);
      near(q.bloch.x, 0);
      near(q.bloch.y, 0);
      near(q.bloch.z, 0);
    }
    assert.equal(
      r.counts.reduce((a, b) => a + b, 0),
      4096,
    );
  }
});
test('complex phases produce correct Pauli-Y and Bloch coordinates', () => {
  const y = apply(zero(1), { kind: 'Y', target: 0 });
  near(y[2], 0);
  near(y[3], 1);
  const phase = simulate(fixture('phase')).frames.at(-1).reduced[0];
  near(phase.bloch.x, 0);
  near(phase.bloch.y, 1);
  near(phase.bloch.z, 0);
  near(phase.purity, 1);
});
test('single-qubit rotations match analytic amplitudes and interference probabilities', () => {
  for (const angle of [-3, -0.2, 0, 0.7, Math.PI, 7]) {
    const ry = apply(zero(1), { kind: 'RY', target: 0, angle });
    near(ry[0], Math.cos(angle / 2));
    near(ry[2], Math.sin(angle / 2));
    const rx = apply(zero(1), { kind: 'RX', target: 0, angle });
    near(rx[0], Math.cos(angle / 2));
    near(rx[3], -Math.sin(angle / 2));
    const r = simulate({
      ...fixture('interference'),
      gates: [
        { kind: 'H', target: 0 },
        { kind: 'RZ', target: 0, angle },
        { kind: 'H', target: 0 },
      ],
    });
    near(r.frames.at(-1).probabilities[1], Math.sin(angle / 2) ** 2);
  }
});
test('unitary gate inverse identities preserve arbitrary complex amplitudes', () => {
  let state = zero(3);
  for (const g of [
    { kind: 'H', target: 0 },
    { kind: 'RY', target: 1, angle: 0.7 },
    { kind: 'RZ', target: 0, angle: 1.3 },
    { kind: 'CX', control: 1, target: 2 },
  ])
    state = apply(state, g);
  for (const kind of ['H', 'X', 'Y', 'Z', 'CX', 'CZ', 'SWAP', 'RX', 'RY', 'RZ', 'S', 'T']) {
    const g = {
      kind,
      target: 0,
      ...(['CX', 'CZ', 'SWAP'].includes(kind) ? { control: 2 } : {}),
      ...(['RX', 'RY', 'RZ'].includes(kind) ? { angle: 0.87 } : {}),
    };
    let next = apply(state, g);
    if (['RX', 'RY', 'RZ'].includes(kind)) next = apply(next, { ...g, angle: -g.angle });
    else if (kind === 'S' || kind === 'T') {
      for (let i = 1; i < (kind === 'S' ? 4 : 8); i++) next = apply(next, g);
    } else next = apply(next, g);
    for (let i = 0; i < state.length; i++) near(next[i], state[i]);
  }
});
test('controlled gates and swap match a dense basis-column oracle on arbitrary states', () => {
  let seed = 31;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let trial = 0; trial < 100; trial++) {
    const state = Float64Array.from({ length: 16 }, () => random() * 2 - 1);
    for (const kind of ['CX', 'CZ', 'SWAP'])
      for (const [control, target] of [
        [0, 1],
        [2, 0],
        [1, 2],
      ]) {
        const out = apply(state, { kind, control, target }),
          oracle = new Float64Array(16);
        for (let column = 0; column < 8; column++) {
          const a = (column >> control) & 1,
            b = (column >> target) & 1;
          let row = column,
            sign = 1;
          if (kind === 'CX' && a) row = column ^ (1 << target);
          if (kind === 'CZ' && a && b) sign = -1;
          if (kind === 'SWAP' && a !== b) row = column ^ (1 << control) ^ (1 << target);
          for (let component = 0; component < 2; component++)
            oracle[row * 2 + component] += sign * state[column * 2 + component];
        }
        assert.deepEqual(out, oracle);
      }
  }
});
test('coherent state transfer restores an arbitrary prepared state on the third qubit', () => {
  for (const theta of [0.2, 1.1, 2.7])
    for (const phi of [-1.7, 0.4, 2.3]) {
      const gates = [
        { kind: 'RY', target: 0, angle: theta },
        { kind: 'RZ', target: 0, angle: phi },
        { kind: 'H', target: 1 },
        { kind: 'CX', control: 1, target: 2 },
        { kind: 'CX', control: 0, target: 1 },
        { kind: 'H', target: 0 },
        { kind: 'CX', control: 1, target: 2 },
        { kind: 'CZ', control: 0, target: 2 },
      ];
      const r = simulate({ ...circuit(gates), qubits: 3 }).frames.at(-1).reduced[2];
      near(r.bloch.x, Math.sin(theta) * Math.cos(phi));
      near(r.bloch.y, Math.sin(theta) * Math.sin(phi));
      near(r.bloch.z, Math.cos(theta));
      near(r.purity, 1);
    }
});
test('reduced density matrices agree with an explicit partial trace', () => {
  const f = simulate({
    ...fixture('ghz'),
    gates: [
      ...fixture('ghz').gates,
      { kind: 'RY', target: 1, angle: 0.6 },
      { kind: 'RZ', target: 2, angle: 0.8 },
    ],
  }).frames.at(-1);
  for (let q = 0; q < 3; q++) {
    const rho = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 8; j++)
        if ((i & ~(1 << q)) === (j & ~(1 << q))) {
          const at = (((i >> q) & 1) * 2 + ((j >> q) & 1)) * 2;
          rho[at] += f.state[2 * i] * f.state[2 * j] + f.state[2 * i + 1] * f.state[2 * j + 1];
          rho[at + 1] += f.state[2 * i + 1] * f.state[2 * j] - f.state[2 * i] * f.state[2 * j + 1];
        }
    near(rho[0] / f.norm, f.reduced[q].p0);
    near(rho[6] / f.norm, f.reduced[q].p1);
    near(rho[2] / f.norm, f.reduced[q].coherence.re);
    near(rho[3] / f.norm, f.reduced[q].coherence.im);
  }
});
test('seeded sampling is reproducible, conserves shots, and respects zero-mass bins', () => {
  const a = sample([0.25, 0, 0.75, 0], 100000, 123);
  assert.deepEqual(a, sample([0.25, 0, 0.75, 0], 100000, 123));
  assert.notDeepEqual(a, sample([0.25, 0, 0.75, 0], 100000, 456));
  assert.equal(a[1] + a[3], 0);
  assert.equal(
    a.reduce((x, y) => x + y),
    100000,
  );
  assert.ok(Math.abs(a[0] - 25000) < 600);
  assert.deepEqual(sample([0, 1, 0], 50, 1), [0, 50, 0]);
});
test('100-gate circuits preserve norm and produce independent snapshots', () => {
  const gates = Array.from({ length: 100 }, (_, i) => ({
      kind: ['H', 'RX', 'RY', 'RZ'][i % 4],
      target: i % 6,
      ...(i % 4 ? { angle: i / 10 } : {}),
    })),
    r = simulate({ ...circuit(gates), qubits: 6 });
  assert.equal(r.frames.length, 101);
  assert.ok(r.maxNormError < 1e-12);
  assert.equal(r.frames[0].state[0], 1);
  assert.equal(r.frames[0].state[2], 0);
});
test('CSV and OpenQASM exports preserve basis ordering, angles, and control order', () => {
  const c = fixture('bell'),
    r = simulate(c);
  assert.ok(stateCSV(r, 2).includes('q11,'));
  assert.ok(stateCSV(r, 0).split('\r\n')[1].endsWith(','));
  assert.equal(
    qasm(c),
    'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\nh q[0];\ncx q[0],q[1];\n',
  );
  assert.ok(qasm(fixture('interference')).includes(`rz(${Math.PI / 3}) q[0];`));
});
test('invalid circuit schemas, qubit indices, angles, and shot settings fail explicitly', () => {
  const c = fixture();
  for (const bad of [
    { ...c, qubits: 7 },
    { ...c, seed: 0 },
    { ...c, shots: 100001 },
    { ...c, extra: 0 },
    { ...c, gates: [{ kind: 'CX', control: 0, target: 0 }] },
    { ...c, gates: [{ kind: 'RY', target: 0, angle: Infinity }] },
    { ...c, gates: [{ kind: 'H', target: 3 }] },
    { ...c, gates: [{ kind: 'H', target: 0, angle: 1 }] },
  ])
    assert.throws(() => validate(bad));
  assert.throws(() => sample([0, 0], 1, 1));
  assert.throws(() => sample([NaN], 1, 1));
  assert.throws(() => matrix('bad'));
});
