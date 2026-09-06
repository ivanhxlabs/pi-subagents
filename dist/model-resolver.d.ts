/**
 * Model resolution: exact match ("provider/modelId") with fuzzy fallback.
 */
export interface ModelEntry {
    id: string;
    name: string;
    provider: string;
}
export interface ModelRegistry<TModel extends ModelEntry = ModelEntry> {
    find(provider: string, modelId: string): TModel | undefined;
    getAll(): TModel[];
    getAvailable?(): TModel[];
}
export declare function isExactQualifiedModelId(input: string): boolean;
export type ExactModelResolution<TModel extends ModelEntry = ModelEntry> = {
    ok: true;
    model: TModel;
    canonicalId: string;
} | {
    ok: false;
    code: "INVALID_MODEL_ID" | "MODEL_UNAVAILABLE" | "AUTH_UNAVAILABLE";
    message: string;
};
/**
 * Resolve one exact, case-sensitive qualified model id without fuzzy spelling,
 * date normalization or cross-provider fallback.
 *
 * Registration and authentication are deliberately separate. A registered
 * exact model that is absent from `getAvailable()` is an auth refusal; an id
 * absent from the registry is unavailable. The strict route runtime uses that
 * distinction to produce stable failure codes before child execution.
 */
export declare function resolveExactAvailableModel<TModel extends ModelEntry>(input: string, registry: ModelRegistry<TModel>): ExactModelResolution<TModel>;
/**
 * Both display forms of a model. The short one goes on tight rows (the widget,
 * the Agent tool result), the canonical one where there is room to disambiguate
 * two providers serving a similarly-named model (the conversation viewer).
 *
 * One function, because `index.ts` labels the model it resolved before the run
 * and `agent-manager.ts` relabels it from the live session afterwards — the two
 * must agree or the label would visibly change the moment the session starts.
 */
export declare function describeModel(model: {
    provider: string;
    id: string;
    name?: string;
}): {
    modelName: string;
    modelId: string;
};
/**
 * Resolve a model string to a Model instance.
 * Tries exact match first ("provider/modelId"), then fuzzy match against all available models.
 * Returns the Model on success, or an error message string on failure.
 */
export declare function resolveModel<TModel extends ModelEntry>(input: string, registry: ModelRegistry<TModel>): TModel | string;
