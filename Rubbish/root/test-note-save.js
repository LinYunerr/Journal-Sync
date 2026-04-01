/**
 * 测试笔记保存功能
 * 验证 AI 分类、标签生成、元数据提取、总结功能
 */

import { saveToObsidian } from '../../src/sync/journal-sync.js';

const testContent = `
# 人工智能在医疗领域的应用

作者：张三
来源：科技日报
发布时间：2026-03-10

人工智能技术正在深刻改变医疗行业。从疾病诊断到药物研发，AI 展现出巨大潜力。

## 主要应用领域

1. **医学影像分析**：AI 可以快速准确地识别 X 光片、CT 扫描中的异常
2. **疾病预测**：通过分析患者数据，预测疾病风险
3. **个性化治疗**：根据患者基因信息制定治疗方案

## 挑战与展望

尽管前景广阔，但 AI 医疗仍面临数据隐私、算法透明度等挑战。未来需要在技术创新和伦理规范之间找到平衡。
`;

async function test() {
  console.log('=== 测试 1: 笔记保存（原文模式） ===');
  try {
    const result1 = await saveToObsidian(testContent, 'note', { summarize: false });
    console.log('✅ 原文模式保存成功');
    console.log('路径:', result1.path);
    console.log('文件夹:', result1.folder || '根目录');
    console.log('元数据:', result1.metadata);
  } catch (error) {
    console.error('❌ 原文模式保存失败:', error.message);
  }

  console.log('\n=== 测试 2: 笔记保存（总结模式） ===');
  try {
    const result2 = await saveToObsidian(testContent, 'note', { summarize: true });
    console.log('✅ 总结模式保存成功');
    console.log('路径:', result2.path);
    console.log('文件夹:', result2.folder || '根目录');
    console.log('元数据:', result2.metadata);
  } catch (error) {
    console.error('❌ 总结模式保存失败:', error.message);
  }

  console.log('\n=== 测试 3: 日记保存 ===');
  try {
    const result3 = await saveToObsidian('今天天气不错，心情很好。', 'diary');
    console.log('✅ 日记保存成功');
    console.log('路径:', result3.path);
    console.log('操作:', result3.action);
  } catch (error) {
    console.error('❌ 日记保存失败:', error.message);
  }
}

test().catch(console.error);
