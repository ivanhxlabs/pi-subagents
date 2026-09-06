/**
 * agent-color.ts — Claude Code-compatible agent name badges.
 *
 * Claude Code renders a subagent's name as a badge: the configured color is the
 * background, the text an inverse foreground. Its eight named colors are
 * reproduced here, along with six-digit hex and the extra palette names Agency
 * Agents uses, so those definitions render as written.
 */
type ColorMode = "truecolor" | "256color";
export interface AgentNameTheme {
    fg(color: string, text: string): string;
    bold(text: string): string;
    getColorMode?(): ColorMode;
}
export interface AgentNameStyle {
    /** Existing theme foreground used when no valid agent color is configured. */
    fallbackColor?: string;
    /** Reapply an enclosing background after the badge instead of resetting it. */
    restoreBackground?: string;
    bold?: boolean;
}
/** Resolve Claude Code/Agency Agents color syntax to normalized #RRGGBB. */
export declare function resolveAgentColor(value: string | undefined): string | undefined;
/**
 * Render one name as a padded background badge when `color` is valid. Claude
 * Code uses one inverse color for every badge's text; black or white is picked
 * by WCAG contrast here instead, so each palette entry stays readable. Invalid
 * or omitted colors preserve the caller's existing theme styling.
 */
export declare function renderAgentNameLabel(name: string, color: string | undefined, theme: AgentNameTheme, style?: AgentNameStyle): string;
/** Whether an agent renders as a badge — i.e. it has a valid configured color. */
export declare function hasAgentBadge(type: string | undefined): boolean;
/** Render a registered agent's display name with its configured color. */
export declare function renderAgentName(type: string | undefined, theme: AgentNameTheme, style?: AgentNameStyle): string;
export {};
