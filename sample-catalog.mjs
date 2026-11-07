const group = '界面与信息设计';

const examples = [
  ['bento-grid', '模块网格', 'Bento Grid', '让总览页用大小不同的区域区分主任务与辅助信息。', '入口多、优先级不同的总览。', '各模块信息量接近时，大小差异可能误导。'],
  ['swiss-modernism-2', '网格与大字', 'Swiss Modernism', '用对齐、字级和留白组织有限的信息。', '海报、章节封面或活动导览。', '需要同时显示大量可操作内容时。'],
  ['data-dense-dashboard', '密集数据看板', 'Data Dashboard', '把关键指标放在稳定的位置，便于反复扫读。', '经常对照同类数字的工作台。', '面向初次接触该业务的读者时。'],
  ['accessible-ethical', '清晰可读的界面', 'Accessible Interface', '用文字与颜色共同表达状态，并保留明确的操作焦点。', '有状态变化、需要反复操作的界面。', '仅凭示意图无法判断是否满足无障碍标准。']
];

export const styleGroups = [group];
export const styleCards = examples.map(([id, title, englishTitle, description, useWhen, avoidWhen]) => ({
  id: `style:${id}`, kind: 'style-language', title, englishTitle, group, category: group,
  image: `style-thumbnails/${id}.svg`, description, useWhen, avoidWhen,
  feelings: ['清晰理性'], occasions: ['咨询与演示'], prompt: `${description} 用实际内容检查层次。`
}));

export const cases = styleCards.map((item, index) => ({
  ...item, id: `case:${index + 1}`, kind: 'case',
  category: index === 1 ? 'Posters & Typography' : 'UI & Interfaces'
}));

const referenceTypes = ['layout', 'style', 'layout', 'color'];
export const creativeCards = styleCards.map((item, index) => ({
  ...item, id: `reference:${index + 1}`, kind: 'creative-reference',
  resourceType: referenceTypes[index], sourceCode: `DEMO-${index + 1}`, sourceVersion: 'v1'
}));
