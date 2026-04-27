/**
 * 优化内容：删除多余空格和重复行
 */
export function optimizeContent(content) {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter((line, index, arr) => index === 0 || line !== arr[index - 1])
    .join('\n')
    .trim();
}

export default {
  optimizeContent
};
