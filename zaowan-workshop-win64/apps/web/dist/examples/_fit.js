const fit = () => {
  const s = Math.min(innerWidth / 1536, innerHeight / 1024);
  document.body.style.transform = 'scale(' + s + ')';
};
addEventListener('resize', fit);
fit();
