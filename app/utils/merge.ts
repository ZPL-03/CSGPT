export function merge(target: any, source: any) {
  Object.keys(source).forEach(function (key) {
    if (
      (source.hasOwnProperty(key) && // 检查属性不是继承的
        source[key] &&
        typeof source[key] === "object") ||
      key === "__proto__" ||
      key === "constructor"
    ) {
      merge((target[key] = target[key] || {}), source[key]);
      return;
    }
    target[key] = source[key];
  });
}
