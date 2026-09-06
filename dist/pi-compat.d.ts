import { type ExtensionContext } from "@earendil-works/pi-coding-agent";
interface CompatibleModelRuntime {
    getModel(provider: string, modelId: string): unknown;
    getAvailable(providerId?: string): Promise<readonly unknown[]>;
    hasConfiguredAuth(providerId: string): boolean;
}
/**
 * The extension context exposes a synchronous ModelRegistry facade while child
 * sessions require its canonical ModelRuntime. Pi has retained this property
 * since 0.80.8, but it is intentionally kept behind this compatibility adapter.
 */
export declare function strictModelRuntime(registry: ExtensionContext["modelRegistry"]): CompatibleModelRuntime | undefined;
/**
 * Verify the exact pre-execution seam strict launches depend on.
 *
 * Version checks are deliberately absent: newer Pi releases remain eligible.
 * Capability drift fails only the opt-in strict path closed.
 */
export declare function strictPiCompatibilityError(registry: ExtensionContext["modelRegistry"], promptMethod?: object): string | undefined;
export {};
