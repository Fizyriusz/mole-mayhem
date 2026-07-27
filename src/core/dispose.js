/**
 * Zwalnianie zasobow GPU. Kazdy mecz tworzy nowe modele postaci i warzyw —
 * bez tego pamiec karty rosla by z kazda rozgrywka.
 */
export function disposeObject(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) {
      for (const key of Object.keys(m)) {
        const v = m[key];
        // tekstury z cache'u textures.js sa wspoldzielone — kasujemy tylko jednorazowe
        if (v && v.isTexture && !v.userData?.shared) v.dispose();
      }
      m.dispose();
    }
  });
  if (root.parent) root.parent.remove(root);
}
