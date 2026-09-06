/**
 * agent-mention.ts — what `@` can address, and the suggestions pi renders for it.
 *
 * A subagent is addressable whether or not it is currently running: a live
 * record is messaged or resumed, an evicted one whose session is still on disk
 * is reopened, and an agent *type* with no instance at all is started. That is
 * the point of the handle — `@explore` means the Explore agent, not "the
 * Explore process that happens to exist right now" — so the roster below unions
 * all three, and the dispatcher and the popup read the same list.
 *
 * Rows are per *agent*, not per handle. An agent given a `name` holds two names
 * (its alias and its type-derived handle) and both resolve, but it lists once,
 * under the alias, with its type moved into the description so the row still
 * says what it is.
 *
 * pi's `CombinedAutocompleteProvider` already owns `@`, where it means "attach a
 * file". Extensions can wrap it (`ctx.ui.addAutocompleteProvider`), so this
 * provider adds the `@` tokens that name an agent and delegates everything else
 * — including all of `applyCompletion`, whose `@`-branch already inserts
 * `item.value` plus a trailing space, which is exactly what a handle needs.
 *
 * Matching mirrors Claude Code: case-insensitive prefix, not fuzzy. What it does
 * NOT mirror is Claude Code dropping files whenever an agent matches. Here `@` is
 * pi's file picker first, and the handles are additive, so a token matching both
 * lists both — agents first. Suppressing on any match sounds narrow and is not:
 * an empty token prefix-matches every handle, so a bare `@` — the gesture people
 * use to browse files — would offer no files at all, and a single letter
 * beginning any handle would do the same.
 *
 * Both halves ship under ONE `prefix`, which is sound because wherever BOTH sides
 * produce rows they measured the same span. pi's `extractAtPrefix` takes the
 * token after the last of `{space, tab, ", ', =}` and keeps it only if it starts
 * with `@`; `MENTION_TRIGGER` matches `@[\w-]*` at the cursor, after start-of-line
 * or `[\s。、？！]`. Where those two disagree, exactly one side answers and there
 * is nothing to merge: `@src/index.ts` and `@"my file` are pi's alone (no handle
 * matches), `=@ex` is pi's alone (`=` is a delimiter to pi, not a boundary to us),
 * and `。@ex` is ours alone (the reverse). A merged response therefore never
 * carries a prefix from one side and an item from the other.
 *
 * Offering never-started types is a deliberate step beyond Claude Code, whose
 * registry holds only live tasks, so an agent you had not launched yet was
 * unaddressable.
 */
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import type { AgentManager } from "../agent-manager.js";
import type { AgentRecord, AgentTombstone } from "../types.js";
/**
 * One thing `@` can address, and what sending to it will do. `typeLabel` is the
 * agent's `display_name`, resolved by the caller: this module stays independent
 * of the type registry, but the popup must agree with FleetView and the widget,
 * which both render the label rather than the raw type.
 */
export type MentionTarget = {
    kind: "record";
    handle: string;
    record: AgentRecord;
    typeLabel: string;
} | {
    kind: "tombstone";
    handle: string;
    entry: AgentTombstone;
    typeLabel: string;
} | {
    kind: "type";
    handle: string;
    type: string;
    description: string;
};
/** The registry facts the roster needs, so it stays independent of agent-types. */
export type TypeInfo = {
    name: string;
    description: string;
};
/**
 * Everything `@` can reach, in the order the popup lists it: steerable agents
 * first, then the other live ones earliest-launched, then agent types with no
 * live instance. A type whose handle a record already holds is omitted — that
 * name addresses the existing agent, which is what makes `@explore` mean
 * "message the one that's running" and only otherwise "start one".
 */
export declare function mentionRoster(manager: AgentManager, types: readonly TypeInfo[], displayNameOf?: (type: string) => string): MentionTarget[];
export declare function createMentionProvider(current: AutocompleteProvider, roster: () => MentionTarget[], isEnabled: () => boolean): AutocompleteProvider;
