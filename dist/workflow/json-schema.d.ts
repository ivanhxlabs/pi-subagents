/**
 * json-schema.ts — validating a script-supplied JSON Schema.
 *
 * `agent(prompt, { schema })` hands us a raw JSON Schema written by a model, to
 * be used two ways: as a tool's `parameters` (so the provider fills the fields)
 * and as the check that decides whether what came back is usable.
 *
 * ## Which typebox
 *
 * **`typebox`, not `@sinclair/typebox`.** They are different packages and both
 * are installed here. `@sinclair/typebox` (0.34) dispatches on a `Kind` symbol
 * that a schema arriving over the wire does not carry, so `Value.Check` throws
 * `Unknown type` on a plain JSON Schema — and `Type.Unsafe` does not help, it
 * stamps a `Kind` that is not registered. `typebox` v1 is a standards JSON
 * Schema validator and takes the schema as-is. It is also the package pi itself
 * types `ToolDefinition.parameters` against, so the same schema object serves
 * both roles with no conversion.
 *
 * ## Why we validate at all
 *
 * Nothing in pi checks a tool call's arguments against the tool's `parameters`.
 * `validateToolCall`/`validateToolArguments` exist in `pi-ai` but are never
 * called from either shipped package, so a schema on a tool is a *prompt to the
 * provider*, not an enforcement point. Every guarantee the script gets about
 * the shape of its result is made here.
 *
 * Pure and pi-free on purpose, so `runtime.ts` can import it without dragging
 * sessions and models into the runtime's tests.
 */
export interface CompiledSchema {
    /** The schema as given, for the tool's `parameters` and the journal key. */
    readonly schema: Record<string, unknown>;
    /** `true`, or a human-readable account of what is wrong. */
    check(value: unknown): true | string;
}
export type SchemaCompilation = {
    ok: true;
    compiled: CompiledSchema;
} | {
    ok: false;
    message: string;
};
/**
 * Turn a script-supplied schema into something we can check against.
 *
 * Rejects up front rather than at the first tool call. A schema whose root is
 * not an object cannot be a tool's input schema at all, so it would break every
 * request the child makes rather than just the last one — and the author should
 * hear about that before a model is paid to discover it.
 */
export declare function compileJsonSchema(schema: unknown): SchemaCompilation;
