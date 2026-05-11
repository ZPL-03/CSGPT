declare global {
  interface Array<T> {
    at(index: number): T | undefined;
  }
}

if (!Array.prototype.at) {
  Array.prototype.at = function (index: number) {
    // 获取数组长度
    const length = this.length;

    // 将负索引转换为正索引
    if (index < 0) {
      index = length + index;
    }

    // 索引越界返回 undefined
    if (index < 0 || index >= length) {
      return undefined;
    }

    // 使用 slice 方法获取指定索引的值
    return Array.prototype.slice.call(this, index, index + 1)[0];
  };
}

export {};
