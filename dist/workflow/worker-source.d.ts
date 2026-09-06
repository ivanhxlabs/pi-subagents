/**
 * worker-source.ts — the JavaScript that runs inside the workflow worker thread.
 *
 * The host spawns this with `new Worker(WORKER_SOURCE, { eval: true })`, so the
 * source has to be an inlined string: `AGENTS.md` forbids dynamic `import()`,
 * and a file path would have to survive bundling. Keeping it as a template
 * literal costs editor tooling but nothing else — the worker is plain CommonJS
 * JavaScript and never sees the TypeScript pipeline.
 *
 * Two boundaries stack here, and they are not the same boundary:
 *
 *   host thread  ←postMessage→  worker thread  ←vm context→  workflow script
 *
 * The worker/host split exists for *killability*: `worker.terminate()` stops a
 * runaway script mid-loop, which an in-process `vm` timeout cannot do once the
 * script is inside an `await`. The vm context exists for *determinism and
 * accident-avoidance*, not security — see the note on `codeGeneration` below.
 *
 * ## Why the context gets no host built-ins
 *
 * `vm.createContext(sandbox)` gives the script a fresh realm that already owns
 * `Object`, `Array`, `JSON`, `Math`, `Date`, `Promise`, `Map`, `Set`. We inject
 * *only* our own globals on top. Injecting host built-ins instead would hand the
 * script `Object.constructor` → the **host** `Function`, i.e. a compiler for
 * arbitrary host-realm code.
 *
 * That said: our injected globals are themselves host closures, so
 * `agent.constructor` is still the host `Function`. The hygiene shrinks the
 * surface; it does not close the hole. **`codeGeneration: { strings: false }` is
 * the load-bearing defense** — it makes `Function("…")` and `eval("…")` throw
 * `EvalError`, so a captured host `Function` cannot compile anything. Treat this
 * as a determinism boundary, not a security boundary against a hostile script.
 *
 * ## Why determinism is a prelude and not a stub
 *
 * Because `Date` and `Math` come *from the realm*, they cannot be neutered by
 * injection — there is nothing to inject over. So the compiled source is
 * prefixed with a prelude that runs inside the realm and reassigns `Date.now`
 * and `Math.random` in place, then lexically shadows `Date` with a subclass
 * whose zero-argument constructor throws. Lexical shadowing rather than a global
 * assignment because a `const` in the IIFE scope cannot be reached around.
 *
 * Determinism is enforced because a workflow's journal is replayed by prefix on
 * resume: a script that reads the clock produces a different prefix on the
 * second run and the replay silently diverges.
 */
export declare const WORKER_SOURCE: string;
