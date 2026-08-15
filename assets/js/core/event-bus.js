/**
 * 事件匯流排 [Phase4]（零業務依賴）
 * 用於解除模組間循環依賴：模組只 emit 事件，唔再直接互相 import。
 */
const listeners = new Map(); // event -> Set<fn>

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return function off() {
    const set = listeners.get(event);
    if (set) set.delete(fn);
  };
}

export function off(event, fn) {
  const set = listeners.get(event);
  if (set) set.delete(fn);
}

export function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  set.forEach((fn) => {
    try {
      fn(payload);
    } catch (err) {
      console.error('[event-bus] handler error for "' + event + '":', err);
    }
  });
}

export function clear(event) {
  if (event) listeners.delete(event);
  else listeners.clear();
}