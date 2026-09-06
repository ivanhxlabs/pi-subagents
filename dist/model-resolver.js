/**
 * Model resolution: exact match ("provider/modelId") with fuzzy fallback.
 */
const EXACT_QUALIFIED_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:@+/-]*$/;
export function isExactQualifiedModelId(input) {
    const slash = input.indexOf("/");
    return (slash > 0 &&
        slash < input.length - 1 &&
        EXACT_QUALIFIED_MODEL_ID.test(input));
}
/**
 * Resolve one exact, case-sensitive qualified model id without fuzzy spelling,
 * date normalization or cross-provider fallback.
 *
 * Registration and authentication are deliberately separate. A registered
 * exact model that is absent from `getAvailable()` is an auth refusal; an id
 * absent from the registry is unavailable. The strict route runtime uses that
 * distinction to produce stable failure codes before child execution.
 */
export function resolveExactAvailableModel(input, registry) {
    const slash = input.indexOf("/");
    if (!isExactQualifiedModelId(input)) {
        return {
            ok: false,
            code: "INVALID_MODEL_ID",
            message: `Strict model ids must be exact qualified provider/model ids: "${input}".`,
        };
    }
    const provider = input.slice(0, slash);
    const modelId = input.slice(slash + 1);
    const registered = registry.getAll().find(model => model.provider === provider && model.id === modelId);
    const found = registry.find(provider, modelId);
    if (registered === undefined || found === undefined) {
        return {
            ok: false,
            code: "MODEL_UNAVAILABLE",
            message: `Exact model is not registered: "${input}".`,
        };
    }
    const canonicalId = `${registered.provider}/${registered.id}`;
    if (canonicalId !== input) {
        return {
            ok: false,
            code: "MODEL_UNAVAILABLE",
            message: `Exact model is not registered: "${input}".`,
        };
    }
    const available = registry.getAvailable?.();
    if (available !== undefined &&
        !available.some(model => `${model.provider}/${model.id}` === input)) {
        return {
            ok: false,
            code: "AUTH_UNAVAILABLE",
            message: `Authentication is unavailable for exact model "${input}".`,
        };
    }
    return { ok: true, model: found, canonicalId };
}
/**
 * Both display forms of a model. The short one goes on tight rows (the widget,
 * the Agent tool result), the canonical one where there is room to disambiguate
 * two providers serving a similarly-named model (the conversation viewer).
 *
 * One function, because `index.ts` labels the model it resolved before the run
 * and `agent-manager.ts` relabels it from the live session afterwards — the two
 * must agree or the label would visibly change the moment the session starts.
 */
export function describeModel(model) {
    return {
        modelName: (model.name ?? model.id).replace(/^Claude\s+/i, "").toLowerCase(),
        modelId: `${model.provider}/${model.id}`,
    };
}
/**
 * Resolve a model string to a Model instance.
 * Tries exact match first ("provider/modelId"), then fuzzy match against all available models.
 * Returns the Model on success, or an error message string on failure.
 */
export function resolveModel(input, registry) {
    // Available models (those with auth configured)
    const all = registry.getAvailable?.() ?? registry.getAll();
    const availableSet = new Set(all.map(m => `${m.provider}/${m.id}`.toLowerCase()));
    // 1. Exact match: "provider/modelId" — only if available (has auth)
    const slashIdx = input.indexOf("/");
    if (slashIdx !== -1) {
        const provider = input.slice(0, slashIdx);
        const modelId = input.slice(slashIdx + 1);
        if (availableSet.has(input.toLowerCase())) {
            const found = registry.find(provider, modelId);
            if (found)
                return found;
        }
    }
    // 2. Fuzzy match against available models. Normalize separators so cosmetic
    // punctuation differences still match — e.g. "claude-haiku-4.5" and
    // "claude-haiku-4-5" (dot vs dash in the version) resolve to the same model.
    const normalize = (s) => s.toLowerCase().replace(/\./g, "-");
    const query = normalize(input);
    // Score each model: prefer exact id match > id contains > name contains > provider+id contains
    let bestMatch;
    let bestScore = 0;
    for (const m of all) {
        const id = normalize(m.id);
        const name = normalize(m.name);
        const full = normalize(`${m.provider}/${m.id}`);
        let score = 0;
        if (id === query || full === query) {
            score = 100; // exact
        }
        else if (id.includes(query) || full.includes(query)) {
            score = 60 + (query.length / id.length) * 30; // substring, prefer tighter matches
        }
        else if (name.includes(query)) {
            score = 40 + (query.length / name.length) * 20;
        }
        else if (
        // A trailing date-stamp token (e.g. "20251001") is optional, so a
        // date-pinned config like "claude-haiku-4-5-20251001" still matches an
        // undated registry id like "claude-haiku-4-5".
        query
            .split(/[\s\-/]+/)
            .every(part => /^\d{8}$/.test(part) || id.includes(part) || name.includes(part) || m.provider.toLowerCase().includes(part))) {
            score = 20; // all parts present somewhere
        }
        if (score > bestScore) {
            bestScore = score;
            bestMatch = m;
        }
    }
    if (bestMatch && bestScore >= 20) {
        const found = registry.find(bestMatch.provider, bestMatch.id);
        if (found)
            return found;
    }
    // 3. Provider fallback: a "provider/modelId" query that didn't match under the
    // named provider (exact or fuzzy above) retries against all providers. The
    // named provider is preferred when present; this only kicks in when it isn't,
    // so the same model from another provider beats falling back to "inherit".
    if (slashIdx !== -1) {
        const bare = resolveModel(input.slice(slashIdx + 1), registry);
        if (typeof bare !== "string")
            return bare;
    }
    // 4. No match — list available models
    const modelList = all
        .map(m => `  ${m.provider}/${m.id}`)
        .sort()
        .join("\n");
    return `Model not found: "${input}".\n\nAvailable models:\n${modelList}`;
}
