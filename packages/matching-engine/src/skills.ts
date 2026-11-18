const aliases: Record<string, string[]> = {
  JavaScript: ['javascript', 'js', 'ecmascript'],
  TypeScript: ['typescript', 'ts'],
  React: ['react', 'react.js', 'reactjs'],
  'Node.js': ['node.js', 'nodejs', 'node js'],
  'Next.js': ['next.js', 'nextjs'],
  PostgreSQL: ['postgresql', 'postgres'],
  Python: ['python'], Java: ['java'], SQL: ['sql'], 'C++': ['c++'], 'C#': ['c#'],
  '.NET': ['.net', 'dotnet'], AWS: ['aws', 'amazon web services'],
  Azure: ['azure'], Git: ['git'], Docker: ['docker'], Kubernetes: ['kubernetes', 'k8s'],
  HTML: ['html'], CSS: ['css'], Tailwind: ['tailwind', 'tailwind css'],
  Go: ['golang', 'go language'], Rust: ['rust'], Vue: ['vue', 'vue.js'],
  Angular: ['angular'], PHP: ['php'], Ruby: ['ruby'], MongoDB: ['mongodb'],
  Linux: ['linux'], Terraform: ['terraform'], Figma: ['figma'], GraphQL: ['graphql'],
};

export function normalizeSkill(skill: string) {
  const lower = skill.trim().toLowerCase();
  return Object.entries(aliases).find(([, names]) => names.includes(lower))?.[0] ?? lower;
}

export function extractSkills(text: string) {
  return Object.entries(aliases).filter(([, names]) => names.some(name => {
    const escaped = name.replace(/[.*+?^$${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^\\w])' + escaped + '(?![\\w])', 'i').test(text);
  })).map(([skill]) => skill);
}
