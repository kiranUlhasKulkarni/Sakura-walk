import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ASSETS } from '../config.js';

/**
 * Loads every GLB in the manifest in parallel behind the gate, reporting one
 * combined byte-weighted progress value. A failed model resolves to null (the
 * show goes on without it) and is logged.
 */
export class AssetLibrary {
  constructor(manifest = ASSETS) {
    this.manifest = manifest;
    this.gltf = {};
    this.loader = new GLTFLoader();
  }

  async loadAll(onProgress) {
    const bytes = {};
    const report = () => {
      let l = 0, t = 0;
      for (const b of Object.values(bytes)) {
        l += b.loaded;
        t += b.total;
      }
      onProgress?.(t ? l / t : 0);
    };
    await Promise.all(
      Object.entries(this.manifest).map(async ([key, def]) => {
        bytes[key] = { loaded: 0, total: 1 };
        try {
          this.gltf[key] = await this.loader.loadAsync(def.url, (e) => {
            bytes[key] = { loaded: e.loaded, total: e.total || e.loaded || 1 };
            report();
          });
        } catch (err) {
          console.error(`[assets] ${key} failed to load`, err);
          this.gltf[key] = null;
        }
        bytes[key].loaded = bytes[key].total;
        report();
      }),
    );
    return this.gltf;
  }
}

const _box = new Box3(), _size = new Vector3(), _c = new Vector3();

/**
 * Rescales `root` so its bounds match the requested size and puts its feet
 * on y = 0 centred on the origin (xz). Wrap the model in a Group first if you
 * need to rotate it afterwards. One of:
 *   { height }  vertical extent,
 *   { length }  longest horizontal extent,
 *   { width }   longest horizontal extent (alias for props).
 */
export function fitObject(root, { height, length, width }) {
  root.updateMatrixWorld(true);
  _box.setFromObject(root, true);
  _box.getSize(_size);
  let s = 1;
  if (height) s = height / _size.y;
  else if (length || width) s = (length || width) / Math.max(_size.x, _size.z);
  root.scale.multiplyScalar(s);
  root.updateMatrixWorld(true);
  _box.setFromObject(root, true);
  _box.getCenter(_c);
  root.position.x -= _c.x;
  root.position.z -= _c.z;
  root.position.y -= _box.min.y;
  return root;
}
