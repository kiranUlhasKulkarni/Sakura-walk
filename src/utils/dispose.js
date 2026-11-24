/**
 * Frees every GPU resource under `root` (geometries, materials, textures,
 * skeleton bone textures) and detaches it from its parent. Shared resources
 * passed in `keep` are skipped (e.g. a geometry reused by several instances).
 */
export function disposeObject(root, keep = new Set()) {
  if (!root) return;
  const textures = new Set();
  root.traverse((o) => {
    if (o.geometry && !keep.has(o.geometry)) o.geometry.dispose();
    if (o.skeleton?.boneTexture) o.skeleton.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (keep.has(m)) continue;
      for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
      if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u?.value?.isTexture) textures.add(u.value);
      m.dispose();
    }
    o.dispose?.(); // InstancedMesh / lights
  });
  for (const t of textures) if (!keep.has(t)) t.dispose();
  root.removeFromParent();
}
