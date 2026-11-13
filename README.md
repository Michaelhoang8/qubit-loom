# Qubit Loom

A local quantum-circuit workbench with complex statevector simulation, gate-by-gate inspection, reduced density matrices, and reproducible measurement sampling.

![Qubit Loom](docs/workbench.png)

## Interface

Gate controls sit directly above the circuit. Gate ordering and model notes open separately, while probabilities and reduced states remain below the shared step control. Gates support pointer and keyboard inspection, retain keyboard focus after inspection, and distinguish applied single-qubit gates by fill. Circuit and amplitude tables scroll within their containers on narrow screens.

## Run

Requires Python 3.10+. No runtime dependencies, API keys, or quantum hardware connection.

```sh
python run.py --port 8000
```

Open http://127.0.0.1:8000/. Simulation runs in a cancellable browser worker. Save a circuit before refreshing.

## Workflows

- Start from Bell, GHZ, phase-interference, complex-phase, or empty circuits.
- Append gates, edit rotation angles, reorder/remove operations, and choose register size.
- Scrub every gate boundary or activate a gate in the diagram with the pointer or keyboard.
- Inspect exact basis probabilities and complex amplitudes, plus each qubit's Bloch coordinates and purity.
- Compare final probabilities with seeded shot counts.
- Export circuit JSON, all-frame evidence JSON, the selected state as CSV, or the unitary circuit as OpenQASM 2.

The [example circuit](docs/example.json) prepares a Bell pair. Its final support is `00` and `11`, each with probability 0.5; 4,096 shots at seed 17 yield 2,004 and 2,092 observations. Each single-qubit reduced state has purity 0.5. The [OpenQASM example](docs/example.qasm) preserves the control/target order.

## Model and conventions

All qubits start at `|0⟩`. Supported gates are H, X, Y, Z, S, T, RX, RY, RZ, CX, CZ, and SWAP. Rotations use radians and the convention `Raxis(theta) = exp(-i theta PauliAxis / 2)`. CX/CZ specify a control and target; SWAP exchanges the two designated qubits.

Qubit 0 is the least significant bit of a basis index. Display labels read `q[n−1] … q0`; applying X to q1 of a two-qubit zero state produces `|10⟩`. See [IBM's bit-ordering guide](https://quantum.cloud.ibm.com/docs/en/qiskit/bit-ordering) for the same indexing convention.

The engine retains real/imaginary amplitudes after every gate without renormalizing them. Probabilities and reduced-state calculations divide by the frame's squared norm to account for floating-point roundoff. The interface reports the maximum deviation of that squared norm from one.

Each reduced density matrix is obtained by summing over matching states of the other qubits. Bloch coordinates are `x = 2 Re(rho01)`, `y = -2 Im(rho01)`, and `z = rho00 - rho11`. Purity is `Tr(rho²)`. Since the complete simulated state is pure, a single-qubit purity below one indicates entanglement between that qubit and the rest. It does not identify which other qubits are pairwise entangled. [IBM's density-matrix lesson](https://learning.quantum.ibm.com/course/general-formulation-of-quantum-information/density-matrices) explains reduced states.

Shot counts sample the final computational-basis distribution using xorshift32 and inverse cumulative probabilities. Sampling does not collapse the displayed state or change amplitudes. The generator is deterministic, not cryptographic. Earlier frames show probabilities only; final shot counts are deliberately withheld there.

This simulator does not model noise, mixed global states, mid-circuit measurement, classical feed-forward, hardware topology, or execution on a quantum processor. OpenQASM export contains only the unitary gate sequence, without classical registers or measurements. Shots/seed are retained in JSON, not OpenQASM. QASM import is not implemented.

## Exports and bounds

Circuit JSON contains exactly `qubits`, `gates`, `shots`, and `seed`. Single-qubit gates have `kind` and `target`; rotations also have `angle`; two-qubit gates also have `control`. Unknown fields are rejected. Limits are 1–6 qubits, 100 gates, 1–100,000 shots, seed 1–4,294,967,295, angles within ±8π, and 100 KB imported files.

Evidence JSON includes the circuit, all complex state frames, normalized probabilities, reduced-state data, final counts, and norm-error diagnostic. CSV exports the selected frame; its `final_shots` column is empty for intermediate frames. CSV basis labels carry a `q` prefix to preserve leading zeros in spreadsheet tools. Phases are shown as undefined for exactly zero amplitudes.

`core.js` implements schema validation, gate application, reduced-state summaries, sampling, and exports. `worker.js` isolates simulation. `app.js` handles circuit editing and inspection. Input changes invalidate old results. `run.py` serves only explicit static assets on loopback and validates Host headers.

## Validation

Requires Node.js 22+ for JavaScript tests.

```sh
node --test
npm run check
python -m unittest discover -s tests -v
```

Thirteen core tests cover basis ordering, interference cancellation, Bell/GHZ support, complex phase signs, analytic rotations, inverse identities, controlled gates against a dense basis-column oracle across 100 arbitrary complex states, coherent state transfer across nine preparations, explicit partial traces, reproducible sampling, zero-mass bins, 100-gate norm preservation, exports, and schema limits. One HTTP test checks assets, HEAD, hidden-file rejection, and Host validation. CI runs Ubuntu Node 22/24 and Windows Node 24.

Browser checks verified pre/post-entanglement purity, intermediate-frame shot labels, rotation editing, gate reordering/removal/appending, keyboard diagram inspection, JSON round-trip, and downloads. Independent Python checks verified exported Bell amplitudes, reduced-state purity, all 4,096 seeded outcomes, CSV basis/count fields, and QASM control ordering.
