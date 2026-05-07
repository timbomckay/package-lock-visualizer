// Maps a package's `resolved` URL to a human-browseable page.

const URL_SCHEME_RE = /^(?:git\+|https?:|ssh:|git:)/i;

export function parseResolvedUrl(resolved) {
  // WHATWG URL throws for unsupported schemes; the regex skips that cost for
  // file:, npm:, workspace:, bare paths. The git+ prefix and ssh-with-user form
  // also need rewriting before URL can extract a hostname.
  if (!resolved || !URL_SCHEME_RE.test(resolved)) return null;
  let s = resolved.replace(/^git\+/, "");
  if (s.startsWith("ssh://git@")) s = "https://" + s.slice("ssh://git@".length);
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

function parseGitTarget(resolved) {
  const u = parseResolvedUrl(resolved);
  if (!u) return null;
  const ref = u.hash ? u.hash.slice(1) : null;
  const segs = u.pathname.split("/").filter(Boolean);

  if (u.hostname === "codeload.github.com") {
    const [owner, repo, , refFromPath] = segs;
    if (!owner || !repo) return null;
    return { owner, repo: repo.replace(/\.git$/, ""), ref: refFromPath ?? ref };
  }

  const [owner, repoRaw] = segs;
  if (!owner || !repoRaw) return null;
  return { owner, repo: repoRaw.replace(/\.git$/, ""), ref };
}

const GIT_HOSTS = {
  "github.com": { label: "GitHub", treePath: (ref) => `/tree/${ref}` },
  "gitlab.com": { label: "GitLab", treePath: (ref) => `/-/tree/${ref}` },
  "bitbucket.org": { label: "Bitbucket", treePath: (ref) => `/src/${ref}` },
};

function gitResolver(host, alias) {
  const meta = GIT_HOSTS[host];
  return {
    match: (h) => h === host || h === alias,
    label: () => meta.label,
    url: ({ resolved }) => {
      const t = parseGitTarget(resolved);
      if (!t) return null;
      const base = `https://${host}/${t.owner}/${t.repo}`;
      return t.ref ? base + meta.treePath(t.ref) : base;
    },
  };
}

const RESOLVERS = [
  {
    match: (host) => host === "registry.npmjs.org",
    label: () => "npm",
    url: ({ name, version }) => `https://www.npmjs.com/package/${name}/v/${version}`,
  },
  {
    match: (host) => host === "jfrog.io" || host.endsWith(".jfrog.io"),
    label: () => "JFrog",
    url: ({ name, version, registry }) => {
      const encoded = name.replace(/\//g, "%2F");
      return `https://${registry}/ui/packages/npm:%2F%2F${encoded}/${version}`;
    },
  },
  gitResolver("github.com", "codeload.github.com"),
  gitResolver("gitlab.com"),
  gitResolver("bitbucket.org"),
];

export function getRegistryLink(node) {
  if (!node?.name || !node.version || !node.registry) return null;
  const resolver = RESOLVERS.find((r) => r.match(node.registry));
  if (!resolver) return null;
  const url = resolver.url(node);
  return url ? { url, label: resolver.label() } : null;
}
