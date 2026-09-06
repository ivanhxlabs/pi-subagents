export declare function inChildSessionContext(): boolean;
export declare function runInChildSessionContext<T>(fn: () => Promise<T>): Promise<T>;
