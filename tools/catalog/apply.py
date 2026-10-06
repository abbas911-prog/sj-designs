import re, sys
JS = open('' + __import__('os').path.dirname(__file__) + '/sheet.js', encoding='utf-8').read()
SHARE = """  document.getElementById('share').addEventListener('click', function(){
    shareText = buildText();
    var pdf = summaryImage(shareText), payload = { files: [pdf] };     // the PDF only — nothing else goes
    if (!navigator.share || (navigator.canShare && !navigator.canShare(payload))) { fallbackToText(pdf); return; }
    var p;
    try { p = navigator.share(payload); } catch (e) { fallbackToText(pdf); return; }
    p.catch(function(err){ if (!err || err.name !== 'AbortError') fallbackToText(pdf); });
  });
"""
FALLBACK = """  function fallbackToText(pdf){
    try { pdf = pdf || summaryImage(buildText());
      var a = document.createElement('a'); a.href = URL.createObjectURL(pdf); a.download = pdf.name;
      document.body.appendChild(a); a.click(); a.remove(); } catch (e) {}
    var bl = document.getElementById('blocked');
    bl.innerHTML = 'Your order PDF has been saved to your phone. Open WhatsApp and attach it. <span class="ar">تم حفظ ملف الطلب PDF على هاتفك. افتح واتساب وأرفقه.</span>';
    bl.hidden = false;
    document.getElementById('share').hidden = true;
    document.getElementById('wa').hidden = false;
  }
"""
def apply(src, share=True):
    a = src.index('  function summaryImage(text){'); b = src.index('  function fallbackToText(){')
    src = src[:a] + JS + src[b:]
    old = """    var files = shareFiles.slice();
    if (deliveryFile) files.push(deliveryFile);
    files.push(summaryImage(shareText));        // the ordered list, last — the link rides with it"""
    assert old in src; src = src.replace(old, "    var files = [summaryImage(shareText)];      // one picture: the whole order, the link rides with it")
    # preview of exactly what will be sent, refreshed when delivery details change
    # 4 Oct 2026: the confirm screen stays as before — the marked (faded) photos, NOT the PDF pages.
    # The PDF is made only when the customer taps Send order.
    old3 = "    var img = document.getElementById('f-prev'); img.src = URL.createObjectURL(f); img.hidden = false;"
    assert old3 in src
    old4 = "document.addEventListener('input', function(e){ if (e.target.closest('.dl')) { shareText = buildText(); } });"
    assert old4 in src
    # PDF ONLY (3 Oct 2026): "when he says send order, he sends me the final PDF only".
    # Share carries the PDF and nothing else — no caption text; the reopen link lives inside the PDF.
    a = src.index("  document.getElementById('share').addEventListener('click', function(){")
    b = src.index("  function openFromLink(){")
    src = src[:a] + SHARE + src[b:]
    # if the phone cannot share a file: save the PDF, open the WhatsApp chat empty, tell them to attach it
    a = src.index("  function fallbackToText(){"); b = src.index("  }\n", a) + 4
    src = src[:a] + FALLBACK + src[b:]
    o5 = "sb.hidden = !canShare; document.getElementById('wa').hidden = canShare;"
    assert o5 in src; src = src.replace(o5, "sb.hidden = false; document.getElementById('wa').hidden = true;   // one button always: it shares the PDF, or saves it")
    src = src.replace('>Send photos + order</button>', '>Send order · إرسال الطلب</button>')
    src = src.replace(">Send on WhatsApp</a>", ">Open WhatsApp · افتح واتساب</a>")
    src = src.replace("document.getElementById('wa').href = 'https://wa.me/971562529222?text=' + encodeURIComponent(text);",
                      "document.getElementById('wa').href = 'https://wa.me/971562529222';   // no order text — the order is the PDF")
    # confirm-screen text unchanged (was briefly replaced 3 Oct)
    # SHARE ANY SINGLE PHOTO OR VIDEO (5 Oct 2026) — a Share button on every design photo and video
    if share and 'class="sh1"' not in src and '.sh1{' not in src:
        i = src.rindex('</body>'); src = src[:i] + open('' + __import__('os').path.dirname(__file__) + '/share1.js', encoding='utf-8').read() + '\n' + src[i:]
    return src
if __name__ == '__main__':
    p = sys.argv[1]; s = open(p, encoding='utf-8').read(); open(p, 'w', encoding='utf-8').write(apply(s)); print('applied', p)
