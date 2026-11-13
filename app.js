import { GATES, ROTATIONS, PAIRS, fixture, validate, label, stateCSV, qasm } from './core.js';
const $ = (id) => document.getElementById(id),
  el = (tag, text) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  },
  ns = 'http://www.w3.org/2000/svg';
let draft = fixture(),
  result = null,
  worker = null,
  busy = false,
  revision = 0,
  step = 0;
function svg(tag, attrs, text) {
  const n = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
}
function status(s) {
  $('status').textContent = s;
}
function controls() {
  for (const n of document.querySelectorAll('button,input,select')) n.disabled = busy;
  $('cancel').disabled = !worker;
  $('add').disabled = busy || draft.gates.length >= 100;
  $('previous').disabled = busy || !result || step === 0;
  $('next').disabled = busy || !result || step === result.frames.length - 1;
  const pair = PAIRS.includes($('gate').value),
    rotation = ROTATIONS.includes($('gate').value);
  $('control-label').hidden = !pair;
  $('angle-label').hidden = !rotation;
}
function invalidate() {
  revision++;
  worker?.terminate();
  worker = null;
  busy = false;
  result = null;
  $('results').hidden = true;
  controls();
  renderCircuit();
}
function candidate() {
  return validate({
    ...draft,
    qubits: Number($('qubits').value),
    shots: Number($('shots').value),
    seed: Number($('seed').value),
  });
}
function editor() {
  for (const key of ['qubits', 'shots', 'seed']) $(key).value = draft[key];
  for (const id of ['target', 'control']) {
    const old = $(id).value;
    $(id).replaceChildren();
    for (let q = 0; q < draft.qubits; q++) {
      const opt = el('option', `q${q}`);
      opt.value = q;
      $(id).append(opt);
    }
    $(id).value =
      Number(old) < draft.qubits && old !== ''
        ? old
        : id === 'control' && draft.qubits > 1
          ? '1'
          : '0';
  }
  $('gates').replaceChildren();
  draft.gates.forEach((g, i) => {
    const row = el('tr');
    row.append(
      el('td', i + 1),
      el('td', g.kind),
      el('td', PAIRS.includes(g.kind) ? `q${g.control} → q${g.target}` : `q${g.target}`),
    );
    const angle = el('td');
    if (ROTATIONS.includes(g.kind)) {
      const input = el('input');
      input.type = 'number';
      input.step = 'any';
      input.value = g.angle;
      input.setAttribute('aria-label', `Angle for gate ${i + 1}`);
      input.addEventListener('input', () => {
        g.angle = input.value.trim() === '' ? NaN : Number(input.value);
        invalidate();
        status('Gate angle changed. Simulate to update the evidence.');
      });
      angle.append(input);
    } else angle.textContent = '—';
    row.append(angle);
    const actions = el('td');
    for (const [text, delta] of [
      ['↑', -1],
      ['↓', 1],
      ['Remove', 0],
    ]) {
      const b = el('button', text);
      b.setAttribute(
        'aria-label',
        `${delta < 0 ? 'Move up' : delta > 0 ? 'Move down' : 'Remove'} gate ${i + 1}`,
      );
      b.addEventListener('click', () => {
        if (delta) {
          const j = i + delta;
          if (j < 0 || j >= draft.gates.length) return;
          [draft.gates[i], draft.gates[j]] = [draft.gates[j], draft.gates[i]];
        } else draft.gates.splice(i, 1);
        invalidate();
        editor();
        status('Circuit edited. Simulate to refresh states.');
      });
      actions.append(b);
    }
    row.append(actions);
    $('gates').append(row);
  });
  renderCircuit();
  controls();
}
function renderCircuit() {
  const root = $('circuit-svg'),
    width = Math.max(640, 120 + draft.gates.length * 72),
    height = 50 + draft.qubits * 55;
  root.setAttribute('width', width);
  root.setAttribute('height', height);
  root.setAttribute('viewBox', `0 0 ${width} ${height}`);
  root.replaceChildren();
  $('circuit-count').textContent = `${draft.qubits} qubits / ${draft.gates.length} gates`;
  for (let q = 0; q < draft.qubits; q++) {
    const y = 40 + q * 55;
    root.append(
      svg('line', { x1: 70, x2: width - 25, y1: y, y2: y, stroke: '#becfe2', 'stroke-width': 1 }),
      svg('text', { x: 17, y: y + 4, fill: '#7893b0', 'font-size': 12 }, `q${q} |0⟩`),
    );
  }
  if (result) {
    const x = step ? 110 + (step - 1) * 72 + 27 : 78;
    root.append(
      svg('line', {
        x1: x,
        x2: x,
        y1: 12,
        y2: height - 20,
        stroke: '#8cb2d7',
        'stroke-dasharray': '3 4',
      }),
    );
  }
  draft.gates.forEach((g, i) => {
    const x = 110 + i * 72,
      y = 40 + g.target * 55,
      group = svg('g', {
        role: 'button',
        tabindex: result ? '0' : '-1',
        'aria-label': `Inspect state after gate ${i + 1}: ${g.kind}`,
        'aria-disabled': String(!result),
      });
    if (PAIRS.includes(g.kind)) {
      const cy = 40 + g.control * 55;
      group.append(
        svg('line', { x1: x, x2: x, y1: cy, y2: y, stroke: '#658bb4', 'stroke-width': 2 }),
      );
      if (g.kind === 'SWAP') {
        for (const yy of [cy, y])
          group.append(
            svg('path', {
              d: `M${x - 7},${yy - 7}L${x + 7},${yy + 7}M${x - 7},${yy + 7}L${x + 7},${yy - 7}`,
              stroke: '#4e79a6',
              'stroke-width': 2,
            }),
          );
      } else {
        group.append(
          svg('circle', { cx: x, cy: cy, r: 4, fill: '#4e79a6' }),
          svg('circle', { cx: x, cy: y, r: 14, fill: '#eff5fc', stroke: '#5c87b4' }),
          svg(
            'text',
            { x, y: y + 5, 'text-anchor': 'middle', 'font-size': 17, fill: '#4e79a6' },
            g.kind === 'CX' ? '+' : 'Z',
          ),
        );
      }
    } else {
      group.append(
        svg('rect', {
          x: x - 19,
          y: y - 17,
          width: 38,
          height: 34,
          rx: 3,
          fill: result && i < step ? '#d3e4f5' : '#eff5fc',
          stroke: '#8cadcf',
        }),
        svg(
          'text',
          { x, y: y + 4, 'text-anchor': 'middle', 'font-size': 11, fill: '#3e6b9a' },
          g.kind,
        ),
      );
    }
    group.append(
      svg(
        'text',
        { x, y: height - 5, 'text-anchor': 'middle', 'font-size': 9, fill: '#9aadc4' },
        i + 1,
      ),
    );
    const inspect = () => {
      if (!result || busy) return;
      step = i + 1;
      render();
    };
    group.addEventListener('click', inspect);
    group.addEventListener('keydown', (e) => {
      if (['Enter', ' '].includes(e.key)) {
        e.preventDefault();
        inspect();
      }
    });
    root.append(group);
  });
}
function render() {
  if (!result) return;
  const f = result.frames[step],
    final = step === result.frames.length - 1;
  $('results').hidden = false;
  $('step').max = result.frames.length - 1;
  $('step').value = step;
  $('step-label').textContent = `${step} / ${result.circuit.gates.length}`;
  $('norm').textContent = `max |norm² − 1| ${result.maxNormError.toExponential(2)}`;
  $('shot-note').textContent = final
    ? `${result.circuit.shots.toLocaleString()} final-state shots`
    : 'Shots belong to the final step';
  $('probabilities').replaceChildren();
  for (let i = 0; i < f.probabilities.length; i++) {
    const row = el('div');
    row.className = 'outcome';
    row.append(el('span', `|${label(i, result.circuit.qubits)}⟩`));
    const bar = el('div');
    bar.className = 'bar';
    const fill = el('span');
    fill.style.width = `${f.probabilities[i] * 100}%`;
    bar.append(fill);
    row.append(bar, el('span', `${(f.probabilities[i] * 100).toFixed(2)}%`));
    const count = el('span', final ? `${result.counts[i]} shots` : '—');
    count.className = 'count';
    row.append(count);
    $('probabilities').append(row);
  }
  $('reduced').replaceChildren();
  for (const q of f.reduced) {
    const card = el('div');
    card.className = 'qubit';
    const heading = el('div', `q${q.qubit}`);
    heading.className = 'qubit-head';
    heading.append(el('span', `purity ${q.purity.toFixed(5)} · P(1) ${q.p1.toFixed(4)}`));
    card.append(heading);
    for (const axis of ['x', 'y', 'z']) {
      const row = el('div');
      row.className = 'axis-row';
      row.append(el('span', axis));
      const plot = svg('svg', { viewBox: '0 0 200 16', 'aria-hidden': 'true' }),
        position = 100 + q.bloch[axis] * 95;
      plot.append(
        svg('line', { x1: 5, x2: 195, y1: 8, y2: 8, stroke: '#d4e0ee' }),
        svg('line', { x1: 100, x2: 100, y1: 2, y2: 14, stroke: '#acc1d9' }),
        svg('line', { x1: 100, x2: position, y1: 8, y2: 8, stroke: '#739cc5', 'stroke-width': 4 }),
        svg('circle', { cx: position, cy: 8, r: 3, fill: '#3f72a8' }),
      );
      row.append(plot, el('code', q.bloch[axis].toFixed(4)));
      card.append(row);
    }
    $('reduced').append(card);
  }
  $('amplitudes').replaceChildren();
  $('amplitude-count').textContent = `/ ${f.probabilities.length}`;
  for (let i = 0; i < f.probabilities.length; i++) {
    const row = el('tr'),
      re = f.state[2 * i],
      im = f.state[2 * i + 1];
    for (const value of [
      `|${label(i, result.circuit.qubits)}⟩`,
      re.toFixed(7),
      im.toFixed(7),
      f.probabilities[i].toFixed(7),
      re === 0 && im === 0 ? 'undefined' : Math.atan2(im, re).toFixed(7),
    ])
      row.append(el('td', value));
    $('amplitudes').append(row);
  }
  renderCircuit();
  controls();
}
function run() {
  let value;
  try {
    value = candidate();
  } catch (e) {
    status(e.message);
    return;
  }
  invalidate();
  draft = value;
  editor();
  const ticket = revision,
    w = new Worker('worker.js', { type: 'module' });
  worker = w;
  busy = true;
  controls();
  status('Evolving the circuit and sampling its final distribution…');
  w.onmessage = ({ data }) => {
    if (ticket !== revision) return;
    w.terminate();
    worker = null;
    busy = false;
    if (data.error) {
      status(data.error);
      controls();
      return;
    }
    result = data.result;
    step = result.frames.length - 1;
    render();
    status('Simulation complete. Scrub the circuit to inspect interference and reduced states.');
  };
  w.onerror = () => {
    if (ticket !== revision) return;
    w.terminate();
    worker = null;
    busy = false;
    controls();
    status('Simulation worker failed. Try again.');
  };
  w.postMessage(value);
}
for (const kind of GATES) {
  const option = el('option', kind);
  option.value = kind;
  $('gate').append(option);
}
$('gate').addEventListener('change', controls);
$('add').addEventListener('click', () => {
  try {
    const base = candidate(),
      kind = $('gate').value,
      g = {
        kind,
        target: Number($('target').value),
        ...(PAIRS.includes(kind) ? { control: Number($('control').value) } : {}),
        ...(ROTATIONS.includes(kind)
          ? { angle: $('angle').value.trim() === '' ? NaN : Number($('angle').value) }
          : {}),
      };
    draft = validate({ ...base, gates: [...base.gates, g] });
    invalidate();
    editor();
    status('Gate appended. Simulate to update the states.');
  } catch (e) {
    status(e.message);
  }
});
for (const key of ['qubits', 'shots', 'seed'])
  $(key).addEventListener('input', () => {
    invalidate();
    status('Simulation settings changed. Simulate again.');
  });
$('qubits').addEventListener('change', () => {
  try {
    draft = candidate();
    editor();
  } catch (e) {
    status(e.message);
  }
});
$('example').addEventListener('change', () => {
  draft = fixture($('example').value);
  invalidate();
  editor();
  run();
});
$('run').addEventListener('click', run);
$('cancel').addEventListener('click', () => {
  invalidate();
  status('Simulation cancelled.');
});
$('step').addEventListener('input', () => {
  step = Number($('step').value);
  render();
});
$('previous').addEventListener('click', () => {
  step = Math.max(0, step - 1);
  render();
});
$('next').addEventListener('click', () => {
  step = Math.min(result.frames.length - 1, step + 1);
  render();
});
function download(name, data, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = el('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('save').addEventListener('click', () =>
  download('qubit-circuit.json', JSON.stringify(result.circuit, null, 2)),
);
$('csv').addEventListener('click', () =>
  download('qubit-state.csv', stateCSV(result, step), 'text/csv;charset=utf-8'),
);
$('report').addEventListener('click', () =>
  download('qubit-evidence.json', JSON.stringify(result, null, 2)),
);
$('qasm').addEventListener('click', () =>
  download('qubit-circuit.qasm', qasm(result.circuit), 'text/plain;charset=utf-8'),
);
$('file').addEventListener('change', async () => {
  const file = $('file').files[0];
  if (!file) return;
  busy = true;
  controls();
  try {
    if (file.size > 100000) throw Error('Circuit files are limited to 100 KB.');
    const value = validate(JSON.parse(await file.text()));
    draft = value;
    invalidate();
    editor();
    run();
  } catch (e) {
    busy = false;
    controls();
    status(`Import rejected: ${e.message}`);
  } finally {
    $('file').value = '';
  }
});
editor();
run();
