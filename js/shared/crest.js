/* Local crest fallback. */
function installCrestFallback() {
  const crest = document.querySelector('.crest');
  const frame = crest?.closest('.crest-frame');
  if (!crest || !frame) return;

  const showFallback = () => {
    crest.hidden = true;
    frame.classList.add('crest-fallback');
  };

  crest.addEventListener('error', showFallback, { once: true });
  if (crest.complete && crest.naturalWidth === 0) showFallback();
}


installCrestFallback();
