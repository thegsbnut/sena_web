// The structure rules LINE enforces that a text-only reading cannot see: an icon
// or a span-less text may sit in a baseline box, and a baseline box holds only
// text, icon and filler ("invalid box content type" otherwise).
export const flexProblems = (node, parent = null, at = 'root') => {
  if (!node || typeof node !== 'object') return [];
  const problems = [];
  if (node.type === 'icon' && parent?.layout !== 'baseline')
    problems.push(at + ': icon outside a baseline box');
  if (node.type === 'box' && node.layout === 'baseline')
    for (const child of node.contents)
      if (!['text', 'icon', 'filler'].includes(child.type))
        problems.push(at + ': ' + child.type + ' inside a baseline box');
  if (node.type === 'bubble')
    for (const part of ['header', 'hero', 'body', 'footer'])
      problems.push(...flexProblems(node[part], node, at + '.' + part));
  if (node.type === 'carousel')
    node.contents.forEach((b, i) => problems.push(...flexProblems(b, node, at + '[' + i + ']')));
  if (node.type === 'box')
    node.contents.forEach((c, i) =>
      problems.push(...flexProblems(c, node, at + '.contents[' + i + ']')),
    );
  return problems;
};
