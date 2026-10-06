<style>
  .sh1{position:absolute;top:8px;right:8px;z-index:3;display:flex;align-items:center;gap:6px;border:0;border-radius:999px;
       padding:7px 11px 7px 9px;background:rgba(28,26,23,.72);color:#fff;font:600 12px/1.1 var(--body,Arial),Arial,sans-serif;
       -webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.25)}
  .sh1 svg{width:15px;height:15px;flex:none}
  .sh1 small{font-size:11px;opacity:.9;font-weight:500}
  .sh1[disabled]{opacity:.6}
  /* videos: the button sits in a strip UNDER the video, never over it — the phone's volume/mute and
     full-screen buttons live in the video's corners (5 Oct 2026: it was covering the volume icon) */
  .shbar{display:flex;justify-content:flex-end;padding:7px 8px;background:#111}
  .shbar .sh1{position:static;box-shadow:none;background:rgba(255,255,255,.14)}
</style>
<script>
/* SHARE ANY SINGLE PHOTO OR VIDEO (5 Oct 2026): "give an option for share on every photo and video,
   so when customers want to share them singular it's up to them." A button on each design photo and
   each video shares that one file through the phone's share sheet; no share sheet -> it downloads. */
(function(){
  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg>';
  var LABEL = ICON + '<span>Share <small>مشاركة</small></span>';
  function canFiles(f){ try { return !!(navigator.share && navigator.canShare && navigator.canShare({files:[f]})); } catch(e){ return false; } }
  function save(f){ var a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000); }
  function send(f, btn){
    if (!canFiles(f)) { save(f); return; }
    navigator.share({ files: [f] }).catch(function(e){
      if (e && e.name === 'NotAllowedError' && btn) { btn.innerHTML = ICON + '<span>Tap again <small>اضغط مرة أخرى</small></span>'; return; }
      if (!e || e.name !== 'AbortError') save(f);
    });
  }
  function dataFile(src, name){
    var p = src.split(','), bin = atob(p[1]), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new File([u], name, { type: (p[0].match(/data:([^;]+)/) || [,'image/jpeg'])[1] });
  }
  function button(host, onTap, under){
    if (under){ var bar = document.createElement('div'); bar.className = 'shbar'; host.appendChild(bar); host = bar; }
    var b = document.createElement('button'); b.type = 'button'; b.className = 'sh1'; b.innerHTML = LABEL;
    b.setAttribute('aria-label', 'Share this · مشاركة');
    b.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); onTap(b); });
    host.appendChild(b);
  }
  document.querySelectorAll('.design').forEach(function(d){
    var no = d.dataset.no;
    d.querySelectorAll('.photo').forEach(function(ph, i, all){
      var img = ph.querySelector('img'); if (!img) return;
      var name = 'SJ-' + no + (all.length > 1 ? '-' + (i + 1) : '') + '.jpg', file = null;
      button(ph, function(b){ file = file || dataFile(img.src, name); send(file, b); });
    });
    d.querySelectorAll('.vid').forEach(function(v){
      var vEl = v.querySelector('video'); if (!vEl) return;
      var name = 'SJ-' + no + '-video.mp4', file = null, busy = false;
      button(v, function(b){
        if (file) { b.innerHTML = LABEL; send(file, b); return; }
        if (busy) return; busy = true; b.disabled = true;
        b.innerHTML = ICON + '<span>Preparing… <small>جارٍ التحضير</small></span>';
        fetch(vEl.currentSrc || vEl.getAttribute('src')).then(function(r){ return r.blob(); }).then(function(bl){
          file = new File([bl], name, { type: 'video/mp4' }); busy = false; b.disabled = false; b.innerHTML = LABEL;
          send(file, b);                          // if the phone says the tap is too old, the button asks for one more tap
        }).catch(function(){ busy = false; b.disabled = false; b.innerHTML = LABEL; window.open(vEl.currentSrc || vEl.getAttribute('src'), '_blank'); });
      }, true);
    });
  });
})();
</script>
