  // ONE FILE CARRIES THE WHOLE ORDER (Option C 3 Oct 2026; PDF 3 Oct 2026):
  // a card per chosen dress, cut from its own photo column, set count in English over Arabic,
  // then the total band and the delivery photo + notes — laid out on A4 pages and shared as ONE PDF.
  // WhatsApp recompresses a tall JPEG until the cards blur; a PDF goes as a document, untouched.
  function colsOf(ph){
    var nums = ph.dataset.nums.split(',').map(Number), n = nums.length;
    var cols = ph.dataset.cols ? ph.dataset.cols.split(';').map(function(p){ return p.split(',').map(Number); })
             : nums.map(function(_, i){ return [i / n, (i + 1) / n]; });
    return { nums: nums, cols: cols };
  }
  function findDress(no, c){
    var phs = document.querySelectorAll('.design[data-no="' + no + '"] .photo');
    for (var i = 0; i < phs.length; i++){
      var o = colsOf(phs[i]), k = o.nums.indexOf(c);
      if (k >= 0) return { img: phs[i].querySelector('img'), col: o.cols[k] };
    }
    return null;
  }
  function wrap(ctx, text, maxW){
    var words = text.split(' '), cur = '', out = [];
    words.forEach(function(w){ var t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && cur){ out.push(cur); cur = w; } else cur = t; });
    if (cur) out.push(cur); return out;
  }
  var PW = 2480, PH = 3508;                         // A4 at 300 dpi — sharp when zoomed
  function drawPages(){
    var O = window.SJ_ORDER || {date:'', designs:[], tEn:'', tAr:''};
    var notes = (document.getElementById('f-notes').value || '').trim();
    var dimg = document.getElementById('f-prev'), hasPhoto = !!(deliveryFile && dimg && dimg.naturalWidth);
    var W = PW, S = W / 1080, P = Math.round(64 * S), N = 5, G = Math.round(16 * S);
    var TW = Math.floor((W - 2 * P - (N - 1) * G) / N), TH = Math.round(TW * 2.1), CAP = Math.round(100 * S), WIDE = W - 2 * P;
    var BOTTOM = PH - Math.round(70 * S);
    function px(n){ return Math.round(n * S) + 'px Arial'; }
    function bpx(n){ return 'bold ' + px(n); }
    // ---- build blocks: {h, draw(g, y), keepNext, title} ----
    var blocks = [];
    var headH = Math.round((110 + 50 + (CUSTOMER ? 32 : 0) + 26) * S);
    blocks.push({ h: headH, draw: function(g, y){
      var yy = y + Math.round(110 * S) - Math.round(40 * S);
      en(g, 'ORDER REQUEST', P, yy, bpx(44), '#1C1A17'); ar(g, 'طلب شراء', W - P, yy, bpx(44), '#1C1A17');
      yy += Math.round(50 * S);
      if (CUSTOMER){ en(g, CUSTOMER, P, yy, bpx(36), '#1C1A17'); en(g, O.date, W - P, yy, px(26), '#6E675D', 'right'); yy += Math.round(32 * S);
                     if (CUSTOMER_SUB) en(g, CUSTOMER_SUB, P, yy, px(22), '#6E675D'); }
      else en(g, O.date, P, yy, px(26), '#6E675D');
      yy += Math.round(26 * S); line(g, P, yy, W - P, '#DCD6CA', 2);
    }});
    O.designs.forEach(function(d){
      var title = 'DESIGN ' + d.no;
      var tb = { h: Math.round(70 * S), keepNext: true, title: title, draw: function(g, y, cont){
        en(g, title + (cont ? '  (continued)' : ''), P, y + Math.round(52 * S), bpx(38), '#1C1A17'); } };
      blocks.push(tb);
      if (isC(d.no)){
        var im = document.querySelector('.design[data-no="' + d.no + '"] .photo img');
        var hh = Math.round(WIDE * im.naturalHeight / im.naturalWidth);
        var maxh = Math.round(470 * S); if (hh > maxh) hh = maxh;   // two complete designs per page
        var ww = Math.round(hh * im.naturalWidth / im.naturalHeight);
        blocks.push({ h: hh + CAP + Math.round(8 * S), title: title, draw: function(g, y){
          card(g, P + (WIDE - ww) / 2, y, ww, hh, im, 0, 0, im.naturalWidth, im.naturalHeight, 0, d.rows[0].en, d.rows[0].ar); } });
        return;
      }
      // the WHOLE dress, head to hem (5 Oct 2026: "it's half cut") — each card shows its dress's full
      // column fitted inside without cropping, and the card is only as wide as the dress, so rows pack
      // as many dresses as fit across the page
      var items = [];
      d.rows.forEach(function(r){
        var f = findDress(d.no, r.c); if (!f) return;
        var iw = f.img.naturalWidth, ih = f.img.naturalHeight;
        var x0 = f.col[0] * iw, x1 = f.col[1] * iw, pad = (x1 - x0) * 0.02; x0 += pad; x1 -= pad;
        var cw = x1 - x0, k = Math.min(TW / cw, TH / ih), dw = cw * k, dh = ih * k;
        var cwid = Math.round(Math.max(Math.min(TW, dw + 16 * S), TW * 0.62));
        items.push({ r: r, f: f, x0: x0, cw: cw, ih: ih, dw: dw, dh: dh, w: cwid });
      });
      var rows = [], cur = [], used = 0;
      items.forEach(function(it){
        if (cur.length && used + G + it.w > WIDE){ rows.push(cur); cur = []; used = 0; }
        used += (cur.length ? G : 0) + it.w; cur.push(it);
      });
      if (cur.length) rows.push(cur);
      rows.forEach(function(row){
        blocks.push({ h: TH + CAP + Math.round(14 * S), title: title, draw: function(g, y){
          var xc = P;
          row.forEach(function(it){
            card(g, xc, y, it.w, TH, it.f.img, it.x0, 0, it.cw, it.ih, it.r.c, it.r.en, it.r.ar,
                 [xc + (it.w - it.dw) / 2, y + (TH - it.dh), it.dw, it.dh]);
            xc += it.w + G;
          });
        }});
      });
    });
    blocks.push({ h: Math.round((48 + 104) * S), draw: function(g, y){
      var yy = y + Math.round(48 * S), bh = Math.round(104 * S);
      g.fillStyle = '#234C47'; g.fillRect(P, yy, WIDE, bh);
      en(g, O.tEn, P + Math.round(24 * S), yy + Math.round(42 * S), bpx(32), '#F3F6F5');
      ar(g, O.tAr, W - P - Math.round(24 * S), yy + Math.round(86 * S), px(28), '#CFE0DC'); } });
    blocks.push({ h: Math.round(74 * S), keepNext: true, draw: function(g, y){
      var yy = y + Math.round(56 * S);
      en(g, 'DELIVERY', P, yy, bpx(28), '#1C1A17'); ar(g, 'التوصيل', W - P, yy, bpx(28), '#1C1A17'); } });
    if (hasPhoto){
      var pw = WIDE, phh = Math.round(pw * dimg.naturalHeight / dimg.naturalWidth), lim = Math.round(500 * S);
      if (phh > lim){ phh = lim; pw = Math.round(phh * dimg.naturalWidth / dimg.naturalHeight); }
      blocks.push({ h: phh + Math.round(16 * S), draw: function(g, y){
        g.drawImage(dimg, P + (WIDE - pw) / 2, y, pw, phh); g.strokeStyle = '#DCD6CA'; g.lineWidth = 2; g.strokeRect(P + (WIDE - pw) / 2, y, pw, phh); } });
    }
    var mc = document.createElement('canvas').getContext('2d'); mc.font = px(28);
    var isAr = /^[؀-ۿ]/.test(notes);
    (notes ? wrap(mc, notes, WIDE) : (hasPhoto ? [] : ['—'])).forEach(function(l){
      blocks.push({ h: Math.round(42 * S), draw: function(g, y){
        if (isAr) ar(g, l, W - P, y + Math.round(32 * S), px(28), '#3A352E'); else en(g, l, P, y + Math.round(32 * S), px(28), '#3A352E'); } });
    });
    // ---- paginate: a design title never sits alone at a page bottom; a split design repeats its title ----
    var pages = [], cur = null, y = 0, top = Math.round(40 * S);
    function newPage(){ cur = []; pages.push(cur); y = top; }
    newPage();
    for (var i = 0; i < blocks.length; i++){
      var b = blocks[i], need = b.h + (b.keepNext && blocks[i + 1] ? blocks[i + 1].h : 0);
      if (y + need > BOTTOM && cur.length){
        newPage();
        if (!b.keepNext && b.title){ var t = blocks.filter(function(x){ return x.keepNext && x.title === b.title; })[0];
          if (t){ cur.push({ b: t, y: y, cont: true }); y += t.h; } }
      }
      cur.push({ b: b, y: y }); y += b.h;
    }
    return pages.map(function(items, pi){
      var cv = document.createElement('canvas'); cv.width = W; cv.height = PH; var g = cv.getContext('2d');
      g.fillStyle = '#F4F2ED'; g.fillRect(0, 0, W, PH); g.fillStyle = '#8A6A2A'; g.fillRect(0, 0, W, Math.round(10 * S));
      g.textBaseline = 'alphabetic';
      items.forEach(function(it){ it.b.draw(g, it.y, it.cont); });
      en(g, (CUSTOMER ? CUSTOMER + '  ·  ' : '') + O.date + '  ·  page ' + (pi + 1) + ' / ' + pages.length,
         W / 2, PH - Math.round(24 * S), px(18), '#9A9286', 'center');
      if (window.SJ_LINK){                                   // the whole strip is a live link in the PDF
        en(g, 'Tap here to reopen this order', W / 2 - Math.round(12 * S), PH - Math.round(50 * S), bpx(20), '#234C47', 'right');
        ar(g, 'اضغط هنا لفتح الطلب', W / 2 + Math.round(12 * S), PH - Math.round(50 * S), bpx(20), '#234C47', 'left');
      }
      return cv;
    });
    function en(g, t, x, yy, font, col, al){ g.font = font; g.fillStyle = col; g.textAlign = al || 'left'; g.direction = 'ltr'; g.fillText(t, x, yy); }
    function ar(g, t, x, yy, font, col, al){ g.font = font; g.fillStyle = col; g.textAlign = al || 'right'; g.direction = 'rtl'; g.fillText(t, x, yy); g.direction = 'ltr'; }
    function fit(g, t, w, n, b){ for (; n > 12; n--){ g.font = b ? bpx(n) : px(n); if (g.measureText(t).width <= w - 14 * S) break; } return b ? bpx(n) : px(n); }
    function line(g, x0, yy, x1, col, w){ g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, yy); g.lineTo(x1, yy); g.stroke(); }
    function card(g, x, y0, w, h, img, sx, sy, sw, sh, badge, tEn, tAr, box){
      if (box){ g.fillStyle = '#EFEBE3'; g.fillRect(x, y0, w, h); g.drawImage(img, sx, sy, sw, sh, box[0], box[1], box[2], box[3]); }
      else g.drawImage(img, sx, sy, sw, sh, x, y0, w, h);
      g.fillStyle = '#FFFFFF'; g.fillRect(x, y0 + h, w, CAP);
      g.strokeStyle = '#DCD6CA'; g.lineWidth = 2; g.strokeRect(x + 1, y0 + 1, w - 2, h + CAP - 2);
      if (badge){ var r = Math.round(19 * S), cx = x + Math.round(12 * S) + r, cy = y0 + Math.round(12 * S) + r;
        g.fillStyle = '#234C47'; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill(); g.strokeStyle = '#FFFFFF'; g.lineWidth = 3; g.stroke();
        g.fillStyle = '#F3F6F5'; g.font = bpx(22); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(badge), cx, cy + 1); g.textBaseline = 'alphabetic'; }
      en(g, tEn, x + w / 2, y0 + h + Math.round(40 * S), fit(g, tEn, w, 24, true), '#1C1A17', 'center');
      ar(g, tAr, x + w / 2, y0 + h + Math.round(80 * S), fit(g, tAr, w, 22, false), '#234C47', 'center');
    }
  }
  // minimal PDF writer: one full-page JPEG per A4 page, no library needed, runs synchronously inside the tap
  function b64bytes(d){ var s = atob(d.split(',')[1]), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  function makePDF(canvases, link){
    var parts = [], len = 0, offs = [];
    function add(x){ if (typeof x === 'string'){ var u = new Uint8Array(x.length); for (var i = 0; i < x.length; i++) u[i] = x.charCodeAt(i) & 255; x = u; } parts.push(x); len += x.length; }
    function obj(n){ offs[n] = len; add(n + ' 0 obj\n'); }
    var n = canvases.length, MW = 595.28, MH = 841.89;
    var esc = (link || '').replace(/[^\x20-\x7E]/g, encodeURIComponent).replace(/([\\()])/g, '\\$1');
    var annot = link ? ' /Annots [<< /Type /Annot /Subtype /Link /Rect [0 0 ' + MW + ' ' + (MH * 66 / 1528).toFixed(2) + '] /Border [0 0 0] /A << /S /URI /URI (' + esc + ') >> >>]' : '';
    add('%PDF-1.4\n%âãÏÓ\n');
    obj(1); add('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    var kids = []; for (var i = 0; i < n; i++) kids.push((3 + 3 * i) + ' 0 R');
    obj(2); add('<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>\nendobj\n');
    canvases.forEach(function(cv, i){
      var p = 3 + 3 * i, c = p + 1, im = p + 2, jpg = b64bytes(cv.toDataURL('image/jpeg', 0.86));
      var cs = 'q ' + MW + ' 0 0 ' + MH + ' 0 0 cm /Im0 Do Q';
      obj(p); add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + MW + ' ' + MH + '] /Resources << /XObject << /Im0 ' + im + ' 0 R >> >> /Contents ' + c + ' 0 R' + annot + ' >>\nendobj\n');
      obj(c); add('<< /Length ' + cs.length + ' >>\nstream\n' + cs + '\nendstream\nendobj\n');
      obj(im); add('<< /Type /XObject /Subtype /Image /Width ' + cv.width + ' /Height ' + cv.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpg.length + ' >>\nstream\n');
      add(jpg); add('\nendstream\nendobj\n');
    });
    var total = 3 + 3 * n, xref = len;
    var x = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
    for (var k = 1; k < total; k++) x += ('0000000000' + offs[k]).slice(-10) + ' 00000 n \n';
    add(x + 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    var out = new Uint8Array(len), o = 0; parts.forEach(function(p){ out.set(p, o); o += p.length; });
    return out;
  }
  function orderFileName(){
    var base = (CUSTOMER ? CUSTOMER.replace(/[^A-Za-z0-9]+/g, '-') + '-' : '') + 'SJ-order';
    return base.replace(/-+$/, '') + '.pdf';
  }
  function summaryImage(text){
    return new File([makePDF(drawPages(), window.SJ_LINK || '')], orderFileName(), {type: 'application/pdf'});
  }
  function showSheet(){
    if (!window.SJ_ORDER) return;
    var m = document.getElementById('marks'); if (!m) return;
    m.innerHTML = '';
    drawPages().forEach(function(cv){ var im = document.createElement('img'); im.alt = 'Your order'; im.src = cv.toDataURL('image/jpeg', 0.7); m.appendChild(im); });
  }
