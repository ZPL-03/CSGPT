export function estimateTokenLength(input: string): number {
  let tokenLength = 0;

  for (let i = 0; i < input.length; i++) {
    const charCode = input.charCodeAt(i);

    if (charCode < 128) {
      // ASCII 字符
      if (charCode <= 122 && charCode >= 65) {
        // 英文字母 a-z A-Z
        tokenLength += 0.25;
      } else {
        tokenLength += 0.5;
      }
    } else {
      // Unicode 字符（中文等）
      tokenLength += 1.5;
    }
  }

  return tokenLength;
}
