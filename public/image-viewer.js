(() => {
  const dialog = document.querySelector('#imageViewer');
  const stage = document.querySelector('#viewerStage');
  const image = document.querySelector('#viewerImage');
  const preview = document.querySelector('#detailImage');
  let scale = 1;
  let x = 0;
  let y = 0;
  let pointer = null;
  let fitMode = true;

  function render() {
    image.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`;
    document.querySelector('#viewerScale').textContent = `${Math.round(scale * 100)}%`;
  }

  function fit() {
    if (!image.naturalWidth || !image.naturalHeight) return;
    scale = Math.min((stage.clientWidth - 32) / image.naturalWidth, (stage.clientHeight - 32) / image.naturalHeight, 1);
    x = y = 0;
    fitMode = true;
    render();
  }

  function zoom(next, anchorX = 0, anchorY = 0) {
    const target = Math.max(.02, Math.min(8, next));
    const ratio = target / scale;
    x = anchorX - (anchorX - x) * ratio;
    y = anchorY - (anchorY - y) * ratio;
    scale = target;
    fitMode = false;
    render();
  }

  function open() {
    if (!preview.src) return;
    document.querySelector('#viewerTitle').textContent = preview.alt || '图片';
    image.alt = preview.alt;
    image.style.width = '';
    image.style.height = '';
    image.src = preview.currentSrc || preview.src;
    dialog.showModal();
    if (image.complete && image.naturalWidth) fit();
  }

  preview.addEventListener('click', open);
  preview.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
  });
  image.addEventListener('load', () => {
    image.style.width = `${image.naturalWidth}px`;
    image.style.height = `${image.naturalHeight}px`;
    fit();
  });
  document.querySelector('#viewerClose').addEventListener('click', () => dialog.close());
  document.querySelector('#viewerFit').addEventListener('click', fit);
  document.querySelector('#viewerOriginal').addEventListener('click', () => { x = y = 0; zoom(1); });
  document.querySelector('#viewerZoomIn').addEventListener('click', () => zoom(scale * 1.4));
  document.querySelector('#viewerZoomOut').addEventListener('click', () => zoom(scale / 1.4));
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { pointer = null; preview.focus(); });
  stage.addEventListener('wheel', event => {
    event.preventDefault();
    const bounds = stage.getBoundingClientRect();
    zoom(scale * Math.exp(-event.deltaY * .002), event.clientX - bounds.left - bounds.width / 2, event.clientY - bounds.top - bounds.height / 2);
  }, { passive: false });
  stage.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add('is-dragging');
  });
  stage.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    x += event.clientX - pointer.x;
    y += event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    fitMode = false;
    render();
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) stage.addEventListener(name, () => {
    pointer = null;
    stage.classList.remove('is-dragging');
  });
  window.addEventListener('resize', () => { if (dialog.open && fitMode) fit(); });
})();
