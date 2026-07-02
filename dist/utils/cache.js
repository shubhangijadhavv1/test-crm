"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cacheGet = cacheGet;
exports.cacheSet = cacheSet;
exports.cacheClear = cacheClear;
const store = new Map();
function cacheGet(key) {
    const e = store.get(key);
    if (!e)
        return undefined;
    if (Date.now() > e.expires) {
        store.delete(key);
        return undefined;
    }
    return e.value;
}
function cacheSet(key, value, ttlMs) {
    store.set(key, { value, expires: Date.now() + ttlMs });
}
/** Clear everything, or only keys starting with `prefix`. */
function cacheClear(prefix) {
    if (!prefix) {
        store.clear();
        return;
    }
    for (const k of store.keys())
        if (k.startsWith(prefix))
            store.delete(k);
}
//# sourceMappingURL=cache.js.map