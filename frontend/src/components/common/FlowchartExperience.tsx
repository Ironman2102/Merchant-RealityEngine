import { useEffect, useRef } from 'react';
import FLOWCHART_SOURCE from './flowchartSource.html?raw';

type Mode = 'workflow' | 'studies';

export function FlowchartExperience({ mode }: { mode: Mode }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const shadow = element.shadowRoot ?? element.attachShadow({ mode: 'open' });
    shadow.replaceChildren();
    const source = new DOMParser().parseFromString(FLOWCHART_SOURCE, 'text/html');
    const style = source.querySelector('style')?.cloneNode(true) as HTMLStyleElement | undefined;
    if (!style) return;

    style.textContent += `
      main{position:relative;z-index:1;max-width:none;margin:0;padding:0 0 12px}
      .stage{margin-top:0}
      .case-studies{margin:0 auto;max-width:1180px}
      .case-card{cursor:default}
      .case-card:hover{transform:none;box-shadow:none}
      @media(max-width:820px){.case-studies{padding-top:8px}}
      .flowchart-app{--bg:#0d0b09;--fg:#f6efe4;--mut:#b7aa98;--line:#3e352c;--green:#ffb07a;--green2:#ffd3b0;font-family:'Inter Tight',Inter,system-ui,sans-serif;color:#f6efe4}
      .flowchart-app *{font-family:'Inter Tight',Inter,system-ui,sans-serif}
      .flowchart-app h1,.flowchart-app h2,.flowchart-app h3{font-family:'Bricolage Grotesque','Inter Tight',sans-serif!important;letter-spacing:-.02em}
      .flowchart-app text{font-family:'Inter Tight',Inter,system-ui,sans-serif!important}
      .flowchart-app .stage{border-color:#2a241e;border-radius:18px;background:linear-gradient(180deg,#17130f,#110e0b)}
      .flowchart-app .bx{fill:#15110e;stroke:color-mix(in srgb,var(--c) 30%,#3e352c)}
    `;
    const fonts = document.createElement('link');
    fonts.rel = 'stylesheet';
    fonts.href = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&display=swap';
    const app = document.createElement('div');
    app.className = 'flowchart-app';
    shadow.append(fonts, style, app);

    const main = document.createElement('main');
    const selectors = mode === 'workflow' ? ['.stage', '.bands'] : ['.case-studies'];
    for (const selector of selectors) {
      const item = source.querySelector(selector);
      if (!item) continue;
      const copy = item.cloneNode(true) as HTMLElement;
      copy.querySelectorAll<HTMLImageElement>('img[src]').forEach(image => {
        image.src = `${import.meta.env.BASE_URL}flowchart/${image.getAttribute('src')}`;
      });
      main.append(copy);
    }
    app.append(main);

    if (mode === 'workflow') {
      const modal = source.querySelector('#M');
      if (modal) app.append(modal.cloneNode(true));
      const original = [...source.scripts].find(script => script.textContent?.includes('// ---- grand flowchart'))?.textContent ?? '';
      const interactiveCode = original.split('// ---- particle background')[0]
        .replace('const $=s=>document.querySelector(s);', 'const $=s=>root.querySelector(s);')
        .replaceAll('document.addEventListener(', 'root.addEventListener(')
        .replace("history.replaceState(null,'','#'+id)", '')
        .replace("history.replaceState(null,'',location.pathname)", '')
        .replace("if(D[location.hash.slice(1)])show(location.hash.slice(1));", '');
      new Function('root', interactiveCode)(app);
    }

    return () => { document.body.style.overflow = ''; shadow.replaceChildren(); };
  }, [mode]);

  return <div ref={host} className="w-full" />;
}
