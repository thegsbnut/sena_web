// Minimal LINE Flex Message -> HTML renderer (enough for Badbot's cards).
// Units are LINE "px" (CSS px on a phone). Spec: developers.line.biz Flex Message layout.
(function () {
  const SP = { none: 0, xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 20 };
  const TS = {
    xxs: 11,
    xs: 13,
    sm: 14,
    md: 16,
    lg: 19,
    xl: 22,
    xxl: 29,
    '3xl': 35,
    '4xl': 48,
    '5xl': 74,
  };
  const IS = {
    xxs: 40,
    xs: 60,
    sm: 80,
    md: 100,
    lg: 120,
    xl: 140,
    xxl: 160,
    '3xl': 180,
    '4xl': 200,
    '5xl': 240,
  };
  const RAD = { none: 0, xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 20 };
  const BW = { none: 0, light: 0.5, normal: 1, medium: 2, 'semi-bold': 3, bold: 4 };
  const WIDTH = { nano: 120, micro: 160, deca: 220, hecto: 241, kilo: 260, mega: 300, giga: 386 };
  const len = (v, map) =>
    v == null ? null : map && map[v] != null ? map[v] + 'px' : /^[\d.]+(px|%)$/.test(v) ? v : null;
  let urlMap = u => u;
  const esc = s =>
    String(s).replace(
      /[&<>"]/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
    );
  const color = c => {
    if (!c) return c;
    const m = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(c);
    return m ? `#${m[1]}${m[2]}` : c;
  };
  const css = o =>
    Object.entries(o)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${k}:${v}`)
      .join(';');

  function boxStyle(b) {
    const s = {};
    if (b.backgroundColor) s.background = color(b.backgroundColor);
    if (b.background?.type === 'linearGradient') {
      const g = b.background;
      s.background = `linear-gradient(${g.angle}, ${color(g.startColor)}${g.centerColor ? ', ' + color(g.centerColor) + ' ' + (g.centerPosition || '50%') : ''}, ${color(g.endColor)})`;
    }
    if (b.cornerRadius) s['border-radius'] = len(b.cornerRadius, RAD);
    if (b.borderWidth)
      s.border = `${BW[b.borderWidth] != null ? BW[b.borderWidth] + 'px' : b.borderWidth} solid ${color(b.borderColor) || '#000'}`;
    const pa = len(b.paddingAll, SP);
    for (const [k, side] of [
      ['paddingTop', 'top'],
      ['paddingBottom', 'bottom'],
      ['paddingStart', 'left'],
      ['paddingEnd', 'right'],
    ]) {
      const v = len(b[k], SP) ?? pa;
      if (v != null) s['padding-' + side] = v;
    }
    if (b.width) s.width = len(b.width);
    if (b.height) s.height = len(b.height);
    if (b.maxWidth) s['max-width'] = len(b.maxWidth);
    if (b.justifyContent) s['justify-content'] = b.justifyContent.replace('flex-', 'flex-');
    if (b.alignItems) s['align-items'] = b.alignItems;
    if (b.cornerRadius || b.borderWidth) s.overflow = 'hidden';
    return s;
  }

  function flexOf(c, parent) {
    const horiz = parent !== 'vertical';
    const f = c.flex != null ? c.flex : horiz ? 1 : 0;
    if (c.type === 'filler') return { flex: `${c.flex ?? 1} 1 0`, 'min-width': 0 };
    return f > 0 ? { flex: `${f} ${f} 0`, 'min-width': 0 } : { flex: '0 0 auto' };
  }

  function children(b) {
    const dir = b.layout === 'vertical' ? 'top' : 'left';
    return (b.contents || [])
      .map((c, i) => {
        const m = i === 0 ? null : c.margin != null ? len(c.margin, SP) : len(b.spacing, SP);
        return render(c, b.layout, m ? { ['margin-' + dir]: m } : {});
      })
      .join('');
  }

  function render(c, parent, extra = {}) {
    const base = { ...flexOf(c, parent), ...extra };
    if (parent === 'vertical' && c.flex == null) delete base.flex;
    switch (c.type) {
      case 'box': {
        const s = {
          display: 'flex',
          'flex-direction': c.layout === 'vertical' ? 'column' : 'row',
          ...(c.layout === 'baseline' ? { 'align-items': 'baseline' } : {}),
          ...base,
          ...boxStyle(c),
          'box-sizing': 'border-box',
        };
        if (parent === 'vertical' && !s.width) s['align-self'] = 'stretch';
        return `<div style="${css(s)}">${children(c)}</div>`;
      }
      case 'text': {
        const size = len(c.size, TS) || '16px';
        const s = {
          ...base,
          'font-size': size,
          'font-weight': c.weight === 'bold' ? 700 : 400,
          color: color(c.color) || '#111111',
          'text-align': { start: 'left', end: 'right', center: 'center' }[c.align] || 'left',
          'line-height': c.lineSpacing ? `calc(${size} + ${c.lineSpacing})` : '1.4',
          ...(c.wrap
            ? { 'white-space': 'pre-wrap', 'word-break': 'break-word' }
            : { 'white-space': 'nowrap', overflow: 'hidden', 'text-overflow': 'ellipsis' }),
          ...(c.gravity
            ? {
                'align-self': { top: 'flex-start', center: 'center', bottom: 'flex-end' }[
                  c.gravity
                ],
              }
            : {}),
          ...(c.style === 'italic' ? { 'font-style': 'italic' } : {}),
          ...(c.decoration ? { 'text-decoration': c.decoration } : {}),
        };
        if (c.maxLines)
          Object.assign(s, {
            display: '-webkit-box',
            '-webkit-line-clamp': c.maxLines,
            '-webkit-box-orient': 'vertical',
            overflow: 'hidden',
          });
        const inner = c.contents?.length
          ? c.contents
              .map(
                sp =>
                  `<span style="${css({ 'font-size': len(sp.size, TS), color: color(sp.color), 'font-weight': sp.weight === 'bold' ? 700 : null, 'text-decoration': sp.decoration })}">${esc(sp.text || '')}</span>`,
              )
              .join('')
          : esc(c.text);
        return `<div style="${css(s)}">${inner}</div>`;
      }
      case 'icon': {
        const sz = len(c.size, TS) || '16px';
        const [w, h] = (c.aspectRatio || '1:1').split(':').map(Number);
        return `<img src="${esc(urlMap(c.url))}" style="${css({ ...extra, width: `calc(${sz} * ${w / h})`, height: sz, 'vertical-align': 'baseline', flex: '0 0 auto', 'align-self': 'center' })}">`;
      }
      case 'image': {
        const [w, h] = (c.aspectRatio || '1:1').split(':').map(Number);
        const width = c.size === 'full' ? '100%' : len(c.size, IS) || '100px';
        const wrap = {
          ...base,
          display: 'flex',
          'justify-content': { start: 'flex-start', end: 'flex-end' }[c.align] || 'center',
          background: color(c.backgroundColor),
        };
        return `<div style="${css(wrap)}"><div style="${css({ width, 'max-width': '100%', 'aspect-ratio': `${w}/${h}`, overflow: 'hidden' })}"><img src="${esc(urlMap(c.url))}" style="width:100%;height:100%;display:block;object-fit:${c.aspectMode === 'cover' ? 'cover' : 'contain'}"></div></div>`;
      }
      case 'button': {
        const st = c.style || 'link';
        const bg =
          st === 'primary'
            ? color(c.color) || '#17C950'
            : st === 'secondary'
              ? color(c.color) || '#DCDFE5'
              : 'transparent';
        const fg =
          st === 'primary'
            ? '#FFFFFF'
            : st === 'secondary'
              ? '#111111'
              : color(c.color) || '#42659A';
        const h = c.height === 'sm' ? 40 : 52;
        const s = {
          ...base,
          height: h + 'px',
          background: bg,
          color: fg,
          'border-radius': '8px',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          'font-size': '16px',
          padding: '0 8px',
          'box-sizing': 'border-box',
          'white-space': 'nowrap',
          overflow: 'hidden',
        };
        if (parent === 'vertical') s['align-self'] = 'stretch';
        return `<div class="fx-btn" data-label="${esc(c.action?.label || '')}" style="${css(s)}"><span style="overflow:hidden;text-overflow:ellipsis">${esc(c.action?.label || '')}</span></div>`;
      }
      case 'separator': {
        const s =
          parent === 'vertical'
            ? { ...extra, height: '1px', 'align-self': 'stretch' }
            : { ...extra, width: '1px', 'align-self': 'stretch', flex: '0 0 auto' };
        s.background = color(c.color) || '#D4D6DA';
        return `<div style="${css(s)}"></div>`;
      }
      case 'filler':
        return `<div style="${css(base)}"></div>`;
      case 'span':
        return '';
      default:
        return '';
    }
  }

  function block(b, defaults) {
    if (!b) return '';
    if (b.type === 'image') return render(b, 'vertical');
    const pad = defaults;
    const box = { ...b };
    const s = {
      display: 'flex',
      'flex-direction': b.layout === 'vertical' ? 'column' : 'row',
      padding: `${pad}px`,
      background: '#FFFFFF',
      ...boxStyle(box),
      'box-sizing': 'border-box',
    };
    return `<div style="${css(s)}">${children(box)}</div>`;
  }

  function bubble(b) {
    const w = WIDTH[b.size || 'mega'];
    return `<div class="fx-bubble" style="width:${w}px;max-width:100%;border-radius:17px;overflow:hidden;background:#fff;display:flex;flex-direction:column;font-family:inherit">${block(b.header, 20)}${b.hero ? render(b.hero, 'vertical') : ''}${block(b.body, 20)}${block(b.footer, 10)}</div>`;
  }

  window.Flex = {
    render(contents, map) {
      if (map) urlMap = map;
      if (contents.type === 'carousel')
        return `<div style="display:flex;gap:9px">${contents.contents.map(bubble).join('')}</div>`;
      return bubble(contents);
    },
  };
})();
