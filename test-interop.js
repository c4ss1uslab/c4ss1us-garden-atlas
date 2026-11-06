import _remarkParse from 'remark-parse';
import _remarkFrontmatter from 'remark-frontmatter';
const remarkParse = _remarkParse.default || _remarkParse;
const remarkFrontmatter = _remarkFrontmatter.default || _remarkFrontmatter;
console.log(typeof remarkParse, typeof remarkFrontmatter);
