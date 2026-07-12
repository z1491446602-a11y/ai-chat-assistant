interface MermaidApi {
  initialize: (config: {
    startOnLoad: boolean;
    securityLevel: 'strict';
    theme: string;
    fontFamily: string;
  }) => void;
  render: (id: string, source: string) => Promise<{ svg: string }>;
}

let mermaidPromise: Promise<MermaidApi> | undefined;

export function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    const loadingPromise = import('mermaid').then(module => {
      const mermaid = module.default as MermaidApi;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'default',
        fontFamily: 'inherit',
      });
      return mermaid;
    });
    mermaidPromise = loadingPromise.catch(error => {
      mermaidPromise = undefined;
      throw error;
    });
  }

  return mermaidPromise;
}
