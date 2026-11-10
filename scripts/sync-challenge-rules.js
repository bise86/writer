const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = JSON.parse(
  fs.readFileSync(path.join(root, 'src/assets/challenge-rules.json'), 'utf8'),
);
const directory = path.join(root, 'src/assets/challenge');
const check = process.argv.includes('--check');
const subjects = [
  'math',
  'english',
  'chinese',
  'physics',
  'chemistry',
  'biology',
  'history',
  'geography',
  'politics',
  'science',
  'other',
];
if (
  source.subjects.length !== subjects.length ||
  subjects.some(
    subject =>
      source.subjects.filter(item => item.subject === subject).length !== 1,
  )
) {
  throw new Error('挑战学科索引必须包含11个唯一、可加载的学科');
}
const expected = new Map();
const common = {
  ...source,
  subjects: source.subjects.map(({subject, label, summary}) => ({
    subject,
    label,
    summary,
  })),
};
expected.set('common.json', common);
for (const policy of source.subjects) {
  expected.set(`subjects/${policy.subject}.json`, {
    policyVersion: `${source.id}:${source.version}`,
    policy,
  });
}
const mismatched = [];
for (const [relative, value] of expected) {
  const target = path.join(directory, relative);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (check) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) {
      mismatched.push(relative);
    }
  } else {
    fs.mkdirSync(path.dirname(target), {recursive: true});
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) {
      fs.writeFileSync(target, text);
    }
  }
}
if (mismatched.length) {
  throw new Error(
    `分科学科规则尚未同步：${mismatched.join(
      ', ',
    )}。请运行 npm run sync:challenge-rules`,
  );
}
console.log(
  check
    ? '挑战科目索引与11科模块均与完整JSON一致'
    : '已同步挑战科目索引与11科模块',
);
