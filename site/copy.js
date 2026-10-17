// "Copiar" buttons: copy the text of the element named by data-t.
document.querySelectorAll('.copy').forEach((btn) => {
  const el = document.getElementById(btn.dataset.t);
  if (!el) return;
  const label = btn.textContent;
  let timer;
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(el.innerText);
    } catch (e) {
      // Fallback for browsers without the async clipboard API.
      const r = document.createRange();
      r.selectNode(el);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      document.execCommand('copy');
      getSelection().removeAllRanges();
    }
    btn.textContent = '¡Copiado!';
    btn.classList.add('done');
    clearTimeout(timer);
    timer = setTimeout(() => {
      btn.textContent = label;
      btn.classList.remove('done');
    }, 1600);
  });
});
