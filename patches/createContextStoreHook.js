/**
 * Patched build of createContextStoreHook without React Compiler memo-cache.
 * Fixes assistant-ui #4398: hook order violation in ThreadPrimitive.ViewportScrollable.
 * Remove after upgrading to @assistant-ui/react > 0.14.20.
 */
function createContextStoreHook(contextHook, contextKey) {
  function useStoreStoreHook(options) {
    const context = contextHook(options);
    if (!context) return null;
    return context[contextKey];
  }

  function useStoreHook(param) {
    let optional = false;
    let selector;

    if (typeof param === "function") {
      selector = param;
    } else if (param && typeof param === "object") {
      optional = !!param.optional;
      selector = param.selector;
    }

    const useStore = useStoreStoreHook({ optional });
    if (!useStore) return null;
    return selector ? useStore(selector) : useStore();
  }

  return {
    [contextKey]: useStoreHook,
    [`${contextKey}Store`]: useStoreStoreHook,
  };
}

export { createContextStoreHook };
