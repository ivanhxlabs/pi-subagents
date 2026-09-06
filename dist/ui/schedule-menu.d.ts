/**
 * schedule-menu.ts — `/agents → Scheduled jobs` submenu.
 *
 * Minimal v1 surface: list scheduled jobs, select one to inspect details +
 * confirm cancellation. No create wizard (the `Agent` tool's `schedule` param
 * is the canonical creation path), no toggle/cleanup (cancel is enough for
 * "I scheduled something dumb, get rid of it"). Add management surfaces here
 * if real demand emerges.
 */
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SubagentScheduler } from "../schedule.js";
/**
 * List scheduled jobs; selecting one opens a cancel-confirm with details.
 * Returns when the user backs out or after a cancellation.
 */
export declare function showSchedulesMenu(ctx: ExtensionCommandContext, scheduler: SubagentScheduler): Promise<void>;
