// "Copiar" buttons: copy the text of the element named by data-t.
document.querySelectorAll('.copy').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const el = document.getElementById(btn.dataset.t);
    try {
      await navigator.clipboard.writeText(el.innerText);
    } catch (e) {
      const r = document.createRange();
      r.selectNode(el);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      document.execCommand('copy');
      getSelection().removeAllRanges();
    }
    const old = btn.textContent;
    btn.textContent = '¡Copiado!';
    btn.classList.add('done');
    setTimeout(() => {
      btn.textContent = old;
      btn.classList.remove('done');
    }, 1600);
  });
});
