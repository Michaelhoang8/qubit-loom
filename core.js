export const GATES = ['H', 'X', 'Y', 'Z', 'S', 'T', 'RX', 'RY', 'RZ', 'CX', 'CZ', 'SWAP'];
export const ROTATIONS = ['RX', 'RY', 'RZ'],
  PAIRS = ['CX', 'CZ', 'SWAP'];
export function validate(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'gates,qubits,seed,shots'
  )
    throw Error('Circuit needs qubits, gates, shots, and seed.');
  if (!Number.isInteger(value.qubits) || value.qubits < 1 || value.qubits > 6)
    throw Error('Use 1–6 qubits.');
  if (
    !Number.isInteger(value.shots) ||
    value.shots < 1 ||
    value.shots > 100000 ||
    !Number.isInteger(value.seed) ||
    value.seed < 1 ||
    value.seed > 4294967295
  )
    throw Error('Use 1–100,000 shots and an integer seed from 1 to 4,294,967,295.');
  if (!Array.isArray(value.gates) || value.gates.length > 100)
    throw Error('Use at most 100 gates.');
  for (const g of value.gates) {
    if (!g || typeof g !== 'object' || !GATES.includes(g.kind)) throw Error('Unknown gate.');
    const keys = [
      'kind',
      'target',
      ...(ROTATIONS.includes(g.kind) ? ['angle'] : []),
      ...(PAIRS.includes(g.kind) ? ['control'] : []),
    ].sort();
    if (Object.keys(g).sort().join(',') !== keys.join(','))
      throw Error(`Unexpected fields for ${g.kind}.`);
    if (!Number.isInteger(g.target) || g.target < 0 || g.target >= value.qubits)
      throw Error('Target qubit is outside the circuit.');
    if (
      PAIRS.includes(g.kind) &&
      (!Number.isInteger(g.control) ||
        g.control < 0 ||
        g.control >= value.qubits ||
        g.control === g.target)
    )
      throw Error('Two-qubit gates need distinct valid qubits.');
    if (
      ROTATIONS.includes(g.kind) &&
      (!Number.isFinite(g.angle) || Math.abs(g.angle) > 8 * Math.PI)
    )
      throw Error('Rotation angles must be finite radians within ±8π.');
  }
  return structuredClone(value);
}
export function zero(qubits) {
  const state = new Float64Array(2 * 2 ** qubits);
  state[0] = 1;
  return state;
}
export function matrix(kind, angle = 0) {
  const c = Math.cos(angle / 2),
    s = Math.sin(angle / 2),
    h = Math.SQRT1_2;
  const values = {
    H: [h, 0, h, 0, h, 0, -h, 0],
    X: [0, 0, 1, 0, 1, 0, 0, 0],
    Y: [0, 0, 0, -1, 0, 1, 0, 0],
    Z: [1, 0, 0, 0, 0, 0, -1, 0],
    S: [1, 0, 0, 0, 0, 0, 0, 1],
    T: [1, 0, 0, 0, 0, 0, h, h],
    RX: [c, 0, 0, -s, 0, -s, c, 0],
    RY: [c, 0, -s, 0, s, 0, c, 0],
    RZ: [c, -s, 0, 0, 0, 0, c, s],
  };
  if (!values[kind]) throw Error('Not a single-qubit gate.');
  return values[kind];
}
export function apply(state, gate) {
  const out = new Float64Array(state),
    size = state.length / 2,
    bit = 1 << gate.target;
  if (PAIRS.includes(gate.kind)) {
    const control = 1 << gate.control;
    for (let i = 0; i < size; i++) {
      if (gate.kind === 'CZ') {
        if (i & bit && i & control) {
          out[2 * i] *= -1;
          out[2 * i + 1] *= -1;
        }
      } else if (gate.kind === 'CX') {
        if (i & control && !(i & bit)) {
          const j = i | bit;
          out[2 * i] = state[2 * j];
          out[2 * i + 1] = state[2 * j + 1];
          out[2 * j] = state[2 * i];
          out[2 * j + 1] = state[2 * i + 1];
        }
      } else if (!(i & bit) && i & control) {
        const j = i ^ bit ^ control;
        out[2 * i] = state[2 * j];
        out[2 * i + 1] = state[2 * j + 1];
        out[2 * j] = state[2 * i];
        out[2 * j + 1] = state[2 * i + 1];
      }
    }
    return out;
  }
  const m = matrix(gate.kind, gate.angle);
  for (let i = 0; i < size; i++)
    if (!(i & bit)) {
      const j = i | bit,
        ar = state[2 * i],
        ai = state[2 * i + 1],
        br = state[2 * j],
        bi = state[2 * j + 1];
      out[2 * i] = m[0] * ar - m[1] * ai + m[2] * br - m[3] * bi;
      out[2 * i + 1] = m[0] * ai + m[1] * ar + m[2] * bi + m[3] * br;
      out[2 * j] = m[4] * ar - m[5] * ai + m[6] * br - m[7] * bi;
      out[2 * j + 1] = m[4] * ai + m[5] * ar + m[6] * bi + m[7] * br;
    }
  return out;
}
export function describe(state, qubits) {
  const size = 2 ** qubits,
    raw = Array.from({ length: size }, (_, i) => state[2 * i] ** 2 + state[2 * i + 1] ** 2),
    norm = raw.reduce((a, b) => a + b, 0),
    probabilities = raw.map((p) => p / norm),
    reduced = [];
  for (let q = 0; q < qubits; q++) {
    const bit = 1 << q;
    let p0 = 0,
      p1 = 0,
      re = 0,
      im = 0;
    for (let i = 0; i < size; i++)
      if (!(i & bit)) {
        const j = i | bit;
        p0 += raw[i];
        p1 += raw[j];
        re += state[2 * i] * state[2 * j] + state[2 * i + 1] * state[2 * j + 1];
        im += state[2 * i + 1] * state[2 * j] - state[2 * i] * state[2 * j + 1];
      }
    p0 /= norm;
    p1 /= norm;
    re /= norm;
    im /= norm;
    reduced.push({
      qubit: q,
      p0,
      p1,
      coherence: { re, im },
      bloch: { x: 2 * re, y: -2 * im, z: p0 - p1 },
      purity: p0 * p0 + p1 * p1 + 2 * (re * re + im * im),
    });
  }
  return { norm, probabilities, reduced };
}
export function sample(probabilities, shots, seed) {
  if (
    !Array.isArray(probabilities) ||
    !probabilities.length ||
    probabilities.length > 64 ||
    probabilities.some((p) => !Number.isFinite(p) || p < 0) ||
    !Number.isInteger(shots) ||
    shots < 1 ||
    shots > 100000 ||
    !Number.isInteger(seed) ||
    seed < 1 ||
    seed > 4294967295
  )
    throw Error('Invalid sampling parameters.');
  const total = probabilities.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(total) || total <= 0)
    throw Error('Probabilities need positive finite mass.');
  const cumulative = [];
  let sum = 0;
  for (const p of probabilities) {
    sum += p / total;
    cumulative.push(sum);
  }
  cumulative[cumulative.length - 1] = 1;
  const counts = Array(probabilities.length).fill(0);
  let random = seed >>> 0;
  for (let i = 0; i < shots; i++) {
    random ^= random << 13;
    random ^= random >>> 17;
    random ^= random << 5;
    const u = (random >>> 0) / 4294967296;
    let lo = 0,
      hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (u < cumulative[mid]) hi = mid;
      else lo = mid + 1;
    }
    counts[lo]++;
  }
  return counts;
}
export function simulate(value) {
  const circuit = validate(value),
    frames = [];
  let state = zero(circuit.qubits);
  frames.push({ step: 0, state: Array.from(state), ...describe(state, circuit.qubits) });
  for (const gate of circuit.gates) {
    state = apply(state, gate);
    frames.push({
      step: frames.length,
      state: Array.from(state),
      ...describe(state, circuit.qubits),
    });
  }
  const counts = sample(frames.at(-1).probabilities, circuit.shots, circuit.seed);
  return {
    circuit,
    frames,
    counts,
    maxNormError: Math.max(...frames.map((f) => Math.abs(f.norm - 1))),
  };
}
export function label(index, qubits) {
  return index.toString(2).padStart(qubits, '0');
}
export function stateCSV(result, step) {
  const frame = result.frames[step];
  if (!frame) throw Error('Unknown frame.');
  const rows = ['basis,real,imaginary,probability,final_shots'];
  for (let i = 0; i < frame.probabilities.length; i++)
    rows.push(
      [
        `q${label(i, result.circuit.qubits)}`,
        frame.state[2 * i],
        frame.state[2 * i + 1],
        frame.probabilities[i],
        step === result.frames.length - 1 ? result.counts[i] : '',
      ].join(','),
    );
  return rows.join('\r\n') + '\r\n';
}
export function qasm(value) {
  const c = validate(value),
    rows = ['OPENQASM 2.0;', 'include "qelib1.inc";', `qreg q[${c.qubits}];`];
  for (const g of c.gates) {
    const name = g.kind.toLowerCase();
    rows.push(
      PAIRS.includes(g.kind)
        ? `${name} q[${g.control}],q[${g.target}];`
        : ROTATIONS.includes(g.kind)
          ? `${name}(${g.angle}) q[${g.target}];`
          : `${name} q[${g.target}];`,
    );
  }
  return rows.join('\n') + '\n';
}
export function fixture(kind = 'bell') {
  const base = { qubits: 2, gates: [], shots: 4096, seed: 17 };
  if (kind === 'bell')
    base.gates = [
      { kind: 'H', target: 0 },
      { kind: 'CX', control: 0, target: 1 },
    ];
  else if (kind === 'ghz') {
    base.qubits = 3;
    base.gates = [
      { kind: 'H', target: 0 },
      { kind: 'CX', control: 0, target: 1 },
      { kind: 'CX', control: 1, target: 2 },
    ];
  } else if (kind === 'interference') {
    base.qubits = 1;
    base.gates = [
      { kind: 'H', target: 0 },
      { kind: 'RZ', target: 0, angle: Math.PI / 3 },
      { kind: 'H', target: 0 },
    ];
  } else if (kind === 'phase') {
    base.qubits = 1;
    base.gates = [
      { kind: 'H', target: 0 },
      { kind: 'S', target: 0 },
    ];
  } else if (kind !== 'empty') throw Error('Unknown circuit study.');
  return base;
}
