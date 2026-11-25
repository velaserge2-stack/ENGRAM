// Ensambla docs/landing/preview.html (un solo archivo, sin red).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const d = dirname(fileURLToPath(import.meta.url));
const rd = (f) => { try { return readFileSync(join(d, f), 'utf8'); } catch { return f.endsWith('.css') ? '' : `<main id="${f.startsWith('landing') ? 'landing' : 'acceso'}" hidden></main>`; } };
const logo = 'data:image/png;base64,' + readFileSync(join(d, '../../public/brand/logo-64.png')).toString('base64');
const router = `
(function(){
  var root=document.documentElement;
  window.engTheme={set:function(m){root.classList.toggle('dark',m==='dark');document.querySelectorAll('[data-theme-set]').forEach(function(b){b.setAttribute('aria-pressed',b.getAttribute('data-theme-set')===m)})},toggle:function(){this.set(root.classList.contains('dark')?'light':'dark')}};
  var pages={'/':'landing','/entrar':'acceso','/crear':'acceso'};
  function show(){
    var h=(location.hash||'#/').slice(1)||'/'; if(!pages[h]) h='/';
    document.querySelectorAll('main[id]').forEach(function(m){m.hidden=m.id!==pages[h]});
    root.setAttribute('data-route',h);
    document.dispatchEvent(new CustomEvent('eng:route',{detail:h}));
    window.scrollTo(0,0);
  }
  addEventListener('hashchange',show);
  document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('[data-go]');if(!a)return;e.preventDefault();
    var go=function(){var el=document.getElementById('lp-'+a.getAttribute('data-go'));if(el)el.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth',block:'start'})};
    if((location.hash||'#/')!=='#/'){location.hash='#/';setTimeout(go,60)}else go()});
  document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-theme-set]');if(b)window.engTheme.set(b.getAttribute('data-theme-set'))});
  show();
})();`;
const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Engrama · vista previa de la página de presentación</title>
<style>${rd('base.css')}</style>
</head>
<body>
<div class="bg"></div>
<div class="maqueta glass" role="note">Maqueta · precios, cuentas y acceso son de ejemplo; esta página no envía nada.</div>
${rd('landing.fragment.html').replaceAll('{{LOGO}}', logo)}
${rd('acceso.fragment.html').replaceAll('{{LOGO}}', logo)}
<script>${router}</script>
</body>
</html>`;
const OUT = process.env.OUT || join(d, 'preview.html');
writeFileSync(OUT, html);
console.log(OUT, Math.round(html.length / 1024) + ' KB');
